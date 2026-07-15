// Shared utility functions for the Titip Protocol web app

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge class names, resolving conflicting Tailwind utility classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Format a number as Indonesian Rupiah.
 * Example: 50000 → "Rp 50.000"
 */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Format USDC amount with proper decimals.
 * Example: 50.1234567 → "50.12 USDC"
 */
export function formatUsdc(amount: number | string, decimals = 2): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return `${num.toFixed(decimals)} USDC`
}

/**
 * Convert USDC base units (7 decimals) to human-readable.
 * Example: 500000000n → 50.0
 */
export function baseUnitsToUsdc(baseUnits: bigint): number {
  return Number(baseUnits) / 10_000_000
}

/**
 * Convert human-readable USDC to base units (7 decimals).
 * Example: 50.0 → 500000000n
 */
export function usdcToBaseUnits(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10_000_000))
}

/**
 * Truncate a Stellar address for display.
 * Example: "GABCDEF...UVWXYZ" → "GABC...WXYZ"
 */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

/**
 * Format a relative time string.
 * Example: 3600000 → "1 hour ago"
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const then = typeof date === 'string' ? new Date(date) : date
  const diffMs = now.getTime() - then.getTime()

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

/**
 * Format a countdown timer for escrow timeout.
 * Example: futureDate → "23h 45m remaining"
 */
export function formatCountdown(timeoutAt: Date | string): string {
  const target = typeof timeoutAt === 'string' ? new Date(timeoutAt) : timeoutAt
  const now = new Date()
  const diffMs = target.getTime() - now.getTime()

  if (diffMs <= 0) return 'Expired'

  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h remaining`
  }

  return `${hours}h ${minutes}m remaining`
}

/**
 * Build a Stellar Expert transaction URL.
 */
export function stellarExpertTxUrl(txHash: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`
}

/**
 * Build a Stellar Expert account URL.
 */
export function stellarExpertAccountUrl(address: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  return `https://stellar.expert/explorer/${network}/account/${address}`
}
