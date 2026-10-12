import { describe, it, expect } from 'vitest'
import { evidenceStorageKey, readStorageEnv } from '@/lib/evidence/storage'

describe('readStorageEnv', () => {
  it('is off when no bucket is set', () => {
    expect(readStorageEnv({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('refuses a bucket without credentials instead of silently using Postgres', () => {
    expect(() => readStorageEnv({ EVIDENCE_S3_BUCKET: 'b' } as unknown as NodeJS.ProcessEnv)).toThrow(/ACCESS_KEY/)
  })

  it('reads a full configuration and defaults the region to auto', () => {
    const env = {
      EVIDENCE_S3_BUCKET: 'b',
      EVIDENCE_S3_ACCESS_KEY_ID: 'id',
      EVIDENCE_S3_SECRET_ACCESS_KEY: 'secret',
      EVIDENCE_S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
    } as unknown as NodeJS.ProcessEnv
    expect(readStorageEnv(env)).toMatchObject({ bucket: 'b', region: 'auto', endpoint: 'https://x.r2.cloudflarestorage.com' })
  })
})

describe('evidenceStorageKey', () => {
  it('is deterministic per escrow, submitter and hash', () => {
    expect(evidenceStorageKey('e1', 'GABC', 'ff')).toBe('evidence/e1/GABC/ff')
  })
})
