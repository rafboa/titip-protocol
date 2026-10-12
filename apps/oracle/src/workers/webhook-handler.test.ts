import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  handleWebhookEvent,
  type EscrowRow,
  type ShipmentRef,
  type WebhookDeps,
  type WebhookEventRow,
} from './webhook-handler.js'

const event = (stage: string, overrides: Partial<WebhookEventRow> = {}): WebhookEventRow => ({
  id: 'w1',
  courier: 'JNT',
  eventId: 'evt-1',
  stage,
  trackingNumber: 'JP123',
  payload: { status: stage },
  processedAt: null,
  ...overrides,
})

const escrow = (status: string): EscrowRow => ({
  id: 'esc1',
  status,
  contractAddress: 'CCONTRACT',
  contractEscrowId: 7n,
  buyerAddress: 'GBUYER',
  sellerAddress: 'GSELLER',
})

/** A single-shipment escrow: the primary tracking number is also the final one. */
const primary = (status: string, overrides: Partial<ShipmentRef> = {}): ShipmentRef => ({
  escrow: escrow(status),
  kind: 'PRIMARY',
  legId: null,
  legStatus: null,
  isFinal: true,
  hasPendingProposal: false,
  ...overrides,
})

const leg = (status: string, overrides: Partial<ShipmentRef> = {}): ShipmentRef => ({
  escrow: escrow(status),
  kind: 'LEG',
  legId: 'leg1',
  legStatus: 'APPROVED',
  isFinal: true,
  hasPendingProposal: false,
  ...overrides,
})

function makeDeps(ev: WebhookEventRow | null, ref: ShipmentRef | null): WebhookDeps {
  return {
    getEvent: vi.fn().mockResolvedValue(ev),
    resolveShipment: vi.fn().mockResolvedValue(ref),
    recordLegStage: vi.fn().mockResolvedValue(undefined),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    logOracleEvent: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
    submitConfirmDelivery: vi.fn().mockResolvedValue({ released: true, txHash: 'a'.repeat(64), step: 'approve' }),
    syncDelivery: vi.fn().mockResolvedValue(undefined),
  }
}

let deps: WebhookDeps

beforeEach(() => vi.clearAllMocks())

