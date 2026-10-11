// Extracts likely courier waybill (AWB / resi) numbers from OCR text.
// Pure and I/O free so it can be unit tested. The OCR result is only a suggestion: the seller
// must confirm it, and the server still validates the value before it is signed on-chain.

export type WaybillCourier = 'JNT' | 'JNE' | 'SICEPAT' | 'ANTERAJA' | 'POS_INDONESIA'

export type WaybillCandidate = {
  value: string
  /** Couriers whose usual format this value matches (best guess, may be ambiguous). */
  couriers: WaybillCourier[]
}

// TODO(mainnet): verify these formats against real receipts / courier docs before relying on
// the courier suggestion. The number itself is always editable by the user.
const PATTERNS: Array<{ re: RegExp; couriers: WaybillCourier[] }> = [
  { re: /\bJ[A-Z]\d{9,11}\b/g, couriers: ['JNT'] }, // e.g. JP3012345678
  { re: /\b\d{16}\b/g, couriers: ['JNE'] },
  { re: /\b\d{13}\b/g, couriers: ['POS_INDONESIA', 'ANTERAJA'] },
  { re: /\bP\d{12,13}\b/g, couriers: ['POS_INDONESIA'] },
  { re: /\b\d{12}\b/g, couriers: ['SICEPAT', 'ANTERAJA'] },
]

const MAX_CANDIDATES = 5

/** Indonesian mobile numbers (08xx / 628xx) share the digit lengths of some waybills. */
const LOOKS_LIKE_PHONE = /^(08|628)\d+$/

/** Joins digit groups the OCR split with spaces or dashes ("0123 4567 8901" -> "012345678901"). */
function normalise(text: string): string {
  let out = text.toUpperCase()
  for (let i = 0; i < 4; i++) out = out.replace(/(\d)[ \-](?=\d)/g, '$1')
  return out
}

export function extractWaybillCandidates(ocrText: string): WaybillCandidate[] {
  const text = normalise(ocrText)
  const seen = new Map<string, WaybillCandidate>()

  for (const { re, couriers } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      const value = match[0]
      if (LOOKS_LIKE_PHONE.test(value)) continue
      const existing = seen.get(value)
      if (existing) {
        for (const c of couriers) if (!existing.couriers.includes(c)) existing.couriers.push(c)
      } else if (seen.size < MAX_CANDIDATES) {
        seen.set(value, { value, couriers: [...couriers] })
      }
    }
  }
  return [...seen.values()]
}
