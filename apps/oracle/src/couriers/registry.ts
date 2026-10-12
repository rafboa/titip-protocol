// apps/oracle/src/couriers/registry.ts
// Maps a courier code to its adapter. Pure (keys and network are passed in) so it can be tested.

import { jntAdapter } from './jnt.js'
import { jneAdapter } from './jne.js'
import { sicepatAdapter } from './sicepat.js'
import { mockAdapter } from './mock.js'
import type { CourierAdapter } from './types.js'

export type CourierKeys = {
  JNT_API_KEY?: string | undefined
  JNE_API_KEY?: string | undefined
  SICEPAT_API_KEY?: string | undefined
}

/**
 * Falls back to the mock adapter (always "delivered") when the real API key is absent or the
 * courier is unknown, which is only acceptable on testnet. On mainnet a mock delivery would
 * release real funds without a parcel, so this throws instead and the job fails/retries.
 * TODO(mainnet): add real adapters for the remaining couriers (Anteraja, Pos) and drop the mock.
 */
export function resolveAdapter(code: string, keys: CourierKeys, network: 'testnet' | 'mainnet'): CourierAdapter {
  const upper = code.toUpperCase()
  const adapter =
    upper === 'JNT' && keys.JNT_API_KEY
      ? jntAdapter
      : upper === 'JNE' && keys.JNE_API_KEY
        ? jneAdapter
        : upper === 'SICEPAT' && keys.SICEPAT_API_KEY
          ? sicepatAdapter
          : mockAdapter

  if (adapter === mockAdapter && network === 'mainnet') {
    throw new Error(`No real courier adapter for "${code}" (missing API key or unsupported); the mock adapter is disabled on mainnet`)
  }
  return adapter
}
