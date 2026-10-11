import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  webhookEvent: { create: vi.fn() },
}))
vi.mock('@titip/db', () => ({ prisma: prismaMock }))

import { POST } from '@/app/api/webhooks/courier/[courier]/route'
import { toStage, verifySignature } from '@/lib/webhooks/courier'

const SECRET = 'test-webhook-secret'

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function call(
  courier: string,
  payload: unknown,
  opts: { signature?: string | null; raw?: string } = {},
) {
  const raw = opts.raw ?? JSON.stringify(payload)
  const signature = opts.signature === undefined ? sign(raw) : opts.signature
  const req = new NextRequest(`http://localhost/api/webhooks/courier/${courier}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-courier-signature': signature } : {}) },
    body: raw,
  })
  return POST(req, { params: { courier } })
}

const event = (status: string, id = 'evt-1') => ({
  event_id: id,
  tracking_number: 'JP1234567890',
  status,
  occurred_at: '2026-10-11T10:00:00.000Z',
})

beforeEach(() => {
  vi.resetAllMocks()
  process.env.COURIER_WEBHOOK_SECRET_JNT = SECRET
  process.env.COURIER_WEBHOOK_SECRET_JNE = SECRET
  process.env.COURIER_WEBHOOK_SECRET_SICEPAT = SECRET
  prismaMock.webhookEvent.create.mockResolvedValue({ id: 'w1' })
})

describe('POST /api/webhooks/courier/[courier]', () => {
  it.each([
    ['PICKUP', 'PICKUP'],
    ['IN_TRANSIT', 'IN_TRANSIT'],
    ['OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY'],
    ['DELIVERED', 'DELIVERED'],
    ['RETURN_TO_SENDER', 'RETURN_TO_SENDER'],
  ])('records a %s event', async (status, stage) => {
    const res = await call('jnt', event(status))
    expect(res.status).toBe(202)
    expect(prismaMock.webhookEvent.create).toHaveBeenCalledOnce()
    const data = prismaMock.webhookEvent.create.mock.calls[0][0].data
    expect(data).toMatchObject({ courier: 'JNT', eventId: 'evt-1', stage, trackingNumber: 'JP1234567890' })
    expect(data.payloadHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a missing signature', async () => {
    const res = await call('jnt', event('DELIVERED'), { signature: null })
    expect(res.status).toBe(401)
    expect(prismaMock.webhookEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a signature made with the wrong secret', async () => {
    const raw = JSON.stringify(event('DELIVERED'))
    const res = await call('jnt', null, { raw, signature: sign(raw, 'other-secret') })
    expect(res.status).toBe(401)
    expect(prismaMock.webhookEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a body that was altered after signing', async () => {
    const signed = JSON.stringify(event('IN_TRANSIT'))
    const tampered = JSON.stringify(event('DELIVERED'))
    const res = await call('jnt', null, { raw: tampered, signature: sign(signed) })
    expect(res.status).toBe(401)
  })

  it('answers 200 duplicate on replay without creating a second row', async () => {
    prismaMock.webhookEvent.create.mockRejectedValue({ code: 'P2002' })
    const res = await call('jnt', event('DELIVERED'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
  })

  it('returns 500 for unexpected database errors', async () => {
    prismaMock.webhookEvent.create.mockRejectedValue(new Error('db down'))
    const res = await call('jnt', event('DELIVERED'))
    expect(res.status).toBe(500)
  })

  it('returns 404 for an unknown courier', async () => {
    const res = await call('gojek', event('DELIVERED'))
    expect(res.status).toBe(404)
  })

  it('returns 500 when the courier secret is not configured', async () => {
    delete process.env.COURIER_WEBHOOK_SECRET_JNE
    const res = await call('jne', event('DELIVERED'))
    expect(res.status).toBe(500)
  })

  it('returns 400 for malformed JSON and invalid payloads', async () => {
    expect((await call('jnt', null, { raw: '{not json' })).status).toBe(400)
    expect((await call('jnt', { event_id: 'x' })).status).toBe(400)
  })

  it('returns 422 for an unknown status', async () => {
    const res = await call('jnt', event('TELEPORTED'))
    expect(res.status).toBe(422)
    expect(prismaMock.webhookEvent.create).not.toHaveBeenCalled()
  })
})

describe('webhook helpers', () => {
  it('verifySignature accepts a sha256= prefix and rejects non-hex input', () => {
    const body = '{"a":1}'
    expect(verifySignature(body, `sha256=${sign(body)}`, SECRET)).toBe(true)
    expect(verifySignature(body, 'zz'.repeat(32), SECRET)).toBe(false)
    expect(verifySignature(body, 'abcd', SECRET)).toBe(false)
  })

  it('toStage normalises aliases and rejects unknown values', () => {
    expect(toStage('on delivery')).toBe('OUT_FOR_DELIVERY')
    expect(toStage('rts')).toBe('RETURN_TO_SENDER')
    expect(toStage('nope')).toBeNull()
  })
})
