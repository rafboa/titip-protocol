import { describe, it, expect } from 'vitest'
import {
  currentContractWhere,
  NO_UPDATE_LOG_INTERVAL_MS,
  nextWebhookCursor,
  shippedEscrowsWhere,
  shouldLogNoUpdate,
  webhookBatchQuery,
  type WebhookCursor,
} from './poll-queries.js'

describe('shipped escrow scan', () => {
  it('filters by the contract this node serves when one is configured', () => {
    expect(shippedEscrowsWhere('CCURRENT')).toMatchObject({ status: 'SHIPPED', contractAddress: 'CCURRENT' })
    expect(currentContractWhere(undefined)).toEqual({})
    expect(shippedEscrowsWhere(undefined)).not.toHaveProperty('contractAddress')
  })
})

describe('webhook event batches', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 0, 0, s))
  const page = (ids: string[]) => ids.map((id, i) => ({ id, receivedAt: at(i) }))

  it('starts from the oldest unprocessed event', () => {
    const query = webhookBatchQuery(null, 100)
    expect(query.where).toEqual({ processedAt: null })
    expect(query.orderBy).toEqual([{ receivedAt: 'asc' }, { id: 'asc' }])
  })

  it('continues after the last event of a full page, tie-breaking on id', () => {
    const cursor = nextWebhookCursor(page(['a', 'b', 'c']), 3)
    expect(cursor).toEqual({ receivedAt: at(2), id: 'c' })
    expect(webhookBatchQuery(cursor, 3).where).toEqual({
      processedAt: null,
      OR: [{ receivedAt: { gt: at(2) } }, { receivedAt: at(2), id: { gt: 'c' } }],
    })
  })

  it('wraps around after a short page', () => {
    expect(nextWebhookCursor(page(['x']), 3)).toBeNull()
    expect(nextWebhookCursor([], 3)).toBeNull()
  })

  it('reaches a new event even when the oldest ones are never processed', () => {
    // 5 events stay unprocessed forever (waiting for a quorum); a new one arrives behind them.
    const all = page(['s1', 's2', 's3', 's4', 's5', 'new'])
    const fetchPage = (cursor: WebhookCursor, take: number) =>
      all
        .filter((e) => !cursor || e.receivedAt > cursor.receivedAt || (+e.receivedAt === +cursor.receivedAt && e.id > cursor.id))
        .slice(0, take)
    const seen = new Set<string>()
    let cursor: WebhookCursor = null
    for (let cycle = 0; cycle < 3; cycle++) {
      const batch = fetchPage(cursor, 2)
      batch.forEach((e) => seen.add(e.id))
      cursor = nextWebhookCursor(batch, 2)
    }
    expect(seen.has('new')).toBe(true)
  })
})

describe('shouldLogNoUpdate', () => {
  const now = new Date('2026-10-13T10:00:00Z')

  it('logs when nothing was logged before', () => {
    expect(shouldLogNoUpdate(null, now)).toBe(true)
  })

  it('skips inside the window', () => {
    expect(shouldLogNoUpdate(new Date(now.getTime() - 60_000), now)).toBe(false)
  })

  it('logs again once the window has passed', () => {
    expect(shouldLogNoUpdate(new Date(now.getTime() - NO_UPDATE_LOG_INTERVAL_MS), now)).toBe(true)
  })
})
