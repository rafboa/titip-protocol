// POST /api/auth/challenge
// Returns a signed SEP-10 challenge transaction XDR for the given Stellar account.
// The client (Freighter) must sign this transaction and POST it to /api/auth/verify.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { buildChallenge } from '@/lib/auth/sep10'

const ChallengeSchema = z.object({
  address: z.string().min(1, 'address is required'),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = ChallengeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  try {
    const { transactionXdr, expiresAt } = await buildChallenge(parsed.data.address)
    return NextResponse.json({ challengeXdr: transactionXdr, expiresAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build challenge'

    if (message.includes('Invalid Stellar public key')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    console.error('[/api/auth/challenge] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
