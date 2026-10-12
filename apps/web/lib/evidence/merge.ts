// Joins what the contract committed (the source of truth) with the files this app stored.

export type ChainEvidence = {
  submitter: string
  /** Lowercase hex SHA-256. */
  hash: string
  uri: string
  ledger: number
}

export type StoredEvidence = {
  id: string
  submitter: string
  sha256: string
  mimeType: string
  sizeBytes: number
}

/** What the UI gets for one committed item: roles instead of raw Stellar addresses. */
export type EvidenceItem = {
  /** Position in the contract's list (oldest first). */
  index: number
  role: 'BUYER' | 'SELLER'
  /** True when the viewer is the one who committed it. */
  mine: boolean
  sha256: string
  ledger: number
  /** Id to download the file by; null when this app holds no file for the committed hash. */
  fileId: string | null
  mimeType: string | null
  sizeBytes: number | null
}

/**
 * One entry per item committed on-chain. An item with no stored file stays in the list as
 * unavailable (fileId null): the commitment exists even if the file is gone.
 * `viewer` is null for the arbiter reading through the internal key.
 */
export function buildEvidenceList(
  chain: ChainEvidence[],
  stored: StoredEvidence[],
  escrow: { buyerAddress: string; sellerAddress: string },
  viewer: string | null
): EvidenceItem[] {
  const items: EvidenceItem[] = []
  chain.forEach((item, index) => {
    const role = item.submitter === escrow.buyerAddress ? 'BUYER' : item.submitter === escrow.sellerAddress ? 'SELLER' : null
    if (!role) return
    const file = stored.find((s) => s.submitter === item.submitter && s.sha256 === item.hash)
    items.push({
      index,
      role,
      mine: viewer !== null && item.submitter === viewer,
      sha256: item.hash,
      ledger: item.ledger,
      fileId: file?.id ?? null,
      mimeType: file?.mimeType ?? null,
      sizeBytes: file?.sizeBytes ?? null,
    })
  })
  return items
}

/** How many of the per-party slots this address has used on-chain. */
export function slotsUsed(chain: ChainEvidence[], address: string): number {
  return chain.filter((item) => item.submitter === address).length
}
