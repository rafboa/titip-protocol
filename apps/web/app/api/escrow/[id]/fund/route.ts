// POST /api/escrow/:id/fund
// Submits the buyer's signed fund() transaction to Soroban RPC and, once it
// succeeds on-chain, updates the escrow status to FUNDED with the real tx hash.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { submitSignedTx } from '@/lib/stellar/contracts/escrow'

const FundSchema = z.object({
  signedXdr: z.string().min(1, 'Signed transaction XDR is required'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    if (escrow.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot fund escrow with status "${escrow.status}". Expected "PENDING".` },
        { status: 409 }
      )
    }

    // Actually submit the buyer-signed transaction to the network — the
    // resulting hash (not a client-supplied one) is what gets persisted.
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
