import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  escrow: { findUnique: vi.fn() },
}))
const verifyJwt = vi.hoisted(() => vi.fn())
const getAuthorizationHeader = vi.hoisted(() => vi.fn())

vi.mock('@titip/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth/sep10', () => ({ verifyJwt, getAuthorizationHeader }))

import { GET } from '@/app/api/escrow/[id]/route'

const BUYER = 'GBUYER'
const SELLER = 'GSELLER'

const row = () => ({
  id: 'esc1',
  status: 'SHIPPED',
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  contractEscrowId: 7n,
  amountUsdc: { toString: () => '50' },
  qrisPayloadRaw: 'SECRET-QRIS-PAYLOAD',
  txHashFund: null,
  txHashRelease: null,
  oracleEvents: [{ id: 'o1', eventType: 'WEBHOOK_DELIVERED', confirmedAt: new Date() }],
})

const call = () =>
  GET(new NextRequest('http://localhost/api/escrow/esc1'), { params: { id: 'esc1' } })

beforeEach(() => {
  vi.resetAllMocks()
  getAuthorizationHeader.mockReturnValue('Bearer t')
  verifyJwt.mockResolvedValue({ address: BUYER })
  prismaMock.escrow.findUnique.mockResolvedValue(row())
})

describe('GET /api/escrow/[id]', () => {
  it('rejects anonymous callers without touching the database', async () => {
    getAuthorizationHeader.mockReturnValue(null)
    expect((await call()).status).toBe(401)
    expect(prismaMock.escrow.findUnique).not.toHaveBeenCalled()
  })

  it('rejects an invalid or expired session', async () => {
    verifyJwt.mockRejectedValue(new Error('expired'))
    expect((await call()).status).toBe(401)
    expect(prismaMock.escrow.findUnique).not.toHaveBeenCalled()
  })

  it.each([
    ['buyer', BUYER],
    ['seller', SELLER],
  ])('returns the escrow to its %s', async (_role, address) => {
    verifyJwt.mockResolvedValue({ address })
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('esc1')
    expect(body.contractEscrowId).toBe('7')
  })

  it('answers 404 (not 403) to a stranger, identical to a missing escrow', async () => {
    verifyJwt.mockResolvedValue({ address: 'GSTRANGER' })
    const stranger = await call()
    prismaMock.escrow.findUnique.mockResolvedValue(null)
    const missing = await call()
    expect(stranger.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await stranger.json()).toEqual(await missing.json())
  })

  it('never returns the raw QRIS payload', async () => {
    const body = await (await call()).json()
    expect(body).not.toHaveProperty('qrisPayloadRaw')
    expect(JSON.stringify(body)).not.toContain('SECRET-QRIS-PAYLOAD')
  })

  it('only selects id, type and time of oracle events (no raw courier response)', async () => {
    await call()
    const args = prismaMock.escrow.findUnique.mock.calls[0][0]
    expect(args.include.oracleEvents.select).toEqual({ id: true, eventType: true, confirmedAt: true })
  })
})
