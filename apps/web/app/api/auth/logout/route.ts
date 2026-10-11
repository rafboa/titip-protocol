// POST /api/auth/logout
// Clears the HttpOnly session cookie.

import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/sep10'

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return response
}
