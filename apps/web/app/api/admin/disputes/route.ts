// GET /api/admin/disputes — escrows waiting for an admin decision.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { requireAdmin } from '@/lib/admin/access'
import { toAmountString } from '@/lib/admin/resolve'
import { isEscrowParty, isOnCurrentContract } from '@/lib/evidence/access'

export async function GET(request: NextRequest) {
  try {
    const gate = await requireAdmin(request)
    if (!gate.ok) return gate.response

    const escrows = await prisma.escrow.findMany({
      where: { status: 'DISPUTED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        amountUsdc: true,
        buyerAddress: true,
        sellerAddress: true,
        createdAt: true,
        contractAddress: true,
        _count: { select: { evidence: { where: { committedAt: { not: null } } } } },
      },
    })

    return NextResponse.json({
      disputes: escrows.map((escrow) => ({
        id: escrow.id,
        amountUsdc: toAmountString(escrow.amountUsdc),
        buyerAddress: escrow.buyerAddress,
        sellerAddress: escrow.sellerAddress,
        createdAt: escrow.createdAt.toISOString(),
        evidenceCount: escrow._count.evidence,
        // Escrows of an older contract cannot be resolved from here (ids restart at 1 per deployment).
        resolvable: isOnCurrentContract(escrow) && !isEscrowParty(escrow, gate.address),
      })),
    })
  } catch (error: unknown) {
    console.error('[GET /api/admin/disputes] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
