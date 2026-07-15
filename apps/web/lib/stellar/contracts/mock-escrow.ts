/**
 * lib/stellar/contracts/mock-escrow.ts
 *
 * Mock implementation of the escrow contract wrappers for demo contingency.
 * Activated when NEXT_PUBLIC_USE_MOCK_CONTRACT=true in env.
 *
 * Returns fake XDR strings and simulated results so the full UI flow works
 * even if Soroban RPC is unreachable during the live demo.
 *
 * All functions have the same signatures as escrow.ts — the switch happens
 * in the re-export at the bottom of escrow.ts.
 */

// Fake XDR placeholder — Freighter will still pop up to "sign" this,
// but since we skip on-chain submission, it doesn't matter.
const MOCK_XDR =
  'AAAAAgAAAABmb2NrLXRyYW5zYWN0aW9uLXhkci1mb3ItZGVtby1tb2Nr' +
  'AAAAZAABhqAAAABkAAAAAAAAAAAAAAABAAAAEWNyZWF0ZV9lc2Nyb3cA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

let mockEscrowCounter = BigInt(Date.now())

export async function buildCreateEscrowTx(
  _buyerAddress: string,
  _sellerAddress: string,
  _amountBaseUnits: bigint,
  _timeoutLedger: number
): Promise<string> {
  // Simulate network delay
  await sleep(800)
  console.log('[MOCK] buildCreateEscrowTx — returning fake XDR')
  return MOCK_XDR
}

export async function buildFundEscrowTx(
  _buyerAddress: string,
  _contractEscrowId: bigint
): Promise<string> {
  await sleep(600)
  console.log('[MOCK] buildFundEscrowTx — returning fake XDR')
  return MOCK_XDR
}

export async function buildSubmitTrackingTx(
  _sellerAddress: string,
  _contractEscrowId: bigint,
  _trackingNumber: string,
  _courierCode: string
): Promise<string> {
  await sleep(500)
  console.log('[MOCK] buildSubmitTrackingTx — returning fake XDR')
  return MOCK_XDR
}

export async function buildClaimRefundTx(
  _buyerAddress: string,
  _contractEscrowId: bigint
): Promise<string> {
  await sleep(500)
  console.log('[MOCK] buildClaimRefundTx — returning fake XDR')
  return MOCK_XDR
}

export async function submitSignedTx(_signedXdr: string): Promise<string> {
  await sleep(1200)
  const mockHash = `mock_tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  console.log(`[MOCK] submitSignedTx — returning fake hash: ${mockHash}`)
  return mockHash
}

export async function submitConfirmDeliveryTx(
  _contractEscrowId: bigint,
  _oracleSecretKey: string
): Promise<string> {
  await sleep(1000)
  const mockHash = `mock_confirm_${Date.now().toString(36)}`
  console.log(`[MOCK] submitConfirmDeliveryTx — returning fake hash: ${mockHash}`)
  return mockHash
}

export async function submitCreateEscrowTx(
  _signedXdr: string
): Promise<{ txHash: string; contractEscrowId: bigint }> {
  await sleep(1500)
  mockEscrowCounter++
  const result = {
    txHash: `mock_create_${Date.now().toString(36)}`,
    contractEscrowId: mockEscrowCounter,
  }
  console.log(`[MOCK] submitCreateEscrowTx — escrow ID: ${result.contractEscrowId}`)
  return result
}

export async function getCurrentLedger(): Promise<number> {
  // Return a realistic testnet ledger number
  return 1_500_000 + Math.floor(Date.now() / 5000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
