// apps/oracle/src/couriers/mock.ts
// Mock courier adapter — used when no real API key is configured.
// Always reports delivery after 1 poll cycle. Safe for testnet/demo only.
//
// TODO(mainnet): Remove this adapter entirely — require real API keys in production.

import type { CourierAdapter } from './types.js'

export const mockAdapter: CourierAdapter = {
  code: 'MOCK',

  async fetchStatus(trackingNumber: string): Promise<{
    delivered: boolean
    statusText: string
    raw: Record<string, unknown>
  }> {
    console.log(`[mock-courier] Simulating delivery for tracking: ${trackingNumber}`)

    // Simulate a brief network delay
    await new Promise((resolve) => setTimeout(resolve, 200))

    return {
      delivered: true,
      statusText: 'DELIVERED — Paket telah sampai (mock)',
      raw: {
        source:         'mock-courier',
        trackingNumber,
        status:         'DELIVERED',
        deliveredAt:    new Date().toISOString(),
        note:           'Mock response — for testnet demo only. TODO(mainnet): remove',
      },
    }
  },
}
