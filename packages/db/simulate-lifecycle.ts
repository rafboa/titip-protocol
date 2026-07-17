/**
 * scripts/simulate-lifecycle.ts
 *
 * Integration test that drives the full escrow lifecycle against the local stack:
 *   create-escrow (DB only) → fund (DB only) → submit tracking → oracle confirm → DELIVERED
 *
 * Uses the internal API routes directly (no Freighter, no on-chain signing).
 * Requires: npm run dev (web) and .env.local populated.
 *
 * Run: npx tsx scripts/simulate-lifecycle.ts
 *       — or —
 *      npx dotenv -e apps/web/.env.local -- tsx scripts/simulate-lifecycle.ts
 */

import { PrismaClient } from '@prisma/client'

// ─── Config ──────────────────────────────────────────────────────────────────

const WEB_URL = process.env.APP_INTERNAL_API_URL ?? 'http://localhost:3001'
const ORACLE_KEY = process.env.ORACLE_INTERNAL_API_KEY ?? 'titip_oracle_dev_key'
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? 'CDXU2C4KKP7M2NCQM2SD73I7H4UMCU6STLGAF66WPDFOTNYGFENIZV6Z'

// Use test addresses (not on-chain — just for DB simulation)
const BUYER  = 'GCSIGIFQQR7UQ55EFKSLCPB2CFS7PCMULYFBWEMPXJ6V2FR6RTZDLCRZ'
const SELLER = 'GC3SSVNBKDJXYNQXFB6MQABEQOXXQXZ4ZQDG5GV5ZQFBIFHLQRB4A3GA'

