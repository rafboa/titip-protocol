# Titip Protocol — AI Agent Instructions

This file is read by Claude Code, Cursor, GitHub Copilot, and any AI coding assistant working on this repository. Follow every rule here without exception.

---

## 1. Project Identity

**What it is:** Titip Protocol is a trustless escrow dApp on Stellar/Soroban for informal Indonesian social commerce. Payments into QRIS codes are held in a Soroban smart contract until a courier oracle confirms delivery.

**What problem it solves:** Non-delivery fraud in peer-to-peer WhatsApp/Instagram/TikTok commerce where buyers pay sellers upfront with no protection.

**Who uses it:** Indonesian buyers and sellers transacting outside formal marketplaces.

**The single most important architectural fact:** The Soroban contract is the source of truth for fund custody and escrow state. The PostgreSQL database is a cache/index for UI purposes. If they ever conflict, the on-chain state wins.

---

## 2. Repository Structure

```
titip-protocol/
├── apps/
│   ├── web/                          # Next.js 14 App Router (frontend + API)
│   │   ├── app/
│   │   │   ├── (auth)/connect/       # Freighter connect + SEP-10 auth
│   │   │   ├── (app)/dashboard/      # Escrow list
│   │   │   ├── (app)/escrow/new/     # Create escrow (QRIS scan)
│   │   │   └── (app)/escrow/[id]/    # Escrow detail
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn generated — NEVER EDIT
│   │   │   ├── escrow/               # Escrow-specific components
│   │   │   ├── qris/                 # QRIS scanner and preview
│   │   │   └── wallet/               # Freighter connection components
│   │   ├── hooks/                    # Custom React hooks
│   │   ├── lib/
│   │   │   ├── stellar/
│   │   │   │   ├── contracts/        # All Soroban contract calls go here
│   │   │   │   ├── horizon/          # All Horizon API calls go here
│   │   │   │   └── config.ts         # Network URLs, asset definitions
│   │   │   ├── qris/parser.ts        # EMVCo TLV parser + CRC16
│   │   │   └── auth/sep10.ts         # SEP-10 web auth helpers
│   │   ├── actions/                  # Next.js Server Actions
│   │   └── types/index.ts            # All shared TypeScript types
│   └── oracle/                       # Node.js courier polling service
│       └── src/
│           ├── couriers/             # J&T, JNE, SiCepat adapters
│           ├── queues/               # BullMQ queue definitions
│           ├── workers/              # BullMQ worker implementations
│           └── stellar/submit.ts     # Oracle signs + submits to Soroban
├── packages/
│   ├── contracts/                    # Soroban smart contract (Rust)
│   │   └── src/
│   │       ├── lib.rs                # Contract implementation
│   │       └── test.rs               # Contract unit tests
│   ├── db/
│   │   └── prisma/
│   │       ├── schema.prisma         # Database schema — single source of truth
│   │       └── migrations/           # Auto-generated migration files
│   └── shared-types/                 # TypeScript types shared across apps
├── docker-compose.yml
├── .env.example
├── plan.md                           # Full project plan
├── instruction.md                    # Setup instructions
└── claude.md                         # This file
```

---

## 3. Technology Stack Quick Reference

| Technology | Role |
|---|---|
| Next.js 14 (App Router) | Full-stack framework; SSR, RSC, Server Actions, API routes |
| TypeScript (strict) | All code. No JavaScript files. No `any`. |
| shadcn/ui + Tailwind CSS | All UI components. Radix primitives underneath. |
| Zustand | Wallet state only (`useWalletStore`) |
| TanStack Query (React Query) | All server state fetching and caching |
| Prisma | ORM for PostgreSQL. Generated types only. |
| PostgreSQL (Supabase) | Application database. Financial data requires ACID. |
| Soroban (Rust) | Smart contract: escrow state machine, fund custody |
| `@stellar/stellar-sdk` | All Stellar transaction building and submission |
| `@stellar/freighter-api` | Browser wallet connection and transaction signing |
| Stellar Horizon API | Account balances, payment history, fee estimation |
| Soroban RPC | Smart contract invocation and state reads |
| BullMQ + Redis | Oracle job queue for courier polling |
| Docker Compose | Local dev environment (DB, Redis, oracle service) |
| Vercel | Next.js deployment |
| Railway | Oracle service + PostgreSQL deployment |
| pnpm workspaces | Monorepo package management |
| v0.dev | Rapid shadcn component prototyping |
| Claude (Anthropic) | Primary AI for code generation and review |

