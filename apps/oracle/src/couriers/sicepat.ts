// apps/oracle/src/couriers/sicepat.ts
// SiCepat Ekspres tracking adapter
// API docs: https://api.sicepat.com (requires SiCepat partner account)
//
// TODO(mainnet): Verify endpoint, auth header, and status code list with SiCepat.

import type { CourierAdapter, TrackingStatus } from './types.js'
import { config } from '../config.js'

/** SiCepat status codes indicating successful delivery */
const DELIVERED_STATUS_CODES = new Set([
  'DELIVERED',
  'DLVD',
  'ANT-DELIVERED',
])

type SiCepatHistoryItem = {
  date_time: string
  status: string
  city: string
  description: string
}

type SiCepatTrackResult = {
  waybill_number: string
  waybill_date: string
  waybill_status: string
  package_desc: string
  sender_name: string
  receiver_name: string
  track_history: SiCepatHistoryItem[]
}

type SiCepatApiResponse = {
  sicepat: {
    status: {
      code: number
      description: string
    }
    result: SiCepatTrackResult
  }
}

export const sicepatAdapter: CourierAdapter = {
  code: 'SICEPAT',

  async fetchStatus(trackingNumber: string): Promise<TrackingStatus> {
    const apiKey = config.SICEPAT_API_KEY
    if (!apiKey) {
      throw new Error('SICEPAT_API_KEY is not configured — cannot poll SiCepat tracking')
    }

    // TODO(mainnet): Confirm exact endpoint with SiCepat partner docs
    const url = `https://api.sicepat.com/customer/waybill?waybill=${encodeURIComponent(trackingNumber)}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'api-key': apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`SiCepat API returned ${response.status}: ${response.statusText}`)
    }

    const data = await response.json() as SiCepatApiResponse
    const result = data.sicepat?.result

    if (!result) {
      const desc = data.sicepat?.status?.description ?? 'Unknown error'
      throw new Error(`SiCepat API error: ${desc}`)
    }

    const currentStatus = result.waybill_status.toUpperCase()
    const delivered = DELIVERED_STATUS_CODES.has(currentStatus)

    return {
      delivered,
      statusText: result.waybill_status,
      raw: data as unknown as Record<string, unknown>,
    }
  },
}
