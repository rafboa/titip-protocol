# Titip Protocol

> **Trustless QRIS escrow on Stellar/Soroban for Indonesian social commerce.**

Titip Protocol is a trustless escrow dApp built on the Stellar network and Soroban smart contract platform for informal Indonesian social commerce. It eliminates non-delivery fraud in peer-to-peer transactions conducted through WhatsApp, Instagram DMs, and TikTok Shop by inserting a programmable, oracle-driven escrow layer between buyer payment and seller payout — without disrupting either party's existing QRIS-based habits.

**Problem:** Informal social commerce in Indonesia generates an estimated Rp 600 trillion in annual volume. Buyers pay into seller QRIS codes upfront with zero protection. Non-delivery fraud is endemic and has no recourse mechanism outside formal marketplace platforms.

**Solution:** Payment is converted to USDC stablecoin and locked in a Soroban smart contract. A courier oracle monitors J&T, JNE, and SiCepat APIs. On confirmed delivery, the contract releases fiat to the seller. On timeout, the buyer is refunded. Neither party sees the blockchain.

**Target Users:**
- Informal buyers (WhatsApp/Instagram/TikTok shop consumers)
- Informal sellers (peer-to-peer storefront operators)
- Group buyers (shared order coordinators)


> **TL;DR**

Titip Protocol protects buyers and sellers in informal Indonesian e-commerce (WhatsApp, Instagram, TikTok) by locking USDC in a Soroban smart contract until a courier oracle confirms delivery.



## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/titip-protocol.git
cd titip-protocol
npm install

# 2. Start infrastructure (PostgreSQL + Redis)
# If you have Docker installed: 
docker compose up -d
# Otherwise, use a cloud-hosted PostgreSQL + Redis

# 3. Set up environment
cp .env.example .env.local
# Edit .env.local with your values (see Environment section below)

# 4. Run database migrations
npm --prefix packages/db run db:push

# 5. Generate Prisma client
npm --prefix packages/db run db:generate

# 6. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect with Freighter.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Next.js App    │────▶│  Soroban Contract     │◀────│  Oracle Service │
│  (Buyer/Seller) │     │  (USDC Escrow)        │     │  (Courier APIs) │
│                 │     │                       │     │                 │
│  Freighter      │     │  create_escrow()      │     │  J&T / JNE /   │
│  Wallet         │     │  fund()               │     │  SiCepat        │
│  QRIS Scanner   │     │  submit_tracking()    │     │                 │
│                 │     │  confirm_delivery()   │     │  Polls courier  │
│                 │     │  claim_refund()        │     │  → confirms on  │
│                 │     │                       │     │    chain         │
└────────┬────────┘     └──────────────────────┘     └────────┬────────┘
         │                                                      │
         │              ┌──────────────────────┐                │
         └─────────────▶│  PostgreSQL (Cache)   │◀──────────────┘
                        │  + Redis (Job Queue)  │
                        └──────────────────────┘
```

## Escrow Flow

1. **Buyer** scans a QRIS code → merchant identity extracted via EMVCo parser
2. **Buyer** signs `create_escrow()` + `fund()` → USDC locked in contract
3. **Seller** submits tracking number → `submit_tracking()` on-chain
4. **Oracle** polls courier API → confirms delivery → `confirm_delivery()` releases USDC to seller
5. If no delivery after timeout → **Buyer** calls `claim_refund()` to get USDC back

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, shadcn/ui, Tailwind CSS |
| State | Zustand (wallet), TanStack Query (server data) |
| Wallet | Freighter (Stellar browser wallet) |
| Smart Contract | Soroban (Rust) — USDC escrow state machine |
| Database | PostgreSQL via Prisma ORM |
| Oracle | Node.js + BullMQ + Redis |
| Blockchain | Stellar Testnet (Horizon + Soroban RPC) |

## Project Structure

```
titip-protocol/
├── apps/
│   ├── web/                  # Next.js frontend + API routes
│   │   ├── app/              # App Router pages + API
│   │   ├── components/       # React components (shadcn + custom)
│   │   ├── lib/              # Stellar SDK wrappers, QRIS parser, i18n
│   │   └── hooks/            # Custom React hooks
│   └── oracle/               # Courier polling + oracle service
├── packages/
│   ├── contracts/            # Soroban smart contract (Rust)
│   ├── db/                   # Prisma schema + migrations
│   └── shared-types/         # Shared TypeScript types
├── scripts/                  # Demo + testing scripts
├── docker-compose.yml        # PostgreSQL + Redis
└── claude.md                 # AI agent instructions
```

## Deployed Contract

| Resource | Value |
|---|---|
| **Contract Address** | `CDXU2C4KKP7M2NCQM2SD73I7H4UMCU6STLGAF66WPDFOTNYGFENIZV6Z` |
| **Network** | Stellar Testnet |
| **Stellar Expert** | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDXU2C4KKP7M2NCQM2SD73I7H4UMCU6STLGAF66WPDFOTNYGFENIZV6Z) |
| **USDC Asset** | `USDC:GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2` (mock testnet issuer) |
| **USDC SAC** | `CAWMLY7NIWOOL4766XQMN7B7ETXPMQMU2JKUGHY5ROQIAU6GBPKJV34K` |

<!-- TODO(mainnet): Update contract address and USDC issuer for mainnet deployment -->

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
# Required
NEXT_PUBLIC_CONTRACT_ADDRESS=<deployed contract C... address>
NEXT_PUBLIC_USDC_ISSUER=<USDC issuer G... address>
DATABASE_URL=postgresql://titip:titip@localhost:5432/titip_db
JWT_SECRET=<random 32+ char string>
ORACLE_SECRET_KEY=<oracle Stellar secret key S...>
ORACLE_INTERNAL_API_KEY=<shared secret for oracle auth>

# Auto-configured for testnet
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

See [.env.example](.env.example) for the full list.

## Demo Scripts

```bash
# Deploy contract to testnet and initialize with USDC token
npm run demo:deploy

# Pre-fund testnet accounts with XLM + USDC trustlines
npm run demo:fund

# Create USDC issuer and mint to demo accounts
npm run demo:usdc

# Run the full escrow lifecycle (DB simulation)
npm run demo:simulate

# Trigger oracle delivery confirmation for a specific escrow
npm run demo:confirm
```

## Key Design Decisions

1. **Chain is source of truth.** PostgreSQL is a cache/index. On conflict, sync from chain.
2. **Oracle-only release.** Only the whitelisted oracle can call `confirm_delivery()`. Sellers cannot self-confirm.
3. **Timeout-based refunds.** Buyers can only claim refunds after `timeout_ledger` has passed (minimum ~83 minutes).
4. **QRIS-first identity.** Merchant identity is extracted from the QRIS EMVCo payload — no separate registration needed.

## Development

```bash
# Run the web app in development
npm run dev

# Run database studio (GUI)
npm --prefix packages/db run db:studio

# Build the Soroban contract
cd packages/contracts && cargo build --target wasm32-unknown-unknown --release

# Run contract tests
cd packages/contracts && cargo test
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built for the Stellar Hackathon 2026 🚀
