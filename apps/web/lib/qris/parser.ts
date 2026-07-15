'use strict'

// =============================================================================
// QRIS EMVCo TLV Parser
// Parses Indonesian QRIS (Quick Response Code Indonesian Standard) payloads
// conforming to the EMVCo QR Code Specification for Payment Systems.
//
// Reference: EMVCo QR Code Specification for Payment Systems (Merchant-Presented Mode)
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single parsed Tag-Length-Value element from the EMVCo payload. */
export interface QrisTag {
  tag: string
  length: number
  value: string
}

/** Merchant account information extracted from sub-TLVs in tags 26-45. */
export interface QrisMerchantInfo {
  globalId: string | null
  merchantId: string | null
  merchantCriteria: string | null
}

/** Complete structured result of a QRIS payload parse. */
export interface QrisParseResult {
  isValid: boolean
  payloadFormatIndicator: string | null   // Tag 00
  pointOfInitiation: 'static' | 'dynamic' | null // Tag 01
  merchantAccountInfo: QrisMerchantInfo   // First found in tags 26-45
  merchantCategoryCode: string | null     // Tag 52
  transactionCurrency: string | null      // Tag 53 ("360" = IDR)
  transactionAmount: string | null        // Tag 54
  countryCode: string | null              // Tag 58
  merchantName: string | null             // Tag 59
  merchantCity: string | null             // Tag 60
  postalCode: string | null               // Tag 61
  crcValid: boolean                       // Tag 63 checksum verification
  rawPayload: string
  error: string | null
}

// ---------------------------------------------------------------------------
// CRC16-CCITT
// ---------------------------------------------------------------------------

/**
 * Compute CRC16-CCITT (polynomial 0x1021, initial value 0xFFFF).
 *
 * @param data - The ASCII string to compute the checksum over.
 * @returns Uppercase 4-character hex string (zero-padded).
 */
