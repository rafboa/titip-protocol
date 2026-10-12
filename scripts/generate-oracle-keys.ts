/**
 * scripts/generate-oracle-keys.ts
 *
 * TESTNET helper: creates N oracle keypairs and writes each node's environment to
 * .oracle-keys/oracle-<n>.env (git-ignored). Secrets are never printed; only the public
 * keys are, so they can be passed to scripts/set-oracle-set.ts.
 *
 *   npx tsx scripts/generate-oracle-keys.ts 3          # create 3 keys
 *   npx tsx scripts/generate-oracle-keys.ts 3 --fund   # also fund them on testnet via friendbot
 *
 * The files only hold ORACLE_SECRET_KEY and ORACLE_NODE_ID. Run each oracle node with its own file
 * on top of the shared settings (DATABASE_URL, REDIS_URL, ORACLE_INTERNAL_API_KEY, ...).
 * TODO(mainnet): production operators generate and store their own keys; never reuse these.
 */

import * as fs from 'fs'
import * as path from 'path'
import { Keypair } from '@stellar/stellar-sdk'

const count = Number(process.argv[2])
const fund = process.argv.includes('--fund')

if (!Number.isInteger(count) || count < 1 || count > 10) {
  console.error('Usage: generate-oracle-keys.ts <1-10> [--fund]')
  process.exit(1)
}

const dir = path.resolve('.oracle-keys')
fs.mkdirSync(dir, { recursive: true })

const publicKeys: string[] = []
for (let i = 1; i <= count; i++) {
  const file = path.join(dir, `oracle-${i}.env`)
  if (fs.existsSync(file)) {
    console.error(`${file} already exists; refusing to overwrite a key. Delete it first if you mean to.`)
    process.exit(1)
  }
  const kp = Keypair.random()
  fs.writeFileSync(file, `ORACLE_SECRET_KEY=${kp.secret()}\nORACLE_NODE_ID=oracle-${i}\n`, { mode: 0o600 })
  publicKeys.push(kp.publicKey())

  if (fund) {
    const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`)
    console.log(`friendbot oracle-${i}: ${res.ok ? 'funded' : `failed (${res.status})`}`)
  }
}

console.log(`\nWrote ${count} key file(s) to ${dir}`)
console.log('Public keys:')
publicKeys.forEach((k, i) => console.log(`  oracle-${i + 1}: ${k}`))
console.log(
  `\nNext: npx dotenv-cli -e .env.local -- npx tsx scripts/set-oracle-set.ts set ${Math.min(2, count)} ${publicKeys.join(' ')}`,
)
