/**
 * scripts/verify-oracle-submit.ts
 *
 * Testnet check for the oracle service's own confirm_delivery path
 * (apps/oracle/src/stellar/submit.ts), the code that replaced the web app's signing.
 *
 *   create_escrow (buyer) -> fund (buyer) -> submit_tracking (seller)
 *   -> submitConfirmDeliveryOnChain() twice (second call must be an idempotent no-op)
 *   -> read chain state with the web app's getOnChainEscrow() (must be Delivered)
 *
 * Uses the DEMO_* testnet accounts from .env.local. Spends ~10 test USDC.
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-oracle-submit.ts
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

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
const BUYER_SECRET = process.env.DEMO_BUYER_SECRET
const SELLER_SECRET = process.env.DEMO_SELLER_SECRET

if (!CONTRACT_ADDRESS || !BUYER_SECRET || !SELLER_SECRET) {
  console.error('Set NEXT_PUBLIC_CONTRACT_ADDRESS, DEMO_BUYER_SECRET, DEMO_SELLER_SECRET in .env.local')
  process.exit(1)
}

const server = new rpc.Server(RPC_URL)
const contract = new Contract(CONTRACT_ADDRESS)
const buyer = Keypair.fromSecret(BUYER_SECRET)
const seller = Keypair.fromSecret(SELLER_SECRET)

async function send(
  signer: Keypair,
  method: string,
  ...args: xdr.ScVal[]
): Promise<{ hash: string; returnValue?: xdr.ScVal }> {
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
  if (sent.status === 'ERROR') throw new Error(`${method} submission failed: ${JSON.stringify(sent.errorResult)}`)

  let res = await server.getTransaction(sent.hash)
  for (let i = 0; i < 60 && res.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    res = await server.getTransaction(sent.hash)
  }
  if (res.status !== 'SUCCESS') throw new Error(`${method} failed: ${res.status}`)
  return { hash: sent.hash, returnValue: (res as rpc.Api.GetSuccessfulTransactionResponse).returnValue }
}

async function main() {
  // Import after env is loaded: oracle config validates env at import time.
  const { submitConfirmDeliveryOnChain } = await import('../apps/oracle/src/stellar/submit.js')
  const { getOnChainEscrow } = await import('../apps/web/lib/stellar/contracts/escrow.js')

  const ledger = await server.getLatestLedger()
  console.log('[1] create_escrow')
  const created = await send(
    buyer,
    'create_escrow',
    new Address(buyer.publicKey()).toScVal(),
    new Address(seller.publicKey()).toScVal(),
    nativeToScVal(10_0000000n, { type: 'i128' }),
    nativeToScVal(ledger.sequence + 2000, { type: 'u32' })
  )
  if (!created.returnValue) throw new Error('create_escrow returned no value')
  const escrowId = BigInt(created.returnValue.u64().toString())
  console.log(`    escrow id ${escrowId}  tx ${created.hash}`)

  console.log('[2] fund')
  await send(buyer, 'fund', nativeToScVal(escrowId, { type: 'u64' }))

  console.log('[3] submit_tracking')
  await send(
    seller,
    'submit_tracking',
    nativeToScVal(escrowId, { type: 'u64' }),
    nativeToScVal('JT9999999999', { type: 'string' }),
    nativeToScVal('jnt', { type: 'string' })
  )

  console.log('[4] oracle submitConfirmDeliveryOnChain (first call)')
  const first = await submitConfirmDeliveryOnChain(CONTRACT_ADDRESS!, escrowId)
  console.log(`    txHash ${first.txHash}`)
  if (!first.txHash || !/^[0-9a-f]{64}$/i.test(first.txHash)) throw new Error('expected a 64-hex tx hash')

  console.log('[5] oracle submitConfirmDeliveryOnChain (second call, must be idempotent)')
  const second = await submitConfirmDeliveryOnChain(CONTRACT_ADDRESS!, escrowId)
  console.log(`    txHash ${second.txHash}`)
  if (second.txHash !== null) throw new Error('expected null txHash on already-Delivered escrow')

  console.log('[6] web getOnChainEscrow')
  const onChain = await getOnChainEscrow(escrowId)
  console.log(`    status ${onChain.status}`)
  if (onChain.status !== 'Delivered') throw new Error(`expected Delivered, got ${onChain.status}`)

  console.log('\nPASS: oracle signs confirm_delivery, retry is idempotent, chain reports Delivered')
}

main().catch((err) => {
  console.error('\nFAIL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
