// GET /api/escrow/:id/tracking?trackingNumber=X&courierCode=Y
// Builds the unsigned submit_tracking() transaction for the seller to sign.
// POST /api/escrow/:id/tracking
// Submits the seller's signed submit_tracking() transaction to Soroban RPC
// and updates the escrow to SHIPPED.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { buildSubmitTrackingTx, submitSignedTx } from '@/lib/stellar/contracts/escrow'

// Courier codes matching the Prisma CourierCode enum
const COURIER_CODES = ['JNT', 'JNE', 'SICEPAT', 'ANTERAJA', 'POS_INDONESIA'] as const

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const trackingNumber = searchParams.get('trackingNumber')
    const courierCode = searchParams.get('courierCode')

    if (!trackingNumber || !courierCode) {
      return NextResponse.json({ error: 'Missing trackingNumber or courierCode' }, { status: 400 })
    }

    const escrow = await prisma.escrow.findUnique({ where: { id } })

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }

    if (escrow.status !== 'FUNDED') {
      return NextResponse.json(
        { error: `Cannot submit tracking for escrow with status "${escrow.status}". Expected "FUNDED".` },
        { status: 409 }
      )
    }

    const unsignedTrackingXdr = await buildSubmitTrackingTx(
      escrow.sellerAddress,
      escrow.contractEscrowId,
      trackingNumber,
      courierCode
    )

    return NextResponse.json({ unsignedTrackingXdr })
  } catch (error: unknown) {
    console.error('[GET /api/escrow/:id/tracking] Error:', error)

    if (error instanceof Error && error.message.includes('Simulation failed')) {
      return NextResponse.json(
        { error: 'Contract simulation failed', details: error.message },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const TrackingSchema = z.object({
  trackingNumber: z.string().min(3, 'Tracking number too short').max(100),
  courierCode: z.enum(COURIER_CODES),
  signedXdr: z.string().min(1, 'Signed transaction XDR is required'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: unknown = await request.json()
    const parsed = TrackingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const escrow = await prisma.escrow.findUnique({ where: { id } })

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }

    if (escrow.status !== 'FUNDED') {
      return NextResponse.json(
        { error: `Cannot submit tracking for escrow with status "${escrow.status}". Expected "FUNDED".` },
        { status: 409 }
      )
    }

    let txHash: string
    try {
      txHash = await submitSignedTx(parsed.data.signedXdr)
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : 'Unknown error'
      return NextResponse.json(
        { error: 'Failed to submit tracking transaction', details: message },
        { status: 502 }
      )
    }

    const updated = await prisma.escrow.update({
      where: { id },
      data: {
        status: 'SHIPPED',
        shippedAt: new Date(),
        trackingNumber: parsed.data.trackingNumber,
        courierCode: parsed.data.courierCode,
      },
    })

    // Notify the buyer
    await prisma.notification.create({
      data: {
        userAddress: escrow.buyerAddress,
        type: 'ESCROW_SHIPPED',
        message: `Your order has been shipped via ${parsed.data.courierCode} (Tracking: ${parsed.data.trackingNumber}).`,
      },
    })

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      shippedAt: updated.shippedAt?.toISOString(),
      trackingNumber: updated.trackingNumber,
      courierCode: updated.courierCode,
    })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/tracking] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
