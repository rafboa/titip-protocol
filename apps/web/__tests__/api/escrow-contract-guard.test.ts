import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Escrow ids restart at 1 on every deployment: a row from an older contract must never get a
// transaction built or submitted against the current one.

const prismaMock = vi.hoisted(() => ({
  escrow: { findUnique: vi.fn(), update: vi.fn() },
  notification: { create: vi.fn() },
  $transaction: vi.fn(),
}))
const verifyJwt = vi.hoisted(() => vi.fn())
const getAuthorizationHeader = vi.hoisted(() => vi.fn())
const chain = vi.hoisted(() => ({
  buildFundEscrowTx: vi.fn(),
  buildClaimRefundTx: vi.fn(),
  buildDisputeEscrowTx: vi.fn(),
  buildSubmitTrackingTx: vi.fn(),
  submitSignedTx: vi.fn(),
  getOnChainEscrow: vi.fn(),
  getCurrentLedger: vi.fn(),
}))

vi.mock('@titip/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth/sep10', () => ({ verifyJwt, getAuthorizationHeader }))
vi.mock('@/lib/stellar/contracts/escrow', () => chain)
vi.mock('@/lib/stellar/config', () => ({ STELLAR_CONFIG: { contractAddress: 'CCURRENT' } }))

import * as fund from '@/app/api/escrow/[id]/fund/route'
import * as refund from '@/app/api/escrow/[id]/refund/route'
import * as dispute from '@/app/api/escrow/[id]/dispute/route'
import * as tracking from '@/app/api/escrow/[id]/tracking/route'

const BUYER = 'GBUYER'
const SELLER = 'GSELLER'

const escrow = (overrides: Record<string, unknown> = {}) => ({
  id: 'esc1',
  status: 'FUNDED',
  contractEscrowId: 7n,
  contractAddress: 'CCURRENT',
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  amountUsdc: '10',
  timeoutAt: new Date(Date.now() - 1000),
  ...overrides,
})

const ctx = { params: { id: 'esc1' } } as unknown as { params: Promise<{ id: string }> }
const get = (query = '') => new NextRequest(`http://localhost/api/escrow/esc1/x${query}`)
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/escrow/esc1/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// [route, who may call it, status it accepts, GET query, POST body]
const cases = [
  ['fund', fund, BUYER, 'PENDING', '', { signedXdr: 'S' }],
  ['refund', refund, BUYER, 'FUNDED', '', { signedXdr: 'S' }],
  ['dispute', dispute, BUYER, 'FUNDED', '', { signedXdr: 'S' }],
  ['tracking', tracking, SELLER, 'FUNDED', '?trackingNumber=JP3012345678&courierCode=JNT', { signedXdr: 'S', trackingNumber: 'JP3012345678', courierCode: 'JNT' }],
] as const

beforeEach(() => {
  vi.resetAllMocks()
  getAuthorizationHeader.mockReturnValue('Bearer t')
})

describe.each(cases)('%s route on an escrow from an older contract', (_name, route, caller, status, query, body) => {
  beforeEach(() => {
    verifyJwt.mockResolvedValue({ address: caller })
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status, contractAddress: 'COLD' }))
  })

  it('refuses to build a transaction (409)', async () => {
    const res = await route.GET(get(query), ctx)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/older contract/)
    for (const builder of [chain.buildFundEscrowTx, chain.buildClaimRefundTx, chain.buildDisputeEscrowTx, chain.buildSubmitTrackingTx]) {
      expect(builder).not.toHaveBeenCalled()
    }
  })

  it('refuses to submit a signed transaction (409) and writes nothing', async () => {
    const res = await route.POST(post(body), ctx)
    expect(res.status).toBe(409)
    expect(chain.submitSignedTx).not.toHaveBeenCalled()
    expect(prismaMock.escrow.update).not.toHaveBeenCalled()
  })

  it('still answers a stranger with 403 first', async () => {
    verifyJwt.mockResolvedValue({ address: 'GSTRANGER' })
    expect((await route.GET(get(query), ctx)).status).toBe(403)
  })
})

describe.each(cases)('%s route on an escrow from the current contract', (_name, route, caller, status, query) => {
  it('still builds the transaction', async () => {
    verifyJwt.mockResolvedValue({ address: caller })
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status }))
    for (const builder of [chain.buildFundEscrowTx, chain.buildClaimRefundTx, chain.buildDisputeEscrowTx, chain.buildSubmitTrackingTx]) {
      builder.mockResolvedValue('UNSIGNED')
    }
    chain.getCurrentLedger.mockResolvedValue(1)
    chain.getOnChainEscrow.mockResolvedValue({ status: 'Funded', timeoutLedger: 0 })
    expect((await route.GET(get(query), ctx)).status).toBe(200)
  })
})
