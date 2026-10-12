// Pure helpers for dispute evidence files. No I/O, so the API routes, the UI and the tests share them.
//
// The file itself never goes on-chain: the contract stores the SHA-256 of the bytes plus a short
// pointer (`uri`). The server stores the bytes and hashes them itself; the hash a client sends is only
// a check that the upload arrived intact.

/** Largest accepted file. Vercel caps a request body at ~4.5 MB and the upload goes through a route. */
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024

/** Mirrors the contract's per-party limit (MAX_EVIDENCE_PER_PARTY in lib.rs). */
export const MAX_EVIDENCE_PER_PARTY = 10

/**
 * Uploads a party may leave unsigned at once. Abandoned ones (a rejected signature, a closed tab) are
 * pruned oldest first when a new upload would exceed this, so they can never use up the real limit.
 */
export const MAX_PENDING_UPLOADS_PER_PARTY = 3

/** The contract rejects pointers longer than this (MAX_EVIDENCE_URI_LEN in lib.rs). */
export const MAX_EVIDENCE_URI_BYTES = 128

export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number]

const URI_PREFIX = 'titip:evidence/'

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, i) => bytes[offset + i] === value)
}

/**
 * The image type of the bytes by their magic number, or null. The browser-reported MIME type is
 * never trusted: the stored type is what gets served back.
 */
export function detectEvidenceMime(bytes: Uint8Array): EvidenceMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // WebP is a RIFF container: "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  return null
}

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/** Host-free pointer stored on-chain, so a domain or env change never breaks it. */
export function evidenceUri(evidenceId: string): string {
  const uri = `${URI_PREFIX}${evidenceId}`
  if (new TextEncoder().encode(uri).length > MAX_EVIDENCE_URI_BYTES) {
    throw new Error('Evidence pointer is longer than the contract allows')
  }
  return uri
}

export function parseEvidenceUri(uri: string): string | null {
  return uri.startsWith(URI_PREFIX) && uri.length > URI_PREFIX.length ? uri.slice(URI_PREFIX.length) : null
}

/** Lowercase hex of a SHA-256 digest computed in the browser (Web Crypto). */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
