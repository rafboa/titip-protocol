// apps/oracle/src/stellar/submit.ts
// The oracle signs and submits `confirm_delivery` to the Soroban contract with its
// own keypair (ORACLE_SECRET_KEY), then tells the web app so it can sync its DB.
// The web app never holds the oracle secret; it re-reads on-chain state before
// trusting this callback (the contract is the source of truth).

import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk'
import { config } from '../config.js'
import {
  decideDeliveryStep,
  isAlreadyDeliveredResponse,
  parseApprovals,
  parseOracleSet,
  type DeliveryStep,
} from './quorum.js'

// TODO(mainnet): verify passphrase, RPC URL and fee multiplier before deploying.
const NETWORK_PASSPHRASE =
  config.STELLAR_NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015'
const FEE_MULTIPLIER = 100 // BASE_FEE * 100 for contract calls (claude.md)
const POLL_ATTEMPTS = 30

const server = new rpc.Server(config.SOROBAN_RPC_URL)
const oracleKeypair = Keypair.fromSecret(config.ORACLE_SECRET_KEY)

type ConfirmDeliveryResult = {
  success: boolean
  escrowId: string
  txHash: string | null
}

/** Read-only contract call via simulation. A throwaway account is enough. */
async function readContract(
  contractAddress: string,
  method: string,
  args: ReturnType<typeof nativeToScVal>[]
): Promise<unknown> {
  const contract = new Contract(contractAddress)
  const dummy = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0')
  const tx = new TransactionBuilder(dummy, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build()

  const simulated = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`${method} simulation failed: ${simulated.error}`)
  }
  const retval = (simulated as rpc.Api.SimulateTransactionSuccessResponse).result?.retval
  return retval ? scValToNative(retval) : undefined
}

/** Returns the contract's escrow status ("Shipped", "Delivered", ...). */
async function getOnChainStatus(contractAddress: string, contractEscrowId: bigint): Promise<string> {
  const value = await readContract(contractAddress, 'get_escrow', [
    nativeToScVal(contractEscrowId, { type: 'u64' }),
  ])
  if (!value) throw new Error(`Escrow ${contractEscrowId} not found on chain`)

  const native = value as { status: unknown }
  // Unit enum variants decode as ['Shipped'] (a one-element array).
  if (typeof native.status === 'string') return native.status
  if (Array.isArray(native.status) && typeof native.status[0] === 'string') return native.status[0]
  if (typeof native.status === 'object' && native.status !== null) {
    return Object.keys(native.status)[0] ?? 'Unknown'
  }
  return 'Unknown'
}

/** Signs `method` as the oracle, simulates, submits and waits for success. Returns the tx hash. */
async function invokeAsOracle(
  contractAddress: string,
  method: string,
  args: ReturnType<typeof nativeToScVal>[]
): Promise<string> {
  const contract = new Contract(contractAddress)
  const account = await server.getAccount(oracleKeypair.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * FEE_MULTIPLIER),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build()

  // Simulate first: gives the footprint and resource fees.
  const simulated = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`${method} simulation failed: ${simulated.error}`)
  }

  const prepared = rpc.assembleTransaction(tx, simulated).build()
  prepared.sign(oracleKeypair)

  const sent = await server.sendTransaction(prepared)
  if (sent.status === 'ERROR') {
    throw new Error(`${method} submission failed: ${JSON.stringify(sent.errorResult)}`)
  }

  let result = await server.getTransaction(sent.hash)
  for (let i = 0; i < POLL_ATTEMPTS && result.status === 'NOT_FOUND'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    result = await server.getTransaction(sent.hash)
  }
  if (result.status !== 'SUCCESS') {
    throw new Error(`${method} did not succeed: ${result.status}`)
  }
  return sent.hash
}

export type DeliveryResult = {
  /** True when the funds are released on-chain (by this node or by the other oracles). */
  released: boolean
  /** Hash of the transaction this node sent, or null if it sent none. */
  txHash: string | null
  /** Which step this node took; lets callers record only the calls that did something. */
  step: DeliveryStep['kind']
}

/**
 * Signs and submits this node's part of the delivery as a whitelisted oracle.
 *
 * - No oracle set on the contract: `confirm_delivery` (single oracle, as before).
 * - M-of-N oracle set: `approve_delivery`. The funds are released by whichever oracle's approval
 *   completes the quorum; the others get `released: false` until then.
 *
 * Idempotent and safe to run on several nodes at once: an already Delivered escrow sends no
 * transaction, a node that already approved does not pay for a second approval, and losing the
 * race to the final approval (the escrow turned Delivered meanwhile) counts as released.
 */
