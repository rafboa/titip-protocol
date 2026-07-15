/**
 * lib/stellar/contracts/index.ts
 *
 * Re-exports the escrow contract wrappers. If NEXT_PUBLIC_USE_MOCK_CONTRACT=true,
 * delegates to mock-escrow.ts for demo contingency. Otherwise uses the real
 * Soroban contract wrappers in escrow.ts.
 *
 * IMPORTANT: All imports across the app should use this file, not escrow.ts
 * directly, to ensure the mock switch works. However, for the MVP hackathon
 * the existing direct imports from escrow.ts are fine — the mock is only
 * needed if we switch the env var during the demo.
 *
 * // v1.1: Refactor all existing imports to use this barrel (but claude.md
 * // discourages barrel files, so only do it if the mock is actually needed)
 */

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT === 'true'

// Dynamic re-export based on env — since Next.js statically analyzes
// process.env.NEXT_PUBLIC_* at build time, this is tree-shaken correctly.
export async function getContractModule() {
  if (USE_MOCK) {
    return await import('./mock-escrow')
  }
  return await import('./escrow')
}
