import { describe, it, expect, beforeAll } from 'vitest'
import { Account, Keypair, Networks, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk'

// The server signing key, separate from every account that logs in.
const server = Keypair.random()
const user = Keypair.random()

beforeAll(() => {
  process.env.SEP10_SERVER_SECRET_KEY = server.secret()
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123'
})

const sign = (xdr: string, kp: Keypair) => {
  const tx = new Transaction(xdr, Networks.TESTNET)
  tx.sign(kp)
  return tx.toXDR()
}

describe('SEP-10 challenge', () => {
  it('logs a user in when the user signed the challenge', async () => {
    const { buildChallenge, verifyChallenge } = await import('@/lib/auth/sep10')
    const { transactionXdr } = await buildChallenge(user.publicKey())
    const result = await verifyChallenge(sign(transactionXdr, user))
    expect(result.address).toBe(user.publicKey())
  })

  it('refuses a challenge the user did not sign (only the server signature)', async () => {
    const { buildChallenge, verifyChallenge } = await import('@/lib/auth/sep10')
    const { transactionXdr } = await buildChallenge(user.publicKey())
    await expect(verifyChallenge(transactionXdr)).rejects.toThrow(/signature from the client/)
  })

  it('refuses a challenge signed by someone else', async () => {
    const { buildChallenge, verifyChallenge } = await import('@/lib/auth/sep10')
    const { transactionXdr } = await buildChallenge(user.publicKey())
    await expect(verifyChallenge(sign(transactionXdr, Keypair.random()))).rejects.toThrow(/client/)
  })

  it('never issues a challenge for the server signing key itself', async () => {
    const { buildChallenge } = await import('@/lib/auth/sep10')
    await expect(buildChallenge(server.publicKey())).rejects.toThrow(/server signing key/)
  })

  it('refuses a challenge whose client account is the server signing key, even with valid signatures', async () => {
    const { verifyChallenge } = await import('@/lib/auth/sep10')
    const now = Math.floor(Date.now() / 1000)
    const tx = new TransactionBuilder(new Account(server.publicKey(), '-1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: now - 10, maxTime: now + 300 },
    })
      .addOperation(Operation.manageData({ name: 'titip_auth', value: 'x'.repeat(48), source: server.publicKey() }))
      .build()
    tx.sign(server)
    await expect(verifyChallenge(tx.toXDR())).rejects.toThrow(/server signing key/)
  })
})

describe('SEP-10 in dev without SEP10_SERVER_SECRET_KEY (the setup of this repo)', () => {
  const oracle = Keypair.random()

  it('does not use the oracle/admin key as the server key, so that account still has to sign', async () => {
    const saved = process.env.SEP10_SERVER_SECRET_KEY
    delete process.env.SEP10_SERVER_SECRET_KEY
    process.env.ORACLE_SECRET_KEY = oracle.secret()
    try {
      const { buildChallenge, verifyChallenge } = await import('@/lib/auth/sep10')
      const { transactionXdr } = await buildChallenge(oracle.publicKey())
      await expect(verifyChallenge(transactionXdr)).rejects.toThrow(/signature from the client/)
      expect((await verifyChallenge(sign(transactionXdr, oracle))).address).toBe(oracle.publicKey())
    } finally {
      process.env.SEP10_SERVER_SECRET_KEY = saved
    }
  })

  it('keeps the same dev server key across calls, so open challenges survive', async () => {
    const saved = process.env.SEP10_SERVER_SECRET_KEY
    delete process.env.SEP10_SERVER_SECRET_KEY
    try {
      const { buildChallenge } = await import('@/lib/auth/sep10')
      const source = (xdr: string) => new Transaction(xdr, Networks.TESTNET).source
      const first = await buildChallenge(user.publicKey())
      const second = await buildChallenge(user.publicKey())
      expect(source(first.transactionXdr)).toBe(source(second.transactionXdr))
    } finally {
      process.env.SEP10_SERVER_SECRET_KEY = saved
    }
  })
})
