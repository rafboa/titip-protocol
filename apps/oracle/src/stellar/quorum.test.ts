import { describe, it, expect } from 'vitest'
import {
  decideDeliveryStep,
  eventTypeForDeliveryStep,
  isRetryableSubmitError,
  isAlreadyDeliveredResponse,
  parseApprovals,
  parseOracleSet,
  type DeliveryContext,
} from './quorum.js'

const ME = 'GME'
const A = 'GA'
const B = 'GB'

const ctx = (overrides: Partial<DeliveryContext> = {}): DeliveryContext => ({
  status: 'Shipped',
  oracleSet: { oracles: [ME, A, B], threshold: 2 },
  approvals: [],
  me: ME,
  ...overrides,
})

describe('decideDeliveryStep', () => {
  it('does nothing when the funds were already released', () => {
    expect(decideDeliveryStep(ctx({ status: 'Delivered' }))).toEqual({ kind: 'already-delivered' })
  })

  it.each(['Pending', 'Funded', 'Refunded', 'Disputed'])('refuses a %s escrow', (status) => {
    expect(decideDeliveryStep(ctx({ status }))).toEqual({ kind: 'wrong-status', status })
  })

  it('uses confirm_delivery when no oracle set exists (legacy single oracle)', () => {
    expect(decideDeliveryStep(ctx({ oracleSet: null }))).toEqual({ kind: 'confirm-delivery' })
  })

  it('refuses to act when this node is not in the set', () => {
    expect(decideDeliveryStep(ctx({ oracleSet: { oracles: [A, B], threshold: 2 } }))).toEqual({
      kind: 'not-in-set',
    })
  })

  it('approves when this node has not approved yet', () => {
    expect(decideDeliveryStep(ctx())).toEqual({ kind: 'approve' })
    expect(decideDeliveryStep(ctx({ approvals: [A] }))).toEqual({ kind: 'approve' })
  })

  it('waits (no wasted transaction) after approving while the quorum is not reached', () => {
    expect(decideDeliveryStep(ctx({ approvals: [ME] }))).toEqual({
      kind: 'waiting',
      approvals: 1,
      threshold: 2,
    })
  })

  it('does not count approvals from oracles that left the set', () => {
    // GGONE approved but is no longer in the set: only this node counts, so 1 < 2.
    expect(decideDeliveryStep(ctx({ approvals: [ME, 'GGONE'] }))).toEqual({
      kind: 'waiting',
      approvals: 1,
      threshold: 2,
    })
  })

  it('calls again once the quorum is already met so the contract can release', () => {
    // The threshold was lowered after the approvals were collected.
    const lowered = ctx({ approvals: [ME], oracleSet: { oracles: [ME, A, B], threshold: 1 } })
    expect(decideDeliveryStep(lowered)).toEqual({ kind: 'approve' })
  })

  it('a 1-of-1 set approves straight away', () => {
    expect(decideDeliveryStep(ctx({ oracleSet: { oracles: [ME], threshold: 1 } }))).toEqual({
      kind: 'approve',
    })
  })
})

describe('isAlreadyDeliveredResponse', () => {
  it('recognises the web app 409 for an escrow another node already synced', () => {
    const body = JSON.stringify({
      error: 'Cannot confirm delivery for escrow with status "DELIVERED". Expected "SHIPPED".',
    })
    expect(isAlreadyDeliveredResponse(body)).toBe(true)
  })

  it('does not hide other conflicts or non-JSON bodies', () => {
    const refunded = JSON.stringify({ error: 'Cannot confirm delivery for escrow with status "REFUNDED".' })
    expect(isAlreadyDeliveredResponse(refunded)).toBe(false)
    expect(isAlreadyDeliveredResponse('<html>bad gateway</html>')).toBe(false)
    expect(isAlreadyDeliveredResponse('null')).toBe(false)
    expect(isAlreadyDeliveredResponse('')).toBe(false)
  })
})

describe('parsers', () => {
  it('parseOracleSet reads a decoded Option<OracleSet>', () => {
    expect(parseOracleSet({ oracles: [ME, A], threshold: 2 })).toEqual({ oracles: [ME, A], threshold: 2 })
  })

  it('parseOracleSet treats None and malformed values as no set', () => {
    expect(parseOracleSet(null)).toBeNull()
    expect(parseOracleSet(undefined)).toBeNull()
    expect(parseOracleSet({ oracles: 'x', threshold: 2 })).toBeNull()
    expect(parseOracleSet({ oracles: [1, 2], threshold: 2 })).toBeNull()
    expect(parseOracleSet({ oracles: [ME] })).toBeNull()
  })

  it('parseApprovals keeps only strings', () => {
    expect(parseApprovals([ME, A])).toEqual([ME, A])
    expect(parseApprovals(null)).toEqual([])
    expect(parseApprovals([ME, 3, null])).toEqual([ME])
  })

  it('eventTypeForDeliveryStep records only a transaction this node sent', () => {
    const tx = 'a'.repeat(64)
    expect(eventTypeForDeliveryStep('approve', tx)).toBe('DELIVERY_SUBMITTED')
    expect(eventTypeForDeliveryStep('confirm-delivery', tx)).toBe('DELIVERY_SUBMITTED')
    // Re-polled every cycle without sending anything: no new row.
    expect(eventTypeForDeliveryStep('waiting', null)).toBeNull()
    expect(eventTypeForDeliveryStep('already-delivered', null)).toBeNull()
    // Lost the race to the final approval: our tx failed, the other node's release counts.
    expect(eventTypeForDeliveryStep('approve', null)).toBeNull()
  })

  it('isRetryableSubmitError retries failed transactions only', () => {
    expect(isRetryableSubmitError(new Error('approve_delivery did not succeed: FAILED'))).toBe(true)
    expect(isRetryableSubmitError(new Error('approve_delivery submission failed: {"x":1}'))).toBe(true)
    expect(isRetryableSubmitError(new Error('Oracle key GX is not in the oracle set'))).toBe(false)
    expect(isRetryableSubmitError(new Error('get_oracle_set simulation failed: HostError'))).toBe(false)
    expect(isRetryableSubmitError('weird')).toBe(false)
  })
})
