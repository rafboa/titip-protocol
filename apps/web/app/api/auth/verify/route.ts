// POST /api/auth/verify
// Accepts a signed SEP-10 challenge transaction XDR.
// Verifies both the server signature and the client's Freighter signature.
// On success, upserts the User record in PostgreSQL and returns a JWT.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { z } from 'zod'
import { verifyChallenge } from '@/lib/auth/sep10'

const VerifySchema = z.object({
  signedXdr: z.string().min(1, 'signedXdr is required'),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = VerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { signedXdr } = parsed.data

  try {
    // Verify both signatures and issue JWT
    const { token, address } = await verifyChallenge(signedXdr)

    // Upsert the user — creates a record on first login, no-op on subsequent logins
    await prisma.user.upsert({
      where: { stellarAddress: address },
      update: {}, // nothing to update; address is immutable
      create: { stellarAddress: address },
    })

    return NextResponse.json({ token, address })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed'

    // Return 401 for all crypto/signature validation failures
    const authErrors = [
      'Invalid transaction XDR',
      'missing a valid signature',
      'expired',
      'not yet valid',
      'Invalid challenge',
      'timebounds',
      'public key',
    ]

    if (authErrors.some((s) => message.includes(s))) {
      return NextResponse.json({ error: message }, { status: 401 })
    }

    console.error('[/api/auth/verify] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
