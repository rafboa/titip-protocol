// GET  /api/escrow/:id/evidence  — what the contract committed, joined to the files stored here.
// POST /api/escrow/:id/evidence  — upload one image; returns the unsigned submit_evidence XDR.
//
// Flow: the browser hashes the file, POSTs it here, signs the returned XDR with Freighter and POSTs
// the signature to /evidence/:evidenceId. The server hashes the bytes it stores itself and builds the
// transaction from that hash; the client's hash is only a check that the upload arrived intact.

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { buildSubmitEvidenceTx, getOnChainEvidence } from '@/lib/stellar/contracts/escrow'
import {
  WRONG_CONTRACT_ERROR,
  evidenceReadRole,
  isEscrowParty,
  isOnCurrentContract,
  resolveEvidenceReader,
  resolveParty,
} from '@/lib/evidence/access'
import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_PER_PARTY,
  MAX_PENDING_UPLOADS_PER_PARTY,
  detectEvidenceMime,
  evidenceUri,
} from '@/lib/evidence/file'
import { buildEvidenceList, slotsUsed } from '@/lib/evidence/merge'

// Multipart framing around the file; keeps the early Content-Length check from rejecting a max-size file.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await resolveEvidenceReader(request)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const escrow = await prisma.escrow.findUnique({ where: { id } })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    const role = await evidenceReadRole(caller, escrow)
    if (!role) {
      return NextResponse.json({ error: 'Forbidden: only buyer or seller can view this evidence' }, { status: 403 })
    }
    if (!isOnCurrentContract(escrow)) {
      return NextResponse.json({ error: WRONG_CONTRACT_ERROR }, { status: 409 })
    }

    let chain
    try {
      chain = await getOnChainEvidence(escrow.contractEscrowId)
    } catch (err: unknown) {
      console.error('[GET /api/escrow/:id/evidence] chain read failed:', err)
      return NextResponse.json({ error: 'Failed to read evidence from the contract' }, { status: 502 })
    }

    // The chain decides what exists; stored rows (committed or not) only supply the files behind it.
    const stored = await prisma.evidenceFile.findMany({
      where: { escrowId: id },
      select: { id: true, submitter: true, sha256: true, mimeType: true, sizeBytes: true },
    })

    const viewer = role === 'party' && caller.kind === 'party' ? caller.address : null
    return NextResponse.json({
      items: buildEvidenceList(chain, stored, escrow, viewer),
      limit: MAX_EVIDENCE_PER_PARTY,
      remaining: viewer ? Math.max(0, MAX_EVIDENCE_PER_PARTY - slotsUsed(chain, viewer)) : null,
      canUpload: role === 'party' && escrow.status === 'DISPUTED',
    })
  } catch (error: unknown) {
    console.error('[GET /api/escrow/:id/evidence] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002'
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await resolveParty(request)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const escrow = await prisma.escrow.findUnique({ where: { id } })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    if (!isEscrowParty(escrow, caller.address)) {
      return NextResponse.json({ error: 'Forbidden: only buyer or seller can submit evidence' }, { status: 403 })
    }
    if (!isOnCurrentContract(escrow)) {
      return NextResponse.json({ error: WRONG_CONTRACT_ERROR }, { status: 409 })
    }
    if (escrow.status !== 'DISPUTED') {
      return NextResponse.json(
        { error: `Cannot add evidence to an escrow with status "${escrow.status}". Expected "DISPUTED".` },
        { status: 409 }
      )
    }

    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_EVIDENCE_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 })
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return NextResponse.json({ error: 'Expected a multipart form with "file" and "sha256"' }, { status: 400 })
    }
    const file = form.get('file')
    const clientHash = form.get('sha256')
    if (!(file instanceof File) || typeof clientHash !== 'string' || file.size === 0) {
      return NextResponse.json({ error: 'Expected a non-empty "file" and a "sha256" field' }, { status: 400 })
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const mimeType = detectEvidenceMime(bytes)
    if (!mimeType) {
      return NextResponse.json({ error: 'Only JPEG, PNG or WebP images are accepted' }, { status: 400 })
    }
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    if (clientHash.toLowerCase() !== sha256) {
      return NextResponse.json({ error: 'The uploaded file does not match the hash sent with it' }, { status: 400 })
    }

    // Idempotent on (escrow, submitter, hash): picking the same file again after a rejected signature
    // reuses the stored row and only builds a fresh transaction.
    const key = { escrowId: id, submitter: caller.address, sha256 }
    let row = await prisma.evidenceFile.findUnique({ where: { escrowId_submitter_sha256: key } })
    if (!row) {
      // The limit is the contract's own: on-chain slots are what a party really has.
      let chain
      try {
        chain = await getOnChainEvidence(escrow.contractEscrowId)
      } catch (err: unknown) {
        console.error('[POST /api/escrow/:id/evidence] chain read failed:', err)
        return NextResponse.json({ error: 'Failed to read evidence from the contract' }, { status: 502 })
      }
      if (slotsUsed(chain, caller.address) >= MAX_EVIDENCE_PER_PARTY) {
        return NextResponse.json({ error: 'Evidence limit reached for this escrow' }, { status: 409 })
      }

      // Bound the storage of unsigned uploads without ever locking the party out: drop the oldest
      // abandoned ones. A file the chain already holds (its commit was recorded late) is kept.
      const pending = await prisma.evidenceFile.findMany({
        where: { escrowId: id, submitter: caller.address, committedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, sha256: true },
      })
      const abandoned = pending.filter(
        (p) => !chain.some((c) => c.submitter === caller.address && c.hash === p.sha256)
      )
      const excess = abandoned.length - (MAX_PENDING_UPLOADS_PER_PARTY - 1)
      if (excess > 0) {
        await prisma.evidenceFile.deleteMany({ where: { id: { in: abandoned.slice(0, excess).map((p) => p.id) } } })
      }

      try {
        row = await prisma.evidenceFile.create({
          data: { ...key, mimeType, sizeBytes: bytes.length, blob: { create: { data: bytes } } },
        })
      } catch (err: unknown) {
        if (!isUniqueViolation(err)) throw err
        row = await prisma.evidenceFile.findUnique({ where: { escrowId_submitter_sha256: key } })
      }
    }
    if (!row) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

    if (row.committedAt) {
      return NextResponse.json({ evidenceId: row.id, sha256, committed: true })
    }

    // Built last, right before signing: the transaction is only valid for 30 seconds.
    let unsignedXdr: string
    try {
      unsignedXdr = await buildSubmitEvidenceTx(caller.address, escrow.contractEscrowId, sha256, evidenceUri(row.id))
    } catch (err: unknown) {
      console.error('[POST /api/escrow/:id/evidence] build failed:', err)
      return NextResponse.json({ error: 'Failed to prepare the evidence transaction' }, { status: 502 })
    }
    return NextResponse.json({ evidenceId: row.id, sha256, committed: false, unsignedXdr })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/evidence] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
