// apps/oracle/src/workers/webhook-handler.ts
// Business logic for one persisted courier webhook event (webhook_events row).
// Dependencies are injected so the logic is unit-testable without Redis, Postgres or the chain.
//
// Rules (CLAUDE.md escrow invariants):
//  - Only DELIVERED on a SHIPPED escrow may release funds, and only the oracle key does it.
//  - Terminal escrows (DELIVERED / REFUNDED) are never touched again, so stale or reordered
//    events are harmless.
//  - Every event is logged to oracle_events; handling is idempotent via processedAt.

export type WebhookEventRow = {
  id: string
  courier: string
  eventId: string
  stage: string
  trackingNumber: string
  payload: unknown
  processedAt: Date | null
}

export type EscrowRow = {
  id: string
  status: string
  contractAddress: string
  contractEscrowId: bigint
  buyerAddress: string
  sellerAddress: string
}

export type WebhookDeps = {
  getEvent(id: string): Promise<WebhookEventRow | null>
  findEscrow(courier: string, trackingNumber: string): Promise<EscrowRow | null>
  markProcessed(id: string): Promise<void>
  logOracleEvent(escrowId: string, eventType: string, payload: Record<string, unknown>): Promise<void>
  notify(userAddress: string, type: string, message: string): Promise<void>
  /** Signs and submits confirm_delivery as the oracle. txHash is null if already Delivered on-chain. */
  submitConfirmDelivery(contractAddress: string, contractEscrowId: bigint): Promise<{ txHash: string | null }>
  /** Tells the web app to re-read the chain and sync the DB. */
  syncDelivery(escrowId: string, payload: Record<string, unknown>, txHash: string | null): Promise<void>
  /**
   * Opens a dispute on-chain. Optional: the current contract only lets the buyer or seller
   * call dispute_escrow, so until the contract allows the oracle this is left unset and
   * return-to-sender only notifies both parties.
   */
  openDispute?(escrow: EscrowRow): Promise<void>
}

export type WebhookOutcome =
  | 'skipped-processed'
  | 'skipped-missing'
  | 'no-escrow'
  | 'delivered'
  | 'ignored-terminal'
  | 'dispute-opened'
  | 'return-notified'
  | 'logged'

const DISPUTABLE = new Set(['FUNDED', 'SHIPPED'])

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
}

export async function handleWebhookEvent(id: string, deps: WebhookDeps): Promise<WebhookOutcome> {
  const event = await deps.getEvent(id)
  if (!event) return 'skipped-missing'
  if (event.processedAt) return 'skipped-processed'

  const escrow = await deps.findEscrow(event.courier, event.trackingNumber)
  if (!escrow) {
    await deps.markProcessed(event.id)
    return 'no-escrow'
  }

  const payload = asRecord(event.payload)
  await deps.logOracleEvent(escrow.id, `WEBHOOK_${event.stage}`, payload)

  let outcome: WebhookOutcome = 'logged'

  if (event.stage === 'DELIVERED') {
    if (escrow.status === 'SHIPPED') {
      const { txHash } = await deps.submitConfirmDelivery(escrow.contractAddress, escrow.contractEscrowId)
      await deps.syncDelivery(escrow.id, payload, txHash)
      outcome = 'delivered'
    } else {
      outcome = 'ignored-terminal'
    }
  } else if (event.stage === 'RETURN_TO_SENDER') {
    if (DISPUTABLE.has(escrow.status)) {
      if (deps.openDispute) {
        await deps.openDispute(escrow)
        outcome = 'dispute-opened'
      } else {
        outcome = 'return-notified'
      }
      const message =
        outcome === 'dispute-opened'
          ? 'Paket dikembalikan ke pengirim oleh kurir. Dispute dibuka otomatis dan dana dibekukan di escrow sampai diselesaikan admin.'
          : 'Paket dikembalikan ke pengirim oleh kurir. Dana tetap aman di escrow; ajukan dispute dari halaman escrow.'
      await deps.notify(escrow.buyerAddress, 'ESCROW_RETURN_TO_SENDER', message)
      await deps.notify(escrow.sellerAddress, 'ESCROW_RETURN_TO_SENDER', message)
    } else {
      outcome = 'ignored-terminal'
    }
  }

  await deps.markProcessed(event.id)
  return outcome
}