export function computeCrc16(data: string): string {
  let crc = 0xffff

  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8

    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff
      } else {
        crc = (crc << 1) & 0xffff
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// ---------------------------------------------------------------------------
// TLV parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a TLV-encoded string into an array of {@link QrisTag} elements.
 *
 * Each element follows EMVCo encoding:
 * - 2-digit tag ID
 * - 2-digit length (decimal, of the value)
 * - Variable-length value string
 *
 * @param data   - The TLV-encoded string.
 * @param label  - Human-readable label used in error messages (e.g. "top-level", "sub-TLV").
 * @returns Parsed array of tags.
 * @throws {Error} If the data is malformed.
 */
function parseTlv(data: string, label: string): QrisTag[] {
  const tags: QrisTag[] = []
  let cursor = 0

  while (cursor < data.length) {
    // Need at least 4 characters for tag (2) + length (2)
    if (cursor + 4 > data.length) {
      throw new Error(
        `Malformed ${label} TLV: insufficient data at offset ${cursor} ` +
        `(remaining: "${data.slice(cursor)}")`
      )
    }

    const tag = data.slice(cursor, cursor + 2)
    const lengthStr = data.slice(cursor + 2, cursor + 4)

    // Validate that tag and length are numeric
    if (!/^\d{2}$/.test(tag)) {
      throw new Error(
        `Malformed ${label} TLV: non-numeric tag "${tag}" at offset ${cursor}`
      )
    }
    if (!/^\d{2}$/.test(lengthStr)) {
      throw new Error(
        `Malformed ${label} TLV: non-numeric length "${lengthStr}" at offset ${cursor + 2}`
      )
    }

    const length = parseInt(lengthStr, 10)
    const valueStart = cursor + 4
    const valueEnd = valueStart + length

    if (valueEnd > data.length) {
      throw new Error(
        `Malformed ${label} TLV: tag "${tag}" declares length ${length} ` +
        `but only ${data.length - valueStart} characters remain`
      )
    }

    const value = data.slice(valueStart, valueEnd)
    tags.push({ tag, length, value })
    cursor = valueEnd
  }

  return tags
}

/**
 * Extract merchant information from a sub-TLV value (tags 26-45 content).
 *
 * Sub-tag layout:
 * - 00: Globally Unique Identifier
 * - 01: Merchant ID / PAN
 * - 02: Merchant ID (alternative)
 * - 03: Merchant Criteria (e.g. "UMI", "UME", "UKE")
 */
function parseMerchantSubTlv(value: string): QrisMerchantInfo {
  const subTags = parseTlv(value, 'merchant-account-info')

  let globalId: string | null = null
  let merchantId: string | null = null
  let merchantCriteria: string | null = null

  for (const sub of subTags) {
    switch (sub.tag) {
      case '00':
        globalId = sub.value
        break
      case '01':
        // Primary merchant identifier (PAN or similar)
        merchantId = sub.value
        break
      case '02':
        // Secondary merchant identifier — use as fallback if 01 is absent
        if (merchantId === null) {
          merchantId = sub.value
        }
        break
      case '03':
        merchantCriteria = sub.value
        break
      // v1.1: Parse additional sub-tags (04+) if needed for richer merchant data
    }
  }

  return { globalId, merchantId, merchantCriteria }
}

// ---------------------------------------------------------------------------
// Tag number helpers
// ---------------------------------------------------------------------------

/** Returns true if the tag number (as decimal int) is in the merchant account range 26-45. */
function isMerchantAccountTag(tag: string): boolean {
  const n = parseInt(tag, 10)
  return n >= 26 && n <= 45
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/** Minimum realistic payload length: tag 00 (6 chars) + CRC tag 63 (8 chars) = 14 */
const MIN_PAYLOAD_LENGTH = 14

/**
 * Parse a QRIS (EMVCo) payload string and return a structured result.
 *
 * Steps:
 * 1. Trim whitespace.
 * 2. Validate minimum length.
 * 3. Parse all top-level TLV tags.
 * 4. For tags 26-45, parse sub-TLVs to extract merchant info.
 * 5. Validate CRC16-CCITT (tag 63).
 * 6. Return structured {@link QrisParseResult}.
 */
export function parseQris(payload: string): QrisParseResult {
  const trimmed = payload.trim()

  // Default error result factory
  const errorResult = (error: string): QrisParseResult => ({
    isValid: false,
    payloadFormatIndicator: null,
    pointOfInitiation: null,
    merchantAccountInfo: { globalId: null, merchantId: null, merchantCriteria: null },
    merchantCategoryCode: null,
    transactionCurrency: null,
    transactionAmount: null,
    countryCode: null,
    merchantName: null,
    merchantCity: null,
    postalCode: null,
    crcValid: false,
    rawPayload: trimmed,
    error,
  })

  // ---- Step 1: Basic validation ----
  if (trimmed.length === 0) {
    return errorResult('Empty payload')
  }

  if (trimmed.length < MIN_PAYLOAD_LENGTH) {
    return errorResult(
      `Payload too short: ${trimmed.length} characters (minimum ${MIN_PAYLOAD_LENGTH})`
    )
  }

  // ---- Step 2: Parse top-level TLV ----
  let topLevelTags: QrisTag[]
  try {
    topLevelTags = parseTlv(trimmed, 'top-level')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown parse error'
    return errorResult(message)
  }

  if (topLevelTags.length === 0) {
    return errorResult('No TLV tags found in payload')
  }

  // ---- Step 3: Build a tag map for easy access ----
  // Use Map to preserve insertion order; for duplicate tags, first wins
  // (except merchant account which we scan separately).
  const tagMap = new Map<string, string>()
  for (const t of topLevelTags) {
    if (!tagMap.has(t.tag)) {
      tagMap.set(t.tag, t.value)
    }
  }

  // ---- Step 4: Extract merchant account info (first found in 26-45) ----
  let merchantAccountInfo: QrisMerchantInfo = {
    globalId: null,
    merchantId: null,
    merchantCriteria: null,
  }

  for (const t of topLevelTags) {
    if (isMerchantAccountTag(t.tag)) {
      try {
        merchantAccountInfo = parseMerchantSubTlv(t.value)
        break // Use the first merchant account tag
      } catch {
        // If sub-TLV parsing fails, try next merchant tag
        // v1.1: Accumulate all merchant account tags instead of first-only
        continue
      }
    }
  }

  // ---- Step 5: CRC validation ----
  //
  // The CRC is the last 4 hex characters of the payload.
  // It is computed over everything before those 4 characters,
  // which includes the "6304" tag+length prefix.
  let crcValid = false
  const crcTagValue = tagMap.get('63')

  if (crcTagValue !== undefined && crcTagValue.length === 4) {
    // The data to checksum is everything up to (but not including) the CRC value
    const crcDataEndIndex = trimmed.length - 4
    const dataForCrc = trimmed.slice(0, crcDataEndIndex)
    const computed = computeCrc16(dataForCrc)
    crcValid = computed === crcTagValue.toUpperCase()
  }

  // ---- Step 6: Point of Initiation Method ----
  let pointOfInitiation: 'static' | 'dynamic' | null = null
  const poiRaw = tagMap.get('01')
  if (poiRaw === '11') {
    pointOfInitiation = 'static'
  } else if (poiRaw === '12') {
    pointOfInitiation = 'dynamic'
  }
  // v1.1: Warn if tag 01 has an unexpected value

  // ---- Step 7: Build result ----
  const result: QrisParseResult = {
    isValid: crcValid,
    payloadFormatIndicator: tagMap.get('00') ?? null,
    pointOfInitiation,
    merchantAccountInfo,
    merchantCategoryCode: tagMap.get('52') ?? null,
    transactionCurrency: tagMap.get('53') ?? null,
    transactionAmount: tagMap.get('54') ?? null,
    countryCode: tagMap.get('58') ?? null,
    merchantName: tagMap.get('59') ?? null,
    merchantCity: tagMap.get('60') ?? null,
    postalCode: tagMap.get('61') ?? null,
    crcValid,
    rawPayload: trimmed,
    error: null,
  }

  // Additional validation warnings (non-fatal)
  if (result.payloadFormatIndicator !== '01') {
    // EMVCo mandates this must be "01"
    result.error = `Unexpected Payload Format Indicator: "${result.payloadFormatIndicator ?? '(missing)'}"`
    // Still valid if CRC passes; the error is informational
  }

  // TODO(mainnet): Add stricter validation for production:
  //   - Enforce mandatory tags (00, 52, 53, 58, 59, 60, 63)
  //   - Validate MCC against ISO 18245
  //   - Validate currency code against ISO 4217
  //   - Enforce merchant name max 25 chars, city max 15 chars

  return result
}
