// GET /api/escrow/:id/refund — builds the unsigned claim_refund() transaction
// for the buyer to sign.
// POST /api/escrow/:id/refund — submits the buyer's signed claim_refund()
// transaction and updates the escrow to REFUNDED.
//
// The contract itself enforces current_ledger > timeout_ledger and status
// (FUNDED/SHIPPED only) — this route does not duplicate that logic, it just
// relays the buyer's signed transaction and reflects the on-chain result.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { buildClaimRefundTx, submitSignedTx } from '@/lib/stellar/contracts/escrow'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const escrow = await prisma.escrow.findUnique({ where: { id } })

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }

    if (escrow.status !== 'FUNDED' && escrow.status !== 'SHIPPED') {
      return NextResponse.json(
        { error: `Cannot refund escrow with status "${escrow.status}".` },
        { status: 409 }
      )
    }

    const unsignedRefundXdr = await buildClaimRefundTx(escrow.buyerAddress, escrow.contractEscrowId)

    return NextResponse.json({ unsignedRefundXdr })
  } catch (error: unknown) {
    console.error('[GET /api/escrow/:id/refund] Error:', error)

    if (error instanceof Error && error.message.includes('Simulation failed')) {
      return NextResponse.json(
        { error: 'Contract simulation failed', details: error.message },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const RefundSchema = z.object({
  signedXdr: z.string().min(1, 'Signed transaction XDR is required'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: unknown = await request.json()
    const parsed = RefundSchema.safeParse(body)

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

    if (escrow.status !== 'FUNDED' && escrow.status !== 'SHIPPED') {
      return NextResponse.json(
        { error: `Cannot refund escrow with status "${escrow.status}".` },
        { status: 409 }
      )
    }

    let txHash: string
    try {
      txHash = await submitSignedTx(parsed.data.signedXdr)
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : 'Unknown error'
      return NextResponse.json(
        { error: 'Failed to submit refund transaction', details: message },
        { status: 502 }
      )
    }

    const updated = await prisma.escrow.update({
      where: { id },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        txHashRelease: txHash,
      },
    })

    await prisma.notification.create({
      data: {
        userAddress: escrow.sellerAddress,
        type: 'ESCROW_REFUNDED',
        message: `Escrow refunded to buyer after timeout.`,
      },
    })

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      refundedAt: updated.refundedAt?.toISOString(),
      txHashRelease: updated.txHashRelease,
    })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/refund] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
