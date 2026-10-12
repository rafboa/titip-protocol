// GET  /api/admin/disputes/:id/resolve?buyerBps=7000 — the unsigned resolve_dispute_split XDR, for the
//                                                      admin to sign in Freighter.
// POST /api/admin/disputes/:id/resolve                — submit the signed XDR and record the outcome.
//
// The contract pays out; the database follows. The signed XDR is decoded before anything is sent and
// the split that is recorded comes from its arguments, never from the request body, so the database
// cannot say something different from what the admin actually signed.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@titip/db'
import { requireAdmin } from '@/lib/admin/access'
import { recordResolution, toAmountString } from '@/lib/admin/resolve'
import { ResolveTxError, decodeResolveSplitTx } from '@/lib/admin/resolve-xdr'
import { baseUnitsToDecimal, decimalToBaseUnits, isValidBuyerBps, splitAmounts } from '@/lib/admin/split'
import { WRONG_CONTRACT_ERROR, isEscrowParty, isOnCurrentContract } from '@/lib/evidence/access'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import {
  buildResolveDisputeSplitTx,
  getOnChainEscrow,
  getTransactionOutcome,
  submitSignedTx,
} from '@/lib/stellar/contracts/escrow'

type RouteContext = { params: Promise<{ id: string }> }

const CONFLICT_ERROR = 'Forbidden: an admin who is a party to this escrow cannot resolve it'

