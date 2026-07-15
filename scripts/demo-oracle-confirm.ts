/**
 * scripts/demo-oracle-confirm.ts
 *
 * Helper script for the live demo — calls the oracle confirm endpoint
 * with a single escrow ID argument. Simpler than running curl on stage.
 *
 * Usage:
 *   npx tsx scripts/demo-oracle-confirm.ts <ESCROW_ID>
 *
 * Requires: pnpm dev running + .env.local populated
 */

const escrowId = process.argv[2]

if (!escrowId) {
  console.error('Usage: npx tsx scripts/demo-oracle-confirm.ts <ESCROW_ID>')
  process.exit(1)
}

const WEB_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const ORACLE_KEY = process.env.ORACLE_INTERNAL_API_KEY ?? 'titip_oracle_dev_key'

async function confirmDelivery() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Titip Protocol — Demo Oracle Confirmation')
  console.log(`  Escrow ID: ${escrowId}`)
  console.log(`  Target:    ${WEB_URL}`)
  console.log('═══════════════════════════════════════════════════════════════')

  const body = {
    escrowId,
    courierResponse: {
      source: 'demo-manual-confirm',
      trackingNumber: 'JT1234567890',
      status: 'DELIVERED',
      deliveredAt: new Date().toISOString(),
    },
  }

  console.log('\n📤 Sending oracle confirmation...\n')
  console.log(JSON.stringify(body, null, 2))

  const res = await fetch(`${WEB_URL}/api/oracle/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ORACLE_KEY}`,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }

  if (res.ok) {
    console.log('\n✅ Oracle confirmation successful!')
    console.log(JSON.stringify(json, null, 2))
    console.log('\n→ Refresh the escrow page to see DELIVERED status')
  } else {
    console.error(`\n❌ Failed (${res.status}):`)
    console.error(JSON.stringify(json, null, 2))
    process.exit(1)
  }
}

confirmDelivery().catch((err) => {
  console.error('\n💥 Script crashed:', err)
  process.exit(1)
})
