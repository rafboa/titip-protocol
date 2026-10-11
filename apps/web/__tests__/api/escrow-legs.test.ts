import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  escrow: { findUnique: vi.fn() },
  shipmentLeg: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  notification: { create: vi.fn() },
  $transaction: vi.fn(),
}))
const verifyJwt = vi.hoisted(() => vi.fn())
const getAuthorizationHeader = vi.hoisted(() => vi.fn())

vi.mock('@titip/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth/sep10', () => ({ verifyJwt, getAuthorizationHeader }))

import { POST as proposeLeg } from '@/app/api/escrow/[id]/legs/route'
import { POST as decideLeg } from '@/app/api/escrow/[id]/legs/[legId]/route'

const BUYER = 'GBUYER'
const SELLER = 'GSELLER'

const escrow = (overrides: Record<string, unknown> = {}) => ({
  id: 'esc1',
  status: 'SHIPPED',
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  courierCode: 'POS_INDONESIA',
  trackingNumber: 'P1234567890123',
  legs: [],
  ...overrides,
})

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/escrow/esc1/legs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const propose = (body: unknown) => proposeLeg(req(body), { params: { id: 'esc1' } })
const decide = (body: unknown, legId = 'leg1', id = 'esc1') => decideLeg(req(body), { params: { id, legId } })

const validLeg = { courierCode: 'JNT', trackingNumber: 'JP3012345678' }

beforeEach(() => {
  vi.resetAllMocks()
  getAuthorizationHeader.mockReturnValue('Bearer t')
  verifyJwt.mockResolvedValue({ address: SELLER })
  prismaMock.escrow.findUnique.mockResolvedValue(escrow())
  prismaMock.$transaction.mockResolvedValue([{ id: 'leg1', seq: 1, status: 'PROPOSED' }])
})

describe('POST /api/escrow/[id]/legs (seller proposes)', () => {
  it('creates a PROPOSED leg and notifies the buyer', async () => {
    const res = await propose(validLeg)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'leg1', seq: 1, status: 'PROPOSED' })
    expect(prismaMock.shipmentLeg.create).toHaveBeenCalledWith({
      data: { escrowId: 'esc1', seq: 1, courier: 'JNT', trackingNumber: 'JP3012345678' },
    })
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userAddress: BUYER, type: 'LEG_PROPOSED' }) }),
    )
  })

  it('uses the next sequence number', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(
      escrow({ legs: [{ seq: 1, status: 'APPROVED', courier: 'JNE', trackingNumber: 'A1B2C3' }] }),
    )
    await propose(validLeg)
    expect(prismaMock.shipmentLeg.create.mock.calls[0][0].data.seq).toBe(2)
  })

  it('requires authentication', async () => {
    getAuthorizationHeader.mockReturnValue(null)
    expect((await propose(validLeg)).status).toBe(401)
  })

  it('rejects an invalid or expired session', async () => {
    verifyJwt.mockRejectedValue(new Error('expired'))
    expect((await propose(validLeg)).status).toBe(401)
  })

  it('only lets the seller propose', async () => {
    verifyJwt.mockResolvedValue({ address: BUYER })
    expect((await propose(validLeg)).status).toBe(403)
    expect(prismaMock.shipmentLeg.create).not.toHaveBeenCalled()
  })

  it('rejects invalid input', async () => {
    expect((await propose({ courierCode: 'FEDEX', trackingNumber: 'JP3012345678' })).status).toBe(400)
    expect((await propose({ courierCode: 'JNT', trackingNumber: 'ab' })).status).toBe(400)
  })

  it('returns 404 for an unknown escrow', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(null)
    expect((await propose(validLeg)).status).toBe(404)
  })

  it.each(['FUNDED', 'DELIVERED', 'REFUNDED', 'DISPUTED'])('refuses legs on a %s escrow', async (status) => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status }))
    expect((await propose(validLeg)).status).toBe(409)
  })

  it('refuses a second proposal while one is waiting for the buyer', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(
      escrow({ legs: [{ seq: 1, status: 'PROPOSED', courier: 'JNE', trackingNumber: 'A1B2C3' }] }),
    )
    expect((await propose(validLeg)).status).toBe(409)
  })

  it('refuses a duplicate of the primary tracking number or an existing leg', async () => {
    expect((await propose({ courierCode: 'POS_INDONESIA', trackingNumber: 'P1234567890123' })).status).toBe(409)
    prismaMock.escrow.findUnique.mockResolvedValue(
      escrow({ legs: [{ seq: 1, status: 'APPROVED', courier: 'JNT', trackingNumber: 'JP3012345678' }] }),
    )
    expect((await propose(validLeg)).status).toBe(409)
  })

  it('caps the number of live legs but ignores rejected ones', async () => {
    const approved = (i: number) => ({ seq: i, status: 'APPROVED', courier: 'JNE', trackingNumber: `T${i}XYZ` })
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ legs: [1, 2, 3, 4, 5].map(approved) }))
    expect((await propose(validLeg)).status).toBe(409)

    const withRejected = [1, 2, 3, 4].map(approved).concat([{ ...approved(5), status: 'REJECTED' }])
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ legs: withRejected }))
    expect((await propose(validLeg)).status).toBe(201)
  })

  it('answers 409 when two proposals race for the same sequence number', async () => {
    prismaMock.$transaction.mockRejectedValue({ code: 'P2002' })
    expect((await propose(validLeg)).status).toBe(409)
  })
})

