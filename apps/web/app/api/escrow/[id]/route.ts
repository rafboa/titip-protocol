// GET /api/escrow/:id
// Returns a single escrow to its buyer or seller only. Everyone else (including anonymous callers)
// gets the same 404 as for a missing escrow, so ids cannot be probed.
// Merges DB state. Chain state sync is handled separately.
// v1.1: Add on-chain state merge — fetch contract state and reconcile if divergent

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { stellarExpertTxUrl } from '@/lib/utils'
import { verifyJwt, getAuthorizationHeader } from '@/lib/auth/sep10'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const authHeader = getAuthorizationHeader(request)
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let caller: string
    try {
      caller = (await verifyJwt(authHeader)).address
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired session' }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)

    const escrow = await prisma.escrow.findUnique({
      where: { id },
      include: {
        buyer: {
          select: { stellarAddress: true, displayName: true, walletType: true },
        },
        seller: {
          select: { stellarAddress: true, displayName: true, walletType: true },
        },
        // Only what the UI needs: raw courier responses can contain the recipient's personal
        // data, and oracle node ids are internal.
        oracleEvents: {
          orderBy: { confirmedAt: 'desc' },
          take: 10,
          select: { id: true, eventType: true, confirmedAt: true },
        },
        legs: {
          orderBy: { seq: 'asc' },
          select: { id: true, seq: true, courier: true, trackingNumber: true, status: true, stage: true },
        },
      },
    })

    if (!escrow || (escrow.buyerAddress !== caller && escrow.sellerAddress !== caller)) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }

    // The raw QRIS payload (merchant account data) is only needed to create the escrow.
    const { qrisPayloadRaw: _qrisPayloadRaw, ...visible } = escrow

    // Enrich with Stellar Expert links for any tx hashes
    const enriched = {
      ...visible,
      // Serialize BigInt and Decimal for JSON
      contractEscrowId: escrow.contractEscrowId.toString(),
      amountUsdc: escrow.amountUsdc.toString(),
      // Add explorer links
      txHashFundUrl: escrow.txHashFund
        ? stellarExpertTxUrl(escrow.txHashFund)
        : null,
      txHashReleaseUrl: escrow.txHashRelease
        ? stellarExpertTxUrl(escrow.txHashRelease)
        : null,
    }

    return NextResponse.json(enriched)
  } catch (error: unknown) {
    console.error('[GET /api/escrow/:id] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
