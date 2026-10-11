import { describe, it, expect, afterEach, vi } from 'vitest'
import { checkMemoryRateLimit, checkRateLimit } from '@/lib/rate-limit'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('checkMemoryRateLimit', () => {
  it('allows up to the limit then blocks with a retry-after', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++) {
      expect(checkMemoryRateLimit('mem-a', 3, 60_000, t0).allowed).toBe(true)
    }
    const blocked = checkMemoryRateLimit('mem-a', 3, 60_000, t0 + 10_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBe(50)
  })

  it('starts a fresh window after the reset time', () => {
    const t0 = 2_000_000
    checkMemoryRateLimit('mem-b', 1, 1_000, t0)
    expect(checkMemoryRateLimit('mem-b', 1, 1_000, t0 + 500).allowed).toBe(false)
    expect(checkMemoryRateLimit('mem-b', 1, 1_000, t0 + 1_500).allowed).toBe(true)
  })
})

describe('checkRateLimit with Upstash', () => {
  function stubUpstash(reply: unknown, ok = true) {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io/')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok')
    const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => reply })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('allows when the shared counter is within the limit', async () => {
    const fetchMock = stubUpstash([{ result: 2 }, { result: 1 }, { result: 55 }])
    expect(await checkRateLimit('up-a', 5, 60_000)).toEqual({ allowed: true, retryAfter: 0 })
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.upstash.io/pipeline')
  })

  it('blocks over the limit and reports the remaining TTL', async () => {
    stubUpstash([{ result: 6 }, { result: 0 }, { result: 42 }])
    expect(await checkRateLimit('up-b', 5, 60_000)).toEqual({ allowed: false, retryAfter: 42 })
  })

  it('falls back to the in-memory limiter when Upstash fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubUpstash({}, false)
    expect((await checkRateLimit('up-c', 1, 60_000)).allowed).toBe(true)
    expect((await checkRateLimit('up-c', 1, 60_000)).allowed).toBe(false)
  })

  it('uses memory only when Upstash is not configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await checkRateLimit('mem-only', 1, 60_000)).allowed).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
