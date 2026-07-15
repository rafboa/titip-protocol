// GET /api/escrow/:id
// Returns a single escrow with buyer, seller, and oracle event details.
// Merges DB state. Chain state sync is handled separately.
// v1.1: Add on-chain state merge — fetch contract state and reconcile if divergent

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { stellarExpertTxUrl } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const escrow = await prisma.escrow.findUnique({
      where: { id },
      include: {
        buyer: {
          select: { stellarAddress: true, displayName: true, walletType: true },
        },
        seller: {
          select: { stellarAddress: true, displayName: true, walletType: true },
        },
        oracleEvents: {
          orderBy: { confirmedAt: 'desc' },
          take: 10,
        },
      },
    })

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }

    // Enrich with Stellar Expert links for any tx hashes
    const enriched = {
      ...escrow,
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
