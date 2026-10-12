// GET /api/admin/disputes/:id — one escrow for the admin's decision page.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { requireAdmin } from '@/lib/admin/access'
import { toAmountString } from '@/lib/admin/resolve'
import { isEscrowParty, isOnCurrentContract } from '@/lib/evidence/access'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAdmin(request)
    if (!gate.ok) return gate.response

    const { id } = await params
    const escrow = await prisma.escrow.findUnique({ where: { id } })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })

    const onCurrentContract = isOnCurrentContract(escrow)
    const involvesAdmin = isEscrowParty(escrow, gate.address)
    return NextResponse.json({
      id: escrow.id,
      status: escrow.status,
      amountUsdc: toAmountString(escrow.amountUsdc),
      buyerAddress: escrow.buyerAddress,
      sellerAddress: escrow.sellerAddress,
      createdAt: escrow.createdAt.toISOString(),
      resolutionBuyerBps: escrow.resolutionBuyerBps,
      resolvedAt: escrow.resolvedAt?.toISOString() ?? null,
      onCurrentContract,
      involvesAdmin,
      resolvable: escrow.status === 'DISPUTED' && onCurrentContract && !involvesAdmin,
    })
  } catch (error: unknown) {
    console.error('[GET /api/admin/disputes/:id] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
