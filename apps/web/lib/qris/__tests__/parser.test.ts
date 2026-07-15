'use strict'

import { describe, it, expect, beforeAll } from 'vitest'
import { parseQris, computeCrc16 } from '../parser'
import type { QrisParseResult } from '../parser'

// =============================================================================
// Test data
// =============================================================================

/**
 * Realistic QRIS payload (corrected CRC).
 *
 * Structure breakdown:
 *   00 02 01                         → Payload Format Indicator = "01"
 *   01 02 11                         → Point of Initiation = static ("11")
 *   26 67 ...                        → Merchant Account Info (Nobubank)
 *     00 16 COM.NOBUBANK.WWW         →   Global ID
 *     01 18 936001230000003680       →   Merchant PAN
 *     02 09 123456789                →   Merchant ID
 *     03 03 UMI                      →   Merchant Criteria
 *   51 44 ...                        → Merchant Account Info (QRIS National)
 *     00 14 ID.CO.QRIS.WWW           →   Global ID
 *     02 15 ID1020012345678          →   Merchant ID
 *     03 03 UMI                      →   Merchant Criteria
 *   52 04 8399                       → MCC
 *   53 03 360                        → Currency = IDR
 *   58 02 ID                         → Country Code
 *   59 13 TOKO BUDIANTO              → Merchant Name
 *   60 07 JAKARTA                    → Merchant City
 *   61 05 12340                      → Postal Code
 *   62 07 ...                        → Additional Data
 *     07 03 A01                      →   Terminal Label
 *   63 04 6FCC                       → CRC16-CCITT
 */
const VALID_QRIS =
  '00020101021126670016COM.NOBUBANK.WWW01189360012300000036802091234567890303UMI' +
  '51440014ID.CO.QRIS.WWW0215ID10200123456780303UMI' +
  '5204839953033605802ID5913TOKO BUDIANTO6007JAKARTA6105123406207' +
  '0703A0163046FCC'

/** Same structure but with a deliberately wrong CRC. */
const INVALID_CRC_QRIS =
  '00020101021126670016COM.NOBUBANK.WWW01189360012300000036802091234567890303UMI' +
  '51440014ID.CO.QRIS.WWW0215ID10200123456780303UMI' +
  '5204839953033605802ID5913TOKO BUDIANTO6007JAKARTA6105123406207' +
  '0703A0163049A25'

/** Dynamic QR (Point of Initiation = "12") with a transaction amount. */
function buildDynamicQris(): string {
  // Build payload without CRC, then append computed CRC
  const body =
    '00020101021226670016COM.NOBUBANK.WWW01189360012300000036802091234567890303UMI' +
    '51440014ID.CO.QRIS.WWW0215ID10200123456780303UMI' +
    '520483995303360540550000' + // Tag 54 = amount "50000"
    '5802ID5913TOKO BUDIANTO6007JAKARTA6105123406207' +
    '0703A016304'
  const crc = computeCrc16(body)
  return body + crc
}

// =============================================================================
// Tests
// =============================================================================

describe('computeCrc16', () => {
  it('computes correct CRC16-CCITT for known input', () => {
    // Known test vector: "123456789" → CRC = 29B1
    expect(computeCrc16('123456789')).toBe('29B1')
  })

  it('returns 4-character uppercase hex string', () => {
    const result = computeCrc16('hello')
    expect(result).toMatch(/^[0-9A-F]{4}$/)
  })

  it('handles empty string', () => {
    // CRC of empty string with init 0xFFFF and no data = "FFFF" (no processing)
    // Actually for CRC-CCITT with initial 0xFFFF and 0 bytes processed, result is 0xFFFF
    expect(computeCrc16('')).toBe('FFFF')
  })
})

