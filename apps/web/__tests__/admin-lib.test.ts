import { describe, it, expect } from 'vitest'
import { Account, Contract, Keypair, Networks, StrKey, TransactionBuilder, nativeToScVal } from '@stellar/stellar-sdk'
import {
  baseUnitsToDecimal,
  decimalToBaseUnits,
  isValidBuyerBps,
  resolutionStatus,
  splitAmounts,
  toPlainDecimal,
} from '@/lib/admin/split'
import { ResolveTxError, decodeResolveSplitTx } from '@/lib/admin/resolve-xdr'

describe('decimalToBaseUnits / baseUnitsToDecimal', () => {
  it('converts exactly, without floats', () => {
    expect(decimalToBaseUnits('10')).toBe(100000000n)
    expect(decimalToBaseUnits('12.5')).toBe(125000000n)
    expect(decimalToBaseUnits('0.0000001')).toBe(1n)
    expect(decimalToBaseUnits('0.1234567')).toBe(1234567n)
    expect(baseUnitsToDecimal(70000000n)).toBe('7.00')
    expect(baseUnitsToDecimal(125000000n)).toBe('12.50')
    expect(baseUnitsToDecimal(1n)).toBe('0.0000001')
    expect(baseUnitsToDecimal(decimalToBaseUnits('3.1415926'))).toBe('3.1415926')
  })

  it('refuses anything it would have to round or guess', () => {
    for (const bad of ['', 'abc', '-1', '1e-7', '1.12345678', '1,5', ' ']) {
      expect(() => decimalToBaseUnits(bad)).toThrow()
    }
  })
})

describe('toPlainDecimal', () => {
  it('leaves plain decimals alone and only rewrites the exponent form Decimal#toString can produce', () => {
    expect(toPlainDecimal('50')).toBe('50')
    expect(toPlainDecimal('10.5')).toBe('10.5')
    expect(toPlainDecimal('1e-7')).toBe('0.0000001')
    expect(decimalToBaseUnits(toPlainDecimal('1e-7'))).toBe(1n)
  })
})

describe('splitAmounts', () => {
  it('rounds the buyer down and gives the seller the remainder, so the payouts add up exactly', () => {
    expect(splitAmounts(100n, 3333)).toEqual({ buyer: 33n, seller: 67n })
    expect(splitAmounts(10_0000000n, 7000)).toEqual({ buyer: 7_0000000n, seller: 3_0000000n })
    for (const [total, bps] of [[1n, 5001], [7n, 3333], [123456789n, 9999], [10_0000001n, 1]] as const) {
      const { buyer, seller } = splitAmounts(total, bps)
      expect(buyer + seller).toBe(total)
    }
  })

  it('handles the smallest unit: 0.0000001 USDC at 5001 bps goes entirely to the seller', () => {
    expect(splitAmounts(1n, 5001)).toEqual({ buyer: 0n, seller: 1n })
  })

  it('treats the extremes as a full refund and a full payout', () => {
    expect(splitAmounts(500n, 10000)).toEqual({ buyer: 500n, seller: 0n })
    expect(splitAmounts(500n, 0)).toEqual({ buyer: 0n, seller: 500n })
  })

  it('rejects invalid basis points', () => {
    for (const bad of [-1, 10001, 5.5, Number.NaN]) {
      expect(() => splitAmounts(100n, bad)).toThrow()
    }
    expect(isValidBuyerBps(0)).toBe(true)
    expect(isValidBuyerBps(10000)).toBe(true)
    expect(isValidBuyerBps('5000')).toBe(false)
    expect(isValidBuyerBps(null)).toBe(false)
  })
})

describe('resolutionStatus', () => {
  it('is REFUNDED only when the buyer gets everything; a 70/30 split ends as DELIVERED', () => {
    expect(resolutionStatus(100n, 10000)).toBe('REFUNDED')
    expect(resolutionStatus(100n, 9999)).toBe('DELIVERED')
    expect(resolutionStatus(100n, 7000)).toBe('DELIVERED')
    expect(resolutionStatus(100n, 0)).toBe('DELIVERED')
    // the contract rounds the buyer down, so on a 1-unit escrow even 9999 bps leaves the seller the unit
    expect(resolutionStatus(1n, 9999)).toBe('DELIVERED')
  })
})

describe('decodeResolveSplitTx', () => {
  const PASSPHRASE = Networks.TESTNET
  const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 1))
  const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 2))
  const admin = Keypair.random()

  function build(
    options: { contract?: string; method?: string; args?: ReturnType<typeof nativeToScVal>[]; extraOperation?: boolean; sign?: boolean } = {}
  ): string {
    const contract = new Contract(options.contract ?? CONTRACT)
    const builder = new TransactionBuilder(new Account(admin.publicKey(), '1'), { fee: '100', networkPassphrase: PASSPHRASE })
    const args = options.args ?? [nativeToScVal(7n, { type: 'u64' }), nativeToScVal(7000, { type: 'u32' })]
    builder.addOperation(contract.call(options.method ?? 'resolve_dispute_split', ...args))
    if (options.extraOperation) builder.addOperation(contract.call('resolve_dispute_split', ...args))
    const tx = builder.setTimeout(30).build()
    if (options.sign !== false) tx.sign(admin)
    return tx.toXDR()
  }

  it('returns the escrow, the split and the signer exactly as signed', () => {
    const decoded = decodeResolveSplitTx(build(), PASSPHRASE, CONTRACT)
    expect(decoded.escrowId).toBe(7n)
    expect(decoded.buyerBps).toBe(7000)
    expect(decoded.source).toBe(admin.publicKey())
    expect(decoded.txHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives the same hash the network will use, so a retry can look the transaction up', () => {
    const xdr = build()
    const hash = TransactionBuilder.fromXDR(xdr, PASSPHRASE).hash().toString('hex')
    expect(decodeResolveSplitTx(xdr, PASSPHRASE, CONTRACT).txHash).toBe(hash)
  })

  it('rejects another function, another contract, extra operations and an unsigned transaction', () => {
    expect(() => decodeResolveSplitTx(build({ method: 'resolve_dispute' }), PASSPHRASE, CONTRACT)).toThrow(ResolveTxError)
    expect(() => decodeResolveSplitTx(build({ contract: OTHER_CONTRACT }), PASSPHRASE, CONTRACT)).toThrow(/different contract/)
    expect(() => decodeResolveSplitTx(build({ extraOperation: true }), PASSPHRASE, CONTRACT)).toThrow(/exactly one operation/)
    expect(() => decodeResolveSplitTx(build({ sign: false }), PASSPHRASE, CONTRACT)).toThrow(/not signed/)
  })

  it('rejects unexpected arguments and garbage', () => {
    expect(() => decodeResolveSplitTx(build({ args: [nativeToScVal(7n, { type: 'u64' })] }), PASSPHRASE, CONTRACT)).toThrow(/arguments/)
    expect(() =>
      decodeResolveSplitTx(build({ args: [nativeToScVal('7', { type: 'string' }), nativeToScVal(7000, { type: 'u32' })] }), PASSPHRASE, CONTRACT)
    ).toThrow(/argument types/)
    expect(() => decodeResolveSplitTx('not an xdr', PASSPHRASE, CONTRACT)).toThrow(ResolveTxError)
  })

  it('hashes with the given network passphrase, so the caller must pass the application network', () => {
    const testnet = decodeResolveSplitTx(build(), Networks.TESTNET, CONTRACT).txHash
    const pub = decodeResolveSplitTx(build(), Networks.PUBLIC, CONTRACT).txHash
    expect(testnet).not.toBe(pub)
  })
})
