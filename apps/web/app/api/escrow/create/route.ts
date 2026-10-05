import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { buildCreateEscrowTx, getCurrentLedger } from '@/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import { verifyJwt } from '@/lib/auth/sep10'

const CreateEscrowSchema = z.object({
  buyerAddress: z
    .string()
    .min(56, 'Invalid Stellar address')
    .max(56, 'Invalid Stellar address')
    .regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar public key'),
  sellerAddress: z
    .string()
    .min(56, 'Invalid Stellar address')
    .max(56, 'Invalid Stellar address')
    .regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar public key'),
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
    const parsed = CreateEscrowSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { buyerAddress, sellerAddress, amountUsdc, timeoutHours } = parsed.data

    if (payload.address !== buyerAddress) {
      return NextResponse.json(
        { error: 'Forbidden: authenticated wallet does not match buyer address' },
        { status: 403 }
      )
    }

    if (buyerAddress === sellerAddress) {
      return NextResponse.json(
        { error: 'Buyer and seller cannot be the same address' },
        { status: 400 }
      )
    }

    // Convert human-readable USDC to base units (7 decimal places)
    // e.g. "50.00" → 500000000n
    const amountBaseUnits = BigInt(Math.round(parseFloat(amountUsdc) * 10_000_000))

    // Get current ledger and compute timeout
    const currentLedger = await getCurrentLedger()
    const timeoutLedgers = Math.max(
      timeoutHours * 60 * STELLAR_CONFIG.ledgersPerMinute,
      STELLAR_CONFIG.minimumTimeoutLedgers
    )
    const timeoutLedger = currentLedger + timeoutLedgers

    const createTxXdr = await buildCreateEscrowTx(
      buyerAddress,
      sellerAddress,
      amountBaseUnits,
      timeoutLedger
    )

    return NextResponse.json({ createTxXdr, timeoutLedger })
  } catch (error: unknown) {
    console.error('[POST /api/escrow/create] Error:', error)

    if (error instanceof Error && error.message.includes('Simulation failed')) {
      return NextResponse.json(
        { error: 'Contract simulation failed', details: error.message },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
