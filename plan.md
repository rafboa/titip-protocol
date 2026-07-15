# Titip Protocol — Project Plan

## 1. Project Overview

Titip Protocol is a trustless escrow dApp built on the Stellar network and Soroban smart contract platform for informal Indonesian social commerce. It eliminates non-delivery fraud in peer-to-peer transactions conducted through WhatsApp, Instagram DMs, and TikTok Shop by inserting a programmable, oracle-driven escrow layer between buyer payment and seller payout — without disrupting either party's existing QRIS-based habits.

**Problem:** Informal social commerce in Indonesia generates an estimated Rp 600 trillion in annual volume. Buyers pay into seller QRIS codes upfront with zero protection. Non-delivery fraud is endemic and has no recourse mechanism outside formal marketplace platforms.

**Solution:** Payment is converted to USDC stablecoin and locked in a Soroban smart contract. A courier oracle monitors J&T, JNE, and SiCepat APIs. On confirmed delivery, the contract releases fiat to the seller. On timeout, the buyer is refunded. Neither party sees the blockchain.

**Target Users:**
- Informal buyers (WhatsApp/Instagram/TikTok shop consumers)
- Informal sellers (peer-to-peer storefront operators)
- Group buyers (shared order coordinators)

**Hackathon Track:** Track 3 (Payment & Consumer) primary; Track 2 (DeFi & Composability) depth via Soroban.

---

## 2. Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                         │
│  Next.js App Router (SSR/RSC)   Freighter Wallet Ext     │
│  shadcn/ui + Tailwind CSS        @stellar/freighter-api  │
└──────────────────────┬──────────────────────────────────┘
                       │ Server Actions / API Routes (HTTPS)
