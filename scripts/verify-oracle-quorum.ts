/**
 * scripts/verify-oracle-quorum.ts
 *
 * Quorum behaviour of the M-of-N oracle set on testnet. Two stages so the operator can
 * start/stop oracle nodes in between (this script never touches processes):
 *
 *   start   create a Shipped escrow (chain + DB), watch for WATCH_SECONDS, then assert the
 *           escrow has NOT been released while fewer than M oracles are running, and print
 *           the on-chain approvals.
 *   check   <escrowRowId>  poll until DELIVERED (start more nodes first), then print approvals.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-oracle-quorum.ts start
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-oracle-quorum.ts check <rowId>
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
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { PrismaClient } from '@prisma/client'

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
const BUYER_SECRET = process.env.DEMO_BUYER_SECRET
const SELLER_SECRET = process.env.DEMO_SELLER_SECRET
const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const WATCH_SECONDS = Number(process.env.QUORUM_WATCH_SECONDS ?? 150)
const WAIT_SECONDS = Number(process.env.QUORUM_WAIT_SECONDS ?? 180)

if (!CONTRACT_ADDRESS || !BUYER_SECRET || !SELLER_SECRET) {
  console.error('Set NEXT_PUBLIC_CONTRACT_ADDRESS, DEMO_BUYER_SECRET, DEMO_SELLER_SECRET in .env.local')
  process.exit(1)
}

const server = new rpc.Server(RPC_URL)
const contract = new Contract(CONTRACT_ADDRESS)
const buyer = Keypair.fromSecret(BUYER_SECRET)
const seller = Keypair.fromSecret(SELLER_SECRET)
const prisma = new PrismaClient()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    await sleep(1000)
    res = await server.getTransaction(sent.hash)
  }
  if (res.status !== 'SUCCESS') throw new Error(`${method} failed: ${res.status}`)
  return { returnValue: (res as rpc.Api.GetSuccessfulTransactionResponse).returnValue }
}

/** Read-only simulate of get_delivery_approvals; returns the approving oracle addresses. */
async function readApprovals(contractEscrowId: bigint): Promise<string[]> {
  const account = await server.getAccount(buyer.publicKey())
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call('get_delivery_approvals', nativeToScVal(contractEscrowId, { type: 'u64' })))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw new Error(`get_delivery_approvals failed: ${sim.error}`)
  const value = sim.result?.retval
  return value ? (scValToNative(value) as string[]) : []
}

/** Fails when a node wrote the same transaction event more than once (the re-poll noise bug). */
async function assertNoRepeatedEvents(escrowRowId: string): Promise<void> {
  const events = await prisma.oracleEvent.findMany({
    where: { escrowId: escrowRowId, eventType: 'DELIVERY_SUBMITTED' },
    select: { oracleNodeId: true },
  })
  const perNode = new Map<string, number>()
  for (const e of events) perNode.set(e.oracleNodeId, (perNode.get(e.oracleNodeId) ?? 0) + 1)
  const repeated = [...perNode].filter(([, n]) => n > 1)
  console.log(`    DELIVERY_SUBMITTED per node: ${[...perNode].map(([k, n]) => `${k}=${n}`).join(', ') || 'none'}`)
  if (repeated.length > 0) throw new Error(`repeated DELIVERY_SUBMITTED events: ${repeated.map(([k]) => k).join(', ')}`)
}

function short(address: string): string {
  return `${address.slice(0, 5)}...${address.slice(-4)}`
}

async function start(): Promise<void> {
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
    nativeToScVal('E2E0000000002', { type: 'string' }),
    nativeToScVal('anteraja', { type: 'string' })
  )
  console.log(`    escrow ${contractEscrowId} is Shipped on-chain`)

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
      trackingNumber: 'E2E0000000002',
      courierCode: 'ANTERAJA',
      timeoutAt: new Date(Date.now() + 3 * 3600 * 1000),
      fundedAt: new Date(),
      shippedAt: new Date(),
    },
  })
  console.log(`[2] DB row ${row.id}`)

  console.log(`[3] watching ${WATCH_SECONDS}s: with fewer than M nodes the escrow must NOT be released`)
  await sleep(WATCH_SECONDS * 1000)
  const after = await prisma.escrow.findUnique({ where: { id: row.id } })
  const approvals = await readApprovals(contractEscrowId)
  console.log(`    DB status: ${after?.status}, on-chain approvals: ${approvals.length} [${approvals.map(short).join(', ')}]`)
  if (after?.status === 'DELIVERED') throw new Error('released with fewer than M approvals')
  await assertNoRepeatedEvents(row.id)
  console.log(`\nPASS (stage 1): not released. Now start more nodes, then run: check ${row.id}`)
}

async function check(rowId: string): Promise<void> {
  const row = await prisma.escrow.findUnique({ where: { id: rowId } })
  if (!row) throw new Error(`no escrow row ${rowId}`)
  console.log(`waiting up to ${WAIT_SECONDS}s for DELIVERED (row ${rowId}, escrow ${row.contractEscrowId})`)
  const deadline = Date.now() + WAIT_SECONDS * 1000
  let final = row
  while (Date.now() < deadline) {
    await sleep(3000)
    final = (await prisma.escrow.findUnique({ where: { id: rowId } })) ?? row
    if (final.status === 'DELIVERED') break
  }
  const approvals = await readApprovals(BigInt(row.contractEscrowId))
  const events = await prisma.oracleEvent.findMany({ where: { escrowId: rowId }, select: { oracleNodeId: true } })
  console.log(`    status ${final.status}, txHashRelease ${final.txHashRelease ?? 'null'}`)
  console.log(`    on-chain approvals: ${approvals.length} [${approvals.map(short).join(', ')}]`)
  console.log(`    oracle events by node: ${events.map((e) => e.oracleNodeId).join(', ') || 'none'}`)
  if (final.status !== 'DELIVERED') throw new Error('escrow did not reach DELIVERED in time')
  await assertNoRepeatedEvents(rowId)
  console.log('\nPASS (stage 2): released after quorum was reached')
}

const [mode, arg] = process.argv.slice(2)
const run = mode === 'start' ? start() : mode === 'check' && arg ? check(arg) : Promise.reject(new Error('usage: start | check <rowId>'))
run
  .catch((err) => {
    console.error('\nFAIL:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
