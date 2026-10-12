import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Account, Contract, Keypair, Networks, StrKey, TransactionBuilder, nativeToScVal } from '@stellar/stellar-sdk'

// Hoisted because the vi.mock factory below uses it; equals StrKey.encodeContract(Buffer.alloc(32, 1)).
const { CONTRACT } = vi.hoisted(() => ({ CONTRACT: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526' }))
const admin = Keypair.random()
const stranger = Keypair.random()
const BUYER = Keypair.random().publicKey()
const SELLER = Keypair.random().publicKey()

const prismaMock = vi.hoisted(() => ({ escrow: { findUnique: vi.fn(), findMany: vi.fn() } }))
const verifyJwt = vi.hoisted(() => vi.fn())
const getAuthorizationHeader = vi.hoisted(() => vi.fn())
const chain = vi.hoisted(() => ({
  getContractAdmin: vi.fn(),
  buildResolveDisputeSplitTx: vi.fn(),
  getOnChainEscrow: vi.fn(),
  getTransactionOutcome: vi.fn(),
  submitSignedTx: vi.fn(),
}))
const recordResolution = vi.hoisted(() => vi.fn())

vi.mock('@titip/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth/sep10', () => ({ verifyJwt, getAuthorizationHeader }))
vi.mock('@/lib/stellar/contracts/escrow', () => chain)
vi.mock('@/lib/stellar/config', () => ({
  STELLAR_CONFIG: { contractAddress: CONTRACT, networkPassphrase: Networks.TESTNET },
}))
vi.mock('@/lib/admin/resolve', async (original) => ({
  ...(await original<typeof import('@/lib/admin/resolve')>()),
  recordResolution,
}))

import { GET as adminMe } from '@/app/api/admin/me/route'
import { GET as listDisputes } from '@/app/api/admin/disputes/route'
import { GET as disputeDetail } from '@/app/api/admin/disputes/[id]/route'
import { GET as buildResolution, POST as submitResolution } from '@/app/api/admin/disputes/[id]/resolve/route'
import { clearAdminCache } from '@/lib/admin/chain-admin'

const decimal = (value: string) => ({ toFixed: () => value })

const escrow = (overrides: Record<string, unknown> = {}) => ({
  id: 'esc1',
  status: 'DISPUTED',
  contractEscrowId: 7n,
  contractAddress: CONTRACT,
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  amountUsdc: decimal('10.0000000'),
  createdAt: new Date('2026-10-12T10:00:00Z'),
  resolutionBuyerBps: null,
  resolvedAt: null,
  ...overrides,
})

function signed(
  options: { signer?: Keypair; escrowId?: bigint; bps?: number; method?: string; contract?: string; unsigned?: boolean } = {}
): string {
  const signer = options.signer ?? admin
  const tx = new TransactionBuilder(new Account(signer.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(
      new Contract(options.contract ?? CONTRACT).call(
        options.method ?? 'resolve_dispute_split',
        nativeToScVal(options.escrowId ?? 7n, { type: 'u64' }),
        nativeToScVal(options.bps ?? 7000, { type: 'u32' })
      )
    )
    .setTimeout(30)
    .build()
  if (!options.unsigned) tx.sign(signer)
  return tx.toXDR()
}

const get = (path = '', query = '') => new NextRequest(`http://localhost/api/admin/disputes${path}${query}`)
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/disputes/esc1/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const ctx = { params: { id: 'esc1' } } as unknown as Parameters<typeof buildResolution>[1]

const signInAs = (keypair: Keypair | null) => {
  getAuthorizationHeader.mockReturnValue(keypair ? 'Bearer t' : null)
  if (keypair) verifyJwt.mockResolvedValue({ address: keypair.publicKey() })
}

beforeEach(() => {
  vi.resetAllMocks()
  clearAdminCache()
  signInAs(admin)
  chain.getContractAdmin.mockResolvedValue(admin.publicKey())
  prismaMock.escrow.findUnique.mockResolvedValue(escrow())
  chain.getOnChainEscrow.mockResolvedValue({ status: 'Disputed' })
  chain.buildResolveDisputeSplitTx.mockResolvedValue('UNSIGNED_XDR')
  chain.submitSignedTx.mockResolvedValue('a'.repeat(64))
  recordResolution.mockResolvedValue(true)
})

describe('GET /api/admin/me', () => {
  it('says whether the signed-in user is the contract admin', async () => {
    expect(await (await adminMe(get())).json()).toEqual({ isAdmin: true })
    signInAs(stranger)
    expect(await (await adminMe(get())).json()).toEqual({ isAdmin: false })
  })

  it('needs a session, and shows nothing when the chain cannot prove the admin', async () => {
    signInAs(null)
    expect((await adminMe(get())).status).toBe(401)
    signInAs(admin)
    chain.getContractAdmin.mockRejectedValue(new Error('rpc down'))
    expect(await (await adminMe(get())).json()).toEqual({ isAdmin: false })
  })
})

describe('admin gate on every admin route', () => {
  it('answers 401 without a session and 403 for anyone who is not the contract admin', async () => {
    const calls = [
      () => listDisputes(get()),
      () => disputeDetail(get('/esc1'), ctx),
      () => buildResolution(get('/esc1/resolve', '?buyerBps=7000'), ctx),
      () => submitResolution(post({ signedXdr: signed() }), ctx),
    ]
    signInAs(null)
    for (const call of calls) expect((await call()).status).toBe(401)
    signInAs(stranger)
    for (const call of calls) expect((await call()).status).toBe(403)
    expect(chain.submitSignedTx).not.toHaveBeenCalled()
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('answers 502 (not 403) when the contract admin cannot be read', async () => {
    chain.getContractAdmin.mockRejectedValue(new Error('rpc down'))
    expect((await listDisputes(get())).status).toBe(502)
  })
})

describe('GET /api/admin/disputes (list)', () => {
  it('lists disputed escrows and flags the ones the admin cannot resolve', async () => {
    prismaMock.escrow.findMany.mockResolvedValue([
      { ...escrow({ id: 'ok' }), _count: { evidence: 2 } },
      { ...escrow({ id: 'old', contractAddress: 'COLD' }), _count: { evidence: 0 } },
      { ...escrow({ id: 'mine', buyerAddress: admin.publicKey() }), _count: { evidence: 1 } },
    ])
    const body = await (await listDisputes(get())).json()
    expect(body.disputes.map((d: { id: string; resolvable: boolean }) => [d.id, d.resolvable])).toEqual([
      ['ok', true],
      ['old', false],
      ['mine', false],
    ])
    expect(body.disputes[0]).toMatchObject({ amountUsdc: '10.0000000', evidenceCount: 2 })
    expect(prismaMock.escrow.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'DISPUTED' } }))
  })
})

describe('GET /api/admin/disputes/[id] (detail)', () => {
  it('returns the escrow and whether it can be resolved', async () => {
    const body = await (await disputeDetail(get('/esc1'), ctx)).json()
    expect(body).toMatchObject({ id: 'esc1', status: 'DISPUTED', amountUsdc: '10.0000000', resolvable: true, involvesAdmin: false })
  })

  it('is not resolvable on an older contract, when the admin is a party, or once resolved', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ contractAddress: 'COLD' }))
    expect((await (await disputeDetail(get('/esc1'), ctx)).json()).resolvable).toBe(false)
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ sellerAddress: admin.publicKey() }))
    const mine = await (await disputeDetail(get('/esc1'), ctx)).json()
    expect([mine.resolvable, mine.involvesAdmin]).toEqual([false, true])
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status: 'DELIVERED', resolutionBuyerBps: 7000 }))
    const done = await (await disputeDetail(get('/esc1'), ctx)).json()
    expect([done.resolvable, done.resolutionBuyerBps]).toEqual([false, 7000])
  })

  it('answers 404 for an unknown escrow', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(null)
    expect((await disputeDetail(get('/nope'), ctx)).status).toBe(404)
  })
})

