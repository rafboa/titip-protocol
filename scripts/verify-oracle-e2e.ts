/**
 * scripts/verify-oracle-e2e.ts
 *
 * End-to-end check of the real oracle pipeline on testnet:
 *   chain: create_escrow -> fund -> submit_tracking   (escrow is Shipped on-chain)
 *   DB:    insert a SHIPPED escrow row (courier ANTERAJA -> oracle uses its mock adapter)
 *   then wait for the running oracle service (poller -> BullMQ worker -> confirm_delivery
 *   signed by the oracle -> POST /api/oracle/confirm -> web re-reads the chain -> DB sync)
 *   and assert the row became DELIVERED with a release tx hash.
 *
 * Start first (separate terminals): docker redis+db, `next dev -p 3000` in apps/web,
 * and the oracle service with APP_INTERNAL_API_URL pointing at it.
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-oracle-e2e.ts
 */

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { PrismaClient } from '@prisma/client'

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
const BUYER_SECRET = process.env.DEMO_BUYER_SECRET
const SELLER_SECRET = process.env.DEMO_SELLER_SECRET
const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const WAIT_SECONDS = Number(process.env.E2E_WAIT_SECONDS ?? 150)

if (!CONTRACT_ADDRESS || !BUYER_SECRET || !SELLER_SECRET) {
  console.error('Set NEXT_PUBLIC_CONTRACT_ADDRESS, DEMO_BUYER_SECRET, DEMO_SELLER_SECRET in .env.local')
  process.exit(1)
}

const server = new rpc.Server(RPC_URL)
const contract = new Contract(CONTRACT_ADDRESS)
const buyer = Keypair.fromSecret(BUYER_SECRET)
const seller = Keypair.fromSecret(SELLER_SECRET)
const prisma = new PrismaClient()

async function send(signer: Keypair, method: string, ...args: xdr.ScVal[]) {
  const account = await server.getAccount(signer.publicKey())
  const raw = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 200),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(120)
    .build()
  const sim = await server.simulateTransaction(raw)
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method} simulation failed: ${sim.error}`)
  const prepared = rpc.assembleTransaction(raw, sim).build()
  prepared.sign(signer)
  const sent = await server.sendTransaction(prepared)
  if (sent.status === 'ERROR') throw new Error(`${method} submission failed`)
  let res = await server.getTransaction(sent.hash)
  for (let i = 0; i < 60 && res.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    res = await server.getTransaction(sent.hash)
  }
  if (res.status !== 'SUCCESS') throw new Error(`${method} failed: ${res.status}`)
  return { hash: sent.hash, returnValue: (res as rpc.Api.GetSuccessfulTransactionResponse).returnValue }
}

async function main(): Promise<void> {
  const ledger = await server.getLatestLedger()
  console.log('[1] on-chain: create_escrow, fund, submit_tracking')
  const created = await send(
    buyer,
    'create_escrow',
    new Address(buyer.publicKey()).toScVal(),
    new Address(seller.publicKey()).toScVal(),
    nativeToScVal(10_0000000n, { type: 'i128' }),
    nativeToScVal(ledger.sequence + 2000, { type: 'u32' })
  )
  if (!created.returnValue) throw new Error('create_escrow returned no value')
  const contractEscrowId = BigInt(created.returnValue.u64().toString())
  await send(buyer, 'fund', nativeToScVal(contractEscrowId, { type: 'u64' }))
  await send(
    seller,
    'submit_tracking',
    nativeToScVal(contractEscrowId, { type: 'u64' }),
    nativeToScVal('E2E0000000001', { type: 'string' }),
    nativeToScVal('anteraja', { type: 'string' })
  )
  console.log(`    escrow ${contractEscrowId} is Shipped on-chain`)

  console.log('[2] DB: insert SHIPPED escrow row')
  for (const address of [buyer.publicKey(), seller.publicKey()]) {
    await prisma.user.upsert({ where: { stellarAddress: address }, update: {}, create: { stellarAddress: address } })
  }
  const row = await prisma.escrow.create({
    data: {
      contractEscrowId,
      contractAddress: CONTRACT_ADDRESS!,
      buyerAddress: buyer.publicKey(),
      sellerAddress: seller.publicKey(),
      amountUsdc: '10',
      status: 'SHIPPED',
      trackingNumber: 'E2E0000000001',
      courierCode: 'ANTERAJA',
      timeoutAt: new Date(Date.now() + 3 * 3600 * 1000),
      fundedAt: new Date(),
      shippedAt: new Date(),
    },
  })
  console.log(`    row ${row.id}`)

  console.log(`[3] waiting up to ${WAIT_SECONDS}s for the oracle to deliver it`)
  const deadline = Date.now() + WAIT_SECONDS * 1000
  let final = row
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    final = (await prisma.escrow.findUnique({ where: { id: row.id } })) ?? row
    if (final.status === 'DELIVERED') break
  }

  const events = await prisma.oracleEvent.findMany({ where: { escrowId: row.id }, select: { eventType: true } })
  console.log(`    status ${final.status}, txHashRelease ${final.txHashRelease ?? 'null'}`)
  console.log(`    oracle events: ${events.map((e) => e.eventType).join(', ') || 'none'}`)

  const hex = /^[0-9a-f]{64}$/i
  if (final.status !== 'DELIVERED') throw new Error('escrow did not reach DELIVERED in time')
  if (!final.txHashRelease || !hex.test(final.txHashRelease)) throw new Error('missing/invalid txHashRelease')
  console.log('\nPASS: oracle worker -> on-chain confirm_delivery -> web verified chain -> DB DELIVERED')
}

main()
  .catch((err) => {
    console.error('\nFAIL:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
