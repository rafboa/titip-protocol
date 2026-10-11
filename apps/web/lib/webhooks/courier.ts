// Courier webhook helpers: HMAC verification and status normalisation.
// Pure functions only (no I/O) so they can be unit tested without mocks.

import crypto from 'crypto'
import { z } from 'zod'

export type WebhookCourier = 'JNT' | 'JNE' | 'SICEPAT'
export type WebhookStage = 'PICKUP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURN_TO_SENDER'

/** URL slug -> CourierCode enum value (only couriers with signed webhooks). */
const COURIER_SLUGS: Record<string, WebhookCourier> = {
  jnt: 'JNT',
  jne: 'JNE',
  sicepat: 'SICEPAT',
}

export function courierFromSlug(slug: string): WebhookCourier | null {
  return COURIER_SLUGS[slug.toLowerCase()] ?? null
}

export function webhookSecretFor(courier: WebhookCourier): string | undefined {
  return process.env[`COURIER_WEBHOOK_SECRET_${courier}`]
}

/**
 * Constant-time HMAC-SHA256 check of the raw request body.
 * Accepts a hex digest, optionally prefixed with "sha256=".
 */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false
  const provided = header.trim().replace(/^sha256=/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest()
  return crypto.timingSafeEqual(expected, Buffer.from(provided, 'hex'))
}

export function hashPayload(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex')
}

/**
 * Normalised webhook body. TODO(mainnet): replace with each courier's real payload once the
 * carrier agreements (J&T, JNE, SiCepat) provide their schemas; keep the normalised output.
 */
export const WebhookBodySchema = z.object({
  event_id: z.string().min(1).max(128),
  tracking_number: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  occurred_at: z.string().datetime().optional(),
})
export type WebhookBody = z.infer<typeof WebhookBodySchema>

const STAGE_ALIASES: Record<string, WebhookStage> = {
  PICKUP: 'PICKUP',
  PICKED_UP: 'PICKUP',
  IN_TRANSIT: 'IN_TRANSIT',
  ON_PROCESS: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  ON_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  RETURN_TO_SENDER: 'RETURN_TO_SENDER',
  RETURNED: 'RETURN_TO_SENDER',
  RTS: 'RETURN_TO_SENDER',
}

/** Map a courier status string to a normalised stage, or null if unknown. */
export function toStage(status: string): WebhookStage | null {
  return STAGE_ALIASES[status.trim().toUpperCase().replace(/[\s-]+/g, '_')] ?? null
}