const ResolveSchema = z.object({ signedXdr: z.string().min(1, 'signedXdr is required') })

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await requireAdmin(request)
    if (!gate.ok) return gate.response

    const { id } = await params
    const escrow = await prisma.escrow.findUnique({ where: { id } })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    if (!isOnCurrentContract(escrow)) return NextResponse.json({ error: WRONG_CONTRACT_ERROR }, { status: 409 })
    if (isEscrowParty(escrow, gate.address)) return NextResponse.json({ error: CONFLICT_ERROR }, { status: 403 })
    if (escrow.status !== 'DISPUTED') {
      return NextResponse.json(
        { error: `Cannot resolve escrow with status "${escrow.status}". Expected "DISPUTED".` },
        { status: 409 }
      )
    }

    // Strict on purpose: Number('') and Number(null) are 0, which would silently hand everything to the seller.
    const rawBps = new URL(request.url).searchParams.get('buyerBps') ?? ''
    const buyerBps = /^\d{1,5}$/.test(rawBps) ? Number(rawBps) : Number.NaN
    if (!isValidBuyerBps(buyerBps)) {
      return NextResponse.json({ error: 'buyerBps must be an integer between 0 and 10000' }, { status: 400 })
    }

    let onChain
    try {
      onChain = await getOnChainEscrow(escrow.contractEscrowId)
    } catch (err: unknown) {
      console.error('[GET /api/admin/disputes/:id/resolve] chain read failed:', err)
      return NextResponse.json({ error: 'Failed to read the escrow from the contract' }, { status: 502 })
    }
    if (onChain.status !== 'Disputed') {
      return NextResponse.json({ error: `On-chain status is "${onChain.status}", not "Disputed"` }, { status: 409 })
    }

    let unsignedXdr: string
    try {
      unsignedXdr = await buildResolveDisputeSplitTx(gate.address, escrow.contractEscrowId, buyerBps)
    } catch (err: unknown) {
      console.error('[GET /api/admin/disputes/:id/resolve] build failed:', err)
      return NextResponse.json({ error: 'Failed to prepare the resolution transaction' }, { status: 502 })
    }

    const split = splitAmounts(decimalToBaseUnits(toAmountString(escrow.amountUsdc)), buyerBps)
    return NextResponse.json({
      unsignedXdr,
      buyerBps,
      buyerUsdc: baseUnitsToDecimal(split.buyer),
      sellerUsdc: baseUnitsToDecimal(split.seller),
    })
  } catch (error: unknown) {
    console.error('[GET /api/admin/disputes/:id/resolve] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await requireAdmin(request)
    if (!gate.ok) return gate.response

    const { id } = await params
    const parsed = ResolveSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const escrow = await prisma.escrow.findUnique({ where: { id } })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    if (!isOnCurrentContract(escrow)) return NextResponse.json({ error: WRONG_CONTRACT_ERROR }, { status: 409 })
    if (isEscrowParty(escrow, gate.address)) return NextResponse.json({ error: CONFLICT_ERROR }, { status: 403 })

    let decoded
    try {
      decoded = decodeResolveSplitTx(parsed.data.signedXdr, STELLAR_CONFIG.networkPassphrase, STELLAR_CONFIG.contractAddress)
    } catch (err: unknown) {
      if (err instanceof ResolveTxError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }
    if (decoded.source !== gate.address) {
      return NextResponse.json({ error: 'The transaction must be signed by your own account' }, { status: 403 })
    }
    if (decoded.escrowId !== escrow.contractEscrowId) {
      return NextResponse.json({ error: 'The transaction is for a different escrow' }, { status: 400 })
    }
    if (!isValidBuyerBps(decoded.buyerBps)) {
      return NextResponse.json({ error: 'buyerBps must be an integer between 0 and 10000' }, { status: 400 })
    }
    if (escrow.status !== 'DISPUTED') {
      return NextResponse.json({ error: `Escrow is already "${escrow.status}"` }, { status: 409 })
    }

    let onChain
    try {
      onChain = await getOnChainEscrow(escrow.contractEscrowId)
    } catch (err: unknown) {
      console.error('[POST /api/admin/disputes/:id/resolve] chain read failed:', err)
      return NextResponse.json({ error: 'Failed to read the escrow from the contract' }, { status: 502 })
    }

    if (onChain.status === 'Disputed') {
      try {
        await submitSignedTx(parsed.data.signedXdr)
      } catch (err: unknown) {
        const details = err instanceof Error ? err.message : 'Unknown error'
        return NextResponse.json({ error: 'Failed to submit the resolution transaction', details }, { status: 502 })
      }
      try {
        onChain = await getOnChainEscrow(escrow.contractEscrowId)
      } catch (err: unknown) {
        console.error('[POST /api/admin/disputes/:id/resolve] chain re-read failed:', err)
        return NextResponse.json({ error: 'Failed to read the escrow from the contract' }, { status: 502 })
      }
      if (onChain.status === 'Disputed') {
        return NextResponse.json(
          { error: 'Transaction submitted but the escrow is still disputed on-chain; nothing was recorded' },
          { status: 502 }
        )
      }
    } else {
      // The chain was already resolved while the database still says DISPUTED (a retry after a failed
      // write). Only catch up if it was THIS transaction that did it; never resubmit.
      let outcome
      try {
        outcome = await getTransactionOutcome(decoded.txHash)
      } catch (err: unknown) {
        console.error('[POST /api/admin/disputes/:id/resolve] transaction lookup failed:', err)
        return NextResponse.json({ error: 'Failed to look the transaction up' }, { status: 502 })
      }
      if (outcome !== 'SUCCESS') {
        return NextResponse.json(
          { error: `The dispute was already resolved on-chain by another transaction (status "${onChain.status}")` },
          { status: 409 }
        )
      }
    }

    const recorded = await recordResolution(
      {
        id: escrow.id,
        buyerAddress: escrow.buyerAddress,
        sellerAddress: escrow.sellerAddress,
        amountUsdc: toAmountString(escrow.amountUsdc),
      },
      decoded.buyerBps,
      decoded.txHash,
      gate.address
    )
    if (!recorded) {
      return NextResponse.json({ error: 'The dispute was resolved by someone else in the meantime' }, { status: 409 })
    }

    return NextResponse.json({
      id: escrow.id,
      status: onChain.status.toUpperCase(),
      resolutionBuyerBps: decoded.buyerBps,
      txHash: decoded.txHash,
    })
  } catch (error: unknown) {
    console.error('[POST /api/admin/disputes/:id/resolve] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
