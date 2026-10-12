import { describe, it, expect, vi } from 'vitest'

// The real adapters import the env-validated config, which exits the process when env is missing.
vi.mock('../config.js', () => ({ config: {} }))

import { resolveAdapter } from './registry.js'
import { mockAdapter } from './mock.js'
import { jntAdapter } from './jnt.js'

const noKeys = {}

describe('resolveAdapter', () => {
  it('uses the real adapter when its API key is set', () => {
    expect(resolveAdapter('jnt', { JNT_API_KEY: 'k' }, 'mainnet')).toBe(jntAdapter)
    expect(resolveAdapter('JNT', { JNT_API_KEY: 'k' }, 'testnet')).toBe(jntAdapter)
  })

  it('falls back to the mock adapter on testnet (no key, or a courier without an adapter)', () => {
    expect(resolveAdapter('JNT', noKeys, 'testnet')).toBe(mockAdapter)
    expect(resolveAdapter('ANTERAJA', noKeys, 'testnet')).toBe(mockAdapter)
    expect(resolveAdapter('POS_INDONESIA', noKeys, 'testnet')).toBe(mockAdapter)
  })

  it('refuses the mock adapter on mainnet so a fake delivery can never release funds', () => {
    expect(() => resolveAdapter('JNT', noKeys, 'mainnet')).toThrow(/disabled on mainnet/)
    expect(() => resolveAdapter('ANTERAJA', { JNT_API_KEY: 'k' }, 'mainnet')).toThrow(/disabled on mainnet/)
  })
})