describe('GET /api/admin/disputes/[id]/resolve (unsigned transaction)', () => {
  const build = (bps: string) => buildResolution(get('/esc1/resolve', `?buyerBps=${bps}`), ctx)

  it('builds the transaction for the admin and previews the exact amounts', async () => {
    const res = await build('7000')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ unsignedXdr: 'UNSIGNED_XDR', buyerBps: 7000, buyerUsdc: '7.00', sellerUsdc: '3.00' })
    expect(chain.buildResolveDisputeSplitTx).toHaveBeenCalledWith(admin.publicKey(), 7n, 7000)
  })

  it('rejects invalid basis points with 400', async () => {
    for (const bad of ['abc', '10001', '-1', '12.5', '', '1e3', ' 7000']) expect((await build(bad)).status).toBe(400)
  })

  it('never treats a missing buyerBps as 0 (that would pay the seller everything)', async () => {
    const res = await buildResolution(get('/esc1/resolve'), ctx)
    expect(res.status).toBe(400)
    expect(chain.buildResolveDisputeSplitTx).not.toHaveBeenCalled()
  })

  it('accepts the two extremes', async () => {
    expect((await build('0')).status).toBe(200)
    expect((await build('10000')).status).toBe(200)
  })

  it('refuses an escrow of an older contract (409), one the admin is a party to (403), and one not disputed (409)', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ contractAddress: 'COLD' }))
    expect((await build('7000')).status).toBe(409)
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ buyerAddress: admin.publicKey() }))
    expect((await build('7000')).status).toBe(403)
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status: 'DELIVERED' }))
    expect((await build('7000')).status).toBe(409)
    expect(chain.buildResolveDisputeSplitTx).not.toHaveBeenCalled()
  })

  it('answers 409 when the chain says the escrow is not Disputed (the database is behind)', async () => {
    chain.getOnChainEscrow.mockResolvedValue({ status: 'Refunded' })
    expect((await build('7000')).status).toBe(409)
  })

  it('answers 502 when the transaction cannot be built', async () => {
    chain.buildResolveDisputeSplitTx.mockRejectedValue(new Error('rpc down'))
    expect((await build('7000')).status).toBe(502)
  })
})

