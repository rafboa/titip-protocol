// Horizon API helpers — account balances and trustline checks
// Use SorobanRpc.Server for contract state, NOT Horizon

import { STELLAR_CONFIG } from '../config'

interface HorizonBalance {
  asset_type: string
  asset_code?: string
  asset_issuer?: string
  balance: string
}

interface HorizonAccountResponse {
  id: string
  account_id: string
  sequence: string
  balances: HorizonBalance[]
}

/**
 * Fetch account balances from Horizon.
 * Returns null if the account doesn't exist (not funded).
 */
export async function getAccountBalances(
  address: string
): Promise<HorizonBalance[] | null> {
  try {
    const response = await fetch(
      `${STELLAR_CONFIG.horizonUrl}/accounts/${address}`
    )

    if (response.status === 404) {
      return null // Account not funded
    }

    if (!response.ok) {
      throw new Error(`Horizon error: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as HorizonAccountResponse
    return data.balances
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('404')) {
      return null
    }
    throw error
  }
}

/**
 * Get the USDC balance for an account.
 * Returns "0" if no trustline exists, null if account doesn't exist.
 */
export async function getUsdcBalance(address: string): Promise<string | null> {
  const balances = await getAccountBalances(address)
  if (!balances) return null

  const usdcBalance = balances.find(
    (b) =>
      b.asset_code === STELLAR_CONFIG.usdc.code &&
      b.asset_issuer === STELLAR_CONFIG.usdc.issuer
  )

  return usdcBalance?.balance ?? '0'
}

/**
 * Check if an account has a USDC trustline.
 */
export async function hasUsdcTrustline(address: string): Promise<boolean> {
  const balances = await getAccountBalances(address)
  if (!balances) return false

  return balances.some(
    (b) =>
      b.asset_code === STELLAR_CONFIG.usdc.code &&
      b.asset_issuer === STELLAR_CONFIG.usdc.issuer
  )
}