export async function submitConfirmDeliveryOnChain(
  contractAddress: string,
  contractEscrowId: bigint
): Promise<DeliveryResult> {
  const idArg = nativeToScVal(contractEscrowId, { type: 'u64' })
  const me = oracleKeypair.publicKey()

  const [status, setValue, approvalsValue] = await Promise.all([
    getOnChainStatus(contractAddress, contractEscrowId),
    readContract(contractAddress, 'get_oracle_set', []),
    readContract(contractAddress, 'get_delivery_approvals', [idArg]),
  ])

  const step = decideDeliveryStep({
    status,
    oracleSet: parseOracleSet(setValue),
    approvals: parseApprovals(approvalsValue),
    me,
  })

  switch (step.kind) {
    case 'already-delivered':
      return { released: true, txHash: null, step: step.kind }
    case 'wrong-status':
      throw new Error(`Escrow ${contractEscrowId} is "${step.status}" on chain; expected "Shipped"`)
    case 'not-in-set':
      throw new Error(`Oracle key ${me} is not in the contract's oracle set; check ORACLE_SECRET_KEY`)
    case 'waiting':
      console.log(
        `[submit] escrow ${contractEscrowId}: waiting for quorum (${step.approvals}/${step.threshold} approvals)`
      )
      return { released: false, txHash: null, step: step.kind }
    case 'confirm-delivery':
    case 'approve': {
      try {
        const txHash =
          step.kind === 'confirm-delivery'
            ? await invokeAsOracle(contractAddress, 'confirm_delivery', [idArg])
            : await invokeAsOracle(contractAddress, 'approve_delivery', [
                idArg,
                nativeToScVal(me, { type: 'address' }),
              ])
        const after = await getOnChainStatus(contractAddress, contractEscrowId)
        return { released: after === 'Delivered', txHash, step: step.kind }
      } catch (err) {
        // Another oracle completed the quorum between our read and our transaction.
        if ((await getOnChainStatus(contractAddress, contractEscrowId)) === 'Delivered') {
          return { released: true, txHash: null, step: step.kind }
        }
        throw err
      }
    }
  }
}

/**
 * Signs and submits `dispute_escrow` as the whitelisted oracle (e.g. on return-to-sender).
 * The oracle can only freeze funds into Disputed; the admin resolves it. Idempotent: if the
 * escrow is already Disputed on-chain no transaction is sent and txHash is null.
 * Requires a contract version where dispute_escrow accepts the oracle as caller.
 */
export async function submitDisputeOnChain(
  contractAddress: string,
  contractEscrowId: bigint
): Promise<{ txHash: string | null }> {
  const status = await getOnChainStatus(contractAddress, contractEscrowId)
  if (status === 'Disputed') return { txHash: null }
  if (status !== 'Funded' && status !== 'Shipped') {
    throw new Error(`Escrow ${contractEscrowId} is "${status}" on chain; cannot dispute`)
  }
  const txHash = await invokeAsOracle(contractAddress, 'dispute_escrow', [
    nativeToScVal(contractEscrowId, { type: 'u64' }),
    nativeToScVal(oracleKeypair.publicKey(), { type: 'address' }),
  ])
  return { txHash }
}

/**
 * Notifies the web app's internal endpoint that delivery was confirmed on-chain.
 * The endpoint verifies ORACLE_INTERNAL_API_KEY and re-checks the contract state.
 */
export async function confirmDelivery(
  escrowId: string,
  courierResponse: Record<string, unknown>,
  txHash: string | null
): Promise<ConfirmDeliveryResult> {
  const url = `${config.APP_INTERNAL_API_URL}/api/oracle/confirm`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ORACLE_INTERNAL_API_KEY}`,
    },
    body: JSON.stringify({
      escrowId,
      courierResponse,
      nodeId: config.ORACLE_NODE_ID,
      ...(txHash ? { txHash } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const text = await response.text()
    // With several oracle nodes, another node may already have synced this delivery: the web app
    // then answers 409 because the escrow is no longer SHIPPED. That is success for this node.
    if (response.status === 409 && isAlreadyDeliveredResponse(text)) {
      return { success: true, escrowId, txHash }
    }
    throw new Error(`oracle/confirm returned ${response.status}: ${text}`)
  }

  return { success: true, escrowId, txHash }
}
