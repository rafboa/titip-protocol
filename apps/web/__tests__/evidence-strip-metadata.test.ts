import { describe, it, expect } from 'vitest'
import { stripImageMetadata } from '@/lib/evidence/strip-metadata'

const b = (...n: number[]) => new Uint8Array(n)
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('JPEG', () => {
  const soi = b(0xff, 0xd8)
  const jfif = b(0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46)
  const exif = b(0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66)
  const icc = b(0xff, 0xe2, 0x00, 0x04, 0x49, 0x43)
  const sos = b(0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9)

  it('removes EXIF but keeps JFIF, the ICC profile and the image data', () => {
    const out = stripImageMetadata(cat(soi, jfif, exif, icc, sos), 'image/jpeg')
    expect(out).toEqual(cat(soi, jfif, icc, sos))
  })

  it('returns the same bytes when there is no metadata', () => {
    const input = cat(soi, jfif, sos)
    expect(stripImageMetadata(input, 'image/jpeg')).toBe(input)
  })

  it('leaves a malformed file untouched', () => {
    const input = cat(soi, b(0xff, 0xe1, 0xff, 0xff))
    expect(stripImageMetadata(input, 'image/jpeg')).toBe(input)
  })
})

describe('PNG', () => {
  const sig = b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const chunk = (type: string, data: number[]) => cat(b(0, 0, 0, data.length), ascii(type), b(...data), b(0, 0, 0, 0))
  const ihdr = chunk('IHDR', [1, 2, 3])
  const idat = chunk('IDAT', [9, 9])
  const iend = chunk('IEND', [])

  it('removes eXIf and text chunks only', () => {
    const out = stripImageMetadata(cat(sig, ihdr, chunk('eXIf', [1, 2]), chunk('tEXt', [3]), idat, iend), 'image/png')
    expect(out).toEqual(cat(sig, ihdr, idat, iend))
  })

  it('keeps the colour profile', () => {
    const input = cat(sig, ihdr, chunk('iCCP', [7]), idat, iend)
    expect(stripImageMetadata(input, 'image/png')).toBe(input)
  })
})

describe('WebP', () => {
  const u32 = (n: number) => b(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff)
  const chunk = (type: string, data: number[]) => cat(ascii(type), u32(data.length), b(...data), data.length % 2 ? b(0) : b())
  const riff = (...chunks: Uint8Array[]) => {
    const body = cat(ascii('WEBP'), ...chunks)
    return cat(ascii('RIFF'), u32(body.length), body)
  }

  it('removes EXIF/XMP, clears the VP8X flags and fixes the RIFF size', () => {
    const vp8x = chunk('VP8X', [0x0c, 0, 0, 0, 1, 0, 0, 1, 0, 0])
    const vp8xClean = chunk('VP8X', [0x00, 0, 0, 0, 1, 0, 0, 1, 0, 0])
    const image = chunk('VP8 ', [5, 6, 7])
    const input = riff(vp8x, image, chunk('EXIF', [1, 2, 3]), chunk('XMP ', [4]))
    expect(stripImageMetadata(input, 'image/webp')).toEqual(riff(vp8xClean, image))
  })

  it('returns the same bytes when there is no metadata', () => {
    const input = riff(chunk('VP8 ', [5, 6, 7]))
    expect(stripImageMetadata(input, 'image/webp')).toBe(input)
  })
})
