// POST /api/qris/parse
// Parses a QRIS payload string and returns structured merchant information.
// Also stores the parse result in qris_sessions for audit trail.

import { NextRequest, NextResponse } from 'next/server'
import { parseQris } from '@/lib/qris/parser'
import { prisma } from '@titip/db'
import { z } from 'zod'

const ParseQrisSchema = z.object({
  payload: z.string().min(10, 'QRIS payload is too short'),
})

// TODO(mainnet): replace mock FX rate with live anchor rate (SEP-38 / TEMPO)
const MOCK_IDR_PER_USDC = 15_800

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    const parsed = ParseQrisSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { payload } = parsed.data
    const result = parseQris(payload)

    if (!result.isValid) {
      return NextResponse.json(
        { error: 'Invalid QRIS payload', details: result.error },
        { status: 422 }
      )
    }

    // Store the parsed session for audit trail
    const session = await prisma.qrisSession.create({
      data: {
        payloadRaw: payload,
        merchantId: result.merchantAccountInfo.merchantId,
        merchantName: result.merchantName,
        catCode: result.merchantCategoryCode,
        amount: result.transactionAmount ? parseFloat(result.transactionAmount) : null,
      },
    })

    // Mock testnet FX conversion — see MOCK_IDR_PER_USDC above.
    const transactionAmountIdr = result.transactionAmount ? parseFloat(result.transactionAmount) : null
    const usdcAmount = transactionAmountIdr !== null ? transactionAmountIdr / MOCK_IDR_PER_USDC : null

    return NextResponse.json({
      sessionId: session.id,
      ...result,
      usdcAmount,
      exchangeRateUsed: MOCK_IDR_PER_USDC,
      isMockRate: true,
    })
  } catch (error: unknown) {
    console.error('[POST /api/qris/parse] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
