import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  escrow: { findUnique: vi.fn(), update: vi.fn() },
  oracleEvent: { create: vi.fn() },
  notification: { create: vi.fn() },
  $transaction: vi.fn(),
}))
const getOnChainEscrow = vi.hoisted(() => vi.fn())

vi.mock('@titip/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/stellar/contracts/escrow', () => ({ getOnChainEscrow }))

const KEY = 'test-oracle-key'
const TX_HASH = 'a'.repeat(64)

function req(body: unknown, auth: string | null = `Bearer ${KEY}`): NextRequest {
  return new NextRequest('http://localhost/api/oracle/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
}

const shippedEscrow = {
  id: 'esc1',
  status: 'SHIPPED',
  contractEscrowId: 7n,
  sellerAddress: 'GSELLER',
  buyerAddress: 'GBUYER',
  amountUsdc: '10',
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.ORACLE_INTERNAL_API_KEY = KEY
  delete process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT
  delete process.env.ORACLE_SECRET_KEY
  prismaMock.$transaction.mockResolvedValue([{ id: 'esc1', status: 'DELIVERED', deliveredAt: new Date() }])
})

describe('POST /api/oracle/confirm', () => {
  it('rejects a missing or wrong bearer token', async () => {
    const { POST } = await import('@/app/api/oracle/confirm/route')
    expect((await POST(req({ escrowId: 'esc1' }, null))).status).toBe(401)
    expect((await POST(req({ escrowId: 'esc1' }, 'Bearer nope'))).status).toBe(401)
  })

  it('rejects a malformed txHash', async () => {
    const { POST } = await import('@/app/api/oracle/confirm/route')
    expect((await POST(req({ escrowId: 'esc1', txHash: 'xyz' }))).status).toBe(400)
  })

  it('returns 404 for an unknown escrow', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/oracle/confirm/route')
    expect((await POST(req({ escrowId: 'missing' }))).status).toBe(404)
  })

  it('returns 409 when the DB escrow is not SHIPPED', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue({ ...shippedEscrow, status: 'REFUNDED' })
    const { POST } = await import('@/app/api/oracle/confirm/route')
    expect((await POST(req({ escrowId: 'esc1' }))).status).toBe(409)
  })

  it('returns 409 and does not touch the DB when the chain is not Delivered', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(shippedEscrow)
    getOnChainEscrow.mockResolvedValue({ status: 'Shipped' })
    const { POST } = await import('@/app/api/oracle/confirm/route')
    const res = await POST(req({ escrowId: 'esc1', txHash: TX_HASH }))
    expect(res.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('returns 502 when the chain cannot be read', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(shippedEscrow)
    getOnChainEscrow.mockRejectedValue(new Error('rpc down'))
    const { POST } = await import('@/app/api/oracle/confirm/route')
    expect((await POST(req({ escrowId: 'esc1' }))).status).toBe(502)
  })

  it('syncs the DB once the chain says Delivered, without needing ORACLE_SECRET_KEY', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(shippedEscrow)
    getOnChainEscrow.mockResolvedValue({ status: 'Delivered' })
    const { POST } = await import('@/app/api/oracle/confirm/route')
    const res = await POST(req({ escrowId: 'esc1', txHash: TX_HASH }))
    expect(res.status).toBe(200)
    expect(getOnChainEscrow).toHaveBeenCalledWith(7n)
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(prismaMock.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED', txHashRelease: TX_HASH }) })
    )
  })

  it('records the oracle node that synced the delivery, falling back to "unknown"', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(shippedEscrow)
    getOnChainEscrow.mockResolvedValue({ status: 'Delivered' })
    const { POST } = await import('@/app/api/oracle/confirm/route')

    expect((await POST(req({ escrowId: 'esc1', nodeId: 'oracle-2' }))).status).toBe(200)
    expect(prismaMock.oracleEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ oracleNodeId: 'oracle-2' }) })
    )

    expect((await POST(req({ escrowId: 'esc1' }))).status).toBe(200)
    expect(prismaMock.oracleEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ oracleNodeId: 'unknown' }) })
    )
  })

  it('rejects a malformed nodeId', async () => {
    const { POST } = await import('@/app/api/oracle/confirm/route')
    expect((await POST(req({ escrowId: 'esc1', nodeId: 'bad id; drop' }))).status).toBe(400)
  })
})
