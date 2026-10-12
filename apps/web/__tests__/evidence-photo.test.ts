import { describe, it, expect } from 'vitest'
import { MAX_EVIDENCE_BYTES } from '@/lib/evidence/file'
import {
  MAX_PHOTO_EDGE,
  MAX_PHOTO_INPUT_BYTES,
  encodingAttempts,
  fitWithin,
  formatFileSize,
  outputTypeFor,
} from '@/lib/evidence/photo'

describe('fitWithin', () => {
  it('leaves a photo that already fits alone and never upscales', () => {
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(2560, 1000, 2560)).toEqual({ width: 2560, height: 1000 })
  })

  it('scales the longest side down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 })
  })

  it('never produces a zero-sized side, even for an extreme panorama', () => {
    expect(fitWithin(100000, 10, 2560)).toEqual({ width: 2560, height: 1 })
  })
})

describe('outputTypeFor', () => {
  it('keeps PNG lossless (screenshots, receipts) and turns everything else into JPEG', () => {
    expect(outputTypeFor('image/png')).toBe('image/png')
    expect(outputTypeFor('image/jpeg')).toBe('image/jpeg')
    expect(outputTypeFor('image/webp')).toBe('image/jpeg')
  })
})

describe('encodingAttempts', () => {
  it('starts at full size and good quality for JPEG, then lowers quality before it lowers size', () => {
    const jpeg = encodingAttempts('image/jpeg')
    expect(jpeg[0]).toEqual({ edge: MAX_PHOTO_EDGE, quality: 0.9 })
    expect(jpeg.slice(0, 3).map((a) => a.quality)).toEqual([0.9, 0.8, 0.7])
    expect(jpeg.slice(0, 3).every((a) => a.edge === MAX_PHOTO_EDGE)).toBe(true)
    expect(jpeg[3].edge).toBeLessThan(MAX_PHOTO_EDGE)
  })

  it('only shrinks a PNG: it has no quality setting and must stay lossless', () => {
    const png = encodingAttempts('image/png')
    expect(new Set(png.map((a) => a.quality))).toEqual(new Set([1]))
    expect(png[0].edge).toBe(MAX_PHOTO_EDGE)
    const edges = png.map((a) => a.edge)
    expect([...edges].sort((a, b) => b - a)).toEqual(edges)
  })

  it('never goes below a readable size', () => {
    for (const type of ['image/png', 'image/jpeg'] as const) {
      expect(Math.min(...encodingAttempts(type).map((a) => a.edge))).toBeGreaterThanOrEqual(800)
    }
  })
})

describe('limits and labels', () => {
  it('accepts a far bigger input than the server limit, because the output is what must fit', () => {
    expect(MAX_PHOTO_INPUT_BYTES).toBeGreaterThan(MAX_EVIDENCE_BYTES)
  })

  it('formats sizes for the user', () => {
    expect(formatFileSize(10)).toBe('1 KB')
    expect(formatFileSize(340 * 1024)).toBe('340 KB')
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe('1.3 MB')
  })
})
