import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { buildClaimRefundTx, submitSignedTx, getOnChainEscrow } from '@/lib/stellar/contracts/escrow'
import { verifyJwt } from '@/lib/auth/sep10'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized: missing authorization header' }, { status: 401 })
    }

    let payload
    try {
      payload = await verifyJwt(authHeader)
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired session' }, { status: 401 })
    }

    const { id } = await params
    const escrow = await prisma.escrow.findUnique({ where: { id } })

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }

    if (payload.address !== escrow.buyerAddress) {
      return NextResponse.json(
        { error: 'Forbidden: only the buyer can claim a refund' },
        { status: 403 }
      )
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
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized: missing authorization header' }, { status: 401 })
    }

    let payload
    try {
      payload = await verifyJwt(authHeader)
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired session' }, { status: 401 })
    }

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

    if (payload.address !== escrow.buyerAddress) {
      return NextResponse.json(
        { error: 'Forbidden: only the buyer can claim a refund' },
        { status: 403 }
      )
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

    // Verify on-chain status
    const onChain = await getOnChainEscrow(escrow.contractEscrowId)
    if (onChain.status !== 'Refunded') {
      return NextResponse.json(
        { error: `Transaction submitted but contract status is "${onChain.status}", expected "Refunded"` },
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
