// The contract admin as the chain reports it (`get_config().admin`), cached for a few minutes.
// Kept apart from the request gate (access.ts) so the evidence access code can ask the same question.

import { getContractAdmin } from '@/lib/stellar/contracts/escrow'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

const ADMIN_CACHE_MS = 5 * 60 * 1000
const cache = new Map<string, { admin: string; at: number }>()

/** The contract admin, cached per contract address. Throws when the chain cannot be read. */
export async function getAdminAddress(now = Date.now()): Promise<string> {
  const key = STELLAR_CONFIG.contractAddress
  const hit = cache.get(key)
  if (hit && now - hit.at < ADMIN_CACHE_MS) return hit.admin
  const admin = await getContractAdmin()
  cache.set(key, { admin, at: now })
  return admin
}

/** Test hook: forget the cached admin. */
export function clearAdminCache(): void {
  cache.clear()
}

export async function isContractAdmin(address: string): Promise<boolean> {
  return (await getAdminAddress()) === address
}
