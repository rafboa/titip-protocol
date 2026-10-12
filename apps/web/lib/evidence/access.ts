// Who may touch dispute evidence.
//
// - Buyer and seller (SEP-10 session): list, upload, commit, download.
// - The arbiter: the contract admin (signed in, see /admin/disputes) and the internal API key may READ the
//   list and the files. They can never upload or commit.

import crypto from 'crypto'
import { getAuthorizationHeader, verifyJwt } from '@/lib/auth/sep10'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import { isContractAdmin } from '@/lib/admin/chain-admin'

export type EvidenceCaller = { kind: 'party'; address: string } | { kind: 'arbiter' }

/** True when the request carries `Authorization: Bearer <ORACLE_INTERNAL_API_KEY>`. */
export function hasInternalApiKey(request: Request): boolean {
  const expected = process.env.ORACLE_INTERNAL_API_KEY
  const header = request.headers.get('authorization')
  if (!expected || !header) return false
  const provided = Buffer.from(header)
  const wanted = Buffer.from(`Bearer ${expected}`)
  return provided.length === wanted.length && crypto.timingSafeEqual(provided, wanted)
}

/** The signed-in buyer/seller, or null. Used by every route that writes. */
export async function resolveParty(request: Request): Promise<{ kind: 'party'; address: string } | null> {
  const header = getAuthorizationHeader(request)
  if (!header) return null
  try {
    const payload = await verifyJwt(header)
    return { kind: 'party', address: payload.address }
  } catch {
    return null
  }
}

/** A signed-in user, or the arbiter by internal key. Used by the read-only routes. */
export async function resolveEvidenceReader(request: Request): Promise<EvidenceCaller | null> {
  if (hasInternalApiKey(request)) return { kind: 'arbiter' }
  return resolveParty(request)
}

export function isEscrowParty(escrow: { buyerAddress: string; sellerAddress: string }, address: string): boolean {
  return address === escrow.buyerAddress || address === escrow.sellerAddress
}

/**
 * Evidence is read from and written to the contract in NEXT_PUBLIC_CONTRACT_ADDRESS, and escrow ids
 * restart at 1 on every deployment. An escrow row created on an older contract would otherwise show
 * (or receive) the evidence of an unrelated escrow that has the same numeric id.
 */
export function isOnCurrentContract(escrow: { contractAddress: string }): boolean {
  return escrow.contractAddress === STELLAR_CONFIG.contractAddress
}

export const WRONG_CONTRACT_ERROR = 'Evidence is only available for escrows on the current contract'

/**
 * How a caller may read an escrow's evidence: as one of its parties, as the arbiter (the internal key,
 * or the signed-in contract admin who is not a party), or not at all.
 */
export async function evidenceReadRole(
  caller: EvidenceCaller,
  escrow: { buyerAddress: string; sellerAddress: string }
): Promise<'party' | 'arbiter' | null> {
  if (caller.kind === 'arbiter') return 'arbiter'
  if (isEscrowParty(escrow, caller.address)) return 'party'
  try {
    return (await isContractAdmin(caller.address)) ? 'arbiter' : null
  } catch {
    return null // cannot prove the admin: fail closed
  }
}
