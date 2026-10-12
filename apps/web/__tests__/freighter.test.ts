import { describe, it, expect, beforeEach, vi } from 'vitest'

const freighter = vi.hoisted(() => ({
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  setAllowed: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  signAuthEntry: vi.fn(),
}))
vi.mock('@stellar/freighter-api', () => freighter)
vi.mock('@/lib/stellar/config', () => ({ STELLAR_CONFIG: { network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015' } }))

import { FREIGHTER_RESPONSE_TIMEOUT_MS, FreighterError, checkConnection, signTx } from '@/lib/stellar/freighter'

const never = () => new Promise<never>(() => {})

beforeEach(() => {
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('Freighter without the extension (it never answers)', () => {
  it('signTx fails with NOT_INSTALLED instead of hanging', async () => {
    vi.useFakeTimers()
    freighter.getNetwork.mockReturnValue(never())
    const result = signTx('XDR').catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(FREIGHTER_RESPONSE_TIMEOUT_MS)
    const err = await result
    expect(err).toBeInstanceOf(FreighterError)
    expect((err as FreighterError).code).toBe('NOT_INSTALLED')
    expect(freighter.signTransaction).not.toHaveBeenCalled()
  })

  it('checkConnection answers false instead of hanging', async () => {
    vi.useFakeTimers()
    freighter.isConnected.mockReturnValue(never())
    const result = checkConnection()
    await vi.advanceTimersByTimeAsync(FREIGHTER_RESPONSE_TIMEOUT_MS)
    expect(await result).toBe(false)
  })
})

describe('Freighter with the extension', () => {
  it('does not time out the signature itself, which waits for the user', async () => {
    vi.useFakeTimers()
    freighter.getNetwork.mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'x' })
    let approve: (v: { signedTxXdr: string }) => void = () => {}
    freighter.signTransaction.mockReturnValue(new Promise((resolve) => (approve = resolve)))
    const result = signTx('XDR')
    await vi.advanceTimersByTimeAsync(FREIGHTER_RESPONSE_TIMEOUT_MS * 10)
    approve({ signedTxXdr: 'SIGNED' })
    expect(await result).toBe('SIGNED')
  })

  it('still reports the wrong network', async () => {
    freighter.getNetwork.mockResolvedValue({ network: 'PUBLIC', networkPassphrase: 'x' })
    await expect(signTx('XDR')).rejects.toMatchObject({ code: 'WRONG_NETWORK' })
  })
})
