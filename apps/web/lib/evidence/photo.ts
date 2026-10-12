// Prepares an evidence photo in the browser before it is hashed and uploaded.
//
// Re-encoding through a canvas drops every metadata block (EXIF with GPS position, camera and
// owner data, thumbnails) and applies the orientation once, so the other party and the arbiter see
// the picture and nothing else. What gets hashed and committed on-chain is the result, not the
// original file. The server still only accepts what it can verify by magic bytes, so a direct API
// upload can carry metadata; this step is the browser's job.

import { MAX_EVIDENCE_BYTES } from './file'

/** Largest file the browser will try to process; the output is what has to fit the server limit. */
export const MAX_PHOTO_INPUT_BYTES = 25 * 1024 * 1024

/** Longest side of the output. Enough to read chat screenshots and a parcel label. */
export const MAX_PHOTO_EDGE = 2560

const MIN_PHOTO_EDGE = 800

export class PhotoError extends Error {
  constructor(public readonly code: 'DECODE' | 'TOO_LARGE', message: string) {
    super(message)
    this.name = 'PhotoError'
  }
}

/** Scales (width, height) so the longest side is at most maxEdge. Never upscales, never below 1px. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** What to produce for an input type: PNG stays lossless (screenshots), everything else becomes JPEG. */
export function outputTypeFor(inputType: string): 'image/png' | 'image/jpeg' {
  return inputType === 'image/png' ? 'image/png' : 'image/jpeg'
}

export type EncodingAttempt = { edge: number; quality: number }

/**
 * The attempts to make, in order, until one fits the size limit: full quality at the full edge first,
 * then lower JPEG quality, then smaller dimensions. PNG has no quality knob, so it only shrinks.
 */
export function encodingAttempts(type: 'image/png' | 'image/jpeg'): EncodingAttempt[] {
  const qualities = type === 'image/png' ? [1] : [0.9, 0.8, 0.7]
  const edges = [MAX_PHOTO_EDGE, 2048, 1600, 1280, 1024, MIN_PHOTO_EDGE]
  const attempts: EncodingAttempt[] = []
  for (const edge of edges) {
    for (const quality of qualities) attempts.push({ edge, quality })
  }
  return attempts
}

/** "340 KB" / "1.2 MB" for the size shown after resizing. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Returns a metadata-free copy of the photo that fits the server limit, or throws a PhotoError.
 * Browser-only (createImageBitmap + canvas).
 */
export async function prepareEvidencePhoto(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    // 'from-image' applies the EXIF orientation; the canvas output then carries no orientation tag.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoError('DECODE', 'The photo could not be decoded')
  }

  try {
    const type = outputTypeFor(file.type)
    for (const { edge, quality } of encodingAttempts(type)) {
      const size = fitWithin(bitmap.width, bitmap.height, edge)
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) throw new PhotoError('DECODE', 'The photo could not be processed')
      if (type === 'image/jpeg') {
        // JPEG has no transparency: a transparent PNG/WebP would turn black without a background.
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, size.width, size.height)
      }
      context.drawImage(bitmap, 0, 0, size.width, size.height)

      const blob = await canvasToBlob(canvas, type, quality)
      if (blob && blob.size > 0 && blob.size <= MAX_EVIDENCE_BYTES) {
        const extension = type === 'image/png' ? 'png' : 'jpg'
        return new File([blob], `evidence-${Date.now()}.${extension}`, { type })
      }
    }
    throw new PhotoError('TOO_LARGE', 'The photo is still too large after resizing')
  } finally {
    bitmap.close()
  }
}