describe('handleWebhookEvent - single shipment', () => {
  it('skips an event that does not exist', async () => {
    deps = makeDeps(null, null)
    expect(await handleWebhookEvent('w1', deps)).toBe('skipped-missing')
    expect(deps.markProcessed).not.toHaveBeenCalled()
  })

  it('skips an already processed event (replay / duplicate job)', async () => {
    deps = makeDeps(event('DELIVERED', { processedAt: new Date() }), primary('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('skipped-processed')
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    expect(deps.logOracleEvent).not.toHaveBeenCalled()
  })

  it('marks the event processed when no escrow matches the tracking number', async () => {
    deps = makeDeps(event('DELIVERED'), null)
    expect(await handleWebhookEvent('w1', deps)).toBe('no-escrow')
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
  })

  it.each(['PICKUP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'])('only logs a %s event', async (stage) => {
    deps = makeDeps(event(stage), primary('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('logged')
    expect(deps.logOracleEvent).toHaveBeenCalledWith('esc1', `WEBHOOK_${stage}`, { status: stage })
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
  })

  it('confirms delivery on-chain and syncs the web app for DELIVERED on a SHIPPED escrow', async () => {
    deps = makeDeps(event('DELIVERED'), primary('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('delivered')
    expect(deps.submitConfirmDelivery).toHaveBeenCalledWith('CCONTRACT', 7n)
    expect(deps.syncDelivery).toHaveBeenCalledWith('esc1', { status: 'DELIVERED' }, 'a'.repeat(64))
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
  })

  it('syncs the web app even when the final approval was sent by another oracle (no tx from this node)', async () => {
    deps = makeDeps(event('DELIVERED'), primary('SHIPPED'))
    vi.mocked(deps.submitConfirmDelivery).mockResolvedValue({ released: true, txHash: null, step: 'already-delivered' })
    expect(await handleWebhookEvent('w1', deps)).toBe('delivered')
    expect(deps.syncDelivery).toHaveBeenCalledWith('esc1', { status: 'DELIVERED' }, null)
  })

  it('does not sync or finish the event while the oracle quorum is not reached, so every node can approve', async () => {
    deps = makeDeps(event('DELIVERED'), primary('SHIPPED'))
    vi.mocked(deps.submitConfirmDelivery).mockResolvedValue({ released: false, txHash: 'b'.repeat(64), step: 'approve' })
    expect(await handleWebhookEvent('w1', deps)).toBe('awaiting-quorum')
    expect(deps.syncDelivery).not.toHaveBeenCalled()
    expect(deps.markProcessed).not.toHaveBeenCalled()
    // The approval this node sent is the only event; the webhook itself is not logged yet.
    expect(deps.logOracleEvent).toHaveBeenCalledTimes(1)
    expect(deps.logOracleEvent).toHaveBeenCalledWith('esc1', 'DELIVERY_SUBMITTED', {
      step: 'approve',
      released: false,
      txHash: 'b'.repeat(64),
      webhook: { status: 'DELIVERED' },
    })
  })

  it('writes nothing when a node that already approved re-handles the pending event', async () => {
    deps = makeDeps(event('DELIVERED'), primary('SHIPPED'))
    vi.mocked(deps.submitConfirmDelivery).mockResolvedValue({ released: false, txHash: null, step: 'waiting' })
    expect(await handleWebhookEvent('w1', deps)).toBe('awaiting-quorum')
    expect(deps.logOracleEvent).not.toHaveBeenCalled()
    expect(deps.markProcessed).not.toHaveBeenCalled()
  })

  it('logs the webhook and the approval of this node once the delivery is released, then finishes the event', async () => {
    deps = makeDeps(event('DELIVERED'), primary('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('delivered')
    expect(vi.mocked(deps.logOracleEvent).mock.calls.map((c) => c[1])).toEqual(['WEBHOOK_DELIVERED', 'DELIVERY_SUBMITTED'])
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
  })

  it('does not mark the event processed when the chain call fails, so the job can retry', async () => {
    deps = makeDeps(event('DELIVERED'), primary('SHIPPED'))
    vi.mocked(deps.submitConfirmDelivery).mockRejectedValue(new Error('rpc down'))
    await expect(handleWebhookEvent('w1', deps)).rejects.toThrow('rpc down')
    expect(deps.markProcessed).not.toHaveBeenCalled()
  })

  it.each(['DELIVERED', 'REFUNDED', 'PENDING'])(
    'never releases funds when DELIVERED arrives for a %s escrow',
    async (status) => {
      deps = makeDeps(event('DELIVERED'), primary(status))
      expect(await handleWebhookEvent('w1', deps)).toBe('ignored-terminal')
      expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    },
  )

  it('notifies buyer and seller on RETURN_TO_SENDER when no on-chain dispute is available', async () => {
    deps = makeDeps(event('RETURN_TO_SENDER'), primary('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('return-notified')
    expect(deps.notify).toHaveBeenCalledTimes(2)
    expect(deps.notify).toHaveBeenCalledWith('GBUYER', 'ESCROW_RETURN_TO_SENDER', expect.any(String))
    expect(deps.notify).toHaveBeenCalledWith('GSELLER', 'ESCROW_RETURN_TO_SENDER', expect.any(String))
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
  })

  it('opens a dispute on RETURN_TO_SENDER when the dependency is provided', async () => {
    deps = makeDeps(event('RETURN_TO_SENDER'), primary('SHIPPED'))
    deps.openDispute = vi.fn().mockResolvedValue(undefined)
    expect(await handleWebhookEvent('w1', deps)).toBe('dispute-opened')
    expect(deps.openDispute).toHaveBeenCalledOnce()
    expect(deps.notify).toHaveBeenCalledTimes(2)
    expect(deps.notify).toHaveBeenCalledWith('GBUYER', 'ESCROW_RETURN_TO_SENDER', expect.stringContaining('dibuka otomatis'))
  })

  it('ignores RETURN_TO_SENDER once the escrow is terminal', async () => {
    deps = makeDeps(event('RETURN_TO_SENDER'), primary('DELIVERED'))
    deps.openDispute = vi.fn()
    expect(await handleWebhookEvent('w1', deps)).toBe('ignored-terminal')
    expect(deps.openDispute).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })
})

describe('handleWebhookEvent - multi-leg shipments', () => {
  it('does not release funds when the primary (first hop) is delivered but approved legs follow', async () => {
    deps = makeDeps(event('DELIVERED'), primary('SHIPPED', { isFinal: false }))
    expect(await handleWebhookEvent('w1', deps)).toBe('leg-delivered')
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
  })

  it('does not release funds when a middle leg is delivered, but records its stage', async () => {
    deps = makeDeps(event('DELIVERED'), leg('SHIPPED', { isFinal: false }))
    expect(await handleWebhookEvent('w1', deps)).toBe('leg-delivered')
    expect(deps.recordLegStage).toHaveBeenCalledWith('leg1', 'DELIVERED')
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
  })

  it('releases funds only when the final approved leg is delivered', async () => {
    deps = makeDeps(event('DELIVERED'), leg('SHIPPED', { isFinal: true }))
    expect(await handleWebhookEvent('w1', deps)).toBe('delivered')
    expect(deps.recordLegStage).toHaveBeenCalledWith('leg1', 'DELIVERED')
    expect(deps.submitConfirmDelivery).toHaveBeenCalledWith('CCONTRACT', 7n)
  })

  it('defers a final DELIVERED while the buyer has an undecided leg proposal, without logging or consuming it', async () => {
    deps = makeDeps(event('DELIVERED'), leg('SHIPPED', { isFinal: true, hasPendingProposal: true }))
    expect(await handleWebhookEvent('w1', deps)).toBe('deferred')
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    expect(deps.logOracleEvent).not.toHaveBeenCalled()
    expect(deps.markProcessed).not.toHaveBeenCalled()
  })

  it('defers events of a proposed (not yet approved) leg so they are not lost if the buyer approves later', async () => {
    deps = makeDeps(event('DELIVERED'), leg('SHIPPED', { legStatus: 'PROPOSED', isFinal: false }))
    expect(await handleWebhookEvent('w1', deps)).toBe('deferred')
    expect(deps.markProcessed).not.toHaveBeenCalled()
    expect(deps.recordLegStage).not.toHaveBeenCalled()
  })

  it('ignores events of a rejected leg', async () => {
    deps = makeDeps(event('DELIVERED'), leg('SHIPPED', { legStatus: 'REJECTED', isFinal: false }))
    expect(await handleWebhookEvent('w1', deps)).toBe('leg-not-approved')
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    expect(deps.recordLegStage).not.toHaveBeenCalled()
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
  })

  it('opens a dispute when a middle leg is returned to sender', async () => {
    deps = makeDeps(event('RETURN_TO_SENDER'), leg('SHIPPED', { isFinal: false }))
    deps.openDispute = vi.fn().mockResolvedValue(undefined)
    expect(await handleWebhookEvent('w1', deps)).toBe('dispute-opened')
    expect(deps.recordLegStage).toHaveBeenCalledWith('leg1', 'RETURN_TO_SENDER')
  })

  it('keeps a stale final DELIVERED harmless once the escrow is already delivered', async () => {
    deps = makeDeps(event('DELIVERED'), leg('DELIVERED', { isFinal: true }))
    expect(await handleWebhookEvent('w1', deps)).toBe('ignored-terminal')
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
  })
})
