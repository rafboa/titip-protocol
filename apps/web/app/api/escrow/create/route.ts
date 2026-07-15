// POST /api/escrow/create
// Builds the unsigned create_escrow() transaction for the buyer to sign.
//
// create_escrow() requires buyer.require_auth(), so it cannot be submitted
// here — only simulated/built. The contract-assigned escrow ID is not known
// until the buyer's signed transaction is actually submitted, which happens
// in POST /api/escrow/confirm. No DB writes happen in this step.
//
// Flow:
// 1. Validate input (buyer, seller, amount, QRIS session)
// 2. Get current ledger to compute timeout_ledger
// 3. Build the unsigned create_escrow() transaction
// 4. Return { createTxXdr, timeoutLedger } for the client to sign, then
//    POST to /api/escrow/confirm

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { buildCreateEscrowTx, getCurrentLedger } from '@/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

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
  // Amount in USDC (human-readable, e.g. "50.00")
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, 'Amount must be a valid decimal')
    .refine((val) => parseFloat(val) > 0, 'Amount must be greater than 0'),
  // QRIS session ID from a prior /api/qris/parse call
  qrisSessionId: z.string().optional(),
  // Timeout in hours (defaults to 48h per spec)
  timeoutHours: z.number().min(2).max(168).default(48),
})

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    const parsed = CreateEscrowSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { buyerAddress, sellerAddress, amountUsdc, timeoutHours } = parsed.data

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
