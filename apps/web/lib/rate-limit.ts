// lib/rate-limit.ts
// Fixed-window rate limiter used by middleware.ts (Edge runtime, so only fetch/Map are available).
//
// If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, counters live in Upstash Redis
// and are shared by every serverless instance. Without them (local dev) it falls back to an
// in-memory Map that is per-instance only. If Upstash errors, we fail OPEN to the in-memory
// limiter so an outage never blocks every API request.

export type RateLimitResult = { allowed: boolean; retryAfter: number }

type MemoryRecord = { count: number; resetAt: number }

const memory = new Map<string, MemoryRecord>()
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanup = Date.now()

export function checkMemoryRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = now
    for (const [k, record] of memory.entries()) {
      if (now > record.resetAt) memory.delete(k)
    }
  }

  const record = memory.get(key)
  if (!record || now > record.resetAt) {
    memory.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfter: 0 }
  }
  if (record.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) }
  }
  record.count += 1
  return { allowed: true, retryAfter: 0 }
}

type PipelineItem = { result?: number; error?: string }

async function checkUpstashRateLimit(
  url: string,
  token: string,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowSec = Math.ceil(windowMs / 1000)
  const redisKey = `rl:${key}`

  // One round trip: INCR, set the expiry only when the key is new, read the remaining TTL.
  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['EXPIRE', redisKey, String(windowSec), 'NX'],
      ['TTL', redisKey],
    ]),
    signal: AbortSignal.timeout(1500),
  })
  if (!response.ok) throw new Error(`Upstash responded ${response.status}`)

  const [incr, , ttl] = (await response.json()) as PipelineItem[]
  if (typeof incr?.result !== 'number') throw new Error(incr?.error ?? 'Unexpected Upstash reply')

  if (incr.result > limit) {
    const retryAfter = typeof ttl?.result === 'number' && ttl.result > 0 ? ttl.result : windowSec
    return { allowed: false, retryAfter }
  }
  return { allowed: true, retryAfter: 0 }
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    try {
      return await checkUpstashRateLimit(url.replace(/\/$/, ''), token, key, limit, windowMs)
    } catch (err) {
      console.error('[rate-limit] Upstash unavailable, falling back to in-memory limiter:', err)
    }
  }
  return checkMemoryRateLimit(key, limit, windowMs)
}
