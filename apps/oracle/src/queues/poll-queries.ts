// Pure query builders for the oracle pollers, kept free of Prisma/Redis so they can be unit tested.

/** Only escrows of the contract this node serves; old-contract rows would fail on-chain forever. */
export function currentContractWhere(contractAddress: string | undefined): { contractAddress?: string } {
  return contractAddress ? { contractAddress } : {}
}

export function shippedEscrowsWhere(contractAddress: string | undefined) {
  return {
    status: 'SHIPPED' as const,
    trackingNumber: { not: null },
    courierCode: { not: null },
    ...currentContractWhere(contractAddress),
  }
}

/** Where the previous webhook batch stopped. null = start from the oldest event again. */
export type WebhookCursor = { receivedAt: Date; id: string } | null

/**
 * One page of unprocessed webhook events after the cursor, oldest first.
 *
 * Taking "the 100 oldest" every cycle let events that stay unprocessed on purpose (a final DELIVERED
 * waiting for the oracle quorum, a deferred leg) fill the page for good, so newer events were never
 * picked up. Walking through them with a cursor visits every unprocessed event in turn.
 */
export function webhookBatchQuery(cursor: WebhookCursor, take: number) {
  return {
    where: {
      processedAt: null,
      ...(cursor
        ? {
            OR: [
              { receivedAt: { gt: cursor.receivedAt } },
              { receivedAt: cursor.receivedAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    select: { id: true, receivedAt: true },
    orderBy: [{ receivedAt: 'asc' as const }, { id: 'asc' as const }],
    take,
  }
}

/** A full page continues after its last event; a short page means the end was reached: wrap around. */
export function nextWebhookCursor(batch: { id: string; receivedAt: Date }[], take: number): WebhookCursor {
  if (batch.length < take) return null
  const last = batch[batch.length - 1]
  return { receivedAt: last.receivedAt, id: last.id }
}
