// POST /api/escrow/confirm
// Submits the buyer's signed create_escrow() transaction, reads back the
// real contract-assigned escrow ID from the transaction result, creates the
// DB record against that real ID, and returns the unsigned fund() transaction
// for the buyer to sign next.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { submitCreateEscrowTx, buildFundEscrowTx } from '@/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

const ConfirmEscrowSchema = z.object({
  signedCreateXdr: z.string().min(1, 'Signed create transaction XDR is required'),
  buyerAddress: z.string().regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar public key'),
  sellerAddress: z.string().regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar public key'),
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, 'Amount must be a valid decimal')
    .refine((val) => parseFloat(val) > 0, 'Amount must be greater than 0'),
  qrisSessionId: z.string().optional(),
  timeoutHours: z.number().min(2).max(168).default(48),
})

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    const parsed = ConfirmEscrowSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { signedCreateXdr, buyerAddress, sellerAddress, amountUsdc, qrisSessionId, timeoutHours } =
      parsed.data

    let contractEscrowId: bigint
    try {
      const result = await submitCreateEscrowTx(signedCreateXdr)
      contractEscrowId = result.contractEscrowId
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : 'Unknown error'
      return NextResponse.json(
        { error: 'Failed to submit create_escrow transaction', details: message },
        { status: 502 }
      )
    }

    // Upsert buyer and seller in DB
    await prisma.$transaction([
      prisma.user.upsert({
        where: { stellarAddress: buyerAddress },
        update: {},
        create: { stellarAddress: buyerAddress },
      }),
      prisma.user.upsert({
        where: { stellarAddress: sellerAddress },
        update: {},
        create: { stellarAddress: sellerAddress },
      }),
    ])

    // Look up QRIS session data if provided
    let qrisData: {
      merchantId: string | null
      merchantName: string | null
      catCode: string | null
      payloadRaw: string | null
    } = { merchantId: null, merchantName: null, catCode: null, payloadRaw: null }

    if (qrisSessionId) {
      const session = await prisma.qrisSession.findUnique({ where: { id: qrisSessionId } })
      if (session) {
        qrisData = {
          merchantId: session.merchantId,
          merchantName: session.merchantName,
          catCode: session.catCode,
          payloadRaw: session.payloadRaw,
        }
      }
    }

    const timeoutAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000)

    const escrow = await prisma.escrow.create({
      data: {
        contractEscrowId,
        contractAddress: STELLAR_CONFIG.contractAddress,
        buyerAddress,
        sellerAddress,
        amountUsdc: parseFloat(amountUsdc),
        status: 'PENDING',
        qrisMerchantId: qrisData.merchantId,
        qrisMerchantName: qrisData.merchantName,
        qrisCategoryCode: qrisData.catCode,
        qrisPayloadRaw: qrisData.payloadRaw,
        timeoutAt,
      },
    })

    if (qrisSessionId) {
      await prisma.qrisSession.update({
        where: { id: qrisSessionId },
        data: { escrowId: escrow.id },
      })
    }

    await prisma.notification.create({
      data: {
        userAddress: sellerAddress,
        type: 'ESCROW_CREATED',
        message: `New escrow created for ${amountUsdc} USDC. Awaiting buyer funding.`,
      },
    })

    const unsignedFundXdr = await buildFundEscrowTx(buyerAddress, contractEscrowId)

    return NextResponse.json({
      escrowId: escrow.id,
      contractEscrowId: contractEscrowId.toString(),
      status: 'PENDING',
      unsignedFundXdr,
    })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/confirm] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