---

## 4. Coding Conventions

### TypeScript

```typescript
// ✅ Correct
type EscrowStatus = 'PENDING' | 'FUNDED' | 'SHIPPED' | 'DELIVERED' | 'REFUNDED'
export type { EscrowStatus }

// ❌ Wrong
interface EscrowStatus { ... }          // use type, not interface (for unions/scalars)
export default function Component() {} // no default exports except Next.js page/layout
const x: any = ...                     // never use any
const x = value as SomeType            // avoid; narrow properly instead
```

- **Strict mode always on.** `"strict": true` in `tsconfig.json`. Non-negotiable.
- **Named exports only** — except `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx` (Next.js requires default exports for these).
- **`type` over `interface`** — except for objects that need declaration merging (rare).
- **File naming:** `kebab-case.ts` for utilities and hooks; `PascalCase.tsx` for components.
- **No barrel `index.ts` files** that re-export everything — causes circular dependencies.
- **`zod`** for all external input validation (API request bodies, QRIS payloads, form inputs).

### React / Next.js

```typescript
// ✅ Server Component (default — no directive needed)
export default async function EscrowPage({ params }: { params: { id: string } }) {
  const escrow = await getEscrow(params.id) // DB call in Server Component
  return <EscrowDetail escrow={escrow} />
}

// ✅ Client Component (only when needed)
'use client'
export function FundButton({ escrowId }: { escrowId: string }) {
  const { signTransaction } = useFreighter()
  // ...
}

// ❌ Wrong — don't fetch in Client Component if Server Component works
'use client'
export function EscrowPage() {
  const [data, setData] = useState(null)
  useEffect(() => { fetch('/api/escrow/...').then(...) }, []) // NEVER DO THIS
}
```

- **App Router only.** Never touch `pages/` directory.
- **Server Components by default.** Add `'use client'` only for: Freighter interactions, `useState`, `useEffect`, event handlers.
- **Server Actions** for all mutations (create escrow, fund, submit tracking).
- **`loading.tsx` and `error.tsx`** required for every route that fetches data.
- **Never `useEffect` for data fetching** — use Server Components or React Query.

### shadcn/ui

```typescript
// ✅ Correct — use shadcn and cn()
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function EscrowCard({ className }: { className?: string }) {
  return (
    <Card className={cn('border-border', className)}>
      <CardContent>...</CardContent>
    </Card>
  )
}

// ❌ Wrong — never modify ui/ files
// components/ui/button.tsx — DO NOT EDIT THIS FILE
```

- **Never modify `components/ui/`** — these are shadcn-generated and will be overwritten by CLI.
- **Custom components go in `components/`** (not `components/ui/`).
- **Always use `cn()`** from `@/lib/utils` for conditional class names.
- **Reach for shadcn first**, then Radix primitive, then custom implementation.

### Stellar / Soroban

```typescript
// ✅ Correct — always check network before building transactions
import { getNetwork } from '@stellar/freighter-api'
import { Networks, TransactionBuilder, BASE_FEE, Contract } from '@stellar/stellar-sdk'

async function buildFundTransaction(escrowId: bigint, amount: string) {
  const network = await getNetwork()
  if (network !== 'TESTNET') {
    throw new Error('Please switch Freighter to Testnet')
  }

  const networkPassphrase = Networks.TESTNET
  const server = new SorobanRpc.Server(process.env.NEXT_PUBLIC_SOROBAN_RPC_URL!)
  const account = await server.getAccount(publicKey)

  const contract = new Contract(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!)
  const tx = new TransactionBuilder(account, {
    fee: String(BASE_FEE * 100), // always set fee explicitly; 100x base for contract calls
    networkPassphrase,
  })
    .addOperation(contract.call('fund', xdr.ScVal.scvU64(escrowId)))
    .setTimeout(30)
    .build()

  return tx.toXDR()
}

// ❌ Wrong
const tx = new Transaction(...)  // don't build manually
fee: BASE_FEE                    // too low for contract calls; use BASE_FEE * 100
```

