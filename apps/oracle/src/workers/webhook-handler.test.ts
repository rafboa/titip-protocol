import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  handleWebhookEvent,
  type EscrowRow,
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

function makeDeps(ev: WebhookEventRow | null, esc: EscrowRow | null): WebhookDeps {
  return {
    getEvent: vi.fn().mockResolvedValue(ev),
    findEscrow: vi.fn().mockResolvedValue(esc),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    logOracleEvent: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
    submitConfirmDelivery: vi.fn().mockResolvedValue({ txHash: 'a'.repeat(64) }),
    syncDelivery: vi.fn().mockResolvedValue(undefined),
  }
}

let deps: WebhookDeps

beforeEach(() => vi.clearAllMocks())

describe('handleWebhookEvent', () => {
  it('skips an event that does not exist', async () => {
    deps = makeDeps(null, null)
    expect(await handleWebhookEvent('w1', deps)).toBe('skipped-missing')
    expect(deps.markProcessed).not.toHaveBeenCalled()
  })

  it('skips an already processed event (replay / duplicate job)', async () => {
    deps = makeDeps(event('DELIVERED', { processedAt: new Date() }), escrow('SHIPPED'))
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
    deps = makeDeps(event(stage), escrow('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('logged')
    expect(deps.logOracleEvent).toHaveBeenCalledWith('esc1', `WEBHOOK_${stage}`, { status: stage })
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
  })

  it('confirms delivery on-chain and syncs the web app for DELIVERED on a SHIPPED escrow', async () => {
    deps = makeDeps(event('DELIVERED'), escrow('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('delivered')
    expect(deps.submitConfirmDelivery).toHaveBeenCalledWith('CCONTRACT', 7n)
    expect(deps.syncDelivery).toHaveBeenCalledWith('esc1', { status: 'DELIVERED' }, 'a'.repeat(64))
    expect(deps.markProcessed).toHaveBeenCalledWith('w1')
  })

  it('does not mark the event processed when the chain call fails, so the job can retry', async () => {
    deps = makeDeps(event('DELIVERED'), escrow('SHIPPED'))
    vi.mocked(deps.submitConfirmDelivery).mockRejectedValue(new Error('rpc down'))
    await expect(handleWebhookEvent('w1', deps)).rejects.toThrow('rpc down')
    expect(deps.markProcessed).not.toHaveBeenCalled()
  })

  it.each(['DELIVERED', 'REFUNDED', 'PENDING'])(
    'never releases funds when DELIVERED arrives for a %s escrow',
    async (status) => {
      deps = makeDeps(event('DELIVERED'), escrow(status))
      expect(await handleWebhookEvent('w1', deps)).toBe('ignored-terminal')
      expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
    },
  )

  it('notifies buyer and seller on RETURN_TO_SENDER when no on-chain dispute is available', async () => {
    deps = makeDeps(event('RETURN_TO_SENDER'), escrow('SHIPPED'))
    expect(await handleWebhookEvent('w1', deps)).toBe('return-notified')
    expect(deps.notify).toHaveBeenCalledTimes(2)
    expect(deps.notify).toHaveBeenCalledWith('GBUYER', 'ESCROW_RETURN_TO_SENDER', expect.any(String))
    expect(deps.notify).toHaveBeenCalledWith('GSELLER', 'ESCROW_RETURN_TO_SENDER', expect.any(String))
    expect(deps.submitConfirmDelivery).not.toHaveBeenCalled()
  })

  it('opens a dispute on RETURN_TO_SENDER when the dependency is provided', async () => {
    deps = makeDeps(event('RETURN_TO_SENDER'), escrow('SHIPPED'))
    deps.openDispute = vi.fn().mockResolvedValue(undefined)
    expect(await handleWebhookEvent('w1', deps)).toBe('dispute-opened')
    expect(deps.openDispute).toHaveBeenCalledOnce()
    expect(deps.notify).toHaveBeenCalledTimes(2)
  })

  it('ignores RETURN_TO_SENDER once the escrow is terminal', async () => {
    deps = makeDeps(event('RETURN_TO_SENDER'), escrow('DELIVERED'))
    deps.openDispute = vi.fn()
    expect(await handleWebhookEvent('w1', deps)).toBe('ignored-terminal')
    expect(deps.openDispute).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })
})
