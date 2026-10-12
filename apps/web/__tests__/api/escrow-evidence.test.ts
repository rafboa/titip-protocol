import crypto from 'crypto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  escrow: { findUnique: vi.fn() },
  evidenceFile: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  evidenceBlob: { findUnique: vi.fn() },
}))
const verifyJwt = vi.hoisted(() => vi.fn())
const getAuthorizationHeader = vi.hoisted(() => vi.fn())
const chainMock = vi.hoisted(() => ({
  buildSubmitEvidenceTx: vi.fn(),
  getOnChainEvidence: vi.fn(),
  submitSignedTx: vi.fn(),
}))

vi.mock('@titip/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth/sep10', () => ({ verifyJwt, getAuthorizationHeader }))
vi.mock('@/lib/stellar/contracts/escrow', () => chainMock)
vi.mock('@/lib/stellar/config', () => ({ STELLAR_CONFIG: { contractAddress: 'CCURRENT' } }))

import { GET as listEvidence, POST as uploadEvidence } from '@/app/api/escrow/[id]/evidence/route'
import { GET as downloadEvidence, POST as commitEvidence } from '@/app/api/escrow/[id]/evidence/[evidenceId]/route'
import { MAX_EVIDENCE_BYTES } from '@/lib/evidence/file'

const BUYER = 'GBUYER'
const SELLER = 'GSELLER'
const OUTSIDER = 'GOUTSIDER'
const INTERNAL_KEY = 'test-internal-key'

// A few bytes with a JPEG signature are enough: the server only checks the magic number.
const jpeg = (extra = 0) => {
  const bytes = new Uint8Array(8 + extra)
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return bytes
}
const sha = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')

const escrow = (overrides: Record<string, unknown> = {}) => ({
  id: 'esc1',
  status: 'DISPUTED',
  contractEscrowId: 7n,
  contractAddress: 'CCURRENT',
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  ...overrides,
})

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'ev1',
  escrowId: 'esc1',
  submitter: BUYER,
  sha256: sha(jpeg()),
  mimeType: 'image/jpeg',
  sizeBytes: 8,
  committedAt: null,
  txHash: null,
  ...overrides,
})

function uploadReq(bytes: Uint8Array, hash: string | null = sha(bytes), type = 'image/jpeg'): NextRequest {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], 'photo.jpg', { type }))
  if (hash !== null) form.set('sha256', hash)
  return new NextRequest('http://localhost/api/escrow/esc1/evidence', { method: 'POST', body: form })
}

