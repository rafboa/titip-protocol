/**
 * scripts/setup-demo-usdc.ts
 *
 * Creates a fresh mock USDC issuer on testnet, funds it via Friendbot,
 * and mints USDC to the buyer and seller demo accounts.
 *
 * This script is idempotent — if run again with existing DEMO_USDC_ISSUER_SECRET,
 * it reuses the same issuer and just mints more USDC.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-demo-usdc.ts
 *
 * After running, copy the outputted env vars into .env.local and restart dev server.
 *
 * TODO(mainnet): Replace with real USDC (Circle) — no mock issuer needed
 */

import {
  Keypair,
  Horizon,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Operation,
  Asset,
} from '@stellar/stellar-sdk'

// ─── Configuration ──────────────────────────────────────────────────────────

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org'
const FRIENDBOT_URL = 'https://friendbot.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET
const USDC_CODE = 'USDC'

// Amounts to mint
const BUYER_USDC = '500'
const SELLER_USDC = '100' // Small amount so seller can also demo receiving

// ─── Account Keys ───────────────────────────────────────────────────────────

// Reuse existing demo accounts if set, otherwise error
const BUYER_SECRET = process.env.DEMO_BUYER_SECRET
const SELLER_SECRET = process.env.DEMO_SELLER_SECRET

if (!BUYER_SECRET) {
  console.error('❌ DEMO_BUYER_SECRET not set in .env.local')
  console.error('   Run scripts/fund-testnet-accounts.ts first, then add the output to .env.local')
  process.exit(1)
}
if (!SELLER_SECRET) {
  console.error('❌ DEMO_SELLER_SECRET not set in .env.local')
  process.exit(1)
}

const buyerKeypair = Keypair.fromSecret(BUYER_SECRET)
const sellerKeypair = Keypair.fromSecret(SELLER_SECRET)

// Create or reuse USDC issuer
const issuerKeypair = process.env.DEMO_USDC_ISSUER_SECRET
  ? Keypair.fromSecret(process.env.DEMO_USDC_ISSUER_SECRET)
  : Keypair.random()

const server = new Horizon.Server(HORIZON_URL)

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`)
}

function ok(label: string, value?: string) {
  console.log(`  ✅ ${label}${value ? `: ${value}` : ''}`)
}

function warn(label: string, msg: string) {
  console.log(`  ⚠️  ${label}: ${msg}`)
}

async function fundViaFriendbot(address: string): Promise<void> {
  const url = `${FRIENDBOT_URL}?addr=${address}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    if (text.includes('createAccountAlreadyExist') || text.includes('already exists')) {
      warn('Friendbot', `Account ${address.slice(0, 8)}... already exists — skipping`)
      return
    }
    throw new Error(`Friendbot failed (${res.status}): ${text}`)
  }
  ok('Friendbot', `Funded ${address.slice(0, 8)}...`)
}

async function hasTrustline(address: string, asset: Asset): Promise<boolean> {
  try {
    const account = await server.loadAccount(address)
    return account.balances.some(
      (b) =>
        b.asset_type === 'credit_alphanum4' &&
        (b as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4'>).asset_code === asset.getCode() &&
        (b as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4'>).asset_issuer === asset.getIssuer()
    )
  } catch {
    return false
  }
}

async function addTrustline(keypair: Keypair, asset: Asset): Promise<void> {
  if (await hasTrustline(keypair.publicKey(), asset)) {
    ok('Trustline', `${keypair.publicKey().slice(0, 8)}... already has ${asset.getCode()} trustline`)
    return
  }

  const account = await server.loadAccount(keypair.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset,
        limit: '1000000',
      })
    )
    .setTimeout(30)
    .build()

  tx.sign(keypair)
  await server.submitTransaction(tx)
  ok('Trustline', `Added ${asset.getCode()} trustline for ${keypair.publicKey().slice(0, 8)}...`)
}

