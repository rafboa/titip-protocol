// apps/oracle/src/workers/webhook-handler.ts
// Business logic for one persisted courier webhook event (webhook_events row).
// Dependencies are injected so the logic is unit-testable without Redis, Postgres or the chain.
//
// Rules (CLAUDE.md escrow invariants):
//  - Only DELIVERED of the FINAL approved leg on a SHIPPED escrow may release funds, and only the
//    oracle key does it. Earlier legs just record progress.
//  - While the seller has a proposed leg waiting for the buyer, a final DELIVERED is deferred
//    (left unprocessed, not re-logged) until the buyer decides, so a delivery is never lost.
//  - Terminal escrows (DELIVERED / REFUNDED) are never touched again, so stale or reordered
//    events are harmless.
//  - Every handled event is logged to oracle_events; handling is idempotent via processedAt.
//  - With an M-of-N oracle set a final DELIVERED is NOT finished by the first node that approves:
//    processedAt is global (shared DB) but every node must get to approve, so the event stays
//    unprocessed (re-handled each cycle, a no-op for nodes that already approved) until the
//    delivery is released. Only transactions a node actually sends are logged for it.
//  - Every node handles every event; claimProcessed picks the one node that writes the once-only
//    side effects (webhook log, notifications).

import { eventTypeForDeliveryStep, type DeliveryStep } from '../stellar/quorum.js'

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

/** Which shipment of the escrow a webhook refers to. */
export type ShipmentRef = {
  escrow: EscrowRow
  /** The escrow's own tracking number (seq 0) or an extra leg. */
  kind: 'PRIMARY' | 'LEG'
  legId: string | null
  legStatus: 'APPROVED' | 'PROPOSED' | 'REJECTED' | null
  /** True when delivering this shipment completes the whole delivery. */
  isFinal: boolean
  /** True when the seller has proposed a leg the buyer has not decided on yet. */
  hasPendingProposal: boolean
}

export type WebhookDeps = {
  getEvent(id: string): Promise<WebhookEventRow | null>
  resolveShipment(courier: string, trackingNumber: string): Promise<ShipmentRef | null>
  recordLegStage(legId: string, stage: string): Promise<void>
  /**
   * Atomically marks the event processed; true only for the one node whose call changed it. Every
   * node runs every event, so once-only side effects (logging, notifications) belong to the winner.
   */
  claimProcessed(id: string): Promise<boolean>
  logOracleEvent(escrowId: string, eventType: string, payload: Record<string, unknown>): Promise<void>
  notify(userAddress: string, type: string, message: string): Promise<void>
  /**
   * Signs and submits this node's part of the delivery (confirm_delivery, or approve_delivery when
   * the contract has an M-of-N oracle set). `released` is false while other oracles still have to
   * approve; txHash is null when this node sent no transaction.
   */
  submitConfirmDelivery(
    contractAddress: string,
    contractEscrowId: bigint,
  ): Promise<{ released: boolean; txHash: string | null; step: DeliveryStep['kind'] }>
  /** Tells the web app to re-read the chain and sync the DB. */
  syncDelivery(escrowId: string, payload: Record<string, unknown>, txHash: string | null): Promise<void>
  /**
   * Opens a dispute on-chain. Optional: needs the contract where dispute_escrow accepts the oracle.
   * When unset, return-to-sender only notifies both parties.
   */
  openDispute?(escrow: EscrowRow): Promise<void>
}

export type WebhookOutcome =
  | 'skipped-processed'
  | 'skipped-missing'
  | 'no-escrow'
  | 'delivered'
  | 'awaiting-quorum'
  | 'leg-delivered'
  | 'deferred'
  | 'leg-not-approved'
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

  const ref = await deps.resolveShipment(event.courier, event.trackingNumber)
  if (!ref) return (await deps.claimProcessed(event.id)) ? 'no-escrow' : 'skipped-processed'
  const { escrow } = ref

  // A leg the buyer has not approved yet, or a final delivery waiting for the buyer's decision on a
  // proposed leg, must not be consumed: leave it for the poller to pick up again, without re-logging.
  const proposedLeg = ref.kind === 'LEG' && ref.legStatus === 'PROPOSED'
  const finalDeliveryWaiting =
    event.stage === 'DELIVERED' && escrow.status === 'SHIPPED' && ref.isFinal && ref.hasPendingProposal
  if (proposedLeg || finalDeliveryWaiting) return 'deferred'

  const payload = asRecord(event.payload)
  const logWebhook = () => deps.logOracleEvent(escrow.id, `WEBHOOK_${event.stage}`, payload)

  // Every node handles every event (one queue per node) but only the node that claims it writes
  // the once-only side effects: the webhook log and the user notifications.
  if (ref.kind === 'LEG' && ref.legStatus === 'REJECTED') {
    if (!(await deps.claimProcessed(event.id))) return 'skipped-processed'
    await logWebhook()
    return 'leg-not-approved'
  }
  if (ref.legId) await deps.recordLegStage(ref.legId, event.stage)

  // Final delivery of a SHIPPED escrow: every node must approve, so the event stays unprocessed
  // while the quorum is pending and is only claimed once the funds are released.
  if (event.stage === 'DELIVERED' && escrow.status === 'SHIPPED' && ref.isFinal) {
    const { released, txHash, step } = await deps.submitConfirmDelivery(escrow.contractAddress, escrow.contractEscrowId)
    // A transaction this node sent is its own event, whether or not it wins the claim below.
    const submitted = eventTypeForDeliveryStep(step, txHash)
    if (submitted) await deps.logOracleEvent(escrow.id, submitted, { step, released, txHash })
    if (!released) return 'awaiting-quorum'

    // Also from a node that lost the race: the web app keeps the release tx hash from the node that sent it.
    await deps.syncDelivery(escrow.id, payload, txHash)
    if (!(await deps.claimProcessed(event.id))) return 'skipped-processed'
    await logWebhook()
    return 'delivered'
  }

  let outcome: WebhookOutcome = 'logged'
  let openDispute = false
  if (event.stage === 'DELIVERED') {
    outcome = escrow.status !== 'SHIPPED' ? 'ignored-terminal' : 'leg-delivered'
  } else if (event.stage === 'RETURN_TO_SENDER') {
    if (DISPUTABLE.has(escrow.status)) {
      openDispute = true
      outcome = deps.openDispute ? 'dispute-opened' : 'return-notified'
    } else {
      outcome = 'ignored-terminal'
    }
  }

  // Idempotent on-chain (and a failure here must not consume the event), so every node may run it.
  if (openDispute && deps.openDispute) await deps.openDispute(escrow)

  if (!(await deps.claimProcessed(event.id))) return 'skipped-processed'
  await logWebhook()
  if (openDispute) {
    const message =
      outcome === 'dispute-opened'
        ? 'Paket dikembalikan ke pengirim oleh kurir. Dispute dibuka otomatis dan dana dibekukan di escrow sampai diselesaikan admin.'
        : 'Paket dikembalikan ke pengirim oleh kurir. Dana tetap aman di escrow; ajukan dispute dari halaman escrow.'
    await deps.notify(escrow.buyerAddress, 'ESCROW_RETURN_TO_SENDER', message)
    await deps.notify(escrow.sellerAddress, 'ESCROW_RETURN_TO_SENDER', message)
  }
  return outcome
}
