/**
 * scripts/fund-testnet-accounts.ts
 *
 * Pre-funds 3 testnet accounts (buyer, seller, oracle) for demo:
 *   1. Hit Friendbot for XLM on each account
 *   2. Establish USDC trustlines on buyer, seller, oracle
 *   3. Mint mock USDC from the issuer account to buyer (for escrow funding)
 *
 * The mock USDC issuer keypair must match NEXT_PUBLIC_USDC_ISSUER in .env.local.
 * If using the real testnet USDC issuer, skip step 3 and fund manually via
 * a testnet USDC faucet.
 *
 * Run from project root (requires @stellar/stellar-sdk in node_modules):
 *   npx tsx scripts/fund-testnet-accounts.ts
 *
 * Or with explicit env loading:
 *   npx dotenv -e .env.local -- tsx scripts/fund-testnet-accounts.ts
 *
 * TODO(mainnet): Replace with real USDC funding flow
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

// Mock USDC asset — must match .env.local
const USDC_CODE = process.env.NEXT_PUBLIC_USDC_ASSET_CODE ?? 'USDC'
const USDC_ISSUER = process.env.NEXT_PUBLIC_USDC_ISSUER ?? 'GBHVZPGWTQY3WDWFUB447ZO2EM7QAJIBSYSIZ7O7MPWU6BZIZDBWRSNY'

// Amount of mock USDC to mint to buyer for demo
const BUYER_USDC_AMOUNT = '500' // 500 USDC — plenty for demo escrows

// ─── Account Keypairs ───────────────────────────────────────────────────────
// These are TESTNET-ONLY accounts. Never reuse on mainnet.
// TODO(mainnet): Remove hardcoded testnet keypairs

// Generate fresh demo accounts each run, or use pre-existing ones from env
const ACCOUNTS = {
  buyer: {
    label: 'BUYER',
    keypair: process.env.DEMO_BUYER_SECRET
      ? Keypair.fromSecret(process.env.DEMO_BUYER_SECRET)
      : Keypair.random(),
  },
  seller: {
    label: 'SELLER',
    keypair: process.env.DEMO_SELLER_SECRET
      ? Keypair.fromSecret(process.env.DEMO_SELLER_SECRET)
      : Keypair.random(),
  },
  oracle: {
    label: 'ORACLE',
    keypair: process.env.ORACLE_SECRET_KEY
      ? Keypair.fromSecret(process.env.ORACLE_SECRET_KEY)
      : Keypair.random(),
  },
} as const

// Issuer keypair — only needed if we control the mock USDC issuer
const ISSUER_KEYPAIR = process.env.DEMO_USDC_ISSUER_SECRET
  ? Keypair.fromSecret(process.env.DEMO_USDC_ISSUER_SECRET)
  : null

// ─── Helpers ────────────────────────────────────────────────────────────────

const server = new Horizon.Server(HORIZON_URL)
const usdcAsset = new Asset(USDC_CODE, USDC_ISSUER)

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`)
}

function ok(label: string, value?: string) {
  console.log(`  ✅ ${label}${value ? `: ${value}` : ''}`)
}

function warn(label: string, msg: string) {
  console.log(`  ⚠️  ${label}: ${msg}`)
}

function fail(label: string, err: unknown): never {
  console.error(`  ❌ FAILED — ${label}:`, err)
  process.exit(1)
}

async function fundViaFriendbot(address: string): Promise<void> {
  const url = `${FRIENDBOT_URL}?addr=${address}`
  const res = await fetch(url)

  if (!res.ok) {
    const text = await res.text()
    // Friendbot returns 400 if account already funded — that's fine
    if (text.includes('createAccountAlreadyExist') || text.includes('already exists')) {
      warn('Friendbot', `Account ${address.slice(0, 8)}... already exists — skipping`)
      return
    }
    throw new Error(`Friendbot failed (${res.status}): ${text}`)
  }
}

async function addTrustline(keypair: Keypair): Promise<void> {
  try {
    const account = await server.loadAccount(keypair.publicKey())

    // Check if trustline already exists
    const hasTrustline = account.balances.some(
      (b) =>
        b.asset_type === 'credit_alphanum4' &&
        (b as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4'>).asset_code === USDC_CODE &&
        (b as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4'>).asset_issuer === USDC_ISSUER
    )

    if (hasTrustline) {
      ok('Trustline', `${keypair.publicKey().slice(0, 8)}... already has USDC trustline`)
      return
    }

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.changeTrust({
          asset: usdcAsset,
          limit: '1000000', // high limit for demo
        })
      )
      .setTimeout(30)
      .build()

    tx.sign(keypair)
    await server.submitTransaction(tx)
    ok('Trustline', `Added USDC trustline for ${keypair.publicKey().slice(0, 8)}...`)
  } catch (err) {
    fail('addTrustline', err)
  }
}

async function mintUsdcToAccount(
  issuerKeypair: Keypair,
  destinationAddress: string,
  amount: string
): Promise<void> {
  try {
    const issuerAccount = await server.loadAccount(issuerKeypair.publicKey())

    const tx = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: destinationAddress,
          asset: usdcAsset,
          amount,
        })
      )
      .setTimeout(30)
      .build()

    tx.sign(issuerKeypair)
    await server.submitTransaction(tx)
    ok('Mint USDC', `Sent ${amount} USDC to ${destinationAddress.slice(0, 8)}...`)
  } catch (err) {
    fail('mintUsdcToAccount', err)
  }
}

async function printBalance(address: string, label: string): Promise<void> {
  try {
    const account = await server.loadAccount(address)
    const xlm = account.balances.find((b) => b.asset_type === 'native')
    const usdc = account.balances.find(
      (b) =>
        b.asset_type === 'credit_alphanum4' &&
        (b as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4'>).asset_code === USDC_CODE
    )

    console.log(
      `  💰 ${label}: XLM=${xlm?.balance ?? '0'}, USDC=${usdc?.balance ?? '0 (no trustline)'}`
    )
  } catch {
    console.log(`  💰 ${label}: Account not found on testnet`)
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Titip Protocol — Testnet Account Funder')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  Horizon:   ${HORIZON_URL}`)
  console.log(`  USDC:      ${USDC_CODE} (issuer: ${USDC_ISSUER.slice(0, 8)}...)`)
  console.log(`  Network:   TESTNET`)

  // ── Print account addresses ────────────────────────────────────────────
  console.log('\n── Demo Accounts ──')
  for (const [role, { label, keypair }] of Object.entries(ACCOUNTS)) {
    console.log(`  ${label.padEnd(8)} Public:  ${keypair.publicKey()}`)
    console.log(`  ${' '.repeat(8)} Secret:  ${keypair.secret()}`)
  }

  // ── Step 1: Fund via Friendbot ─────────────────────────────────────────
  log('STEP 1', 'Funding accounts with XLM via Friendbot')

  for (const [role, { label, keypair }] of Object.entries(ACCOUNTS)) {
    try {
      await fundViaFriendbot(keypair.publicKey())
      ok(`Friendbot → ${label}`, keypair.publicKey().slice(0, 12) + '...')
    } catch (err) {
      fail(`Friendbot → ${label}`, err)
    }
  }

  // Also fund the issuer if we have its keypair and it's a fresh account
  if (ISSUER_KEYPAIR) {
    log('STEP 1b', 'Funding mock USDC issuer via Friendbot')
    try {
      await fundViaFriendbot(ISSUER_KEYPAIR.publicKey())
      ok('Friendbot → ISSUER', ISSUER_KEYPAIR.publicKey().slice(0, 12) + '...')
    } catch (err) {
      fail('Friendbot → ISSUER', err)
    }
  }

  // ── Step 2: Add USDC trustlines ────────────────────────────────────────
  log('STEP 2', 'Adding USDC trustlines to buyer, seller, oracle')

  for (const [role, { label, keypair }] of Object.entries(ACCOUNTS)) {
    await addTrustline(keypair)
  }

  // ── Step 3: Mint mock USDC to buyer ────────────────────────────────────
  if (ISSUER_KEYPAIR) {
    log('STEP 3', `Minting ${BUYER_USDC_AMOUNT} mock USDC to buyer`)
    await mintUsdcToAccount(
      ISSUER_KEYPAIR,
      ACCOUNTS.buyer.keypair.publicKey(),
      BUYER_USDC_AMOUNT
    )
  } else {
    log('STEP 3', 'Skipping USDC mint — no DEMO_USDC_ISSUER_SECRET in env')
    warn(
      'Manual step required',
      `Send USDC to buyer address: ${ACCOUNTS.buyer.keypair.publicKey()}`
    )
  }

  // ── Print final balances ───────────────────────────────────────────────
  log('BALANCES', 'Final account balances')

  for (const [role, { label, keypair }] of Object.entries(ACCOUNTS)) {
    await printBalance(keypair.publicKey(), label)
  }

  // ── Output env vars to add to .env.local ───────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ ALL ACCOUNTS FUNDED')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('\n── Add these to .env.local for demo persistence ──\n')
  console.log(`DEMO_BUYER_SECRET=${ACCOUNTS.buyer.keypair.secret()}`)
  console.log(`DEMO_SELLER_SECRET=${ACCOUNTS.seller.keypair.secret()}`)
  console.log(`# Oracle secret is already in .env.local as ORACLE_SECRET_KEY`)
  console.log(`\n── Stellar Expert links ──\n`)
  console.log(
    `  Buyer:  https://stellar.expert/explorer/testnet/account/${ACCOUNTS.buyer.keypair.publicKey()}`
  )
  console.log(
    `  Seller: https://stellar.expert/explorer/testnet/account/${ACCOUNTS.seller.keypair.publicKey()}`
  )
  console.log(
    `  Oracle: https://stellar.expert/explorer/testnet/account/${ACCOUNTS.oracle.keypair.publicKey()}`
  )
  console.log(
    `  Contract: https://stellar.expert/explorer/testnet/contract/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? 'NOT_SET'}`
  )
  console.log()
}

main().catch((err) => {
  console.error('\n💥 Funding script crashed:', err)
  process.exit(1)
})