- **Always use `TransactionBuilder`** — never construct transactions manually.
- **Always set `fee` explicitly** — use `BASE_FEE * 100` minimum for contract calls.
- **Always handle these three Freighter errors:** `Freighter not installed`, `user rejected signing`, `network mismatch`.
- **All Soroban contract calls go in `lib/stellar/contracts/`** — never inline in components or API routes.
- **All Horizon API calls go in `lib/stellar/horizon/`** — use the SDK's `Horizon.Server` class.
- **Use `SorobanRpc.Server` for contract state** — NOT `Horizon.Server`.
- **Check USDC trustline before transfer** — `account.balances.find(b => b.asset_code === 'USDC')`.

### PostgreSQL / Prisma

```typescript
// ✅ Correct
import { prisma } from '@/lib/prisma'

// Multi-table write — always use transaction
const escrow = await prisma.$transaction(async (tx) => {
  const escrow = await tx.escrow.create({ data: { ... } })
  await tx.notification.create({ data: { escrowId: escrow.id, ... } })
  return escrow
})

// ❌ Wrong
const result = await prisma.$queryRaw`SELECT * FROM escrows WHERE ...`  // avoid raw SQL
const client = new PrismaClient()  // don't instantiate in components; use shared client
```

- **Never use raw SQL** unless Prisma cannot express the query (complex CTEs are the exception).
- **Always use `prisma.$transaction()`** for multi-table writes.
- **Migration naming:** `pnpm prisma migrate dev --name describe_change_in_snake_case`.
- **Never import Prisma client in client-side code** — DB access only via Server Actions or API Route Handlers.
- **Never commit `schema.prisma` changes without a corresponding migration file.**

### Oracle Service

```typescript
// ✅ Correct — always timeout and retry courier calls
async function fetchTrackingStatus(trackingNumber: string, courier: CourierCode) {
  const response = await fetch(courierUrl, {
    method: 'POST',
    body: JSON.stringify({ tracking: trackingNumber }),
    signal: AbortSignal.timeout(10_000), // 10 second timeout always
  })
  // ...
}

// ✅ Log every oracle event regardless of outcome
await prisma.oracleEvent.create({
  data: {
    escrowId,
    eventType: result.delivered ? 'DELIVERY_CONFIRMED' : 'POLL_NO_UPDATE',
    courierResponse: result.raw,
    oracleNodeId: process.env.ORACLE_NODE_ID ?? 'primary',
  },
})
```

- **All courier API calls must timeout at 10 seconds** — use `AbortSignal.timeout(10_000)`.
- **Retry with exponential backoff** — max 3 retries: 1min, 5min, 15min delays.
- **Log every oracle event to `oracle_events` table** regardless of outcome.
- **Oracle confirmations must be signed** with the oracle's Stellar keypair before calling the contract.
- **Never hardcode API keys** — only `process.env.*`.

---

## 5. Key Files and What They Do

| File | Purpose | Edit? |
|---|---|---|
| `packages/contracts/src/lib.rs` | Soroban escrow contract | Yes — core contract logic |
| `packages/contracts/src/test.rs` | Contract unit tests | Yes — add tests for every new function |
| `packages/db/prisma/schema.prisma` | Database schema | Yes — always generate migration after editing |
| `apps/web/lib/stellar/contracts/escrow.ts` | Soroban contract call wrappers | Yes — all contract interactions |
| `apps/web/lib/stellar/config.ts` | Network URLs, asset codes/issuers | Yes — change for mainnet switch |
| `apps/web/lib/qris/parser.ts` | EMVCo TLV parser + CRC16 | Yes — extend for new QRIS fields |
| `apps/web/lib/auth/sep10.ts` | SEP-10 challenge/verify | Rarely — only if auth flow changes |
| `apps/web/app/api/oracle/confirm/route.ts` | Oracle delivery callback | Carefully — security-critical |
| `apps/web/components/ui/*` | shadcn/ui generated components | **NEVER** — overwritten by CLI |
| `apps/oracle/src/couriers/jnt.ts` | J&T Express API adapter | Yes — update if API changes |
| `apps/oracle/src/couriers/jne.ts` | JNE API adapter | Yes |
| `apps/oracle/src/couriers/sicepat.ts` | SiCepat API adapter | Yes |
| `apps/oracle/src/stellar/submit.ts` | Oracle signs + submits to Soroban | Carefully — signing logic |
| `.env.example` | Environment variable template | Yes — add new vars here first |
| `docker-compose.yml` | Local service definitions | Yes — to add new services |

