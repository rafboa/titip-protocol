// apps/oracle/src/stellar/submit.ts
// Calls the Next.js /api/oracle/confirm endpoint when delivery is confirmed.
// The oracle does NOT sign a Soroban transaction here directly — instead it
// calls the internal API which already has the oracle secret key and handles
// on-chain submission. This keeps Soroban complexity in one place.
//
// v1.1: Move on-chain submission directly here once oracle has its own Stellar
//       signing capability exposed via the oracle's ORACLE_SECRET_KEY env var.

import { config } from '../config.js'

type ConfirmDeliveryResult = {
  success: boolean
  escrowId: string
}

/**
 * Notifies the web app's internal oracle endpoint that a delivery has been confirmed.
 * The endpoint verifies the shared ORACLE_INTERNAL_API_KEY and updates the escrow state.
 */
export async function confirmDelivery(
  escrowId: string,
  courierResponse: Record<string, unknown>
): Promise<ConfirmDeliveryResult> {
  const url = `${config.APP_INTERNAL_API_URL}/api/oracle/confirm`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ORACLE_INTERNAL_API_KEY}`,
    },
    body: JSON.stringify({ escrowId, courierResponse }),
    signal: AbortSignal.timeout(30_000), // 30s — web app has its own Soroban call
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `oracle/confirm returned ${response.status}: ${text}`
    )
  }

  return { success: true, escrowId }
}