┌──────────────────────▼──────────────────────────────────┐
│                  APPLICATION LAYER                        │
│  Next.js Route Handlers  →  Prisma ORM  →  PostgreSQL    │
│  /api/escrow/*              schema.prisma  (Supabase)    │
│  /api/qris/parse                                         │
│  /api/oracle/confirm (internal, signed)                  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  BLOCKCHAIN LAYER                         │
│  Horizon API (accounts, balances, history)               │
│  Soroban RPC  →  Titip Escrow Contract (Rust)            │
│                  States: Pending→Funded→Shipped→         │
│                          Delivered / Refunded            │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   ORACLE LAYER                            │
│  Node.js Service (separate Docker container)             │
│  BullMQ + Redis  →  PollCourierJob  →  ConfirmJob        │
│                          ↓                               │
│              J&T / JNE / SiCepat APIs                    │
└─────────────────────────────────────────────────────────┘
```

### Full Data Flow (Buyer Scan → Seller Paid)

1. Buyer opens Titip app, scans or pastes seller's QRIS string
2. `lib/qris/parser.ts` validates CRC16, extracts Merchant ID, Name, Category Code, Amount
3. Buyer connects Freighter; app calls `POST /api/escrow/create`
4. Server calls `create_escrow()` on Soroban contract via Soroban RPC → returns `contract_escrow_id`
5. Server creates `escrows` DB record (status: `PENDING`), returns unsigned `fund()` transaction XDR to client
6. Buyer signs XDR in Freighter → submits to Stellar network → contract status: `FUNDED`
7. Client calls `POST /api/escrow/:id/fund` with `txHash` → DB status: `FUNDED`
8. Seller receives in-app notification; opens Titip dashboard
9. Seller submits tracking number → `POST /api/escrow/:id/tracking`
10. Server calls `submit_tracking()` on contract → DB status: `SHIPPED`
11. Oracle service picks up `SHIPPED` escrow via DB poll → enqueues `PollCourierJob`
12. Oracle polls courier API every 15 min; on `"Delivered"` → enqueues `ConfirmDeliveryJob`
13. Oracle signs `confirm_delivery(escrow_id)` Soroban transaction with its keypair → submits to Stellar
14. Contract verifies oracle invoker address → releases USDC to seller → DB status: `DELIVERED`
15. Seller off-ramps USDC → IDR via TEMPO anchor SEP-24 flow or holds USDC
16. Both parties notified of resolution

### Component Responsibility Matrix

| Component | Owns | Does NOT Own |
|---|---|---|
| Next.js App | UI, routing, API orchestration, DB writes | Transaction signing, on-chain state |
| Soroban Contract | Fund custody, state transitions, release logic | Courier data, user identity, DB |
| Oracle Service | Courier polling, delivery confirmation, signing | UI, user-facing APIs, DB schema |
| Freighter Wallet | Key management, transaction signing | App state, escrow logic |
| PostgreSQL | Application state, history, notifications | On-chain state (chain is source of truth) |
| Horizon API | Account balances, payment history, fee estimation | Contract state (use Soroban RPC) |

---

## 3. Tech Stack Decision Log

| Decision | Options Considered | Choice | Rationale | Trade-offs |
|---|---|---|---|---|
| Framework | Next.js, Remix, SvelteKit | **Next.js 14 App Router** | RSC reduces bundle, best Vercel DX, largest ecosystem | Steeper App Router learning curve vs Pages |
| UI Library | MUI, Chakra, Ant Design, shadcn | **shadcn/ui + Tailwind** | Own the components, Radix a11y, no vendor lock-in | More CLI setup vs drop-in |
| Package Manager | npm, yarn, pnpm | **pnpm** | Fastest installs, strict node_modules, native monorepo workspaces | Less common; some scripts need `pnpm` prefix |
| Database | PostgreSQL, Firebase, MongoDB | **PostgreSQL via Supabase** | Relational integrity for financial data, RLS, built-in auth, realtime | Supabase vendor (mitigated: standard PG underneath) |
| ORM | Prisma, Drizzle, raw SQL | **Prisma** | Best TS DX, migration system, Studio GUI, generated types | Slightly slower than raw SQL for complex queries |
| Stablecoin | USDC (Stellar), IDR-pegged, USDT | **USDC on Stellar** | Highest liquidity, Circle-issued, TEMPO supports IDR↔USDC, native Stellar support | USD/IDR FX exposure (negligible for <48h escrows) |
| Wallet | Freighter, Albedo, Lobstr, xBull | **Freighter** | SDF-backed, best Soroban support, widest Indonesian Stellar adoption | Browser extension only; WalletConnect is v1.1 |
| Job Queue | BullMQ, Agenda, cron | **BullMQ + Redis** | Reliable retries, job delay, Bull Board visibility | Adds Redis to docker-compose |
| State Management | Zustand, Redux, React Context | **Zustand (wallet) + React Query (server state)** | Minimal boilerplate, server state handled by TanStack Query | Two libraries but very lightweight |

---

## 4. Smart Contract Specification

### Contract: `titip_escrow`

**Language:** Rust (`soroban-sdk` latest stable)
**Location:** `packages/contracts/src/lib.rs`

### Data Types

```rust
#[contracttype]
pub enum EscrowStatus {
    Pending,
    Funded,
    Shipped,
    Delivered,
    Refunded,
}

#[contracttype]
pub struct EscrowState {
    pub escrow_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,           // USDC contract address on Stellar
    pub amount: i128,             // in USDC base units (7 decimals)
    pub status: EscrowStatus,
    pub timeout_ledger: u32,      // absolute ledger number; refund allowed after this
    pub tracking_number: Option<String>,
    pub courier_code: Option<String>,
    pub created_ledger: u32,
    pub funded_ledger: Option<u32>,
    pub shipped_ledger: Option<u32>,
    pub resolved_ledger: Option<u32>,
}
```

### Function Specifications

| Function | Caller | Inputs | Transition | Key Validations |
|---|---|---|---|---|
| `initialize(admin, oracle, token)` | Anyone (once) | Addresses | Sets config | Panics if already initialized |
| `create_escrow(buyer, seller, amount, timeout_ledger)` | Buyer | addresses, i128, u32 | → Pending | amount > 0; timeout > current + 1000 ledgers (~83 min) |
| `fund(escrow_id)` | Buyer | u64 | Pending → Funded | Caller == buyer; transfers USDC buyer → contract |
| `submit_tracking(escrow_id, tracking_number, courier_code)` | Seller | u64, String, String | Funded → Shipped | Caller == seller; status must be Funded |
| `confirm_delivery(escrow_id)` | Oracle only | u64 | Shipped → Delivered | Caller == stored oracle; transfers USDC contract → seller |
| `claim_refund(escrow_id)` | Buyer | u64 | Funded/Shipped → Refunded | Caller == buyer; current_ledger > timeout_ledger; transfers USDC contract → buyer |
| `get_escrow(escrow_id)` | Anyone | u64 | — | Returns EscrowState or panics |
| `get_buyer_escrows(buyer)` | Anyone | Address | — | Returns Vec<u64> |
| `update_oracle(new_oracle)` | Admin only | Address | — | Caller == admin |

### State Machine

```
create_escrow()
      │
      ▼
 ┌─────────┐
 │ PENDING │
 └────┬────┘
      │ fund()
      ▼
 ┌─────────┐
 │ FUNDED  │──────────────────────────┐
 └────┬────┘                          │ claim_refund()
      │ submit_tracking()             │ (after timeout_ledger)
      ▼                               │
 ┌─────────┐                          │
 │ SHIPPED │──────────────────────────┤
 └────┬────┘                          │
      │ confirm_delivery()            ▼
      │ (oracle only)         ┌────────────┐
      ▼                       │  REFUNDED  │
 ┌───────────┐                └────────────┘
 │ DELIVERED │
 └───────────┘
```

### Security Constraints

- `confirm_delivery`: reverts if `env.invoker() != stored_oracle_address`
- `claim_refund`: reverts if `env.ledger().sequence() <= timeout_ledger`
- `fund`: uses SAC `transfer` — buyer must have approved the contract amount in USDC beforehand
- All state transitions are atomic (guaranteed by Soroban execution model)
- No `unsafe` Rust in contract code
- Oracle address updatable only by admin (multi-sig admin recommended for mainnet)

### Estimated On-Chain Costs

| Operation | Estimated Fee | Notes |
|---|---|---|
| `create_escrow` | ~0.01 XLM | Storage write, minimal compute |
| `fund` | ~0.05 XLM | USDC token transfer |
| `submit_tracking` | ~0.01 XLM | Storage write |
| `confirm_delivery` | ~0.05 XLM | USDC token transfer out |
| `claim_refund` | ~0.05 XLM | USDC token transfer out |
| **Full lifecycle** | **~0.17 XLM** | ≈ Rp 300–450 at current rates |

---

## 5. Database Schema

### Prisma Schema (`packages/db/prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  stellarAddress  String         @id @map("stellar_address")
  displayName     String?        @map("display_name")
  walletType      String         @default("freighter") @map("wallet_type")
  createdAt       DateTime       @default(now()) @map("created_at")
  escrowsAsBuyer  Escrow[]       @relation("BuyerEscrows")
  escrowsAsSeller Escrow[]       @relation("SellerEscrows")
  notifications   Notification[]
  @@map("users")
}

model Escrow {
  id                 String        @id @default(cuid())
  contractEscrowId   BigInt        @map("contract_escrow_id")
  contractAddress    String        @map("contract_address")
  buyerAddress       String        @map("buyer_address")
  sellerAddress      String        @map("seller_address")
  amountUsdc         Decimal       @map("amount_usdc") @db.Decimal(20, 7)
  status             EscrowStatus  @default(PENDING)
  trackingNumber     String?       @map("tracking_number")
  courierCode        CourierCode?  @map("courier_code")
  qrisMerchantId     String?       @map("qris_merchant_id")
  qrisMerchantName   String?       @map("qris_merchant_name")
  qrisCategoryCode   String?       @map("qris_category_code")
  qrisPayloadRaw     String?       @map("qris_payload_raw") @db.Text
  timeoutAt          DateTime      @map("timeout_at")
  createdAt          DateTime      @default(now()) @map("created_at")
  fundedAt           DateTime?     @map("funded_at")
  shippedAt          DateTime?     @map("shipped_at")
  deliveredAt        DateTime?     @map("delivered_at")
  refundedAt         DateTime?     @map("refunded_at")
  txHashFund         String?       @map("tx_hash_fund")
  txHashRelease      String?       @map("tx_hash_release")
  buyer              User          @relation("BuyerEscrows",  fields: [buyerAddress],  references: [stellarAddress])
  seller             User          @relation("SellerEscrows", fields: [sellerAddress], references: [stellarAddress])
  oracleEvents       OracleEvent[]
  @@index([buyerAddress])
  @@index([sellerAddress])
  @@index([status])
  @@index([contractEscrowId, contractAddress])
  @@map("escrows")
}

model OracleEvent {
  id              String   @id @default(cuid())
  escrowId        String   @map("escrow_id")
  eventType       String   @map("event_type")
  courierResponse Json?    @map("courier_response")
  confirmedAt     DateTime @default(now()) @map("confirmed_at")
  oracleNodeId    String   @map("oracle_node_id")
  escrow          Escrow   @relation(fields: [escrowId], references: [id])
  @@index([escrowId])
  @@map("oracle_events")
}

model QrisSession {
  id           String   @id @default(cuid())
  payloadRaw   String   @map("payload_raw") @db.Text
  merchantId   String?  @map("merchant_id")
  merchantName String?  @map("merchant_name")
  catCode      String?  @map("cat_code")
  amount       Decimal? @db.Decimal(20, 2)
  parsedAt     DateTime @default(now()) @map("parsed_at")
  escrowId     String?  @unique @map("escrow_id")
  @@map("qris_sessions")
}

model Notification {
  id          String   @id @default(cuid())
  userAddress String   @map("user_address")
  type        String
  message     String
  read        Boolean  @default(false)
  createdAt   DateTime @default(now()) @map("created_at")
  user        User     @relation(fields: [userAddress], references: [stellarAddress])
  @@index([userAddress, read])
  @@map("notifications")
}

enum EscrowStatus {
  PENDING
  FUNDED
  SHIPPED
  DELIVERED
  REFUNDED
}

enum CourierCode {
  JNT
  JNE
  SICEPAT
  ANTERAJA
  POS_INDONESIA
}
```

### PostgreSQL vs Firebase Decision

| Criteria | PostgreSQL (Supabase) | Firebase Firestore |
|---|---|---|
| Financial data integrity | ✅ ACID transactions, foreign keys | ⚠️ Eventual consistency |
| Complex queries | ✅ Full SQL, JOINs, aggregations | ❌ Limited query model |
| TypeScript DX | ✅ Prisma generated types | ⚠️ Manual typing |
| Real-time | ✅ Supabase Realtime | ✅ Native |
| Free tier | ✅ Generous (Supabase) | ✅ Generous |
| **Winner** | ✅ **PostgreSQL** | — |

**Decision: PostgreSQL via Supabase.** Financial escrow data requires ACID compliance and relational integrity. Firebase is disqualified by its inability to enforce relational constraints.

---

## 6. API Design

### Authentication Strategy

SEP-10 Web Authentication:
1. Client calls `POST /api/auth/challenge` with Stellar address
2. Server returns an unsigned Stellar transaction (challenge)
3. Client signs with Freighter → returns signed XDR
4. Server verifies signature, issues JWT (httpOnly cookie, 24h expiry)

### Route Table

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| `POST` | `/api/auth/challenge` | None | `{ address }` | `{ challengeXdr }` |
| `POST` | `/api/auth/verify` | None | `{ address, signedXdr }` | Sets JWT cookie |
| `POST` | `/api/qris/parse` | JWT | `{ payload }` | `QrisParseResult` |
| `POST` | `/api/escrow/create` | JWT | `CreateEscrowInput` | `{ escrowId, unsignedFundXdr }` |
| `GET` | `/api/escrow/:id` | JWT | — | `EscrowDetail` |
| `POST` | `/api/escrow/:id/fund` | JWT | `{ txHash }` | `{ status: 'FUNDED' }` |
| `POST` | `/api/escrow/:id/tracking` | JWT | `{ trackingNumber, courierCode }` | `{ status: 'SHIPPED' }` |
| `GET` | `/api/escrow/:id/tracking` | JWT | — | `CourierStatus` |
| `POST` | `/api/escrow/:id/refund` | JWT | — | `{ unsignedRefundXdr }` |
| `GET` | `/api/user/:address/escrows` | JWT | — | `Escrow[]` |
| `POST` | `/api/oracle/confirm` | Oracle Sig | `{ escrowId, oracleSignature }` | `{ ok: true }` |
| `GET` | `/api/health` | None | — | `{ ok, db, chain }` |

---

## 7. Frontend Architecture

### App Router Directory Structure

```
apps/web/
├── app/
│   ├── (auth)/
│   │   └── connect/page.tsx          # Freighter connect + SEP-10
│   ├── (app)/
│   │   ├── layout.tsx                # App shell: sidebar + navbar
│   │   ├── dashboard/page.tsx        # All escrows (buyer + seller)
│   │   ├── escrow/
│   │   │   ├── new/page.tsx          # Create escrow (QRIS scan/paste)
│   │   │   └── [id]/
│   │   │       ├── page.tsx          # Escrow detail + timeline
│   │   │       ├── loading.tsx
│   │   │       └── error.tsx
│   │   └── settings/page.tsx
│   ├── layout.tsx                    # Root: providers, fonts
│   └── page.tsx                      # Landing page
├── components/
│   ├── ui/                           # shadcn generated — DO NOT EDIT
│   ├── escrow/
│   │   ├── escrow-card.tsx
│   │   ├── escrow-status-badge.tsx
│   │   ├── escrow-timeline.tsx
│   │   └── create-escrow-form.tsx
│   ├── qris/
│   │   ├── qris-scanner.tsx          # Camera-based QR scan (jsQR)
│   │   └── qris-preview.tsx          # Parsed merchant details
│   ├── wallet/
│   │   ├── connect-button.tsx
│   │   ├── wallet-badge.tsx
│   │   └── network-guard.tsx         # Warns on wrong Stellar network
│   └── layout/
│       ├── navbar.tsx
│       └── sidebar.tsx
├── hooks/
│   ├── use-freighter.ts              # Connect, sign, network detection
│   ├── use-escrow.ts                 # Create, fund, track, refund
│   ├── use-qris-parser.ts            # Parse + validate QRIS string
│   └── use-courier-status.ts         # Poll /api/escrow/:id/tracking
├── lib/
│   ├── stellar/
│   │   ├── contracts/escrow.ts       # All Soroban contract calls
│   │   ├── horizon/accounts.ts       # Balance, trustline checks
│   │   └── config.ts                 # Network URLs, asset definitions
│   ├── qris/parser.ts                # EMVCo TLV + CRC16 validation
│   ├── auth/sep10.ts                 # Challenge/verify helpers
│   └── utils.ts                      # cn(), currency formatters
├── actions/
│   ├── escrow.actions.ts             # Server Actions
│   └── auth.actions.ts
└── types/index.ts                    # All shared TS types
```

### shadcn/ui Components to Install

```bash
pnpm dlx shadcn-ui@latest init
pnpm dlx shadcn-ui@latest add button card badge dialog sheet \
  form input label select textarea alert alert-dialog toast \
  tabs separator skeleton dropdown-menu avatar progress \
  tooltip popover command
```

### Key Custom Hooks

```typescript
// use-freighter.ts
export function useFreighter() {
  // returns: { isConnected, address, network, connect, disconnect, signTransaction }
}

// use-escrow.ts
export function useEscrow(escrowId: string) {
  // returns: { escrow, isLoading, fund, submitTracking, claimRefund }
}

// use-qris-parser.ts
export function useQrisParser() {
  // returns: { parse, result, error, isValidating }
}
```

---

## 8. Oracle Service Architecture

### Directory Structure

```
apps/oracle/
├── src/
│   ├── index.ts                  # Starts BullMQ workers
│   ├── queues/
│   │   ├── poll-courier.queue.ts
│   │   └── confirm-delivery.queue.ts
│   ├── workers/
│   │   ├── poll-courier.worker.ts
│   │   └── confirm-delivery.worker.ts
│   ├── couriers/
│   │   ├── index.ts              # Courier factory (detect by prefix)
│   │   ├── jnt.ts               # J&T Express API adapter
│   │   ├── jne.ts               # JNE API adapter
│   │   └── sicepat.ts           # SiCepat API adapter
│   ├── stellar/
│   │   └── submit.ts            # Sign + submit confirm_delivery()
│   └── db/
│       └── client.ts            # Prisma client
├── Dockerfile
└── package.json
```

### Courier Adapters

| Courier | Tracking Prefix | API Endpoint | Delivery Status Field |
|---|---|---|---|
| J&T Express | `JT` | `POST https://api.jet.co.id/tracing/api/tracing` | `reason == "DELIVERED"` |
| JNE | `JNE` | `GET https://apiv2.jne.co.id:10101/tracing/api/list` | `cnote_pod_receiver != ""` |
| SiCepat | `SCP` | `GET https://api.sicepat.com/customer/waybill?waybill=` | `last_status == "DELIVERED"` |

### Polling Strategy

- **Poll interval:** every 15 minutes per active escrow (BullMQ `repeat` option)
- **Retry on API error:** exponential backoff (3 retries: 1min, 5min, 15min)
- **Stop polling on:** status = DELIVERED or REFUNDED or EXPIRED
- **Timeout detection:** separate scheduled job every hour checks `timeout_at < now()` for FUNDED/SHIPPED escrows

### Oracle Signing Flow

```typescript
// confirm-delivery.worker.ts
async function confirmDelivery(escrowId: string, contractEscrowId: bigint) {
  const keypair = Keypair.fromSecret(process.env.ORACLE_SECRET_KEY!)
  const account = await server.loadAccount(keypair.publicKey())
  const contract = new Contract(process.env.CONTRACT_ADDRESS!)

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call('confirm_delivery', xdr.ScVal.scvU64(contractEscrowId)))
    .setTimeout(30)
    .build()

  tx.sign(keypair)
  const result = await sorobanRpc.sendTransaction(tx)
  // log to oracle_events table
}
```

---

## 9. Indonesian Stellar Ecosystem Integration

### USDC on Stellar

| Network | Asset Code | Issuer |
|---|---|---|
| **Testnet** | `USDC` | `GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2` (mock) |
| **Mainnet** | `USDC` | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

### TEMPO Anchor (IDR ↔ USDC, SEP-24)

- Website: `https://tempo.eu.com`
- `stellar.toml`: `https://tempo.eu.com/.well-known/stellar.toml`
- Flow: User initiates SEP-24 interactive deposit/withdrawal → TEMPO provides IDR bank transfer instructions → USDC credited on Stellar
- Integration: parse TRANSFER_SERVER_SEP0024 from `stellar.toml`, open interactive iframe

### Stellar Endpoints

| Network | Horizon API | Soroban RPC |
|---|---|---|
| Testnet | `https://horizon-testnet.stellar.org` | `https://soroban-testnet.stellar.org` |
| Mainnet | `https://horizon.stellar.org` | `https://mainnet.sorobanrpc.com` |

### Freighter Integration

```typescript
import {
  isConnected,
  getPublicKey,
  getNetwork,
  signTransaction,
} from '@stellar/freighter-api'

// Network guard — ALWAYS check before any transaction
const network = await getNetwork()
if (network !== 'TESTNET') throw new Error('Please switch Freighter to Testnet')

// Sign a transaction XDR
const signedXdr = await signTransaction(unsignedXdr, { network: 'TESTNET' })
```

### Relevant Stellar Ecosystem Proposals (SEPs)

| SEP | Name | Usage in Titip |
|---|---|---|
| SEP-10 | Web Authentication | Authenticate users via Stellar keypair |
| SEP-24 | Hosted Deposit/Withdrawal | TEMPO IDR ↔ USDC on/off-ramp |
| SEP-38 | Anchor RFQ | Future: competitive FX rate fetching |

---

## 10. Feature Scope

### MVP — In Scope (Hackathon)

| Feature | Acceptance Criteria |
|---|---|
| QRIS payload parser | Valid QRIS string → Merchant ID, Name, Amount, CRC check |
| Freighter wallet connect | Connect, see address + USDC balance, disconnect, network guard |
| Create escrow | QRIS scan → parsed preview → on-chain escrow created → DB record |
| Fund escrow | Buyer signs USDC transfer via Freighter → contract FUNDED |
| Submit tracking | Seller enters tracking no. + courier → contract SHIPPED |
| Courier oracle (mock) | Mock delivery webhook triggers `confirm_delivery` on contract |
| Escrow status page | Real-time status, timeline, tx hashes for both parties |
| Timeout refund | After timeout, buyer calls `claim_refund` → REFUNDED |
| In-app notifications | Status changes shown in notification bell |

### Out of Scope for MVP

| Feature | Reason |
|---|---|
| TEMPO IDR on-ramp | Requires production anchor account |
| Mobile app | Browser is sufficient for demo |
| Multi-oracle decentralization | V2 governance concern |
| Dispute resolution UI | Happy path + timeout sufficient for hackathon |
| WalletConnect / Lobstr | Freighter only |
| Push notifications | In-app polling sufficient |

### Post-Hackathon Roadmap

**v1.1 — Core Polish (Weeks 1–4)**
- Live courier API integration (replace mocks)
- TEMPO SEP-24 on/off-ramp UI
- Mobile-responsive PWA
- Dispute resolution: 72h grace period + admin arbiter

**v2.0 — Ecosystem Scale (Months 2–6)**
- WalletConnect v2 (Lobstr, xBull, mobile wallets)
- Decentralized oracle network with staking
- Compose with Blueprint C: idle escrow USDC earns yield
- Multi-language: Bahasa Indonesia (primary), English
- Indonesia App Store listing

---


## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Soroban deploy fails on testnet | Medium | High | Test deploy at hour 4; fallback to mocked contract interface |
| Freighter not on demo browser | Low | High | Pre-install + import seed phrase on demo machine |
| Courier API rate-limited | Medium | Medium | Cache last status in DB; use mock courier for demo |
| USDC testnet balance depleted | Low | High | Pre-fund 5 test accounts; keep Friendbot link ready |
| Soroban RPC timeout during demo | Low | Medium | Implement retry logic; have pre-signed demo transactions |
| OJK regulatory question in Q&A | Medium | Low | Frame as research dApp on testnet; not money transmission |

---

## 12. Testing Strategy

### Smart Contract Tests (Rust)

```
packages/contracts/src/test.rs
```
- All state transitions: happy path + invalid caller + wrong status
- Timeout boundary: exact ledger number ± 1
- Token amount correctness: `amount_in == amount_released`
- Oracle address enforcement

### API Tests (Jest + Supertest)

```
apps/web/__tests__/api/
```
- Mock Prisma with `jest-mock-extended`
- Mock `@stellar/stellar-sdk` calls
- Every route: success + 4xx + 5xx cases

### E2E Tests (Playwright)

```
apps/web/e2e/escrow-lifecycle.spec.ts
```
- Buyer: connect wallet → scan QRIS → create → fund
- Seller: submit tracking
- Oracle: simulate delivery → verify DB + UI update
- Timeout: advance mock ledger → verify refund available

**Coverage targets:** 70% for MVP; 85% for v1.0 post-hackathon.

---

## 13. Environment Variables Reference

```env
# .env.example — copy to .env.local

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ENVIRONMENT=testnet

# Database (Supabase or local Docker)
DATABASE_URL=postgresql://titip:titip@localhost:5432/titip_db

# Stellar network
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_CONTRACT_ADDRESS=            # Set after: soroban contract deploy
NEXT_PUBLIC_USDC_ASSET_CODE=USDC
NEXT_PUBLIC_USDC_ISSUER=GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2

# Auth
JWT_SECRET=change_me_to_a_long_random_string
SEP10_WEB_AUTH_DOMAIN=localhost:3000

# Oracle (server-side only — NEVER expose to client)
ORACLE_SECRET_KEY=                       # Stellar keypair secret for oracle signing
ORACLE_INTERNAL_API_KEY=                 # Shared secret for /api/oracle/confirm

# Redis
REDIS_URL=redis://localhost:6379

# Courier APIs
JNT_API_KEY=
JNT_API_URL=https://api.jet.co.id
JNE_API_KEY=
JNE_API_URL=https://apiv2.jne.co.id:10101
SICEPAT_API_KEY=
SICEPAT_API_URL=https://api.sicepat.com

# Optional: Supabase (if using hosted PG)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```