describe('POST /api/admin/disputes/[id]/resolve (submit)', () => {
  beforeEach(() => {
    // before submit: Disputed; after submit: resolved
    chain.getOnChainEscrow.mockResolvedValueOnce({ status: 'Disputed' }).mockResolvedValueOnce({ status: 'Delivered' })
  })

  it('submits the signed transaction and records the split that was signed', async () => {
    const xdr = signed({ bps: 7000 })
    const res = await submitResolution(post({ signedXdr: xdr }), ctx)
    expect(res.status).toBe(200)
    expect(chain.submitSignedTx).toHaveBeenCalledWith(xdr)
    expect(recordResolution).toHaveBeenCalledWith(
      { id: 'esc1', buyerAddress: BUYER, sellerAddress: SELLER, amountUsdc: '10.0000000' },
      7000,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      admin.publicKey()
    )
    expect(await res.json()).toMatchObject({ id: 'esc1', status: 'DELIVERED', resolutionBuyerBps: 7000 })
  })

  it('takes the split from the signed transaction, never from the request body', async () => {
    await submitResolution(post({ signedXdr: signed({ bps: 7000 }), buyerBps: 1, winner: 'buyer' }), ctx)
    expect(recordResolution.mock.calls[0][1]).toBe(7000)
  })

  it('answers 502 and records nothing when the escrow is still disputed after the submit', async () => {
    chain.getOnChainEscrow.mockReset()
    chain.getOnChainEscrow.mockResolvedValue({ status: 'Disputed' })
    expect((await submitResolution(post({ signedXdr: signed() }), ctx)).status).toBe(502)
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('answers 502 and records nothing when the network rejects the transaction', async () => {
    chain.submitSignedTx.mockRejectedValue(new Error('Transaction failed with status: FAILED'))
    expect((await submitResolution(post({ signedXdr: signed() }), ctx)).status).toBe(502)
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('refuses a transaction that is not exactly resolve_dispute_split on this contract (400), before any chain call', async () => {
    for (const bad of [
      signed({ method: 'resolve_dispute' }),
      signed({ contract: StrKey.encodeContract(Buffer.alloc(32, 9)) }),
      signed({ unsigned: true }),
      'garbage',
    ]) {
      expect((await submitResolution(post({ signedXdr: bad }), ctx)).status).toBe(400)
    }
    expect((await submitResolution(post({}), ctx)).status).toBe(400)
    expect(chain.submitSignedTx).not.toHaveBeenCalled()
  })

  it('refuses a transaction signed by another account (403) or built for another escrow (400)', async () => {
    expect((await submitResolution(post({ signedXdr: signed({ signer: stranger }) }), ctx)).status).toBe(403)
    expect((await submitResolution(post({ signedXdr: signed({ escrowId: 8n }) }), ctx)).status).toBe(400)
    expect(chain.submitSignedTx).not.toHaveBeenCalled()
  })

  it('refuses an escrow of an older contract (409) and an admin who is a party (403)', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ contractAddress: 'COLD' }))
    expect((await submitResolution(post({ signedXdr: signed() }), ctx)).status).toBe(409)
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ sellerAddress: admin.publicKey() }))
    expect((await submitResolution(post({ signedXdr: signed() }), ctx)).status).toBe(403)
    expect(chain.submitSignedTx).not.toHaveBeenCalled()
  })

  it('answers 409 without submitting when the database already says it is resolved', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status: 'DELIVERED' }))
    expect((await submitResolution(post({ signedXdr: signed() }), ctx)).status).toBe(409)
    expect(chain.submitSignedTx).not.toHaveBeenCalled()
  })

  it('answers 409 when someone else recorded the resolution first', async () => {
    recordResolution.mockResolvedValue(false)
    expect((await submitResolution(post({ signedXdr: signed() }), ctx)).status).toBe(409)
  })

  describe('a retry after the chain was already resolved but the database was not updated', () => {
    beforeEach(() => {
      chain.getOnChainEscrow.mockReset()
      chain.getOnChainEscrow.mockResolvedValue({ status: 'Refunded' })
    })

    it('catches the database up when it was THIS transaction, without resubmitting', async () => {
      chain.getTransactionOutcome.mockResolvedValue('SUCCESS')
      const xdr = signed({ bps: 10000 })
      const res = await submitResolution(post({ signedXdr: xdr }), ctx)
      expect(res.status).toBe(200)
      expect(chain.submitSignedTx).not.toHaveBeenCalled()
      expect(recordResolution.mock.calls[0][1]).toBe(10000)
      expect(await res.json()).toMatchObject({ status: 'REFUNDED' })
    })

    it('answers 409 and records nothing when another transaction resolved it', async () => {
      for (const outcome of ['FAILED', 'NOT_FOUND'] as const) {
        chain.getTransactionOutcome.mockResolvedValue(outcome)
        expect((await submitResolution(post({ signedXdr: signed() }), ctx)).status).toBe(409)
      }
      expect(chain.submitSignedTx).not.toHaveBeenCalled()
      expect(recordResolution).not.toHaveBeenCalled()
    })
  })
})
