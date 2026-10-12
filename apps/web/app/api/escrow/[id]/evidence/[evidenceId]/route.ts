// GET  /api/escrow/:id/evidence/:evidenceId — download the stored file (buyer, seller or the arbiter).
// POST /api/escrow/:id/evidence/:evidenceId — commit: submit the Freighter-signed submit_evidence XDR.
//
// The contract has no de-duplication and gives each party a fixed number of slots, so the commit
// reads the chain before and after submitting: an item that is already there is marked committed
// without sending anything (a retry after a failed DB write must not burn a slot), and nothing is
// marked committed unless the chain now holds it (the signed XDR comes from the user).

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@titip/db'
import { getOnChainEvidence, submitSignedTx } from '@/lib/stellar/contracts/escrow'
import {
  WRONG_CONTRACT_ERROR,
  evidenceReadRole,
  isEscrowParty,
  isOnCurrentContract,
  resolveEvidenceReader,
  resolveParty,
} from '@/lib/evidence/access'
import { MAX_EVIDENCE_PER_PARTY } from '@/lib/evidence/file'
import { slotsUsed } from '@/lib/evidence/merge'
import { getEvidenceObject } from '@/lib/evidence/storage'

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const CommitSchema = z.object({ signedXdr: z.string().min(1, 'signedXdr is required') })

type RouteContext = { params: Promise<{ id: string; evidenceId: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const caller = await resolveEvidenceReader(request)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, evidenceId } = await params
    const escrow = await prisma.escrow.findUnique({ where: { id } })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    if (!(await evidenceReadRole(caller, escrow))) {
      return NextResponse.json({ error: 'Forbidden: only buyer or seller can view this evidence' }, { status: 403 })
    }
    if (!isOnCurrentContract(escrow)) {
      return NextResponse.json({ error: WRONG_CONTRACT_ERROR }, { status: 409 })
    }

    const row = await prisma.evidenceFile.findFirst({ where: { id: evidenceId, escrowId: id } })
    if (!row) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 })

    // Until it is committed, a file is private to the party who uploaded it.
    const isOwner = caller.kind === 'party' && caller.address === row.submitter
    if (!row.committedAt && !isOwner) {
      let committed = false
      try {
        const chain = await getOnChainEvidence(escrow.contractEscrowId)
        committed = chain.some((item) => item.submitter === row.submitter && item.hash === row.sha256)
      } catch (err: unknown) {
        console.error('[GET /api/escrow/:id/evidence/:evidenceId] chain read failed:', err)
        return NextResponse.json({ error: 'Failed to read evidence from the contract' }, { status: 502 })
      }
      if (!committed) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 })
    }

    let data: Uint8Array | null
    if (row.storageKey) {
      try {
        data = await getEvidenceObject(row.storageKey)
      } catch (err: unknown) {
        console.error('[GET /api/escrow/:id/evidence/:evidenceId] object storage read failed:', err)
        return NextResponse.json({ error: 'Failed to read the evidence file' }, { status: 502 })
      }
    } else {
      data = (await prisma.evidenceBlob.findUnique({ where: { evidenceId: row.id } }))?.data ?? null
    }
    if (!data) return NextResponse.json({ error: 'The file is no longer available' }, { status: 404 })

    // The hash on-chain is the point of the whole feature: never serve bytes that no longer match it.
    const actual = crypto.createHash('sha256').update(data).digest('hex')
    if (actual !== row.sha256) {
      console.error(`[evidence] stored file ${row.id} does not match its committed hash`)
      return NextResponse.json({ error: 'Stored file does not match its committed hash' }, { status: 500 })
    }

    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': row.mimeType,
        'Content-Length': String(data.length),
        'Content-Disposition': `inline; filename="evidence-${row.sha256.slice(0, 12)}.${EXTENSIONS[row.mimeType] ?? 'bin'}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error: unknown) {
    console.error('[GET /api/escrow/:id/evidence/:evidenceId] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const caller = await resolveParty(request)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, evidenceId } = await params
    const parsed = CommitSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const escrow = await prisma.escrow.findUnique({ where: { id } })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    if (!isEscrowParty(escrow, caller.address)) {
      return NextResponse.json({ error: 'Forbidden: only buyer or seller can submit evidence' }, { status: 403 })
    }
    if (!isOnCurrentContract(escrow)) {
      return NextResponse.json({ error: WRONG_CONTRACT_ERROR }, { status: 409 })
    }

    const row = await prisma.evidenceFile.findFirst({ where: { id: evidenceId, escrowId: id } })
    if (!row) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 })
    if (row.submitter !== caller.address) {
      return NextResponse.json({ error: 'Forbidden: only the uploader can commit this evidence' }, { status: 403 })
    }
    if (row.committedAt) {
      return NextResponse.json({ evidenceId: row.id, sha256: row.sha256, committed: true, txHash: row.txHash })
    }
    if (escrow.status !== 'DISPUTED') {
      return NextResponse.json(
        { error: `Cannot add evidence to an escrow with status "${escrow.status}". Expected "DISPUTED".` },
        { status: 409 }
      )
    }

    const holdsItem = (items: { submitter: string; hash: string }[]) =>
      items.some((item) => item.submitter === caller.address && item.hash === row.sha256)

    let chain
    try {
      chain = await getOnChainEvidence(escrow.contractEscrowId)
    } catch (err: unknown) {
      console.error('[POST /api/escrow/:id/evidence/:evidenceId] chain read failed:', err)
      return NextResponse.json({ error: 'Failed to read evidence from the contract' }, { status: 502 })
    }

    let txHash: string | null = null
    if (!holdsItem(chain)) {
      if (slotsUsed(chain, caller.address) >= MAX_EVIDENCE_PER_PARTY) {
        return NextResponse.json({ error: 'Evidence limit reached for this escrow' }, { status: 409 })
      }
      try {
        txHash = await submitSignedTx(parsed.data.signedXdr)
      } catch (err: unknown) {
        const details = err instanceof Error ? err.message : 'Unknown error'
        return NextResponse.json({ error: 'Failed to submit evidence transaction', details }, { status: 502 })
      }
      try {
        chain = await getOnChainEvidence(escrow.contractEscrowId)
      } catch (err: unknown) {
        console.error('[POST /api/escrow/:id/evidence/:evidenceId] chain re-read failed:', err)
        return NextResponse.json({ error: 'Failed to read evidence from the contract' }, { status: 502 })
      }
      if (!holdsItem(chain)) {
        return NextResponse.json(
          { error: 'Transaction submitted but this evidence is not on-chain; it was not recorded' },
          { status: 502 }
        )
      }
    }

    await prisma.evidenceFile.update({ where: { id: row.id }, data: { committedAt: new Date(), txHash } })
    return NextResponse.json({ evidenceId: row.id, sha256: row.sha256, committed: true, txHash })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/evidence/:evidenceId] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
