// apps/oracle/src/couriers/jnt.ts
// J&T Express tracking adapter
// API docs: https://developer.jet.co.id (requires JNT partner account)
//
// TODO(mainnet): Verify API endpoint and auth header format with JNT partner docs.

import type { CourierAdapter, TrackingStatus } from './types.js'
import { config } from '../config.js'

/** Known JNT status codes that indicate successful delivery */
const DELIVERED_STATUS_CODES = new Set([
  'SIGNED',      // Package signed by recipient
  'DELIVERED',   // Delivery confirmed
  'POD',         // Proof of delivery recorded
])

type JntTrackingResponse = {
  status: boolean
  message: string
  data: {
    cnno: string
    status_code: string
    status_desc: string
    detail: Array<{
      time: string
      status_code: string
      status_desc: string
      location: string
    }>
  }
}

export const jntAdapter: CourierAdapter = {
  code: 'JNT',

  async fetchStatus(trackingNumber: string): Promise<TrackingStatus> {
    const apiKey = config.JNT_API_KEY
    if (!apiKey) {
      throw new Error('JNT_API_KEY is not configured — cannot poll JNT tracking')
    }

    // TODO(mainnet): Confirm exact endpoint and auth scheme with JNT partner docs
    const url = `https://api.jet.co.id/tracing/v1/track/${encodeURIComponent(trackingNumber)}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000), // claude.md: always 10s timeout
    })

    if (!response.ok) {
      throw new Error(`JNT API returned ${response.status}: ${response.statusText}`)
    }

    const body = await response.json() as JntTrackingResponse

    if (!body.status || !body.data) {
      throw new Error(`JNT API error: ${body.message ?? 'Unknown error'}`)
    }

    const latestStatusCode = body.data.status_code.toUpperCase()
    const delivered = DELIVERED_STATUS_CODES.has(latestStatusCode)

    return {
      delivered,
      statusText: body.data.status_desc,
      raw: body as unknown as Record<string, unknown>,
    }
  },
}
