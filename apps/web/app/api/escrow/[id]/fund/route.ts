import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { submitSignedTx, getOnChainEscrow, buildFundEscrowTx } from '@/lib/stellar/contracts/escrow'
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
      return NextResponse.json({ error: 'Forbidden: only the buyer can fund this escrow' }, { status: 403 })
    }

    if (escrow.status !== 'PENDING') {
      return NextResponse.json({ error: `Cannot fund escrow with status "${escrow.status}"` }, { status: 409 })
    }

    const unsignedFundXdr = await buildFundEscrowTx(escrow.buyerAddress, escrow.contractEscrowId)
    return NextResponse.json({ unsignedFundXdr })
  } catch (error: unknown) {
    console.error('[GET /api/escrow/:id/fund] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const FundSchema = z.object({
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
    const parsed = FundSchema.safeParse(body)

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
        { error: 'Forbidden: only the buyer can fund this escrow' },
        { status: 403 }
      )
    }

    if (escrow.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot fund escrow with status "${escrow.status}". Expected "PENDING".` },
        { status: 409 }
      )
    }

    let txHash: string
    try {
      txHash = await submitSignedTx(parsed.data.signedXdr)
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : 'Unknown error'
      return NextResponse.json(
        { error: 'Failed to submit funding transaction', details: message },
        { status: 502 }
      )
    }

    // Verify on-chain state to prevent phantom funding
    const onChain = await getOnChainEscrow(escrow.contractEscrowId)
    if (onChain.status !== 'Funded') {
      return NextResponse.json(
        { error: `Transaction submitted but contract status is "${onChain.status}", expected "Funded"` },
        { status: 502 }
      )
    }

    const updated = await prisma.escrow.update({
      where: { id },
      data: {
        status: 'FUNDED',
        fundedAt: new Date(),
        txHashFund: txHash,
      },
    })

    // Notify seller that funds are locked
    await prisma.notification.create({
      data: {
        userAddress: escrow.sellerAddress,
        type: 'ESCROW_FUNDED',
        message: `Escrow funded with ${escrow.amountUsdc} USDC. You can now ship the item.`,
      },
    })

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      fundedAt: updated.fundedAt?.toISOString(),
      txHashFund: updated.txHashFund,
    })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/fund] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
