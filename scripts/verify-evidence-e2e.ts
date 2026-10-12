/**
 * scripts/verify-evidence-e2e.ts
 *
 * End-to-end check of the dispute evidence API against a running web app (default
 * http://localhost:3000) and the real contract on testnet. The Freighter popup is replaced by the
 * DEMO keys; everything else is the real path: SEP-10 cookie login, upload, signing, commit,
 * list and download.
 *
 *   needs: `next dev` running with the same env, DB up, DEMO_BUYER_SECRET / DEMO_SELLER_SECRET,
 *          ORACLE_INTERNAL_API_KEY (the arbiter's read access)
 *   run:   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-evidence-e2e.ts
 */

import crypto from 'crypto'
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import { PrismaClient } from '@prisma/client'
import {
  buildCreateEscrowTx,
  buildDisputeEscrowTx,
  buildFundEscrowTx,
  getCurrentLedger,
  submitCreateEscrowTx,
  submitSignedTx,
} from '../apps/web/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '../apps/web/lib/stellar/config'

const BASE = process.env.WEB_URL ?? 'http://localhost:3000'
const INTERNAL_KEY = process.env.ORACLE_INTERNAL_API_KEY
if (!process.env.DEMO_BUYER_SECRET || !process.env.DEMO_SELLER_SECRET || !INTERNAL_KEY) {
  console.error('Set DEMO_BUYER_SECRET, DEMO_SELLER_SECRET and ORACLE_INTERNAL_API_KEY in .env.local')
  process.exit(1)
}
const buyer = Keypair.fromSecret(process.env.DEMO_BUYER_SECRET)
const seller = Keypair.fromSecret(process.env.DEMO_SELLER_SECRET)
const prisma = new PrismaClient()

let failures = 0
function check(label: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? ` (${extra})` : ''}`)
  if (!ok) failures++
}

function sign(unsignedXdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, STELLAR_CONFIG.networkPassphrase)
  tx.sign(signer)
  return tx.toXDR()
}

/** SEP-10 login; returns the Cookie header for that account. */
async function login(kp: Keypair): Promise<string> {
  const ch = await fetch(`${BASE}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: kp.publicKey() }),
  })
  const { challengeXdr } = (await ch.json()) as { challengeXdr: string }
  const challenge = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET)
  challenge.sign(kp)
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: challenge.toXDR() }),
  })
  if (!res.ok) throw new Error(`login failed for ${kp.publicKey().slice(0, 6)}: ${res.status}`)
  return (res.headers.get('set-cookie') ?? '').split(';')[0]
}

// A real (tiny) PNG plus random trailing bytes, so every run commits a new hash.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const newPng = () => Buffer.concat([PNG_1X1, crypto.randomBytes(8)])
const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')

function uploadBody(bytes: Uint8Array, hash = sha256(bytes), name = 'photo.png'): FormData {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
  form.set('sha256', hash)
  return form
}

