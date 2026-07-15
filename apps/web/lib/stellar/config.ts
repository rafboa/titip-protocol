// Stellar network configuration for Titip Protocol
// This file is the single source of truth for all Stellar network values

export const STELLAR_CONFIG = {
  // TODO(mainnet): Switch these to mainnet values before production deploy
  network: (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet') as 'testnet' | 'mainnet',
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '',
  networkPassphrase:
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet') === 'mainnet'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015',
  usdc: {
    code: process.env.NEXT_PUBLIC_USDC_ASSET_CODE ?? 'USDC',
    // TODO(mainnet): Switch to mainnet issuer GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
    issuer:
      process.env.NEXT_PUBLIC_USDC_ISSUER ??
      'GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2',
  },
  // Minimum fee multiplier for contract calls — BASE_FEE * 100
  feeMultiplier: 100,
  // Ledger constants
  ledgersPerMinute: 12, // ~5 seconds per ledger
  // Default escrow timeout: 48 hours in ledgers
  defaultTimeoutLedgers: 12 * 60 * 48, // 34,560 ledgers ≈ 48h
  // Minimum timeout: ~83 minutes (1000 ledgers) as per contract spec
  minimumTimeoutLedgers: 1000,
} as const

export type StellarNetwork = typeof STELLAR_CONFIG.network
