// Soroban escrow contract call wrappers
// All contract interactions go through this file — never inline in components or API routes
//
// Pattern: simulate → assemble → return unsigned XDR for client signing

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'
import { STELLAR_CONFIG } from '../config'

const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl)

function getContract(): Contract {
  if (!STELLAR_CONFIG.contractAddress) {
    throw new Error('NEXT_PUBLIC_CONTRACT_ADDRESS is not set')
  }
  return new Contract(STELLAR_CONFIG.contractAddress)
}

/**
 * Build an unsigned transaction for `create_escrow` on the Soroban contract.
 * Returns the XDR string for the client to sign via Freighter.
 */
export async function buildCreateEscrowTx(
  buyerAddress: string,
  sellerAddress: string,
  amountBaseUnits: bigint,
  timeoutLedger: number
): Promise<string> {
  const contract = getContract()
  const account = await server.getAccount(buyerAddress)

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * STELLAR_CONFIG.feeMultiplier),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'create_escrow',
        new Address(buyerAddress).toScVal(),
        new Address(sellerAddress).toScVal(),
        nativeToScVal(amountBaseUnits, { type: 'i128' }),
        nativeToScVal(timeoutLedger, { type: 'u32' })
      )
    )
    .setTimeout(30)
    .build()

  // Simulate to get the correct footprint and resource fees
  const simulated = await server.simulateTransaction(tx)

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      `Simulation failed: ${(simulated as rpc.Api.SimulateTransactionErrorResponse).error}`
    )
  }

  // Assemble the transaction with the simulation result
  const assembled = rpc.assembleTransaction(tx, simulated).build()
  return assembled.toXDR()
}

/**
 * Build an unsigned transaction for `fund` on the Soroban contract.
 * Returns the XDR string for the client to sign via Freighter.
 */
export async function buildFundEscrowTx(
  buyerAddress: string,
  contractEscrowId: bigint
): Promise<string> {
  const contract = getContract()
  const account = await server.getAccount(buyerAddress)

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * STELLAR_CONFIG.feeMultiplier),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'fund',
        nativeToScVal(contractEscrowId, { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build()

  const simulated = await server.simulateTransaction(tx)

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      `Simulation failed: ${(simulated as rpc.Api.SimulateTransactionErrorResponse).error}`
    )
  }

  const assembled = rpc.assembleTransaction(tx, simulated).build()
  return assembled.toXDR()
}

/**
 * Build an unsigned transaction for `submit_tracking` on the Soroban contract.
 * Returns the XDR string for the client (seller) to sign via Freighter.
 */
export async function buildSubmitTrackingTx(
  sellerAddress: string,
  contractEscrowId: bigint,
  trackingNumber: string,
  courierCode: string
): Promise<string> {
  const contract = getContract()
  const account = await server.getAccount(sellerAddress)

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * STELLAR_CONFIG.feeMultiplier),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'submit_tracking',
        nativeToScVal(contractEscrowId, { type: 'u64' }),
        nativeToScVal(trackingNumber, { type: 'string' }),
        nativeToScVal(courierCode, { type: 'string' })
      )
    )
    .setTimeout(30)
    .build()

  const simulated = await server.simulateTransaction(tx)

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      `Simulation failed: ${(simulated as rpc.Api.SimulateTransactionErrorResponse).error}`
    )
  }

  const assembled = rpc.assembleTransaction(tx, simulated).build()
  return assembled.toXDR()
}

/**
 * Build an unsigned transaction for `claim_refund` on the Soroban contract.
 * Returns the XDR string for the client (buyer) to sign via Freighter.
 * The contract itself enforces that current_ledger > timeout_ledger.
 */
export async function buildClaimRefundTx(
  buyerAddress: string,
  contractEscrowId: bigint
): Promise<string> {
  const contract = getContract()
  const account = await server.getAccount(buyerAddress)

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * STELLAR_CONFIG.feeMultiplier),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'claim_refund',
        nativeToScVal(contractEscrowId, { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build()

  const simulated = await server.simulateTransaction(tx)

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      `Simulation failed: ${(simulated as rpc.Api.SimulateTransactionErrorResponse).error}`
    )
  }

  const assembled = rpc.assembleTransaction(tx, simulated).build()
  return assembled.toXDR()
}

/**
 * Submit a signed transaction XDR to the Stellar network and wait for it to
 * land. Returns the RPC getTransaction() success response (includes hash and
 * the contract's return value, if any).
 */
async function submitAndAwait(signedXdr: string): Promise<rpc.Api.GetSuccessfulTransactionResponse & { hash: string }> {
  const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_CONFIG.networkPassphrase)
  const result = await server.sendTransaction(tx)

  if (result.status === 'ERROR') {
    throw new Error(`Transaction submission failed: ${JSON.stringify(result.errorResult)}`)
  }

  // Poll for completion
  let getResult = await server.getTransaction(result.hash)
  const maxRetries = 30
  let retries = 0

  while (getResult.status === 'NOT_FOUND' && retries < maxRetries) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    getResult = await server.getTransaction(result.hash)
    retries++
  }

  if (getResult.status === 'SUCCESS') {
    return { ...getResult, hash: result.hash }
  }

  throw new Error(`Transaction failed with status: ${getResult.status}`)
}

/**
 * Submit a signed transaction XDR to the Stellar network.
 * Returns the transaction hash on success.
 */
export async function submitSignedTx(signedXdr: string): Promise<string> {
  const result = await submitAndAwait(signedXdr)
  return result.hash
}

/**
 * Build, sign, and submit the `confirm_delivery` transaction using the Oracle's secret key.
 * Only the Oracle is authorized to call this on-chain.
 */
import { Keypair } from '@stellar/stellar-sdk'

export async function submitConfirmDeliveryTx(
  contractEscrowId: bigint,
  oracleSecretKey: string
): Promise<string> {
  const contract = getContract()
  const oracleKeypair = Keypair.fromSecret(oracleSecretKey)
  const account = await server.getAccount(oracleKeypair.publicKey())

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * STELLAR_CONFIG.feeMultiplier),
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'confirm_delivery',
        nativeToScVal(contractEscrowId, { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build()

  const simulated = await server.simulateTransaction(tx)

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      `Simulation failed: ${(simulated as rpc.Api.SimulateTransactionErrorResponse).error}`
    )
  }

  const assembled = rpc.assembleTransaction(tx, simulated).build()
  assembled.sign(oracleKeypair)
  
  const result = await submitAndAwait(assembled.toXDR())
  return result.hash
}

/**
 * Submit the buyer-signed `create_escrow` transaction and read back the
 * contract-assigned escrow ID from the transaction's return value.
 * `create_escrow` requires buyer.require_auth(), so this can only be
 * submitted after the buyer has signed it — the ID is not knowable before that.
 */
export async function submitCreateEscrowTx(
  signedXdr: string
): Promise<{ txHash: string; contractEscrowId: bigint }> {
  const result = await submitAndAwait(signedXdr)

  if (!result.returnValue) {
    throw new Error('create_escrow transaction succeeded but returned no value')
  }

  if (result.returnValue.switch().name !== 'scvU64') {
    throw new Error(`Unexpected return type from create_escrow: ${result.returnValue.switch().name}`)
  }

  return {
    txHash: result.hash,
    contractEscrowId: BigInt(result.returnValue.u64().toString()),
  }
}

/**
 * Get the current ledger number from Soroban RPC.
 * Used to calculate timeout_ledger for new escrows.
 */
export async function getCurrentLedger(): Promise<number> {
  const result = await server.getLatestLedger()
  return result.sequence
}