describe('parseQris', () => {
  // ---------- Valid payload ----------

  describe('valid QRIS payload', () => {
    let result: QrisParseResult

    // Parse once, assert many
    beforeAll(() => {
      result = parseQris(VALID_QRIS)
    })

    it('marks the payload as valid', () => {
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('extracts Payload Format Indicator (tag 00)', () => {
      expect(result.payloadFormatIndicator).toBe('01')
    })

    it('detects static Point of Initiation (tag 01 = "11")', () => {
      expect(result.pointOfInitiation).toBe('static')
    })

    it('extracts merchant account info from tag 26 sub-TLVs', () => {
      expect(result.merchantAccountInfo.globalId).toBe('COM.NOBUBANK.WWW')
      expect(result.merchantAccountInfo.merchantId).toBe('936001230000003680')
      expect(result.merchantAccountInfo.merchantCriteria).toBe('UMI')
    })

    it('extracts Merchant Category Code (tag 52)', () => {
      expect(result.merchantCategoryCode).toBe('8399')
    })

    it('extracts Transaction Currency (tag 53)', () => {
      expect(result.transactionCurrency).toBe('360')
    })

    it('returns null for Transaction Amount when absent', () => {
      expect(result.transactionAmount).toBeNull()
    })

    it('extracts Country Code (tag 58)', () => {
      expect(result.countryCode).toBe('ID')
    })

    it('extracts Merchant Name (tag 59)', () => {
      expect(result.merchantName).toBe('TOKO BUDIANTO')
    })

    it('extracts Merchant City (tag 60)', () => {
      expect(result.merchantCity).toBe('JAKARTA')
    })

    it('extracts Postal Code (tag 61)', () => {
      expect(result.postalCode).toBe('12340')
    })

    it('validates CRC as correct', () => {
      expect(result.crcValid).toBe(true)
    })

    it('preserves raw payload', () => {
      expect(result.rawPayload).toBe(VALID_QRIS)
    })
  })

  // ---------- Invalid CRC ----------

  describe('invalid CRC detection', () => {
    it('detects wrong CRC and marks payload as invalid', () => {
      const result = parseQris(INVALID_CRC_QRIS)

      expect(result.isValid).toBe(false)
      expect(result.crcValid).toBe(false)
      // Other fields should still be parsed
      expect(result.payloadFormatIndicator).toBe('01')
      expect(result.merchantName).toBe('TOKO BUDIANTO')
    })
  })

  // ---------- Static vs Dynamic ----------

  describe('static vs dynamic detection', () => {
    it('detects static QR (tag 01 = "11")', () => {
      const result = parseQris(VALID_QRIS)
      expect(result.pointOfInitiation).toBe('static')
    })

    it('detects dynamic QR (tag 01 = "12")', () => {
      const dynamicPayload = buildDynamicQris()
      const result = parseQris(dynamicPayload)

      expect(result.pointOfInitiation).toBe('dynamic')
      expect(result.transactionAmount).toBe('50000')
      expect(result.crcValid).toBe(true)
      expect(result.isValid).toBe(true)
    })
  })

  // ---------- Empty / Malformed ----------

  describe('empty and malformed input handling', () => {
    it('returns error for empty string', () => {
      const result = parseQris('')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Empty payload')
    })

    it('returns error for whitespace-only string', () => {
      const result = parseQris('   \n\t  ')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Empty payload')
    })

    it('returns error for too-short payload', () => {
      const result = parseQris('000201')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('returns error for non-numeric tag', () => {
      const result = parseQris('AB0201630400000000')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('non-numeric tag')
    })

    it('returns error when declared length exceeds remaining data', () => {
      // Tag "00", length "99" but only 2 chars of value
      const result = parseQris('009901630400000000')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('declares length')
    })

    it('handles payload with leading/trailing whitespace', () => {
      const result = parseQris(`  ${VALID_QRIS}  `)
      expect(result.isValid).toBe(true)
      expect(result.rawPayload).toBe(VALID_QRIS)
    })
  })

  // ---------- Edge cases ----------

  describe('edge cases', () => {
    it('handles minimal valid-structure payload (format + CRC only)', () => {
      // Construct: tag 00 = "01", tag 63 = CRC
      const body = '0002016304'
      const crc = computeCrc16(body)
      const payload = body + crc

      const result = parseQris(payload)
      expect(result.crcValid).toBe(true)
      expect(result.payloadFormatIndicator).toBe('01')
      // Merchant info should be all null
      expect(result.merchantAccountInfo.globalId).toBeNull()
      expect(result.merchantAccountInfo.merchantId).toBeNull()
    })

    it('preserves exact raw payload after trim', () => {
      const result = parseQris(VALID_QRIS)
      expect(result.rawPayload).toBe(VALID_QRIS)
    })
  })
})
