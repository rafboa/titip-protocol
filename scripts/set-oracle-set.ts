/**
 * scripts/set-oracle-set.ts
 *
 * Admin tool for the contract's M-of-N oracle set.
 *
 *   Show the current set:
 *     npx dotenv-cli -e .env.local -- npx tsx scripts/set-oracle-set.ts show
 *
 *   Set it (threshold first, then 1-10 oracle public keys):
 *     npx dotenv-cli -e .env.local -- npx tsx scripts/set-oracle-set.ts set 2 G...A G...B G...C
 *
 * Needs NEXT_PUBLIC_CONTRACT_ADDRESS and ADMIN_SECRET_KEY in .env.local (falls back to
 * ORACLE_SECRET_KEY, which is the admin on contracts deployed by scripts/deploy-contract.ts).
 * TODO(mainnet): the admin must be a dedicated, hardware-backed or multisig account, not an oracle key.
 *
 * The deployed contract must be a version that has set_oracles (see docs/multi-oracle.md); older
 * deployments report that the function does not exist and must be redeployed.
 *
 * Once a set exists the contract rejects confirm_delivery; every oracle node must call
 * approve_delivery (the oracle service does this automatically).
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'

const MAX_ORACLES = 10 // keep in sync with the contract's MAX_ORACLES

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
const server = new rpc.Server(RPC_URL)

if (!CONTRACT) {
  console.error('Set NEXT_PUBLIC_CONTRACT_ADDRESS in .env.local')
  process.exit(1)
}
const contract = new Contract(CONTRACT)

/** Turns the host error for a contract that predates the M-of-N oracle into an actionable message. */
function explainSimulationError(method: string, error: string): Error {
  if (error.includes('non-existent contract function')) {
    return new Error(
      `The contract ${CONTRACT} has no ${method}: it was deployed before the M-of-N oracle existed.
` +
        'Build and redeploy it (docs/multi-oracle.md, step 0) and update NEXT_PUBLIC_CONTRACT_ADDRESS.',
    )
  }
  return new Error(`${method} failed: ${error}`)
}

async function show(): Promise<void> {
  const dummy = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0')
  const tx = new TransactionBuilder(dummy, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call('get_oracle_set'))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw explainSimulationError('get_oracle_set', sim.error)
  const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval
  const value = retval ? scValToNative(retval) : null
  if (!value) {
    console.log('No oracle set configured: the contract uses the single oracle from initialize().')
    return
  }
  const set = value as { oracles: string[]; threshold: number }
  console.log(`${set.threshold}-of-${set.oracles.length} oracle set:`)
  set.oracles.forEach((o, i) => console.log(`  ${i + 1}. ${o}`))
}

async function set(thresholdArg: string, keys: string[]): Promise<void> {
  const secret = process.env.ADMIN_SECRET_KEY ?? process.env.ORACLE_SECRET_KEY
  if (!secret) throw new Error('Set ADMIN_SECRET_KEY (or ORACLE_SECRET_KEY) in .env.local')

  const threshold = Number(thresholdArg)
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error('Threshold must be a positive integer')
  if (keys.length < 1 || keys.length > MAX_ORACLES) throw new Error(`Provide 1-${MAX_ORACLES} oracle public keys`)
  if (threshold > keys.length) throw new Error('Threshold cannot exceed the number of oracles')
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate oracle public keys')
  for (const k of keys) {
    if (!StrKey.isValidEd25519PublicKey(k)) throw new Error(`Not a valid Stellar public key: ${k}`)
  }

  const admin = Keypair.fromSecret(secret)
  const account = await server.getAccount(admin.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 100),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'set_oracles',
        xdr.ScVal.scvVec(keys.map((k) => new Address(k).toScVal())),
        nativeToScVal(threshold, { type: 'u32' }),
      ),
    )
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw explainSimulationError('set_oracles', sim.error)
  const prepared = rpc.assembleTransaction(tx, sim).build()
  prepared.sign(admin)

  const sent = await server.sendTransaction(prepared)
  if (sent.status === 'ERROR') throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`)
  let result = await server.getTransaction(sent.hash)
  for (let i = 0; i < 30 && result.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    result = await server.getTransaction(sent.hash)
  }
  if (result.status !== 'SUCCESS') throw new Error(`set_oracles did not succeed: ${result.status}`)
  console.log(`Oracle set updated (${threshold}-of-${keys.length}). tx ${sent.hash}`)
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'show') {
  await show()
} else if (command === 'set' && rest.length >= 2) {
  await set(rest[0], rest.slice(1))
} else {
  console.error('Usage: set-oracle-set.ts show | set <threshold> <G...> [<G...> ...]')
  process.exit(1)
}
