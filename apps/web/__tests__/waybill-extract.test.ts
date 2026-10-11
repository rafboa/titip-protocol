import { describe, it, expect } from 'vitest'
import { extractWaybillCandidates } from '@/lib/waybill/extract'

describe('extractWaybillCandidates', () => {
  it('finds a J&T style waybill in noisy receipt text', () => {
    const text = 'PENGIRIM: Toko Maju\nNo Resi: JP3012345678\nBerat 1kg'
    expect(extractWaybillCandidates(text)).toEqual([{ value: 'JP3012345678', couriers: ['JNT'] }])
  })

  it('finds a 16-digit JNE number and joins OCR-split digit groups', () => {
    const c = extractWaybillCandidates('AWB 0123 4567 8901 2345')
    expect(c).toEqual([{ value: '0123456789012345', couriers: ['JNE'] }])
  })

  it('marks 12-digit numbers as ambiguous between SiCepat and AnterAja', () => {
    const c = extractWaybillCandidates('000123456789')
    expect(c[0].couriers).toEqual(['SICEPAT', 'ANTERAJA'])
  })

  it('is case-insensitive for prefixed waybills', () => {
    expect(extractWaybillCandidates('jd0123456789')[0].value).toBe('JD0123456789')
  })

  it('does not match digit runs of other lengths (phone numbers, prices)', () => {
    expect(extractWaybillCandidates('Telp 081234567890 Rp 150000 Total 12345678')).toEqual([])
  })

  it('deduplicates and caps the number of candidates', () => {
    const many = Array.from({ length: 8 }, (_, i) => `JP30000000${i}0`).join(' ')
    const c = extractWaybillCandidates(`${many} JP3000000000`)
    expect(c.length).toBeLessThanOrEqual(5)
    expect(new Set(c.map((x) => x.value)).size).toBe(c.length)
  })

  it('returns an empty list for empty text', () => {
    expect(extractWaybillCandidates('')).toEqual([])
  })
})
