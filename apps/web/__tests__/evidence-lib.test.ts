import { describe, it, expect } from 'vitest'
import {
  detectEvidenceMime,
  evidenceUri,
  isSha256Hex,
  parseEvidenceUri,
  MAX_EVIDENCE_URI_BYTES,
} from '@/lib/evidence/file'
import { buildEvidenceList, slotsUsed, type ChainEvidence, type StoredEvidence } from '@/lib/evidence/merge'

const bytes = (...values: number[]) => Uint8Array.from(values)

describe('detectEvidenceMime', () => {
  it('recognises jpeg, png and webp by their magic bytes', () => {
    expect(detectEvidenceMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg')
    expect(detectEvidenceMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png')
    expect(
      detectEvidenceMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56))
    ).toBe('image/webp')
  })

  it('rejects other formats, including a RIFF file that is not WebP and an empty file', () => {
    expect(detectEvidenceMime(bytes())).toBeNull()
    expect(detectEvidenceMime(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
    expect(detectEvidenceMime(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    // RIFF + WAVE (audio), not WEBP
    expect(detectEvidenceMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull()
    // A GIF is an image, but not one we accept
    expect(detectEvidenceMime(new TextEncoder().encode('GIF89a'))).toBeNull()
  })
})

describe('evidence pointer and hash', () => {
  it('round-trips the pointer and keeps it within the contract limit', () => {
    const id = 'cmv5chn1z0001u9cc1l4qy783'
    const uri = evidenceUri(id)
    expect(uri).toBe(`titip:evidence/${id}`)
    expect(new TextEncoder().encode(uri).length).toBeLessThanOrEqual(MAX_EVIDENCE_URI_BYTES)
    expect(parseEvidenceUri(uri)).toBe(id)
  })

  it('refuses a pointer the contract would reject', () => {
    expect(() => evidenceUri('x'.repeat(200))).toThrow()
  })

  it('parseEvidenceUri ignores pointers it did not create', () => {
    expect(parseEvidenceUri('https://example.com/a.jpg')).toBeNull()
    expect(parseEvidenceUri('titip:evidence/')).toBeNull()
  })

  it('isSha256Hex accepts only 64 lowercase hex characters', () => {
    expect(isSha256Hex('a'.repeat(64))).toBe(true)
    expect(isSha256Hex('A'.repeat(64))).toBe(false)
    expect(isSha256Hex('a'.repeat(63))).toBe(false)
    expect(isSha256Hex('g'.repeat(64))).toBe(false)
  })
})

describe('buildEvidenceList', () => {
  const escrow = { buyerAddress: 'GBUYER', sellerAddress: 'GSELLER' }
  const h1 = '1'.repeat(64)
  const h2 = '2'.repeat(64)
  const h3 = '3'.repeat(64)
  const chain: ChainEvidence[] = [
    { submitter: 'GBUYER', hash: h1, uri: 'titip:evidence/a', ledger: 10 },
    { submitter: 'GSELLER', hash: h2, uri: 'titip:evidence/b', ledger: 11 },
    { submitter: 'GBUYER', hash: h3, uri: 'titip:evidence/c', ledger: 12 },
  ]
  const stored: StoredEvidence[] = [
    { id: 'a', submitter: 'GBUYER', sha256: h1, mimeType: 'image/png', sizeBytes: 100 },
    { id: 'b', submitter: 'GSELLER', sha256: h2, mimeType: 'image/jpeg', sizeBytes: 200 },
    // Uploaded by the buyer but never committed on-chain: must not appear.
    { id: 'z', submitter: 'GBUYER', sha256: '9'.repeat(64), mimeType: 'image/png', sizeBytes: 1 },
  ]

  it('lists what the chain committed, with roles instead of addresses, oldest first', () => {
    const list = buildEvidenceList(chain, stored, escrow, 'GBUYER')
    expect(list.map((i) => [i.index, i.role, i.mine])).toEqual([
      [0, 'BUYER', true],
      [1, 'SELLER', false],
      [2, 'BUYER', true],
    ])
    expect(JSON.stringify(list)).not.toContain('GBUYER')
    expect(JSON.stringify(list)).not.toContain('GSELLER')
  })

  it('keeps a committed item whose file this app does not hold, as unavailable', () => {
    const list = buildEvidenceList(chain, stored, escrow, 'GBUYER')
    expect(list[0]).toMatchObject({ fileId: 'a', mimeType: 'image/png', sizeBytes: 100 })
    expect(list[2]).toMatchObject({ fileId: null, mimeType: null, sizeBytes: null })
  })

  it('never matches a file to a hash committed by the other party', () => {
    const list = buildEvidenceList(chain, [{ ...stored[0], submitter: 'GSELLER' }], escrow, null)
    expect(list[0].fileId).toBeNull()
  })

  it('marks nothing as mine for the arbiter (no viewer)', () => {
    expect(buildEvidenceList(chain, stored, escrow, null).some((i) => i.mine)).toBe(false)
  })

  it('counts the on-chain slots a party has used', () => {
    expect(slotsUsed(chain, 'GBUYER')).toBe(2)
    expect(slotsUsed(chain, 'GSELLER')).toBe(1)
    expect(slotsUsed(chain, 'GNOBODY')).toBe(0)
  })
})
