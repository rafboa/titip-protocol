/**
 * scripts/verify-evidence-onchain.ts
 *
 * Proves on testnet that the web app's evidence builders produce transactions the contract accepts
 * and that what `getOnChainEvidence` reads back is exactly what was committed:
 *   create_escrow -> fund -> dispute_escrow -> submit_evidence (buyer, then seller) -> get_evidence
 *
 * It uses the same builders the API routes use (apps/web/lib/stellar/contracts/escrow.ts), signed with
 * the DEMO keys instead of Freighter. What it cannot cover: the Freighter popup itself.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/verify-evidence-onchain.ts
 */

import crypto from 'crypto'
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk'
import {
  buildCreateEscrowTx,
  buildDisputeEscrowTx,
  buildFundEscrowTx,
  buildSubmitEvidenceTx,
  getCurrentLedger,
  getOnChainEscrow,
  getOnChainEvidence,
  submitCreateEscrowTx,
  submitSignedTx,
} from '../apps/web/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '../apps/web/lib/stellar/config'
import { evidenceUri } from '../apps/web/lib/evidence/file'

const BUYER_SECRET = process.env.DEMO_BUYER_SECRET
const SELLER_SECRET = process.env.DEMO_SELLER_SECRET
if (!process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || !BUYER_SECRET || !SELLER_SECRET) {
  console.error('Set NEXT_PUBLIC_CONTRACT_ADDRESS, DEMO_BUYER_SECRET, DEMO_SELLER_SECRET in .env.local')
  process.exit(1)
}

const buyer = Keypair.fromSecret(BUYER_SECRET)
const seller = Keypair.fromSecret(SELLER_SECRET)

/** Signs an unsigned XDR the way Freighter would, and returns the signed XDR. */
function sign(unsignedXdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, STELLAR_CONFIG.networkPassphrase)
  tx.sign(signer)
  return tx.toXDR()
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex')

async function main(): Promise<void> {
  console.log('[1] create_escrow, fund, dispute_escrow')
  const ledger = await getCurrentLedger()
  const { contractEscrowId } = await submitCreateEscrowTx(
    sign(await buildCreateEscrowTx(buyer.publicKey(), seller.publicKey(), 10_0000000n, ledger + 2000), buyer)
  )
  await submitSignedTx(sign(await buildFundEscrowTx(buyer.publicKey(), contractEscrowId), buyer))
  await submitSignedTx(sign(await buildDisputeEscrowTx(buyer.publicKey(), contractEscrowId), buyer))
  const escrow = await getOnChainEscrow(contractEscrowId)
  console.log(`    escrow ${contractEscrowId} is ${escrow.status}`)
  if (escrow.status !== 'Disputed') throw new Error(`expected Disputed, got ${escrow.status}`)

  console.log('[2] submit_evidence from the buyer and from the seller')
  const items = [
    { who: buyer, hash: sha256(`buyer photo ${Date.now()}`), uri: evidenceUri('buyer-file-id') },
    { who: seller, hash: sha256(`seller photo ${Date.now()}`), uri: evidenceUri('seller-file-id') },
  ]
  for (const item of items) {
    const unsigned = await buildSubmitEvidenceTx(item.who.publicKey(), contractEscrowId, item.hash, item.uri)
    await submitSignedTx(sign(unsigned, item.who))
  }

  console.log('[3] get_evidence must return exactly what was committed, oldest first')
  const onChain = await getOnChainEvidence(contractEscrowId)
  console.log(`    ${onChain.length} item(s)`)
  const problems: string[] = []
  if (onChain.length !== items.length) problems.push(`expected ${items.length} items, got ${onChain.length}`)
  items.forEach((item, i) => {
    const got = onChain[i]
    if (!got) return
    if (got.submitter !== item.who.publicKey()) problems.push(`#${i} submitter differs`)
    if (got.hash !== item.hash) problems.push(`#${i} hash differs: ${got.hash} vs ${item.hash}`)
    if (got.uri !== item.uri) problems.push(`#${i} uri differs: ${got.uri} vs ${item.uri}`)
    if (!(got.ledger > ledger)) problems.push(`#${i} ledger ${got.ledger} is not after ${ledger}`)
  })
  if (problems.length > 0) throw new Error(problems.join('; '))
  console.log('\nPASS: submit_evidence encoding accepted on-chain and read back identically')
}

main().catch((err) => {
  console.error('\nFAIL:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