async function main(): Promise<void> {
  console.log('[setup] disputed escrow on-chain + DB row')
  const ledger = await getCurrentLedger()
  const { contractEscrowId } = await submitCreateEscrowTx(
    sign(await buildCreateEscrowTx(buyer.publicKey(), seller.publicKey(), 10_0000000n, ledger + 2000), buyer)
  )
  await submitSignedTx(sign(await buildFundEscrowTx(buyer.publicKey(), contractEscrowId), buyer))
  await submitSignedTx(sign(await buildDisputeEscrowTx(buyer.publicKey(), contractEscrowId), buyer))
  for (const address of [buyer.publicKey(), seller.publicKey()]) {
    await prisma.user.upsert({ where: { stellarAddress: address }, update: {}, create: { stellarAddress: address } })
  }
  const escrow = await prisma.escrow.create({
    data: {
      contractEscrowId,
      contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!,
      buyerAddress: buyer.publicKey(),
      sellerAddress: seller.publicKey(),
      amountUsdc: '10',
      status: 'DISPUTED',
      timeoutAt: new Date(Date.now() + 3 * 3600 * 1000),
      fundedAt: new Date(),
      shippedAt: new Date(),
    },
  })
  const api = `${BASE}/api/escrow/${escrow.id}/evidence`
  const buyerHeaders = { cookie: await login(buyer), Origin: BASE }
  const sellerHeaders = { cookie: await login(seller), Origin: BASE }
  const arbiterHeaders = { authorization: `Bearer ${INTERNAL_KEY}` }
  console.log(`        escrow row ${escrow.id}`)

  console.log('[buyer] upload -> sign -> commit')
  const photo = newPng()
  const up = await fetch(api, { method: 'POST', headers: buyerHeaders, body: uploadBody(photo) })
  const upBody = (await up.json()) as { evidenceId?: string; sha256?: string; committed?: boolean; unsignedXdr?: string }
  check('upload 200 with an unsigned XDR', up.status === 200 && !!upBody.unsignedXdr && upBody.committed === false, String(up.status))
  check('server hash equals the file hash', upBody.sha256 === sha256(photo))
  const evidenceId = upBody.evidenceId ?? ''

  const commit = await fetch(`${api}/${evidenceId}`, {
    method: 'POST',
    headers: { ...buyerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: sign(upBody.unsignedXdr ?? '', buyer) }),
  })
  const commitBody = (await commit.json()) as { committed?: boolean; txHash?: string | null }
  check('commit 200, committed with a tx hash', commit.status === 200 && commitBody.committed === true && !!commitBody.txHash, String(commit.status))

  const again = await fetch(`${api}/${evidenceId}`, {
    method: 'POST',
    headers: { ...buyerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: 'ignored' }),
  })
  check('committing again is idempotent (no second transaction)', again.status === 200 && ((await again.json()) as { txHash: string }).txHash === commitBody.txHash)

  const reup = await fetch(api, { method: 'POST', headers: buyerHeaders, body: uploadBody(photo) })
  check('re-uploading the committed file reports committed, no new XDR', ((await reup.json()) as { committed?: boolean }).committed === true)

  console.log('[list and download]')
  const sellerList = (await (await fetch(api, { headers: sellerHeaders })).json()) as {
    items: { role: string; mine: boolean; sha256: string; fileId: string | null }[]
    remaining: number
  }
  check('seller sees the buyer item, not as theirs', sellerList.items.length === 1 && sellerList.items[0].role === 'BUYER' && !sellerList.items[0].mine)
  check('item hash is the one committed', sellerList.items[0]?.sha256 === sha256(photo))
  check('seller still has all 10 slots', sellerList.remaining === 10)

  const dl = await fetch(`${api}/${evidenceId}`, { headers: sellerHeaders })
  const dlBytes = Buffer.from(await dl.arrayBuffer())
  check('seller downloads the buyer file, byte for byte', dl.status === 200 && dlBytes.equals(photo))
  check('download is served as the validated type with nosniff', dl.headers.get('content-type') === 'image/png' && dl.headers.get('x-content-type-options') === 'nosniff')

  const arbiterList = await fetch(api, { headers: arbiterHeaders })
  check('arbiter (internal key) can read the list', arbiterList.status === 200)
  const arbiterFile = await fetch(`${api}/${evidenceId}`, { headers: arbiterHeaders })
  check('arbiter can download the file', arbiterFile.status === 200)
  const arbiterUpload = await fetch(api, { method: 'POST', headers: { ...arbiterHeaders, Origin: BASE }, body: uploadBody(newPng()) })
  check('arbiter cannot upload', arbiterUpload.status === 401, String(arbiterUpload.status))
  const anonymous = await fetch(api)
  check('anonymous cannot list', anonymous.status === 401, String(anonymous.status))

  console.log('[rejections]')
  const sellerCommitsBuyers = await fetch(`${api}/${evidenceId}`, {
    method: 'POST',
    headers: { ...sellerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: 'x' }),
  })
  check('seller cannot commit the buyer upload (403)', sellerCommitsBuyers.status === 403, String(sellerCommitsBuyers.status))
  const wrongHash = await fetch(api, { method: 'POST', headers: buyerHeaders, body: uploadBody(newPng(), 'a'.repeat(64)) })
  check('hash mismatch -> 400', wrongHash.status === 400, String(wrongHash.status))
  const notImage = await fetch(api, { method: 'POST', headers: buyerHeaders, body: uploadBody(Buffer.from('<svg onload=alert(1)>')) })
  check('non-image -> 400', notImage.status === 400, String(notImage.status))
  const tooBig = await fetch(api, { method: 'POST', headers: buyerHeaders, body: uploadBody(Buffer.concat([PNG_1X1, Buffer.alloc(4 * 1024 * 1024)])) })
  check('over 4 MB -> 413', tooBig.status === 413, String(tooBig.status))

  console.log(failures === 0 ? `\nPASS (escrow row ${escrow.id}, open /escrow/${escrow.id} to look at it)` : `\nFAIL: ${failures} check(s) failed`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error('\nFAIL:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
