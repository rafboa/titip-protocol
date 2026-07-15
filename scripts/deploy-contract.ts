/**
 * scripts/deploy-contract.ts
 *
 * Deploys the Titip Escrow Soroban contract to testnet and initializes it
 * with admin, oracle, and USDC token addresses.
 *
 * Steps:
 *   1. Read the compiled WASM from packages/contracts/target/...
 *   2. Upload (install) the WASM code to the network
 *   3. Deploy a new contract instance from the installed code
 *   4. Initialize the contract with admin, oracle, and USDC SAC address
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/deploy-contract.ts
 *
 * Requires: ORACLE_SECRET_KEY in .env.local (used as both deployer and oracle)
 *           NEXT_PUBLIC_USDC_ISSUER in .env.local
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Operation,
  Asset,
  Address,
  Contract,
  xdr,
  hash,
  StrKey,
  Transaction,
  rpc,
} from '@stellar/stellar-sdk'

// ─── Configuration ──────────────────────────────────────────────────────────

const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET

const USDC_CODE = process.env.NEXT_PUBLIC_USDC_ASSET_CODE ?? 'USDC'
const USDC_ISSUER = process.env.NEXT_PUBLIC_USDC_ISSUER

const ORACLE_SECRET = process.env.ORACLE_SECRET_KEY

if (!ORACLE_SECRET) {
  console.error('❌ ORACLE_SECRET_KEY not set in .env.local')
  process.exit(1)
}
if (!USDC_ISSUER) {
  console.error('❌ NEXT_PUBLIC_USDC_ISSUER not set in .env.local')
  process.exit(1)
}

const deployerKeypair = Keypair.fromSecret(ORACLE_SECRET)
const server = new rpc.Server(SOROBAN_RPC_URL)

// WASM path
const WASM_PATH = path.resolve(
  import.meta.dirname ?? '.',
  '..',
  'packages',
  'contracts',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'titip_escrow.wasm'
)

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`)
}

function ok(label: string, value?: string) {
  console.log(`  ✅ ${label}${value ? `: ${value}` : ''}`)
}

/**
 * Derive the SAC (Stellar Asset Contract) contract ID for a classic asset.
 */
function getAssetContractId(asset: Asset, networkPassphrase: string): string {
  const assetXdr = asset.toXDRObject()
  const contractIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(assetXdr),
    })
  )
  const contractHash = hash(contractIdPreimage.toXDR())
  return StrKey.encodeContract(contractHash)
}

/**
 * Simulate, assemble, sign, submit, and wait for a Soroban transaction.
 */