---

## 6. What the AI Should Always Do

- **Generate TypeScript types for every API response and Stellar transaction result.** Never return `any` from an API route.
- **Add `// TODO(mainnet):` comments** for anything that needs verification before mainnet deployment (asset issuers, RPC URLs, fee amounts).
- **Include error handling for all three Freighter failure modes** in every transaction-building function: not installed, user rejected, network mismatch.
- **Check if Prisma schema changes require a migration** before writing query code. If the model doesn't exist yet, note that `pnpm prisma migrate dev` must be run.
- **Wrap every Soroban RPC call in try/catch** with specific error type handling (`SorobanRpc.Api.SimulateTransactionErrorResponse`, network timeout, contract panic).
- **Suggest shadcn/ui components first** before suggesting custom implementations. Reach for `Dialog`, `Sheet`, `Alert`, `Toast`, `Badge` before writing custom markup.
- **Use `Server Actions` for mutations** — not client-side `fetch()` calls to API routes.
- **Use `React Query` for data fetching in Client Components** — not raw `fetch()` in `useEffect`.
- **When generating Prisma queries for financial data**, always use `Decimal` type (not `Float`) and `prisma.$transaction()` for multi-step writes.
- **Always add the `network guard`** before any Freighter signing call.

---

## 7. What the AI Should Never Do

- **Never use `fetch()` directly for Stellar operations** — always use `@stellar/stellar-sdk`.
- **Never store secret keys in code** or in `.env` files committed to git. Secret keys are `ORACLE_SECRET_KEY` and user keypairs. Only `NEXT_PUBLIC_*` vars are safe to reference in client code.
- **Never trust user-supplied QRIS payloads without CRC16 validation** — always run through `lib/qris/parser.ts` before using any extracted field.
- **Never call the courier oracle directly from the Next.js frontend** — all oracle interactions go through the oracle service's internal API.
- **Never use `useEffect` for data fetching** — use Server Components + React Query.
- **Never use `as any` or `@ts-ignore`** — fix the type properly.
- **Never modify files in `components/ui/`** — these are shadcn-generated.
- **Never deploy a Soroban contract change without updating the ABI types** in `packages/shared-types/contract-types.ts`.
- **Never skip the Freighter network guard** when building transactions.
- **Never use `Horizon.Server` to read contract state** — use `SorobanRpc.Server` for that.
- **Never use `Float` or `number` for financial amounts in Prisma** — always use `Decimal` / `@db.Decimal(20, 7)`.
- **Never write raw SQL in Prisma** without a comment explaining why Prisma's query builder couldn't handle it.
- **Never import `PrismaClient` in client-side components or hooks.**

---

## 8. Stellar-Specific AI Instructions

### Network Constants

```typescript
// Always import from config, never hardcode
// lib/stellar/config.ts

export const STELLAR_CONFIG = {
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    usdc: {
      code: 'USDC',
      issuer: 'GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2',
    },
    freighterNetwork: 'TESTNET',
  },
  mainnet: {
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: Networks.PUBLIC,
    usdc: {
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    },
    freighterNetwork: 'PUBLIC',
  },
} as const
```

### Soroban Contract Invocation Pattern

