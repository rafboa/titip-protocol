import {
  Keypair,
  Horizon,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Operation,
  Asset,
} from '@stellar/stellar-sdk'
import 'dotenv/config'

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET
const USDC_CODE = process.env.NEXT_PUBLIC_USDC_ASSET_CODE ?? 'USDC'

const issuerSecret = process.env.DEMO_USDC_ISSUER_SECRET
if (!issuerSecret) {
  console.error('❌ DEMO_USDC_ISSUER_SECRET not set in .env.local')
  process.exit(1)
}

const issuerKeypair = Keypair.fromSecret(issuerSecret)
const usdcAsset = new Asset(USDC_CODE, issuerKeypair.publicKey())
const server = new Horizon.Server(HORIZON_URL)

async function main() {
  const targetAddress = process.argv[2]
  const amount = process.argv[3] || '500'

  if (!targetAddress) {
    console.error('Usage: npx tsx scripts/mint-to-address.ts <PUBLIC_KEY> [AMOUNT]')
    process.exit(1)
  }

  console.log(`Minting ${amount} ${USDC_CODE} to ${targetAddress}...`)

  // Check if account has trustline
  let hasTrustline = false
  try {
    const account = await server.loadAccount(targetAddress)
    hasTrustline = account.balances.some(
      (b) =>
        b.asset_type === 'credit_alphanum4' &&
        (b as any).asset_code === usdcAsset.getCode() &&
        (b as any).asset_issuer === usdcAsset.getIssuer()
    )
  } catch (e) {
    console.log(`Checking account failed (might not exist yet):`, e.message)
  }

  if (!hasTrustline) {
    console.error(`\n❌ ERROR: Account does not have a trustline for this USDC asset!`)
    console.error(`Please open Freighter, click 'Manage Assets' > 'Add Asset', and paste this Issuer ID:`)
    console.error(issuerKeypair.publicKey())
    console.error(`Then run this script again.\n`)
    process.exit(1)
  }

  const issuerAccount = await server.loadAccount(issuerKeypair.publicKey())
  const tx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: targetAddress,
        asset: usdcAsset,
        amount,
      })
    )
    .setTimeout(30)
    .build()

  tx.sign(issuerKeypair)
  await server.submitTransaction(tx)
  console.log(`✅ Successfully minted ${amount} USDC to ${targetAddress}!`)
}

main().catch(console.error)
