import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

const SECRET = 'test-secret-test-secret-test-secret-123'
const ISSUER = 'titip-test'
const ADDRESS = 'GCSIGIFQQR7UQ55EFKSLCPB2CFS7PCMULYFBWEMPXJ6V2FR6RTZDLCRZ'

async function makeToken(secret = SECRET): Promise<string> {
  return new SignJWT({ address: ADDRESS })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ADDRESS)
    .setIssuer(ISSUER)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret))
}

beforeAll(() => {
  process.env.JWT_SECRET = SECRET
  process.env.SEP10_WEB_AUTH_DOMAIN = ISSUER
})

describe('getAuthorizationHeader', () => {
  it('prefers an explicit Authorization header', async () => {
    const { getAuthorizationHeader } = await import('@/lib/auth/sep10')
    const req = new Request('http://localhost/api/x', { headers: { authorization: 'Bearer abc' } })
    expect(getAuthorizationHeader(req)).toBe('Bearer abc')
  })

  it('falls back to the session cookie for GET', async () => {
    const { getAuthorizationHeader } = await import('@/lib/auth/sep10')
    const req = new Request('http://localhost/api/x', { headers: { cookie: 'a=1; titip_session=tok123' } })
    expect(getAuthorizationHeader(req)).toBe('Bearer tok123')
  })

  it('returns null with no credentials', async () => {
    const { getAuthorizationHeader } = await import('@/lib/auth/sep10')
    expect(getAuthorizationHeader(new Request('http://localhost/api/x'))).toBeNull()
  })

  it('rejects cookie auth on POST without a same-origin Origin header', async () => {
    const { getAuthorizationHeader } = await import('@/lib/auth/sep10')
    const noOrigin = new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { cookie: 'titip_session=tok', host: 'localhost' },
    })
    const crossOrigin = new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { cookie: 'titip_session=tok', host: 'localhost', origin: 'https://evil.example' },
    })
    expect(getAuthorizationHeader(noOrigin)).toBeNull()
    expect(getAuthorizationHeader(crossOrigin)).toBeNull()
  })

  it('accepts cookie auth on POST from the same origin', async () => {
    const { getAuthorizationHeader } = await import('@/lib/auth/sep10')
    const req = new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { cookie: 'titip_session=tok', host: 'localhost', origin: 'http://localhost' },
    })
    expect(getAuthorizationHeader(req)).toBe('Bearer tok')
  })
})

describe('GET /api/auth/session', () => {
  it('returns 401 without a cookie', async () => {
    const { GET } = await import('@/app/api/auth/session/route')
    const res = await GET(new NextRequest('http://localhost/api/auth/session'))
    expect(res.status).toBe(401)
  })

  it('returns the address for a valid cookie', async () => {
    const { GET } = await import('@/app/api/auth/session/route')
    const token = await makeToken()
    const res = await GET(
      new NextRequest('http://localhost/api/auth/session', { headers: { cookie: `titip_session=${token}` } })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authenticated: true, address: ADDRESS })
  })

  it('returns 401 for a token signed with another secret', async () => {
    const { GET } = await import('@/app/api/auth/session/route')
    const token = await makeToken('another-secret-another-secret-another-1')
    const res = await GET(
      new NextRequest('http://localhost/api/auth/session', { headers: { cookie: `titip_session=${token}` } })
    )
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('expires the session cookie as HttpOnly', async () => {
    const { POST } = await import('@/app/api/auth/logout/route')
    const res = await POST()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('titip_session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=strict')
    expect(setCookie).toMatch(/max-age=0/i)
  })
})
