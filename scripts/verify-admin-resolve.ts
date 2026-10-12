/**
 * scripts/verify-admin-resolve.ts
 *
 * Resolves a real dispute on testnet through the admin API and checks that the money moved by the exact
 * amounts. The Freighter popup is replaced by the contract admin's key (ORACLE_SECRET_KEY on this
 * deployment); everything else is the real path: SEP-10 cookie login as the admin, the unsigned
 * transaction from the server, the signature, the submit, the database record and the notifications.
 *
 *   needs: `next dev` running with the same env, DB up, DEMO_BUYER_SECRET / DEMO_SELLER_SECRET,
 *          ORACLE_SECRET_KEY (the contract admin)
 *   run:   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-admin-resolve.ts
 */

import { Horizon, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import { PrismaClient } from '@prisma/client'
import {
  buildCreateEscrowTx,
  buildDisputeEscrowTx,
  buildFundEscrowTx,
  getCurrentLedger,
  getOnChainEscrow,
  submitCreateEscrowTx,
  submitSignedTx,
} from '../apps/web/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '../apps/web/lib/stellar/config'

const BASE = process.env.WEB_URL ?? 'http://localhost:3000'
if (!process.env.DEMO_BUYER_SECRET || !process.env.DEMO_SELLER_SECRET || !process.env.ORACLE_SECRET_KEY) {
  console.error('Set DEMO_BUYER_SECRET, DEMO_SELLER_SECRET and ORACLE_SECRET_KEY in .env.local')
  process.exit(1)
}
const buyer = Keypair.fromSecret(process.env.DEMO_BUYER_SECRET)
const seller = Keypair.fromSecret(process.env.DEMO_SELLER_SECRET)
const admin = Keypair.fromSecret(process.env.ORACLE_SECRET_KEY)
const prisma = new PrismaClient()
const horizon = new Horizon.Server(STELLAR_CONFIG.horizonUrl)

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

async function login(kp: Keypair): Promise<{ cookie: string; Origin: string }> {
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
  return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0], Origin: BASE }
}

/** USDC balance in base units (7 decimals) from Horizon. */
async function usdcUnits(address: string): Promise<bigint> {
  const account = await horizon.loadAccount(address)
  const line = account.balances.find(
    (b) => b.asset_type === 'credit_alphanum4' && b.asset_code === STELLAR_CONFIG.usdc.code && b.asset_issuer === STELLAR_CONFIG.usdc.issuer
  )
  if (!line) throw new Error(`no USDC trustline for ${address.slice(0, 6)}`)
  const [whole, fraction = ''] = line.balance.split('.')
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'))
}