```typescript
// Always use this pattern for Soroban calls
import { SorobanRpc, Contract, TransactionBuilder, BASE_FEE, Networks, xdr } from '@stellar/stellar-sdk'

async function callContract(functionName: string, args: xdr.ScVal[], signerPublicKey: string) {
  const config = getStellarConfig() // reads from env
  const server = new SorobanRpc.Server(config.sorobanRpcUrl)
  const contract = new Contract(config.contractAddress)
  const account = await server.getAccount(signerPublicKey)

  const tx = new TransactionBuilder(account, {
    fee: String(BASE_FEE * 100),
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build()

  // Simulate first to estimate resources
  const simResult = await server.simulateTransaction(tx)
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`)
  }

  // Assemble with resource fees
  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build()
  return preparedTx.toXDR() // return XDR for Freighter to sign
}
```

### Freighter Error Handling Pattern

```typescript
// Always handle all three failure modes
import { isConnected, getPublicKey, getNetwork, signTransaction } from '@stellar/freighter-api'

async function signWithFreighter(xdr: string) {
  const connected = await isConnected()
  if (!connected) {
    throw new FreighterError('NOT_INSTALLED', 'Please install the Freighter wallet extension')
  }

  const network = await getNetwork()
  if (network !== process.env.NEXT_PUBLIC_STELLAR_NETWORK?.toUpperCase()) {
    throw new FreighterError('WRONG_NETWORK', `Please switch Freighter to ${process.env.NEXT_PUBLIC_STELLAR_NETWORK}`)
  }

  try {
    const signed = await signTransaction(xdr, { network })
    return signed
  } catch (e) {
    if (String(e).includes('User declined')) {
      throw new FreighterError('REJECTED', 'Transaction was rejected by the user')
    }
    throw e
  }
}
```

### USDC Trustline Check Pattern

```typescript
// Always verify trustline before transfer
async function checkUsdcTrustline(address: string): Promise<boolean> {
  const config = getStellarConfig()
  const server = new Horizon.Server(config.horizonUrl)
  const account = await server.loadAccount(address)

  return account.balances.some(
    (b) =>
      b.asset_type === 'credit_alphanum4' &&
      b.asset_code === config.usdc.code &&
      b.asset_issuer === config.usdc.issuer
  )
}
```

---

## 9. Escrow Business Logic Rules — Never Violate

These are invariants of the protocol. No code change may violate them.

1. **Funds can only be released by the oracle.** The seller cannot call `confirm_delivery` directly. Only the whitelisted oracle address can.

2. **Refunds can only be claimed after `timeout_ledger` has passed.** Never allow refund before timeout, even if both parties agree. They must use the dispute path.

3. **A `DELIVERED` escrow can never be refunded.** Once delivered, the state is terminal. No re-opening.

4. **A `REFUNDED` escrow can never be released.** Once refunded, the state is terminal.

5. **The QRIS Merchant ID extracted from the EMVCo payload is the canonical seller identifier on-chain.** Always parse and validate it. Never accept a seller address that doesn't match a valid parsed QRIS.

6. **All monetary amounts in Soroban contract storage are in USDC base units (7 decimal places).** Example: 50 USDC = `500000000` in storage. Convert correctly in every UI display and API response.

7. **The on-chain contract state is the source of truth.** If the DB says `FUNDED` but the contract says `PENDING`, sync from the contract. Never override chain state with DB state.

8. **The oracle must sign its `confirm_delivery` transaction with its own Stellar keypair before submission.** The contract rejects any call where `env.invoker() != stored_oracle_address`. Never let the oracle call via a proxy or relay.

9. **Escrow creation requires a minimum timeout of 1000 ledgers** (~83 minutes) from the current ledger. Never allow a timeout shorter than this. Recommended default for UI: 72 hours = ~51,840 ledgers.

10. **Never display raw Stellar addresses to users** — always use a truncated format: `GABCD...WXYZ`. Never expose the oracle's keypair address in the UI.

---

## 10. Environment Variables Reference

These are the variable names the AI can reference in generated code. Never generate actual secret values.

```typescript
// Client-safe (NEXT_PUBLIC_ prefix)
process.env.NEXT_PUBLIC_APP_URL              // string — base URL of the app
process.env.NEXT_PUBLIC_ENVIRONMENT         // 'testnet' | 'mainnet'
process.env.NEXT_PUBLIC_STELLAR_NETWORK     // 'testnet' | 'mainnet'
process.env.NEXT_PUBLIC_HORIZON_URL         // Horizon API base URL
process.env.NEXT_PUBLIC_SOROBAN_RPC_URL     // Soroban RPC base URL
process.env.NEXT_PUBLIC_CONTRACT_ADDRESS    // Deployed escrow contract ID (C...)
process.env.NEXT_PUBLIC_USDC_ASSET_CODE     // 'USDC'
process.env.NEXT_PUBLIC_USDC_ISSUER         // USDC issuer G... address