async function simulateSignSubmit(
  txBuilder: TransactionBuilder,
  signerKeypair: Keypair
): Promise<rpc.Api.GetSuccessfulTransactionResponse & { hash: string }> {
  // 1. Build the raw transaction
  const rawTx = txBuilder.build()

  // 2. Simulate it
  const simResult = await server.simulateTransaction(rawTx)
  if (rpc.Api.isSimulationError(simResult)) {
    const errMsg = (simResult as rpc.Api.SimulateTransactionErrorResponse).error
    throw new Error(`Simulation failed: ${errMsg}`)
  }

  // 3. Assemble (adds resource info, auth, footprint)
  const assembledTx = rpc.assembleTransaction(rawTx, simResult).build()
  
  // 4. Sign
  assembledTx.sign(signerKeypair)

  // 5. Submit
  const sendResult = await server.sendTransaction(assembledTx)
  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction submission failed: ${JSON.stringify(sendResult.errorResult)}`)
  }

  // 6. Poll for confirmation
  let getResult = await server.getTransaction(sendResult.hash)
  let retries = 0
  const maxRetries = 60

  while (getResult.status === 'NOT_FOUND' && retries < maxRetries) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    getResult = await server.getTransaction(sendResult.hash)
    retries++
    if (retries % 10 === 0) console.log(`  ⏳ Waiting for confirmation... (${retries}s)`)
  }

  if (getResult.status === 'SUCCESS') {
    return { ...getResult, hash: sendResult.hash }
  }

  throw new Error(`Transaction failed with status: ${getResult.status}`)
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Titip Protocol — Contract Deployment')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  Deployer:  ${deployerKeypair.publicKey()}`)
  console.log(`  USDC:      ${USDC_CODE}:${USDC_ISSUER}`)
  console.log(`  RPC:       ${SOROBAN_RPC_URL}`)

  // ── Step 1: Read WASM ──────────────────────────────────────────────────
  log('STEP 1', 'Reading compiled WASM')

  if (!fs.existsSync(WASM_PATH)) {
    console.error(`  ❌ WASM not found at: ${WASM_PATH}`)
    console.error('  Run: cd packages/contracts && cargo build --target wasm32-unknown-unknown --release')
    process.exit(1)
  }

  const wasmBytes = fs.readFileSync(WASM_PATH)
  console.log(`  📦 WASM size: ${wasmBytes.length} bytes (${(wasmBytes.length / 1024).toFixed(1)} KB)`)

  // ── Step 2: Upload (install) the WASM ──────────────────────────────────
  log('STEP 2', 'Uploading WASM to testnet')

  const account = await server.getAccount(deployerKeypair.publicKey())

  const uploadTx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 200),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBytes),
        auth: [],
      })
    )
    .setTimeout(120)

  const uploadResult = await simulateSignSubmit(uploadTx, deployerKeypair)
  
  if (!uploadResult.returnValue) {
    throw new Error('Upload succeeded but returned no WASM hash')
  }
  const wasmHash = uploadResult.returnValue.bytes()
  ok('WASM uploaded', `hash = ${Buffer.from(wasmHash).toString('hex').slice(0, 16)}...`)
  console.log(`  Tx: https://stellar.expert/explorer/testnet/tx/${uploadResult.hash}`)

  // ── Step 3: Deploy contract instance ───────────────────────────────────
  log('STEP 3', 'Deploying contract instance')

  const account2 = await server.getAccount(deployerKeypair.publicKey())
  
  // Deterministic salt from current timestamp
  const salt = Buffer.alloc(32)
  const timestamp = BigInt(Date.now())
  salt.writeBigUInt64BE(timestamp, 24)

  const deployTx = new TransactionBuilder(account2, {
    fee: String(Number(BASE_FEE) * 200),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeCreateContractV2(
          new xdr.CreateContractArgsV2({
            contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
              new xdr.ContractIdPreimageFromAddress({
                address: new Address(deployerKeypair.publicKey()).toScAddress(),
                salt,
              })
            ),
            executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
            constructorArgs: [],
          })
        ),
        auth: [],
      })
    )
    .setTimeout(120)

  const deployResult = await simulateSignSubmit(deployTx, deployerKeypair)

  if (!deployResult.returnValue) {
    throw new Error('Deploy succeeded but returned no contract address')
  }
  
  const contractAddress = Address.fromScVal(deployResult.returnValue).toString()
  ok('Contract deployed', contractAddress)
  console.log(`  Tx:   https://stellar.expert/explorer/testnet/tx/${deployResult.hash}`)
  console.log(`  Link: https://stellar.expert/explorer/testnet/contract/${contractAddress}`)

  // ── Step 4: Initialize the contract ────────────────────────────────────
  log('STEP 4', 'Initializing contract')

  // Derive the SAC contract ID for our mock USDC
  const usdcAsset = new Asset(USDC_CODE, USDC_ISSUER)
  const usdcSacAddress = getAssetContractId(usdcAsset, NETWORK_PASSPHRASE)
  console.log(`  USDC SAC: ${usdcSacAddress}`)

  const adminAddress = deployerKeypair.publicKey()
  const oracleAddress = deployerKeypair.publicKey()

  const account3 = await server.getAccount(deployerKeypair.publicKey())
  const contract = new Contract(contractAddress)

  const initTx = new TransactionBuilder(account3, {
    fee: String(Number(BASE_FEE) * 200),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'initialize',
        new Address(adminAddress).toScVal(),
        new Address(oracleAddress).toScVal(),
        new Address(usdcSacAddress).toScVal()
      )
    )
    .setTimeout(60)

  const initResult = await simulateSignSubmit(initTx, deployerKeypair)

  ok('Contract initialized')
  console.log(`  Admin:   ${adminAddress}`)
  console.log(`  Oracle:  ${oracleAddress}`)
  console.log(`  Token:   ${usdcSacAddress}`)
  console.log(`  Tx:      https://stellar.expert/explorer/testnet/tx/${initResult.hash}`)

  // ── Output ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ CONTRACT DEPLOYED AND INITIALIZED')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\n── UPDATE .env.local with this value ──\n')
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${contractAddress}`)

  console.log('\n── Stellar Expert links ──\n')
  console.log(`  Contract: https://stellar.expert/explorer/testnet/contract/${contractAddress}`)
  console.log(`  USDC SAC: https://stellar.expert/explorer/testnet/contract/${usdcSacAddress}`)
  console.log()
}

main().catch((err) => {
  console.error('\n💥 Deployment crashed:', err)
  process.exit(1)
})
