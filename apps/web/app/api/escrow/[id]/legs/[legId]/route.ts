// POST /api/escrow/[id]/legs/[legId]   body: { decision: 'APPROVE' | 'REJECT' }
// The buyer decides on a leg the seller proposed. Only PROPOSED legs can be decided, once.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { verifyJwt, getAuthorizationHeader } from '@/lib/auth/sep10'

const DecisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) })

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; legId: string } },
) {
  try {
    const authHeader = getAuthorizationHeader(request)
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let caller: string
    try {
      caller = (await verifyJwt(authHeader)).address
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired session' }, { status: 401 })
    }

    const parsed = DecisionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const leg = await prisma.shipmentLeg.findUnique({
      where: { id: params.legId },
      include: { escrow: { select: { id: true, status: true, buyerAddress: true, sellerAddress: true } } },
    })
    // Scope the leg to the escrow in the URL so ids cannot be mixed across escrows.
    if (!leg || leg.escrowId !== params.id) return NextResponse.json({ error: 'Leg not found' }, { status: 404 })

    if (caller !== leg.escrow.buyerAddress) {
      return NextResponse.json({ error: 'Forbidden: only the buyer can decide on a leg' }, { status: 403 })
    }
    if (leg.escrow.status !== 'SHIPPED') {
      return NextResponse.json({ error: `Escrow is "${leg.escrow.status}", not "SHIPPED"` }, { status: 409 })
    }
    if (leg.status !== 'PROPOSED') {
      return NextResponse.json({ error: `Leg already ${leg.status.toLowerCase()}` }, { status: 409 })
    }

    const status = parsed.data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    // Conditional update: a concurrent decision cannot be overwritten.
    const result = await prisma.shipmentLeg.updateMany({
      where: { id: leg.id, status: 'PROPOSED' },
      data: { status, decidedAt: new Date() },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Leg already decided' }, { status: 409 })

    await prisma.notification.create({
      data: {
        userAddress: leg.escrow.sellerAddress,
        type: status === 'APPROVED' ? 'LEG_APPROVED' : 'LEG_REJECTED',
        message:
          status === 'APPROVED'
            ? `Pembeli menyetujui leg pengiriman ${leg.courier} (resi ${leg.trackingNumber}).`
            : `Pembeli menolak leg pengiriman ${leg.courier} (resi ${leg.trackingNumber}).`,
      },
    })

    return NextResponse.json({ id: leg.id, status })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/legs/:legId] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
