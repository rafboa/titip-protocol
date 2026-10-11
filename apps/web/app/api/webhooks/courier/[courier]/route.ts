// POST /api/webhooks/courier/[courier]   (jnt | jne | sicepat)
// Inbound, HMAC-signed carrier webhook. This route only authenticates, validates and records the
// event. It never touches the chain: the oracle service picks up unprocessed rows from
// webhook_events and decides what to do (confirm delivery / open a dispute).
// Replays are rejected by the unique (courier, event_id) constraint and answered with 200 so the
// carrier stops retrying.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import type { Prisma } from '@prisma/client'
import {
  WebhookBodySchema,
  courierFromSlug,
  hashPayload,
  toStage,
  verifySignature,
  webhookSecretFor,
} from '@/lib/webhooks/courier'

const MAX_BODY_BYTES = 64 * 1024

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

export async function POST(request: NextRequest, { params }: { params: { courier: string } }) {
  const courier = courierFromSlug(params.courier)
  if (!courier) return NextResponse.json({ error: 'Unknown courier' }, { status: 404 })

  const secret = webhookSecretFor(courier)
  if (!secret) {
    console.error(`[webhook] COURIER_WEBHOOK_SECRET_${courier} not set`)
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  if (!verifySignature(rawBody, request.headers.get('x-courier-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = WebhookBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const stage = toStage(parsed.data.status)
  if (!stage) {
    return NextResponse.json({ error: `Unknown status "${parsed.data.status}"` }, { status: 422 })
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        courier,
        eventId: parsed.data.event_id,
        stage,
        trackingNumber: parsed.data.tracking_number,
        payloadHash: hashPayload(rawBody),
        payload: json as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ ok: true, duplicate: true }, { status: 200 })
    console.error('[webhook] failed to record event:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, stage }, { status: 202 })
}