// Server-only (NEVER reference in client components or hooks)
process.env.DATABASE_URL                    // PostgreSQL connection string
process.env.JWT_SECRET                      // JWT signing secret
process.env.SEP10_WEB_AUTH_DOMAIN           // Domain for SEP-10 challenges
process.env.ORACLE_SECRET_KEY               // Oracle Stellar secret key (S...)
process.env.ORACLE_INTERNAL_API_KEY         // Shared secret for oracle→app auth
process.env.REDIS_URL                       // Redis connection URL
process.env.JNT_API_KEY                     // J&T Express API key
process.env.JNE_API_KEY                     // JNE API key
process.env.SICEPAT_API_KEY                 // SiCepat API key
```

---

## 11. Testing Expectations

- **Every new API Route Handler** → corresponding test in `apps/web/__tests__/api/`
- **Every new Soroban contract function** → corresponding Rust test in `packages/contracts/src/test.rs`
- **Every new custom hook** → corresponding test in `apps/web/__tests__/hooks/`
- **Every new Server Action** → tested via integration test with mocked Prisma
- **New courier adapter** → test with mocked API response (success + timeout + malformed response)
- **Coverage targets:** 70% for MVP; 85% for v1.0 post-hackathon

When generating test code:
- Mock `@stellar/stellar-sdk` and `@stellar/freighter-api` in web tests (never hit real network in unit tests)
- Use `jest-mock-extended` to mock Prisma client
- Use `msw` (Mock Service Worker) for courier API mocking in oracle tests
- Use `soroban-sdk` test harness for contract tests (do not mock the SDK itself)

---

## 12. AI Persona for This Project

You are building financial infrastructure for informal Indonesian commerce. This means:

- **Reliability and clarity over cleverness.** If there is a simple approach and a clever one, always pick simple for the MVP. Document the clever version as a future optimization.

- **The user (Roff) is a CS student at Universitas Diponegoro with strong TypeScript, Next.js, and system-level skills.** Do not over-explain basics. Focus on Stellar/Soroban-specific patterns that are genuinely non-obvious. Explain Soroban concepts (simulation step, resource fees, SAC token transfers) in depth.

- **shadcn/ui first, always.** When suggesting UI, reach for a shadcn component before anything else. If one doesn't exist, check Radix primitives. Custom components are the last resort.

- **Stellar SDK patterns change frequently.** When generating SDK code, note the SDK version the pattern applies to and add a `// TODO: verify against @stellar/stellar-sdk@latest` comment if there's any chance it's stale.

- **Assume the reader is building for testnet first, mainnet second.** All generated code should default to testnet configs but be designed to switch cleanly via the `NEXT_PUBLIC_ENVIRONMENT` env var.

- **When in doubt about a Soroban pattern, generate the simulation step first.** The `server.simulateTransaction()` → `assembleTransaction()` → sign → submit pattern is the correct Soroban flow. Never skip simulation.

- **Indonesian context matters.** When generating user-facing strings, prefer Bahasa Indonesia for labels that face end-users. Use English for developer-facing code, comments, and error messages. Format currency as `Rp 50.000` (period as thousands separator), not `$50.00`.

- **The hackathon timeline is tight.** When asked to generate code for MVP scope, always ship the simplest correct solution. Don't gold-plate. Add a `// v1.1:` comment for improvements to make post-hackathon.
