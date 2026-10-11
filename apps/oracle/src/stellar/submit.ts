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

/** Returns the contract's escrow status ("Shipped", "Delivered", ...). */
async function getOnChainStatus(contractAddress: string, contractEscrowId: bigint): Promise<string> {
  const contract = new Contract(contractAddress)
  // Read-only simulation: a throwaway account is enough.
  const dummy = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0')
  const tx = new TransactionBuilder(dummy, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call('get_escrow', nativeToScVal(contractEscrowId, { type: 'u64' })))
    .setTimeout(30)
    .build()

  const simulated = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`get_escrow simulation failed: ${simulated.error}`)
  }
  const retval = (simulated as rpc.Api.SimulateTransactionSuccessResponse).result?.retval
  if (!retval) throw new Error(`Escrow ${contractEscrowId} not found on chain`)

  const native = scValToNative(retval) as { status: unknown }
  if (typeof native.status === 'string') return native.status
  if (typeof native.status === 'object' && native.status !== null) {
    return Object.keys(native.status)[0] ?? 'Unknown'
  }
  return 'Unknown'
}

/**
 * Signs and submits `confirm_delivery` as the whitelisted oracle.
 * Idempotent: if the escrow is already Delivered on-chain (e.g. a previous attempt
 * landed but the web callback failed), no transaction is sent and txHash is null.
 */
export async function submitConfirmDeliveryOnChain(
  contractAddress: string,
  contractEscrowId: bigint
): Promise<{ txHash: string | null }> {
  const status = await getOnChainStatus(contractAddress, contractEscrowId)
  if (status === 'Delivered') return { txHash: null }
  if (status !== 'Shipped') {
    throw new Error(`Escrow ${contractEscrowId} is "${status}" on chain; expected "Shipped"`)
  }

  const contract = new Contract(contractAddress)
  const account = await server.getAccount(oracleKeypair.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * FEE_MULTIPLIER),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('confirm_delivery', nativeToScVal(contractEscrowId, { type: 'u64' })))
    .setTimeout(30)
    .build()

  // Simulate first: gives the footprint and resource fees.
  const simulated = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`confirm_delivery simulation failed: ${simulated.error}`)
  }

  const prepared = rpc.assembleTransaction(tx, simulated).build()
  prepared.sign(oracleKeypair)

  const sent = await server.sendTransaction(prepared)
  if (sent.status === 'ERROR') {
    throw new Error(`confirm_delivery submission failed: ${JSON.stringify(sent.errorResult)}`)
  }

  let result = await server.getTransaction(sent.hash)
  for (let i = 0; i < POLL_ATTEMPTS && result.status === 'NOT_FOUND'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    result = await server.getTransaction(sent.hash)
  }
  if (result.status !== 'SUCCESS') {
    throw new Error(`confirm_delivery did not succeed: ${result.status}`)
  }
  return { txHash: sent.hash }
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
    body: JSON.stringify({ escrowId, courierResponse, ...(txHash ? { txHash } : {}) }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`oracle/confirm returned ${response.status}: ${text}`)
  }

  return { success: true, escrowId, txHash }
}