const getReq = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/escrow/esc1/evidence${path}`, { headers })

const commitReq = (body: unknown) =>
  new NextRequest('http://localhost/api/escrow/esc1/evidence/ev1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const listCtx = { params: { id: 'esc1' } } as unknown as Parameters<typeof listEvidence>[1]
const itemCtx = { params: { id: 'esc1', evidenceId: 'ev1' } } as unknown as Parameters<typeof commitEvidence>[1]

const chainItem = (submitter: string, bytes = jpeg()) => ({ submitter, hash: sha(bytes), uri: 'titip:evidence/ev1', ledger: 100 })

beforeEach(() => {
  vi.resetAllMocks()
  process.env.ORACLE_INTERNAL_API_KEY = INTERNAL_KEY
  getAuthorizationHeader.mockReturnValue('Bearer t')
  verifyJwt.mockResolvedValue({ address: BUYER })
  prismaMock.escrow.findUnique.mockResolvedValue(escrow())
  prismaMock.evidenceFile.findUnique.mockResolvedValue(null)
  prismaMock.evidenceFile.findMany.mockResolvedValue([])
  prismaMock.evidenceFile.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...row(),
    ...data,
    id: 'ev1',
    blob: undefined,
  }))
  chainMock.getOnChainEvidence.mockResolvedValue([])
  chainMock.buildSubmitEvidenceTx.mockResolvedValue('UNSIGNED_XDR')
  chainMock.submitSignedTx.mockResolvedValue('a'.repeat(64))
})

describe('POST /api/escrow/[id]/evidence (upload)', () => {
  it('stores the file, hashes it on the server and returns the unsigned submit_evidence XDR', async () => {
    const bytes = jpeg()
    const res = await uploadEvidence(uploadReq(bytes), listCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ evidenceId: 'ev1', sha256: sha(bytes), committed: false, unsignedXdr: 'UNSIGNED_XDR' })
    expect(prismaMock.evidenceFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        escrowId: 'esc1',
        submitter: BUYER,
        sha256: sha(bytes),
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
        blob: { create: { data: expect.any(Uint8Array) } },
      }),
    })
    expect(chainMock.buildSubmitEvidenceTx).toHaveBeenCalledWith(BUYER, 7n, sha(bytes), 'titip:evidence/ev1')
  })

  it('is idempotent: the same file again reuses the stored row and only builds a fresh transaction', async () => {
    prismaMock.evidenceFile.findUnique.mockResolvedValue(row())
    const res = await uploadEvidence(uploadReq(jpeg()), listCtx)
    expect(res.status).toBe(200)
    expect(prismaMock.evidenceFile.create).not.toHaveBeenCalled()
    expect(chainMock.buildSubmitEvidenceTx).toHaveBeenCalledOnce()
  })

  it('does not build a new transaction for a file that is already committed', async () => {
    prismaMock.evidenceFile.findUnique.mockResolvedValue(row({ committedAt: new Date() }))
    const body = await (await uploadEvidence(uploadReq(jpeg()), listCtx)).json()
    expect(body).toMatchObject({ committed: true })
    expect(body).not.toHaveProperty('unsignedXdr')
  })

  it('recovers from a concurrent upload of the same file (unique violation)', async () => {
    prismaMock.evidenceFile.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row())
    prismaMock.evidenceFile.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    expect((await uploadEvidence(uploadReq(jpeg()), listCtx)).status).toBe(200)
  })

  it('rejects a missing session with 401 (the arbiter key cannot upload)', async () => {
    getAuthorizationHeader.mockReturnValue(null)
    expect((await uploadEvidence(uploadReq(jpeg()), listCtx)).status).toBe(401)
  })

  it('rejects someone who is not buyer or seller with 403', async () => {
    verifyJwt.mockResolvedValue({ address: OUTSIDER })
    expect((await uploadEvidence(uploadReq(jpeg()), listCtx)).status).toBe(403)
  })

  it('returns 409 when the escrow is not DISPUTED', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status: 'SHIPPED' }))
    expect((await uploadEvidence(uploadReq(jpeg()), listCtx)).status).toBe(409)
  })

  it('returns 400 for a file that is not a JPEG, PNG or WebP image, whatever its declared type', async () => {
    const svg = new TextEncoder().encode('<svg onload=alert(1)></svg>')
    expect((await uploadEvidence(uploadReq(svg, sha(svg), 'image/jpeg'), listCtx)).status).toBe(400)
    expect(prismaMock.evidenceFile.create).not.toHaveBeenCalled()
  })

  it('returns 413 for a file over the size limit', async () => {
    const big = jpeg(MAX_EVIDENCE_BYTES)
    expect((await uploadEvidence(uploadReq(big), listCtx)).status).toBe(413)
    expect(prismaMock.evidenceFile.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the hash sent does not match the bytes received', async () => {
    const res = await uploadEvidence(uploadReq(jpeg(), 'b'.repeat(64)), listCtx)
    expect(res.status).toBe(400)
    expect(prismaMock.evidenceFile.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the hash field is missing', async () => {
    expect((await uploadEvidence(uploadReq(jpeg(), null), listCtx)).status).toBe(400)
  })

  it('returns 409 once the party has used all their on-chain slots', async () => {
    chainMock.getOnChainEvidence.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => chainItem(BUYER, jpeg(i + 1)))
    )
    expect((await uploadEvidence(uploadReq(jpeg()), listCtx)).status).toBe(409)
    expect(prismaMock.evidenceFile.create).not.toHaveBeenCalled()
  })

  it('is never locked out by abandoned uploads: 10 unsigned rows and 0 on-chain still accepts a new file', async () => {
    const pending = Array.from({ length: 10 }, (_, i) => ({ id: `old${i}`, sha256: sha(jpeg(i + 100)) }))
    prismaMock.evidenceFile.findMany.mockResolvedValue(pending)
    const res = await uploadEvidence(uploadReq(jpeg()), listCtx)
    expect(res.status).toBe(200)
    // keeps at most 3 pending in total: 8 oldest removed, 2 stay, plus the new one
    expect(prismaMock.evidenceFile.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: pending.slice(0, 8).map((p) => p.id) } },
    })
  })

  it('does not prune a pending file the chain already holds (its commit was recorded late)', async () => {
    const heldHash = sha(jpeg(100))
    const pending = [{ id: 'held', sha256: heldHash }, ...[1, 2, 3].map((i) => ({ id: `old${i}`, sha256: sha(jpeg(i + 100)) }))]
    prismaMock.evidenceFile.findMany.mockResolvedValue(pending)
    chainMock.getOnChainEvidence.mockResolvedValue([{ submitter: BUYER, hash: heldHash, uri: 'titip:evidence/held', ledger: 1 }])
    await uploadEvidence(uploadReq(jpeg()), listCtx)
    const deleted = prismaMock.evidenceFile.deleteMany.mock.calls[0][0].where.id.in as string[]
    expect(deleted).not.toContain('held')
    expect(deleted).toEqual(['old1']) // 3 abandoned + the new one would exceed 3, so only the oldest goes
  })

  it('prunes nothing while the party is under the pending limit', async () => {
    prismaMock.evidenceFile.findMany.mockResolvedValue([{ id: 'old1', sha256: sha(jpeg(101)) }])
    await uploadEvidence(uploadReq(jpeg()), listCtx)
    expect(prismaMock.evidenceFile.deleteMany).not.toHaveBeenCalled()
  })

  it('returns 502 when the transaction cannot be built', async () => {
    chainMock.buildSubmitEvidenceTx.mockRejectedValue(new Error('rpc down'))
    expect((await uploadEvidence(uploadReq(jpeg()), listCtx)).status).toBe(502)
  })
})

describe('POST /api/escrow/[id]/evidence/[evidenceId] (commit)', () => {
  beforeEach(() => {
    prismaMock.evidenceFile.findFirst.mockResolvedValue(row())
  })

  it('submits the signed transaction, checks the chain holds the item, then marks it committed', async () => {
    chainMock.getOnChainEvidence.mockResolvedValueOnce([]).mockResolvedValueOnce([chainItem(BUYER)])
    const res = await commitEvidence(commitReq({ signedXdr: 'SIGNED' }), itemCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ committed: true, txHash: 'a'.repeat(64) })
    expect(chainMock.submitSignedTx).toHaveBeenCalledWith('SIGNED')
    expect(prismaMock.evidenceFile.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { committedAt: expect.any(Date), txHash: 'a'.repeat(64) },
    })
  })

  it('marks the item committed without sending a transaction when the chain already holds it (retry)', async () => {
    chainMock.getOnChainEvidence.mockResolvedValue([chainItem(BUYER)])
    const res = await commitEvidence(commitReq({ signedXdr: 'SIGNED' }), itemCtx)
    expect(res.status).toBe(200)
    expect(chainMock.submitSignedTx).not.toHaveBeenCalled()
    expect(prismaMock.evidenceFile.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { committedAt: expect.any(Date), txHash: null },
    })
  })

  it('returns 502 and leaves the row uncommitted when the chain lacks the item after submit', async () => {
    chainMock.getOnChainEvidence.mockResolvedValue([])
    const res = await commitEvidence(commitReq({ signedXdr: 'SIGNED' }), itemCtx)
    expect(res.status).toBe(502)
    expect(prismaMock.evidenceFile.update).not.toHaveBeenCalled()
  })

  it('returns 502 when the network rejects the transaction', async () => {
    chainMock.submitSignedTx.mockRejectedValue(new Error('Transaction failed with status: FAILED'))
    const res = await commitEvidence(commitReq({ signedXdr: 'SIGNED' }), itemCtx)
    expect(res.status).toBe(502)
    expect(prismaMock.evidenceFile.update).not.toHaveBeenCalled()
  })

  it('returns 409 without submitting when all slots are used on-chain', async () => {
    chainMock.getOnChainEvidence.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => chainItem(BUYER, jpeg(i + 1)))
    )
    const res = await commitEvidence(commitReq({ signedXdr: 'SIGNED' }), itemCtx)
    expect(res.status).toBe(409)
    expect(chainMock.submitSignedTx).not.toHaveBeenCalled()
  })

  it('is idempotent for an already committed row', async () => {
    prismaMock.evidenceFile.findFirst.mockResolvedValue(row({ committedAt: new Date(), txHash: 'c'.repeat(64) }))
    const res = await commitEvidence(commitReq({ signedXdr: 'SIGNED' }), itemCtx)
    expect(await res.json()).toMatchObject({ committed: true, txHash: 'c'.repeat(64) })
    expect(chainMock.submitSignedTx).not.toHaveBeenCalled()
  })

  it('returns 403 for a party who is not the uploader, and for outsiders', async () => {
    verifyJwt.mockResolvedValue({ address: SELLER })
    expect((await commitEvidence(commitReq({ signedXdr: 'S' }), itemCtx)).status).toBe(403)
    verifyJwt.mockResolvedValue({ address: OUTSIDER })
    expect((await commitEvidence(commitReq({ signedXdr: 'S' }), itemCtx)).status).toBe(403)
  })

  it('returns 409 when the escrow is not DISPUTED, 400 without a signature, 404 for an unknown row', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ status: 'DELIVERED' }))
    expect((await commitEvidence(commitReq({ signedXdr: 'S' }), itemCtx)).status).toBe(409)
    expect((await commitEvidence(commitReq({}), itemCtx)).status).toBe(400)
    prismaMock.escrow.findUnique.mockResolvedValue(escrow())
    prismaMock.evidenceFile.findFirst.mockResolvedValue(null)
    expect((await commitEvidence(commitReq({ signedXdr: 'S' }), itemCtx)).status).toBe(404)
  })
})

describe('GET /api/escrow/[id]/evidence (list)', () => {
  const stored = [{ id: 'ev1', submitter: BUYER, sha256: sha(jpeg()), mimeType: 'image/jpeg', sizeBytes: 8 }]

  beforeEach(() => {
    prismaMock.evidenceFile.findMany.mockResolvedValue(stored)
    chainMock.getOnChainEvidence.mockResolvedValue([chainItem(BUYER), chainItem(SELLER, jpeg(1))])
  })

  it('lists what the chain committed with roles, not addresses, and the viewer\'s remaining slots', async () => {
    const body = await (await listEvidence(getReq(''), listCtx)).json()
    expect(body.items).toHaveLength(2)
    expect(body.items[0]).toMatchObject({ role: 'BUYER', mine: true, fileId: 'ev1' })
    expect(body.items[1]).toMatchObject({ role: 'SELLER', mine: false, fileId: null })
    expect(body).toMatchObject({ limit: 10, remaining: 9, canUpload: true })
    expect(JSON.stringify(body)).not.toContain(BUYER)
    expect(JSON.stringify(body)).not.toContain(SELLER)
  })

  it('lets the arbiter read with the internal key, without upload rights', async () => {
    getAuthorizationHeader.mockReturnValue(null)
    const res = await listEvidence(getReq('', { authorization: `Bearer ${INTERNAL_KEY}` }), listCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ remaining: null, canUpload: false })
  })

  it('rejects an outsider with 403 and an anonymous caller with 401', async () => {
    verifyJwt.mockResolvedValue({ address: OUTSIDER })
    expect((await listEvidence(getReq(''), listCtx)).status).toBe(403)
    getAuthorizationHeader.mockReturnValue(null)
    expect((await listEvidence(getReq(''), listCtx)).status).toBe(401)
    expect((await listEvidence(getReq('', { authorization: 'Bearer wrong' }), listCtx)).status).toBe(401)
  })

  it('returns 502 when the contract cannot be read', async () => {
    chainMock.getOnChainEvidence.mockRejectedValue(new Error('rpc down'))
    expect((await listEvidence(getReq(''), listCtx)).status).toBe(502)
  })
})

describe('GET /api/escrow/[id]/evidence/[evidenceId] (download)', () => {
  const bytes = jpeg(16)
  const stored = () => row({ sha256: sha(bytes), committedAt: new Date(), sizeBytes: bytes.length })

  beforeEach(() => {
    prismaMock.evidenceFile.findFirst.mockResolvedValue(stored())
    prismaMock.evidenceBlob.findUnique.mockResolvedValue({ evidenceId: 'ev1', data: bytes })
  })

  it('serves the file with its validated type and hardening headers', async () => {
    verifyJwt.mockResolvedValue({ address: SELLER })
    const res = await downloadEvidence(getReq('/ev1'), itemCtx)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('lets the arbiter download a committed file', async () => {
    getAuthorizationHeader.mockReturnValue(null)
    const res = await downloadEvidence(getReq('/ev1', { authorization: `Bearer ${INTERNAL_KEY}` }), itemCtx)
    expect(res.status).toBe(200)
  })

  it('refuses to serve bytes that no longer match the committed hash', async () => {
    prismaMock.evidenceBlob.findUnique.mockResolvedValue({ evidenceId: 'ev1', data: jpeg(17) })
    expect((await downloadEvidence(getReq('/ev1'), itemCtx)).status).toBe(500)
  })

  it('keeps an uncommitted upload private to its uploader', async () => {
    prismaMock.evidenceFile.findFirst.mockResolvedValue({ ...stored(), committedAt: null })
    chainMock.getOnChainEvidence.mockResolvedValue([])

    expect((await downloadEvidence(getReq('/ev1'), itemCtx)).status).toBe(200) // uploader (BUYER)
    verifyJwt.mockResolvedValue({ address: SELLER })
    expect((await downloadEvidence(getReq('/ev1'), itemCtx)).status).toBe(404)
  })

  it('serves an item the chain holds even if the DB never recorded the commit', async () => {
    prismaMock.evidenceFile.findFirst.mockResolvedValue({ ...stored(), committedAt: null })
    chainMock.getOnChainEvidence.mockResolvedValue([chainItem(BUYER, bytes)])
    verifyJwt.mockResolvedValue({ address: SELLER })
    expect((await downloadEvidence(getReq('/ev1'), itemCtx)).status).toBe(200)
  })

  it('rejects outsiders with 403 and unknown ids with 404', async () => {
    verifyJwt.mockResolvedValue({ address: OUTSIDER })
    expect((await downloadEvidence(getReq('/ev1'), itemCtx)).status).toBe(403)
    verifyJwt.mockResolvedValue({ address: BUYER })
    prismaMock.evidenceFile.findFirst.mockResolvedValue(null)
    expect((await downloadEvidence(getReq('/ev1'), itemCtx)).status).toBe(404)
  })
})

describe('escrows created on an older contract', () => {
  // Escrow ids restart at 1 on every deployment: evidence for such a row would belong to another escrow.
  beforeEach(() => {
    prismaMock.escrow.findUnique.mockResolvedValue(escrow({ contractAddress: 'COLD' }))
    prismaMock.evidenceFile.findFirst.mockResolvedValue(row({ committedAt: new Date() }))
  })

  it('is refused with 409 by every evidence endpoint, before any chain access', async () => {
    expect((await listEvidence(getReq(''), listCtx)).status).toBe(409)
    expect((await uploadEvidence(uploadReq(jpeg()), listCtx)).status).toBe(409)
    expect((await downloadEvidence(getReq('/ev1'), itemCtx)).status).toBe(409)
    expect((await commitEvidence(commitReq({ signedXdr: 'S' }), itemCtx)).status).toBe(409)
    expect(chainMock.getOnChainEvidence).not.toHaveBeenCalled()
    expect(chainMock.buildSubmitEvidenceTx).not.toHaveBeenCalled()
    expect(chainMock.submitSignedTx).not.toHaveBeenCalled()
  })

  it('still answers an outsider with 403, not with the contract error', async () => {
    verifyJwt.mockResolvedValue({ address: OUTSIDER })
    expect((await listEvidence(getReq(''), listCtx)).status).toBe(403)
  })
})
