/**
 * scripts/mock-courier-webhook.ts
 *
 * Mock carrier: sends signed webhooks to the local web app, one per lifecycle stage, then
 * replays the last one to prove idempotency.
 *
 *   PICKUP -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED   (or --rts for RETURN_TO_SENDER)
 *
 * Needs `next dev -p 3000` running and COURIER_WEBHOOK_SECRET_<COURIER> in .env.local.
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/mock-courier-webhook.ts <TRACKING> [jnt|jne|sicepat] [--rts]
 *
 * Expected: 202 for each new event, 200 {duplicate:true} for the replay, 401 for the bad signature.
 */

import crypto from 'crypto'

const [tracking, courierArg = 'jnt'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const useRts = process.argv.includes('--rts')
const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

if (!tracking) {
  console.error('Usage: mock-courier-webhook.ts <TRACKING_NUMBER> [jnt|jne|sicepat] [--rts]')
  process.exit(1)
}

const secret = process.env[`COURIER_WEBHOOK_SECRET_${courierArg.toUpperCase()}`]
if (!secret) {
  console.error(`Set COURIER_WEBHOOK_SECRET_${courierArg.toUpperCase()} in .env.local`)
  process.exit(1)
}

const sign = (body: string, key = secret): string =>
  crypto.createHmac('sha256', key).update(body).digest('hex')

async function send(status: string, eventId: string, signature?: string): Promise<void> {
  const body = JSON.stringify({
    event_id: eventId,
    tracking_number: tracking,
    status,
    occurred_at: new Date().toISOString(),
  })
  const res = await fetch(`${BASE}/api/webhooks/courier/${courierArg}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-courier-signature': signature ?? sign(body) },
    body,
  })
  console.log(`${status.padEnd(18)} ${eventId.padEnd(24)} -> ${res.status} ${await res.text()}`)
}

const run = `${Date.now()}`
const stages = useRts
  ? ['PICKUP', 'IN_TRANSIT', 'RETURN_TO_SENDER']
  : ['PICKUP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']

for (const stage of stages) {
  await send(stage, `mock-${run}-${stage}`)
}
console.log('--- replay of the last event (expect 200 duplicate) ---')
await send(stages[stages.length - 1], `mock-${run}-${stages[stages.length - 1]}`)
console.log('--- wrong signature (expect 401) ---')
await send('DELIVERED', `mock-${run}-forged`, sign('x', 'wrong-secret'))