async function mintTo(
  issuer: Keypair,
  destination: string,
  asset: Asset,
  amount: string,
  label: string
): Promise<void> {
  const issuerAccount = await server.loadAccount(issuer.publicKey())
  const tx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset,
        amount,
      })
    )
    .setTimeout(30)
    .build()

  tx.sign(issuer)
  await server.submitTransaction(tx)
  ok('Mint', `Sent ${amount} ${asset.getCode()} → ${label} (${destination.slice(0, 8)}...)`)
}

async function getBalance(address: string, asset: Asset): Promise<string> {
  try {
    const account = await server.loadAccount(address)
    const bal = account.balances.find(
      (b) =>
        b.asset_type === 'credit_alphanum4' &&
        (b as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4'>).asset_code === asset.getCode() &&
        (b as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4'>).asset_issuer === asset.getIssuer()
    )
    return bal?.balance ?? '0'
  } catch {
    return 'N/A'
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const usdcAsset = new Asset(USDC_CODE, issuerKeypair.publicKey())

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Titip Protocol — Demo USDC Setup')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  USDC Issuer: ${issuerKeypair.publicKey()}`)
  console.log(`  Buyer:       ${buyerKeypair.publicKey()}`)
  console.log(`  Seller:      ${sellerKeypair.publicKey()}`)
  console.log(`  ${process.env.DEMO_USDC_ISSUER_SECRET ? '(reusing existing issuer)' : '(new issuer generated)'}`)

  // ── Step 1: Fund issuer via Friendbot ──────────────────────────────────
  log('STEP 1', 'Funding USDC issuer via Friendbot')
  await fundViaFriendbot(issuerKeypair.publicKey())

  // ── Step 2: Add trustlines for the NEW issuer ──────────────────────────
  // If the issuer changed, buyer/seller need new trustlines for this asset
  log('STEP 2', 'Adding USDC trustlines for new issuer')
  await addTrustline(buyerKeypair, usdcAsset)
  await addTrustline(sellerKeypair, usdcAsset)

  // ── Step 3: Mint USDC to buyer and seller ──────────────────────────────
  log('STEP 3', 'Minting USDC')
  await mintTo(issuerKeypair, buyerKeypair.publicKey(), usdcAsset, BUYER_USDC, 'BUYER')
  await mintTo(issuerKeypair, sellerKeypair.publicKey(), usdcAsset, SELLER_USDC, 'SELLER')

  // ── Step 4: Verify balances ────────────────────────────────────────────
  log('STEP 4', 'Verifying balances')
  const buyerBal = await getBalance(buyerKeypair.publicKey(), usdcAsset)
  const sellerBal = await getBalance(sellerKeypair.publicKey(), usdcAsset)
  console.log(`  💰 BUYER  USDC: ${buyerBal}`)
  console.log(`  💰 SELLER USDC: ${sellerBal}`)

  // ── Output ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ USDC SETUP COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\n── UPDATE .env.local with these values ──\n')
  console.log(`NEXT_PUBLIC_USDC_ISSUER=${issuerKeypair.publicKey()}`)
  console.log(`DEMO_USDC_ISSUER_SECRET=${issuerKeypair.secret()}`)

  console.log('\n── Stellar Expert links ──\n')
  console.log(`  Issuer: https://stellar.expert/explorer/testnet/account/${issuerKeypair.publicKey()}`)
  console.log(`  Buyer:  https://stellar.expert/explorer/testnet/account/${buyerKeypair.publicKey()}`)
  console.log(`  Seller: https://stellar.expert/explorer/testnet/account/${sellerKeypair.publicKey()}`)

  console.log('\n')
  if (!process.env.DEMO_USDC_ISSUER_SECRET) {
    console.log('  ⚠️  NEW ISSUER CREATED — you must update:')
    console.log('     1. NEXT_PUBLIC_USDC_ISSUER in .env.local')
    console.log('     2. DEMO_USDC_ISSUER_SECRET in .env.local')
    console.log('     3. Re-initialize the contract with the new token address')
    console.log('        (or use NEXT_PUBLIC_USE_MOCK_CONTRACT=true for demo)')
    console.log('')
  }
}

main().catch((err) => {
  console.error('\n💥 USDC setup crashed:', err)
  process.exit(1)
})
