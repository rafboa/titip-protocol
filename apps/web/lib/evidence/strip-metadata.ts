// Lossless removal of location/camera metadata from evidence images, on the server.
//
// The browser already re-encodes photos (lib/evidence/photo.ts), but a direct API upload skips that.
// This drops metadata containers without touching pixel data, so the image looks identical. Colour
// profiles (JPEG APP2 / PNG iCCP / WebP ICCP) are kept because removing them changes how the picture
// is displayed. If the file cannot be parsed it is returned unchanged: the caller already validated
// the magic number, and a malformed file is never made "cleaner" by guessing.
//
// Pure functions, no I/O.

import type { EvidenceMimeType } from '@/lib/evidence/file'

/** Returns the same array instance when nothing was removed. */
export function stripImageMetadata(bytes: Uint8Array, mime: EvidenceMimeType): Uint8Array {
  try {
    if (mime === 'image/jpeg') return stripJpeg(bytes)
    if (mime === 'image/png') return stripPng(bytes)
    return stripWebp(bytes)
  } catch {
    return bytes
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

// ---- JPEG: drop APP1 (EXIF/XMP), APP3-APP15 (vendor/IPTC) and COM segments before the scan. ----
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)] // SOI
  let removed = false
  let i = 2
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('bad marker')
    const marker = bytes[i + 1]
    if (marker === 0xff) {
      i += 1 // fill byte
      continue
    }
    // Standalone markers have no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(i)) // EOI
      return removed ? concat(parts) : bytes
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    if (length < 2 || i + 2 + length > bytes.length) throw new Error('bad length')
    if (marker === 0xda) {
      // SOS: entropy-coded data follows; keep everything from here on.
      parts.push(bytes.subarray(i))
      return removed ? concat(parts) : bytes
    }
    const isMetadata = marker === 0xe1 || (marker >= 0xe3 && marker <= 0xef) || marker === 0xfe
    if (isMetadata) removed = true
    else parts.push(bytes.subarray(i, i + 2 + length))
    i += 2 + length
  }
  throw new Error('no SOS')
}

// ---- PNG: drop eXIf and text chunks (tEXt, zTXt, iTXt) and tIME. ----
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  let removed = false
  let i = 8
  let sawEnd = false
  while (i < bytes.length) {
    if (i + 12 > bytes.length) throw new Error('truncated chunk')
    const length = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
    const end = i + 12 + length // length + type + data + crc
    if (end > bytes.length) throw new Error('chunk overruns file')
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    if (PNG_DROP.has(type)) removed = true
    else parts.push(bytes.subarray(i, end))
    i = end
    if (type === 'IEND') {
      sawEnd = true
      break
    }
  }
  if (!sawEnd) throw new Error('no IEND')
  return removed ? concat(parts) : bytes
}

// ---- WebP: drop EXIF and XMP chunks, clear their flags in VP8X, fix the RIFF size. ----
function stripWebp(bytes: Uint8Array): Uint8Array {
  const fourcc = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
  const readU32 = (at: number) =>
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
  const riffEnd = 8 + readU32(4)
  if (riffEnd > bytes.length || riffEnd < 12) throw new Error('bad RIFF size')

  const parts: Uint8Array[] = []
  let removed = false
  let i = 12
  while (i + 8 <= riffEnd) {
    const type = fourcc(i)
    const size = readU32(i + 4)
    const end = i + 8 + size + (size % 2) // chunks are padded to even length
    if (end > riffEnd) throw new Error('chunk overruns file')
    if (type === 'EXIF' || type === 'XMP ') {
      removed = true
    } else if (type === 'VP8X') {
      const chunk = bytes.slice(i, end)
      chunk[8] &= ~(0x08 | 0x04) // EXIF (0x08) and XMP (0x04) flags
      parts.push(chunk)
    } else {
      parts.push(bytes.subarray(i, end))
    }
    i = end
  }
  if (!removed) return bytes

  const body = concat(parts)
  const header = bytes.slice(0, 12)
  const riffSize = 4 + body.length
  header[4] = riffSize & 0xff
  header[5] = (riffSize >>> 8) & 0xff
  header[6] = (riffSize >>> 16) & 0xff
  header[7] = (riffSize >>> 24) & 0xff
  return concat([header, body])
}
