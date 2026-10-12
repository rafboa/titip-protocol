// apps/oracle/src/stellar/quorum.ts
// Pure decision logic for releasing a delivery through the contract's M-of-N oracle set.
// Kept free of I/O so it can be unit tested without an RPC node.

export type OracleSetState = {
  oracles: string[]
  threshold: number
}

export type DeliveryContext = {
  /** Escrow status as reported by the contract ("Shipped", "Delivered", ...). */
  status: string
  /** The contract's M-of-N set, or null while it still uses the single legacy oracle. */
  oracleSet: OracleSetState | null
  /** Oracles that already approved this escrow's delivery. */
  approvals: string[]
  /** This node's public key. */
  me: string
}

export type DeliveryStep =
  /** Funds were already released (by this node earlier, or by the other oracles). */
  | { kind: 'already-delivered' }
  /** The escrow cannot be delivered from its current on-chain status. */
  | { kind: 'wrong-status'; status: string }
  /** No oracle set: call confirm_delivery (the contract checks this node is the oracle). */
  | { kind: 'confirm-delivery' }
  /** An oracle set exists and this node's key is not part of it. */
  | { kind: 'not-in-set' }
  /** This node already approved and the quorum is not reached; nothing to do until others act. */
  | { kind: 'waiting'; approvals: number; threshold: number }
  /** Submit approve_delivery. */
  | { kind: 'approve' }

export function decideDeliveryStep(ctx: DeliveryContext): DeliveryStep {
  if (ctx.status === 'Delivered') return { kind: 'already-delivered' }
  if (ctx.status !== 'Shipped') return { kind: 'wrong-status', status: ctx.status }

  const set = ctx.oracleSet
  if (!set) return { kind: 'confirm-delivery' }
  if (!set.oracles.includes(ctx.me)) return { kind: 'not-in-set' }

  // Approvals from oracles that have since left the set do not count (same rule as the contract).
  const valid = ctx.approvals.filter((a) => set.oracles.includes(a)).length
  const alreadyApproved = ctx.approvals.includes(ctx.me)

  // Calling again once the quorum is met (e.g. the threshold was lowered) lets the contract
  // re-evaluate and release; calling again while still short would only waste fees.
  if (alreadyApproved && valid < set.threshold) {
    return { kind: 'waiting', approvals: valid, threshold: set.threshold }
  }
  return { kind: 'approve' }
}

/**
 * True when the web app's /api/oracle/confirm 409 body says the escrow is already DELIVERED, i.e.
 * another oracle node already synced this delivery.
 */
export function isAlreadyDeliveredResponse(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body)
    const error = (parsed as { error?: unknown } | null)?.error
    return typeof error === 'string' && error.includes('status "DELIVERED"')
  } catch {
    return false
  }
}

/** Parses the decoded value of the contract's `get_oracle_set` (an Option<OracleSet>). */
export function parseOracleSet(value: unknown): OracleSetState | null {
  if (typeof value !== 'object' || value === null) return null
  const { oracles, threshold } = value as { oracles?: unknown; threshold?: unknown }
  if (!Array.isArray(oracles) || typeof threshold !== 'number') return null
  if (!oracles.every((o) => typeof o === 'string')) return null
  return { oracles: oracles as string[], threshold }
}

/** Parses the decoded value of `get_delivery_approvals` (Vec<Address>). */
export function parseApprovals(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}
