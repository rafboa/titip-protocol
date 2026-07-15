// apps/oracle/src/couriers/jne.ts
// JNE Express tracking adapter
// API docs: https://apiv2.jne.co.id (requires JNE merchant account)
//
// TODO(mainnet): Verify endpoint and auth with JNE merchant portal.

import type { CourierAdapter, TrackingStatus } from './types.js'
import { config } from '../config.js'

/** JNE status codes / descriptions indicating successful delivery */
const DELIVERED_DESCRIPTIONS = [
  'DELIVERED',
  'RECEIVED BY',
  'DITERIMA OLEH',
  'TERKIRIM',
]

type JneTrackingItem = {
  date: string
  desc: string
  location: string
}

type JneTrackingResponse = {
  cnote: {
    cnote_no: string
    cnote_status: string
    cnote_last_status: string
  }
  history: JneTrackingItem[]
}

type JneApiResponse = {
  detail: JneTrackingResponse[]
}

export const jneAdapter: CourierAdapter = {
  code: 'JNE',

  async fetchStatus(trackingNumber: string): Promise<TrackingStatus> {
    const apiKey = config.JNE_API_KEY
    if (!apiKey) {
      throw new Error('JNE_API_KEY is not configured — cannot poll JNE tracking')
    }

    // JNE v2 API — POST with form-encoded body
    // TODO(mainnet): Confirm exact endpoint and auth with JNE merchant docs
    const url = 'https://apiv2.jne.co.id:10101/tracing/api/list/v1/cnote'

    const body = new URLSearchParams({
      username: 'titip', // TODO(mainnet): JNE merchant username from env
      api_key: apiKey,
      from: 'CGK',      // TODO(mainnet): origin code should come from escrow data
      theno: trackingNumber,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`JNE API returned ${response.status}: ${response.statusText}`)
    }

    const data = await response.json() as JneApiResponse

    const detail = data.detail?.[0]
    if (!detail) {
      throw new Error('JNE API returned empty tracking detail')
    }

    const lastStatus = detail.cnote.cnote_last_status.toUpperCase()
    const delivered = DELIVERED_DESCRIPTIONS.some((s) => lastStatus.includes(s))

    return {
      delivered,
      statusText: detail.cnote.cnote_last_status,
      raw: data as unknown as Record<string, unknown>,
    }
  },
}
