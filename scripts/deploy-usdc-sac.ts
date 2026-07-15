/**
 * scripts/deploy-usdc-sac.ts
 *
 * Deploys the Stellar Asset Contract (SAC) for our mock USDC on testnet.
 * This makes the classic USDC asset available to Soroban contracts.
 *
 * The SAC contract ID is deterministic — it's derived from the asset code
 * and issuer. This script just ensures it's deployed on-chain.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/deploy-usdc-sac.ts
 */

import {
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Operation,
  Asset,
  Address,
  xdr,
  hash,
  StrKey,
  rpc,
} from '@stellar/stellar-sdk'

const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET
const USDC_CODE = process.env.NEXT_PUBLIC_USDC_ASSET_CODE ?? 'USDC'
const USDC_ISSUER = process.env.NEXT_PUBLIC_USDC_ISSUER
const ISSUER_SECRET = process.env.DEMO_USDC_ISSUER_SECRET

if (!USDC_ISSUER) {
  console.error('❌ NEXT_PUBLIC_USDC_ISSUER not set')
  process.exit(1)
}
if (!ISSUER_SECRET) {
  console.error('❌ DEMO_USDC_ISSUER_SECRET not set')
  process.exit(1)
}

const issuerKeypair = Keypair.fromSecret(ISSUER_SECRET)
const server = new rpc.Server(SOROBAN_RPC_URL)

function getAssetContractId(asset: Asset, networkPassphrase: string): string {
  const assetXdr = asset.toXDRObject()
  const contractIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(assetXdr),
    })
  )
  return StrKey.encodeContract(hash(contractIdPreimage.toXDR()))
}

async function main() {
  const usdcAsset = new Asset(USDC_CODE, USDC_ISSUER)
  const sacAddress = getAssetContractId(usdcAsset, NETWORK_PASSPHRASE)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Deploy USDC Stellar Asset Contract (SAC)')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  Asset:   ${USDC_CODE}:${USDC_ISSUER}`)
  console.log(`  SAC:     ${sacAddress}`)
  console.log(`  Issuer:  ${issuerKeypair.publicKey()}`)

  // Check if already deployed
  try {
    const existing = await server.getContractData(
      sacAddress,
      xdr.ScVal.scvLedgerKeyContractInstance(),
      rpc.Durability.Persistent
    )
    if (existing) {
      console.log('\n  ✅ SAC already deployed — no action needed')
      console.log(`  https://stellar.expert/explorer/testnet/contract/${sacAddress}`)
      return
    }
  } catch {
    console.log('\n  SAC not yet deployed — deploying now...')
  }

  // Deploy the SAC
  const account = await server.getAccount(issuerKeypair.publicKey())

  const deployTx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 200),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeCreateContractV2(
          new xdr.CreateContractArgsV2({
            contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(
              usdcAsset.toXDRObject()
            ),
            executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
            constructorArgs: [],
          })
        ),
        auth: [],
      })
    )
    .setTimeout(120)

  // Simulate
  const rawTx = deployTx.build()
  const simResult = await server.simulateTransaction(rawTx)
  if (rpc.Api.isSimulationError(simResult)) {
    console.error('  ❌ Simulation failed:', (simResult as rpc.Api.SimulateTransactionErrorResponse).error)
    process.exit(1)
  }

  // Assemble, sign, submit
  const assembledTx = rpc.assembleTransaction(rawTx, simResult).build()
  assembledTx.sign(issuerKeypair)

  const sendResult = await server.sendTransaction(assembledTx)
  if (sendResult.status === 'ERROR') {
    throw new Error(`Submission failed: ${JSON.stringify(sendResult.errorResult)}`)
  }

  // Wait for confirmation
  let getResult = await server.getTransaction(sendResult.hash)
  let retries = 0
  while (getResult.status === 'NOT_FOUND' && retries < 60) {
    await new Promise((r) => setTimeout(r, 1000))
    getResult = await server.getTransaction(sendResult.hash)
    retries++
  }

  if (getResult.status === 'SUCCESS') {
    console.log('\n  ✅ USDC SAC deployed successfully')
    console.log(`  Tx:  https://stellar.expert/explorer/testnet/tx/${sendResult.hash}`)
    console.log(`  SAC: https://stellar.expert/explorer/testnet/contract/${sacAddress}`)
  } else {
    console.error(`  ❌ SAC deployment failed: ${getResult.status}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n💥 SAC deployment crashed:', err)
  process.exit(1)
})
