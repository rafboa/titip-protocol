// Exact arithmetic for dispute resolutions. Mirrors `resolve_dispute_split` in the contract
// (packages/contracts/src/lib.rs): the buyer's share is rounded DOWN and the seller receives the
// remainder, so the two payouts always add up to the locked amount. No floats anywhere: amounts are
// USDC base units (7 decimals) held as bigint.

export const BPS_DENOMINATOR = 10_000
const USDC_DECIMALS = 7

/** True for an integer number of basis points between 0 and 10 000. */
export function isValidBuyerBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= BPS_DENOMINATOR
}

/**
 * "12.5" -> 125000000n. Accepts plain decimals with at most 7 fraction digits (use Prisma's
 * `Decimal#toFixed(7)` to get one); anything else throws instead of rounding silently.
 */
export function decimalToBaseUnits(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim())
  if (!match) throw new Error(`Not a USDC amount with at most ${USDC_DECIMALS} decimals: "${amount}"`)
  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] ?? '').padEnd(USDC_DECIMALS, '0'))
  return whole * 10n ** BigInt(USDC_DECIMALS) + fraction
}

/**
 * A plain decimal string for `decimalToBaseUnits`. Prisma's `Decimal#toString()` switches to exponent
 * form for values below 1e-6 ("1e-7"); only that rare form goes through a float.
 */
export function toPlainDecimal(amount: string): string {
  return /^\d+(\.\d+)?$/.test(amount.trim()) ? amount.trim() : Number(amount).toFixed(7)
}

/** 70000000n -> "7.00". Trailing zeros beyond two decimals are dropped. */
export function baseUnitsToDecimal(units: bigint): string {
  const scale = 10n ** BigInt(USDC_DECIMALS)
  const whole = units / scale
  const fraction = (units % scale).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${fraction}`
}

/** Who gets what: the buyer's share rounded down, the seller the remainder (same as the contract). */
export function splitAmounts(total: bigint, buyerBps: number): { buyer: bigint; seller: bigint } {
  if (!isValidBuyerBps(buyerBps)) throw new Error('buyerBps must be an integer between 0 and 10000')
  const buyer = (total * BigInt(buyerBps)) / BigInt(BPS_DENOMINATOR)
  return { buyer, seller: total - buyer }
}

/**
 * The status the contract leaves the escrow in: REFUNDED only when the buyer gets everything, DELIVERED
 * otherwise (even for a 70/30 split), which is why the split is stored next to the status.
 */
export function resolutionStatus(total: bigint, buyerBps: number): 'REFUNDED' | 'DELIVERED' {
  return splitAmounts(total, buyerBps).seller === 0n ? 'REFUNDED' : 'DELIVERED'
}

/**
 * What each party is told. Spelled out per amount: a split also ends as DELIVERED, so the status alone
 * would tell a buyer who got 70% back that the seller received everything.
 */
export function resolutionMessages(total: bigint, buyerBps: number): { buyer: string; seller: string } {
  const { buyer, seller } = splitAmounts(total, buyerBps)
  const buyerUsdc = baseUnitsToDecimal(buyer)
  const sellerUsdc = baseUnitsToDecimal(seller)
  if (seller === 0n) {
    return {
      buyer: `Dispute resolved in your favor: ${buyerUsdc} USDC was refunded to you.`,
      seller: `Dispute resolved in the buyer's favor: the ${buyerUsdc} USDC was refunded to the buyer.`,
    }
  }
  if (buyer === 0n) {
    return {
      buyer: `Dispute resolved in the seller's favor: the ${sellerUsdc} USDC was released to the seller.`,
      seller: `Dispute resolved in your favor: ${sellerUsdc} USDC was released to you.`,
    }
  }
  return {
    buyer: `Dispute resolved with a split: you receive ${buyerUsdc} USDC back and the seller receives ${sellerUsdc} USDC.`,
    seller: `Dispute resolved with a split: you receive ${sellerUsdc} USDC and the buyer receives ${buyerUsdc} USDC back.`,
  }
}
