// POST /api/escrow/[id]/legs
// The seller proposes an extra shipping leg (e.g. Pos Indonesia -> local courier). The buyer must
// approve it (see ./[legId]/route.ts) before it counts. Only while the escrow is SHIPPED.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { verifyJwt, getAuthorizationHeader } from '@/lib/auth/sep10'

const MAX_LEGS = 5

const ProposeLegSchema = z.object({
  courierCode: z.enum(['JNT', 'JNE', 'SICEPAT', 'ANTERAJA', 'POS_INDONESIA']),
  trackingNumber: z.string().trim().min(3, 'Tracking number too short').max(100),
})

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authHeader = getAuthorizationHeader(request)
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let caller: string
    try {
      caller = (await verifyJwt(authHeader)).address
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired session' }, { status: 401 })
    }

    const parsed = ProposeLegSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const escrow = await prisma.escrow.findUnique({
      where: { id: params.id },
      include: { legs: { select: { seq: true, status: true, courier: true, trackingNumber: true } } },
    })
    if (!escrow) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    if (caller !== escrow.sellerAddress) {
      return NextResponse.json({ error: 'Forbidden: only the seller can propose a shipping leg' }, { status: 403 })
    }
    if (escrow.status !== 'SHIPPED') {
      return NextResponse.json(
        { error: `Cannot add a leg to an escrow with status "${escrow.status}". Expected "SHIPPED".` },
        { status: 409 },
      )
    }

    const { courierCode, trackingNumber } = parsed.data
    const live = escrow.legs.filter((l) => l.status !== 'REJECTED')
    if (live.length >= MAX_LEGS) {
      return NextResponse.json({ error: `At most ${MAX_LEGS} extra legs per escrow` }, { status: 409 })
    }
    if (live.some((l) => l.status === 'PROPOSED')) {
      return NextResponse.json({ error: 'A proposed leg is still waiting for the buyer' }, { status: 409 })
    }
    const sameAsPrimary = escrow.courierCode === courierCode && escrow.trackingNumber === trackingNumber
    const sameAsLeg = live.some((l) => l.courier === courierCode && l.trackingNumber === trackingNumber)
    if (sameAsPrimary || sameAsLeg) {
      return NextResponse.json({ error: 'This tracking number is already on the escrow' }, { status: 409 })
    }

    const seq = escrow.legs.reduce((max, l) => Math.max(max, l.seq), 0) + 1
    try {
      const [leg] = await prisma.$transaction([
        prisma.shipmentLeg.create({
          data: { escrowId: escrow.id, seq, courier: courierCode, trackingNumber },
        }),
        prisma.notification.create({
          data: {
            userAddress: escrow.buyerAddress,
            type: 'LEG_PROPOSED',
            message: `Penjual menambahkan leg pengiriman (${courierCode}, resi ${trackingNumber}). Setujui atau tolak di halaman escrow.`,
          },
        }),
      ])
      return NextResponse.json({ id: leg.id, seq: leg.seq, status: leg.status }, { status: 201 })
    } catch (err) {
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: 'Another leg was added at the same time; retry' }, { status: 409 })
      }
      throw err
    }
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/legs] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
