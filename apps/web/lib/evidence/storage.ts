// Evidence bytes in S3-compatible object storage (Cloudflare R2, AWS S3, MinIO).
//
// Optional: when EVIDENCE_S3_BUCKET is unset, evidence stays in Postgres (evidence_blobs) exactly as
// before. Rows written with object storage carry a `storageKey` and no blob; rows without one are
// read from Postgres, so both kinds coexist. Server-only: never import this from a client component.

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

type StorageEnv = {
  bucket: string
  region: string
  endpoint: string | undefined
  accessKeyId: string
  secretAccessKey: string
}

export function readStorageEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv | null {
  const bucket = env.EVIDENCE_S3_BUCKET
  if (!bucket) return null
  const accessKeyId = env.EVIDENCE_S3_ACCESS_KEY_ID
  const secretAccessKey = env.EVIDENCE_S3_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    // A half-configured bucket must not silently fall back to Postgres.
    throw new Error('EVIDENCE_S3_BUCKET is set but EVIDENCE_S3_ACCESS_KEY_ID / EVIDENCE_S3_SECRET_ACCESS_KEY are missing')
  }
  return {
    bucket,
    // R2 accepts "auto"; AWS needs the real region.
    region: env.EVIDENCE_S3_REGION ?? 'auto',
    endpoint: env.EVIDENCE_S3_ENDPOINT,
    accessKeyId,
    secretAccessKey,
  }
}

export function isObjectStorageConfigured(): boolean {
  return readStorageEnv() !== null
}

/** Deterministic key, so re-uploading the same file overwrites the same object. */
export function evidenceStorageKey(escrowId: string, submitter: string, sha256: string): string {
  return `evidence/${escrowId}/${submitter}/${sha256}`
}

let cached: { client: S3Client; bucket: string } | null = null

function getClient(): { client: S3Client; bucket: string } {
  if (cached) return cached
  const env = readStorageEnv()
  if (!env) throw new Error('Object storage is not configured')
  cached = {
    bucket: env.bucket,
    client: new S3Client({
      region: env.region,
      endpoint: env.endpoint,
      // R2 and MinIO need path-style addressing when a custom endpoint is used.
      forcePathStyle: env.endpoint !== undefined,
      credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    }),
  }
  return cached
}

export async function putEvidenceObject(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const { client, bucket } = getClient()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mimeType }))
}

export async function getEvidenceObject(key: string): Promise<Uint8Array | null> {
  const { client, bucket } = getClient()
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return res.Body ? await res.Body.transformToByteArray() : null
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) return null
    throw err
  }
}

/** Best effort: a leftover object is harmless (private bucket), a failed delete must not fail the upload. */
export async function deleteEvidenceObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    const { client, bucket } = getClient()
    await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } })
    )
  } catch (err: unknown) {
    console.error('[evidence] failed to delete objects:', err)
  }
}