const prisma = new PrismaClient()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`)
}

function ok(label: string, value: unknown) {
  console.log(`  ✅ ${label}:`, JSON.stringify(value, null, 2))
}

function fail(label: string, err: unknown): never {
  console.error(`  ❌ FAILED — ${label}:`, err)
  process.exit(1)
}

async function apiPost(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${WEB_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, ok: res.ok, json }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

/**
 * Step 1: Upsert users and create escrow record directly in DB.
 * (Skips on-chain create_escrow — contract not funded for simulation.)
 */
async function step1_createEscrow() {
  log('STEP 1', 'Creating escrow directly in DB (no on-chain tx)')

  // Ensure users exist
  await prisma.user.upsert({
    where: { stellarAddress: BUYER },
    update: {},
    create: { stellarAddress: BUYER },
  })
  await prisma.user.upsert({
    where: { stellarAddress: SELLER },
    update: {},
    create: { stellarAddress: SELLER },
  })

  // Simulate a QRIS session
  const session = await prisma.qrisSession.create({
    data: {
      payloadRaw:   'SIM-PAYLOAD-0001',
      merchantId:   'ID.SIM.MOCK',
      merchantName: 'Toko Simulasi Titip',
      catCode:      '5411',
      amount:       150000,
    },
  })

  // Create escrow in PENDING state (mirrors what /api/escrow/confirm does)
  const escrow = await prisma.escrow.create({
    data: {
      contractEscrowId: BigInt(Date.now()), // fake ID — no real contract call
      contractAddress:  CONTRACT_ADDRESS,
      buyerAddress:     BUYER,
      sellerAddress:    SELLER,
      amountUsdc:       75,
      status:           'PENDING',
      qrisMerchantId:   session.merchantId,
      qrisMerchantName: session.merchantName,
      qrisPayloadRaw:   session.payloadRaw,
      timeoutAt:        new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  })

  await prisma.qrisSession.update({
    where: { id: session.id },
    data:  { escrowId: escrow.id },
  })

  ok('Escrow created', { id: escrow.id, status: escrow.status, amountUsdc: escrow.amountUsdc })
  return escrow.id
}

/**
 * Step 2: Fund escrow (DB update — simulates buyer signing fund() tx)
 */
async function step2_fundEscrow(escrowId: string) {
  log('STEP 2', `Funding escrow ${escrowId} (DB only — simulates fund() tx)`)

  const updated = await prisma.escrow.update({
    where: { id: escrowId },
    data: {
      status:     'FUNDED',
      fundedAt:   new Date(),
      txHashFund: `sim-fund-${Date.now()}`,
    },
  })

  await prisma.notification.create({
    data: {
      userAddress: SELLER,
      type:        'ESCROW_FUNDED',
      message:     `Escrow telah didanai! Kirim paket dan masukkan nomor resi.`,
    },
  })

  ok('Escrow funded', { status: updated.status, fundedAt: updated.fundedAt })
}

/**
 * Step 3: Submit tracking via the real API route.
 * This exercises the full /api/escrow/:id/tracking path including
 * DB update + notification creation.
 */
async function step3_submitTracking(escrowId: string) {
  log('STEP 3', `Submitting tracking via POST /api/escrow/${escrowId}/tracking`)

  const res = await apiPost(`/api/escrow/${escrowId}/tracking`, {
    trackingNumber: `SIM${Date.now()}`.slice(0, 16),
    courierCode:    'JNT',
    sellerAddress:  SELLER,
  })

  if (!res.ok) fail('/api/escrow/:id/tracking', res)
  ok('Tracking submitted', res.json)

  // Verify DB state
  const escrow = await prisma.escrow.findUniqueOrThrow({ where: { id: escrowId } })
  if (escrow.status !== 'SHIPPED') fail('Expected SHIPPED', escrow.status)
  ok('DB status', escrow.status)

  return (res.json as Record<string, unknown>)['trackingNumber'] as string
}

/**
 * Step 4: Oracle confirms delivery via the real /api/oracle/confirm endpoint.
 * This is the critical integration test — same call the oracle service makes.
 */
async function step4_oracleConfirm(escrowId: string, trackingNumber: string) {
  log('STEP 4', `Oracle confirming delivery via POST /api/oracle/confirm`)

  const res = await apiPost(
    '/api/oracle/confirm',
    {
      escrowId,
      courierResponse: {
        source:         'simulate-lifecycle-script',
        trackingNumber,
        status:         'DELIVERED',
        deliveredAt:    new Date().toISOString(),
      },
    },
    { Authorization: `Bearer ${ORACLE_KEY}` }
  )

  if (!res.ok) fail('/api/oracle/confirm', res)
  ok('Oracle confirm response', res.json)

  // Verify DB state
  const escrow = await prisma.escrow.findUniqueOrThrow({ where: { id: escrowId } })
  if (escrow.status !== 'DELIVERED') fail('Expected DELIVERED', escrow.status)
  ok('DB status', escrow.status)
  ok('deliveredAt', escrow.deliveredAt?.toISOString())

  // Verify oracle event was logged
  const event = await prisma.oracleEvent.findFirst({
    where: { escrowId },
    orderBy: { confirmedAt: 'desc' },
  })
  ok('Oracle event logged', { type: event?.eventType, node: event?.oracleNodeId })

  // Verify notifications were created
  const notifications = await prisma.notification.findMany({
    where: { userAddress: { in: [BUYER, SELLER] }, escrowId: undefined },
    orderBy: { createdAt: 'desc' },
    take: 4,
  })
  ok('Notifications created', notifications.map((n) => ({ to: n.userAddress.slice(0, 8), type: n.type })))
}

/**
 * Step 5: GET /api/escrow/:id — verify the response merges DB state correctly.
 */
async function step5_verifyGetEscrow(escrowId: string) {
  log('STEP 5', `Verifying GET /api/escrow/${escrowId}`)

  const res = await fetch(`${WEB_URL}/api/escrow/${escrowId}`)
  const json = await res.json() as Record<string, unknown>

  if (!res.ok) fail('GET /api/escrow/:id', json)
  if (json['status'] !== 'DELIVERED') fail('Expected DELIVERED in GET response', json['status'])

  ok('GET /api/escrow/:id', {
    status:      json['status'],
    deliveredAt: json['deliveredAt'],
    events:      (json['oracleEvents'] as unknown[])?.length ?? 0,
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Titip Protocol — Lifecycle Integration Test')
  console.log(`  Web: ${WEB_URL}`)
  console.log('═══════════════════════════════════════════════════════════════')

  // Health check first
  const health = await fetch(`${WEB_URL}/api/health`).catch(() => null)
  if (!health?.ok) {
    console.error(`\n❌ Cannot reach ${WEB_URL}/api/health — is the dev server running?\n`)
    process.exit(1)
  }
  console.log('\n✅ Web server reachable')

  try {
    const escrowId = await step1_createEscrow()
    await step2_fundEscrow(escrowId)
    const trackingNumber = await step3_submitTracking(escrowId)
    await step4_oracleConfirm(escrowId, trackingNumber)
    await step5_verifyGetEscrow(escrowId)

    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('  ✅ ALL STEPS PASSED — Full lifecycle verified!')
    console.log(`  Escrow ID: ${escrowId}`)
    console.log(`  View at: http://localhost:3001/escrow/${escrowId}`)
    console.log('═══════════════════════════════════════════════════════════════\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('\n💥 Simulation crashed:', err)
  process.exit(1)
})
