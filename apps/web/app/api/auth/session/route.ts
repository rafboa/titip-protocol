// GET /api/auth/session
// Returns the address of the signed-in user from the HttpOnly session cookie,
// so the client can restore its session without ever reading the JWT.

import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizationHeader, verifyJwt } from '@/lib/auth/sep10'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = getAuthorizationHeader(request)
  if (!authHeader) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
  try {
    const payload = await verifyJwt(authHeader)
    return NextResponse.json({ authenticated: true, address: payload.address })
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
}