describe('POST /api/escrow/[id]/legs/[legId] (buyer decides)', () => {
  const proposedLeg = (overrides: Record<string, unknown> = {}) => ({
    id: 'leg1',
    escrowId: 'esc1',
    status: 'PROPOSED',
    courier: 'JNT',
    trackingNumber: 'JP3012345678',
    escrow: { id: 'esc1', status: 'SHIPPED', buyerAddress: BUYER, sellerAddress: SELLER },
    ...overrides,
  })

  beforeEach(() => {
    verifyJwt.mockResolvedValue({ address: BUYER })
    prismaMock.shipmentLeg.findUnique.mockResolvedValue(proposedLeg())
    prismaMock.shipmentLeg.updateMany.mockResolvedValue({ count: 1 })
  })

  it.each([
    ['APPROVE', 'APPROVED', 'LEG_APPROVED'],
    ['REJECT', 'REJECTED', 'LEG_REJECTED'],
  ])('%s sets the leg to %s and notifies the seller', async (decision, status, type) => {
    const res = await decide({ decision })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'leg1', status })
    expect(prismaMock.shipmentLeg.updateMany).toHaveBeenCalledWith({
      where: { id: 'leg1', status: 'PROPOSED' },
      data: { status, decidedAt: expect.any(Date) },
    })
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userAddress: SELLER, type }) }),
    )
  })

  it('only lets the buyer decide', async () => {
    verifyJwt.mockResolvedValue({ address: SELLER })
    expect((await decide({ decision: 'APPROVE' })).status).toBe(403)
    expect(prismaMock.shipmentLeg.updateMany).not.toHaveBeenCalled()
  })

  it('requires authentication and a valid decision', async () => {
    getAuthorizationHeader.mockReturnValue(null)
    expect((await decide({ decision: 'APPROVE' })).status).toBe(401)
    getAuthorizationHeader.mockReturnValue('Bearer t')
    expect((await decide({ decision: 'MAYBE' })).status).toBe(400)
  })

  it('does not accept a leg id from another escrow', async () => {
    expect((await decide({ decision: 'APPROVE' }, 'leg1', 'other-escrow')).status).toBe(404)
  })

  it('returns 404 for an unknown leg', async () => {
    prismaMock.shipmentLeg.findUnique.mockResolvedValue(null)
    expect((await decide({ decision: 'APPROVE' })).status).toBe(404)
  })

  it('refuses to decide twice', async () => {
    prismaMock.shipmentLeg.findUnique.mockResolvedValue(proposedLeg({ status: 'APPROVED' }))
    expect((await decide({ decision: 'REJECT' })).status).toBe(409)
  })

  it('loses the race cleanly when another decision lands first', async () => {
    prismaMock.shipmentLeg.updateMany.mockResolvedValue({ count: 0 })
    expect((await decide({ decision: 'APPROVE' })).status).toBe(409)
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })

  it('refuses once the escrow is no longer SHIPPED', async () => {
    prismaMock.shipmentLeg.findUnique.mockResolvedValue(
      proposedLeg({ escrow: { id: 'esc1', status: 'DELIVERED', buyerAddress: BUYER, sellerAddress: SELLER } }),
    )
    expect((await decide({ decision: 'APPROVE' })).status).toBe(409)
  })
})
