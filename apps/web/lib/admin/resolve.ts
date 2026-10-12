// Records a dispute resolution in the database once the chain has already paid out.
// Shared by the admin screen and the internal `/resolve` route, so both leave the same trail.

import { prisma } from '@titip/db'
import { decimalToBaseUnits, resolutionMessages, resolutionStatus } from './split'

export type ResolvedEscrow = {
  id: string
  buyerAddress: string
  sellerAddress: string
  /** Plain decimal with 7 fraction digits (Prisma `Decimal#toFixed(7)`). */
  amountUsdc: string
}

/**
 * Atomically moves DISPUTED -> REFUNDED/DELIVERED with the split, who signed it and the transaction,
 * and notifies both parties with their exact amounts. Returns false when the escrow was no longer
 * DISPUTED in the database (resolved by someone else first): nothing is written then.
 */
export async function recordResolution(
  escrow: ResolvedEscrow,
  buyerBps: number,
  txHash: string,
  resolvedBy: string
): Promise<boolean> {
  const total = decimalToBaseUnits(escrow.amountUsdc)
  const status = resolutionStatus(total, buyerBps)
  const messages = resolutionMessages(total, buyerBps)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.escrow.updateMany({
      where: { id: escrow.id, status: 'DISPUTED' },
      data: {
        status,
        resolutionBuyerBps: buyerBps,
        resolvedAt: now,
        resolvedBy,
        txHashRelease: txHash,
        refundedAt: status === 'REFUNDED' ? now : null,
        deliveredAt: status === 'DELIVERED' ? now : null,
      },
    })
    if (claimed.count === 0) return false

    await tx.notification.create({
      data: { userAddress: escrow.buyerAddress, type: 'DISPUTE_RESOLVED', message: messages.buyer },
    })
    await tx.notification.create({
      data: { userAddress: escrow.sellerAddress, type: 'DISPUTE_RESOLVED', message: messages.seller },
    })
    return true
  })
}

/** A `Decimal(20,7)` from Prisma (or a string) as a plain decimal string, never in exponent form. */
export function toAmountString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'toFixed' in value && typeof value.toFixed === 'function') {
    return String(value.toFixed(7))
  }
  throw new Error('Unexpected amount value')
}