async function main(): Promise<void> {
  console.log('[setup] a fresh disputed escrow of 10 USDC (on-chain + DB)')
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
  console.log(`        escrow row ${escrow.id}`)

  const adminHeaders = await login(admin)
  const buyerHeaders = await login(buyer)
  const api = `${BASE}/api/admin/disputes`

  console.log('[who is the admin]')
  const meAdmin = (await (await fetch(`${BASE}/api/admin/me`, { headers: adminHeaders })).json()) as { isAdmin: boolean }
  const meBuyer = (await (await fetch(`${BASE}/api/admin/me`, { headers: buyerHeaders })).json()) as { isAdmin: boolean }
  check('the contract admin is recognised', meAdmin.isAdmin === true)
  check('the buyer is not', meBuyer.isAdmin === false)
  check('buyer cannot list disputes (403)', (await fetch(api, { headers: buyerHeaders })).status === 403)
  check('buyer cannot ask for a resolution transaction (403)', (await fetch(`${api}/${escrow.id}/resolve?buyerBps=5000`, { headers: buyerHeaders })).status === 403)
  check('anonymous cannot list disputes (401)', (await fetch(api)).status === 401)

  const list = (await (await fetch(api, { headers: adminHeaders })).json()) as { disputes: { id: string; resolvable: boolean }[] }
  check('the admin sees this dispute as resolvable', list.disputes.some((d) => d.id === escrow.id && d.resolvable))
  check('the admin can read the evidence list as arbiter', (await fetch(`${BASE}/api/escrow/${escrow.id}/evidence`, { headers: adminHeaders })).status === 200)

  console.log('[resolve 70 / 30]')
  const before = { buyer: await usdcUnits(buyer.publicKey()), seller: await usdcUnits(seller.publicKey()) }
  check('missing buyerBps is refused, not read as 0 (400)', (await fetch(`${api}/${escrow.id}/resolve`, { headers: adminHeaders })).status === 400)
  const prepared = await fetch(`${api}/${escrow.id}/resolve?buyerBps=7000`, { headers: adminHeaders })
  const preparedBody = (await prepared.json()) as { unsignedXdr?: string; buyerUsdc?: string; sellerUsdc?: string }
  check('the server prepares the transaction and previews 7.00 / 3.00', prepared.status === 200 && preparedBody.buyerUsdc === '7.00' && preparedBody.sellerUsdc === '3.00', String(prepared.status))

  const signedXdr = sign(preparedBody.unsignedXdr ?? '', admin)
  const resolved = await fetch(`${api}/${escrow.id}/resolve`, {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    // buyerBps in the body is ignored on purpose: only what was signed counts
    body: JSON.stringify({ signedXdr, buyerBps: 1 }),
  })
  const resolvedBody = (await resolved.json()) as { status?: string; resolutionBuyerBps?: number; txHash?: string }
  check('resolve 200 with the signed split, not the one in the body', resolved.status === 200 && resolvedBody.resolutionBuyerBps === 7000, `${resolved.status} ${JSON.stringify(resolvedBody)}`)

  const after = { buyer: await usdcUnits(buyer.publicKey()), seller: await usdcUnits(seller.publicKey()) }
  check('the buyer received exactly 7.0000000 USDC', after.buyer - before.buyer === 7_0000000n, String(after.buyer - before.buyer))
  check('the seller received exactly 3.0000000 USDC', after.seller - before.seller === 3_0000000n, String(after.seller - before.seller))

  const onChain = await getOnChainEscrow(contractEscrowId)
  check('on-chain status is Delivered (a split ends like a payout)', onChain.status === 'Delivered', onChain.status)
  const row = await prisma.escrow.findUnique({ where: { id: escrow.id } })
  check('database: DELIVERED with the split, the signer and the transaction', row?.status === 'DELIVERED' && row.resolutionBuyerBps === 7000 && row.resolvedBy === admin.publicKey() && row.txHashRelease === resolvedBody.txHash)
  const notes = await prisma.notification.findMany({ where: { type: 'DISPUTE_RESOLVED', userAddress: { in: [buyer.publicKey(), seller.publicKey()] } }, orderBy: { createdAt: 'desc' }, take: 2 })
  check('both parties were told their exact amounts', notes.some((n) => n.message.includes('7.00')) && notes.some((n) => n.message.includes('3.00')))

  console.log('[replay and rejections]')
  const again = await fetch(`${api}/${escrow.id}/resolve`, { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ signedXdr }) })
  check('submitting the same resolution again is refused (409), nothing is paid twice', again.status === 409, String(again.status))
  const final = { buyer: await usdcUnits(buyer.publicKey()), seller: await usdcUnits(seller.publicKey()) }
  check('balances did not move again', final.buyer === after.buyer && final.seller === after.seller)
  const detail = (await (await fetch(`${api}/${escrow.id}`, { headers: adminHeaders })).json()) as { resolvable: boolean; resolutionBuyerBps: number }
  check('the detail now shows it as resolved and not resolvable', detail.resolvable === false && detail.resolutionBuyerBps === 7000)

  const party = await fetch(`${BASE}/api/escrow/${escrow.id}`, { headers: buyerHeaders })
  const partyBody = (await party.json()) as Record<string, unknown>
  check('the buyer sees the split but not the admin address', partyBody.resolutionBuyerBps === 7000 && !('resolvedBy' in partyBody) && !JSON.stringify(partyBody).includes(admin.publicKey()))

  console.log(failures === 0 ? `\nPASS (escrow row ${escrow.id}, open /admin/disputes/${escrow.id})` : `\nFAIL: ${failures} check(s) failed`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error('\nFAIL:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
