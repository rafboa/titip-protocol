/**
 * scripts/verify-cookie-login.ts
 *
 * End-to-end check of the HttpOnly cookie session against a running web app
 * (default http://localhost:3000). Signs the SEP-10 challenge with DEMO_BUYER_SECRET,
 * so no wallet extension is needed. Requires the DB (verify upserts the user).
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-cookie-login.ts
 */

import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk'

const BASE = process.env.WEB_URL ?? 'http://localhost:3000'
const SECRET = process.env.DEMO_BUYER_SECRET
if (!SECRET) {
  console.error('DEMO_BUYER_SECRET not set in .env.local')
  process.exit(1)
}
const kp = Keypair.fromSecret(SECRET)

let failures = 0
function check(label: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? ` (${extra})` : ''}`)
  if (!cond) failures++
}

async function main(): Promise<void> {
  console.log(`Target ${BASE}, account ${kp.publicKey().slice(0, 6)}...${kp.publicKey().slice(-4)}`)

  const before = await fetch(`${BASE}/api/auth/session`)
  check('no cookie -> session 401', before.status === 401, String(before.status))

  const chRes = await fetch(`${BASE}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: kp.publicKey() }),
  })
  check('challenge 200', chRes.ok, String(chRes.status))
  const { challengeXdr } = (await chRes.json()) as { challengeXdr: string }

  const tx = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET)
  tx.sign(kp)

  const vRes = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: tx.toXDR() }),
  })
  const vBody = (await vRes.json()) as Record<string, unknown>
  check('verify 200', vRes.ok, `${vRes.status} ${vRes.ok ? '' : JSON.stringify(vBody)}`)
  check('verify body has no token', !('token' in vBody))

  const setCookie = vRes.headers.get('set-cookie') ?? ''
  check('cookie is HttpOnly', /httponly/i.test(setCookie))
  check('cookie is SameSite=Strict', /samesite=strict/i.test(setCookie))
  check('cookie has Max-Age', /max-age=\d+/i.test(setCookie))
  const cookie = setCookie.split(';')[0] // titip_session=<jwt>
  check('cookie present', cookie.startsWith('titip_session=') && cookie.length > 30)

  const sess = await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })
  const sBody = (await sess.json()) as { address?: string }
  check('session 200 with cookie', sess.ok && sBody.address === kp.publicKey(), String(sess.status))

  const list = await fetch(`${BASE}/api/user/${kp.publicKey()}/escrows`, { headers: { cookie } })
  check('cookie authorises a protected GET', list.status === 200, String(list.status))

  const noOrigin = await fetch(`${BASE}/api/escrow/create`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}',
  })
  check('cookie POST without Origin -> 401 (CSRF rule)', noOrigin.status === 401, String(noOrigin.status))

  const evil = await fetch(`${BASE}/api/escrow/create`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{}',
  })
  check('cookie POST from foreign Origin -> 401', evil.status === 401, String(evil.status))

  const out = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie } })
  check('logout expires the cookie', /max-age=0/i.test(out.headers.get('set-cookie') ?? ''))

  console.log(failures === 0 ? '\nPASS' : `\nFAIL: ${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
