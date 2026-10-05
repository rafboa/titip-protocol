import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { submitCreateEscrowTx, buildFundEscrowTx, getOnChainEscrow } from '@/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import { verifyJwt } from '@/lib/auth/sep10'

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

    if (payload.address !== buyerAddress) {
      return NextResponse.json(
        { error: 'Forbidden: authenticated wallet does not match buyer address' },
        { status: 403 }
      )
    }

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

    // Verify on-chain state to prevent DB spoofing
    const onChain = await getOnChainEscrow(contractEscrowId)
    const expectedBaseUnits = BigInt(Math.round(parseFloat(amountUsdc) * 10_000_000))

    if (
      onChain.buyer !== buyerAddress ||
      onChain.seller !== sellerAddress ||
      onChain.amount !== expectedBaseUnits
    ) {
      return NextResponse.json(
        { error: 'On-chain escrow parameters do not match request parameters' },
        { status: 400 }
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
