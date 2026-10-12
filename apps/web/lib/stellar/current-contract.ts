// Every contract wrapper talks to NEXT_PUBLIC_CONTRACT_ADDRESS, and escrow ids restart at 1 on each
// deployment. A database row created on an older contract therefore points at an unrelated escrow with
// the same numeric id on the current one: routes must refuse to build or submit anything for it.

import { STELLAR_CONFIG } from './config'

export const OLD_CONTRACT_ERROR =
  'This escrow was created on an older contract and cannot be changed from this app'

export function isOnCurrentContract(escrow: { contractAddress: string }): boolean {
  return escrow.contractAddress === STELLAR_CONFIG.contractAddress
}
