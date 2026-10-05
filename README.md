# Titip Protocol

> **Trustless P2P Escrow on Stellar Soroban with Courier Delivery Verification & QRIS Support**

[![Stellar Network](https://img.shields.io/badge/Stellar-Testnet-blue?style=flat-square&logo=stellar)](https://stellar.expert/explorer/testnet/contract/CDXU2C4KKP7M2NCQM2SD73I7H4UMCU6STLGAF66WPDFOTNYGFENIZV6Z)
[![Soroban](https://img.shields.io/badge/Soroban-Rust%20WASM-orange?style=flat-square)](https://soroban.stellar.org)
[![Next.js 14](https://img.shields.io/badge/Next.js-14%20(App%20Router)-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## 📖 Overview

**Titip Protocol** is a decentralized, non-custodial escrow platform built on the **Stellar network** and **Soroban smart contracts**. It solves the rampant counterparty fraud in informal peer-to-peer commerce and cross-border shopping ("jastip") across Southeast Asia—specifically Indonesia—by locking payment in escrow and releasing funds **only when courier delivery is cryptographically verified** by an automated oracle.

### The Problem
In Indonesia and emerging markets, informal social commerce (via WhatsApp, Instagram DMs, and TikTok Shop) accounts for over Rp 600 trillion annually. Transactions suffer from a chronic lack of trust:
- **Buyer Dilemma:** Transferring money upfront via QRIS or bank transfer offers zero protection. Non-delivery, counterfeit goods, or ghosting sellers leave buyers with no recourse.
- **Seller Dilemma:** Cash-on-Delivery (COD) results in high order cancellation rates, return shipping costs, and tied-up working capital.

### The Solution
Titip Protocol bridges informal habits with blockchain guarantees:
1. **Frictionless QRIS Parsing:** Buyers scan standard Indonesian QRIS codes to extract seller identity directly.
2. **Soroban Smart Contract Escrow:** Funds (USDC stablecoins) are locked trustlessly on Stellar.
3. **Automated Courier Oracle:** Background workers poll major couriers (J&T, JNE, SiCepat). Once the courier marks the package as **Delivered**, the oracle triggers the contract to release payouts automatically.
4. **Deterministic Refund Guarantee:** If a seller fails to ship or delivery is not confirmed before the timeout ledger, buyers reclaim 100% of their funds.

---

## 🚀 Key Features

| Feature | Description |
|---|---|
| 🔒 **Non-Custodial Escrow** | Funds are held exclusively in the Soroban smart contract, never by a centralized company or middleman. |
| 🚚 **Automated Delivery Oracle** | Validates tracking numbers with real-world logistics APIs and executes on-chain payout upon verified delivery. |
| 📱 **EMVCo QRIS Scanner** | Built-in camera and file scanner that decodes standard merchant QRIS payloads and verifies CRC16 checksums. |
| ⏱️ **Guaranteed Refund Timeout** | Transparent ledger-based timeout protection ensuring buyers can safely withdraw funds if the order is abandoned. |
| ⚖️ **Dispute Mediation** | On-chain dispute flagging allows buyers or sellers to halt automatic release if an issue arises for human arbiter resolution. |
| 🌐 **Bilingual Localization** | Full native support for Bahasa Indonesia and English with high-contrast, accessible UI design (WCAG AAA). |
| 📲 **Progressive Web App (PWA)** | Installable directly on iOS and Android devices with instant offline caching and responsive mobile layout. |

---

## 🔄 How It Works

```
  [ BUYER ]                                   [ STELLAR / SOROBAN ]                            [ SELLER ]
     │                                                  │                                          │
     │ 1. Scan Seller QRIS / Input Order Details        │                                          │
     │ 2. Sign create_escrow() & fund(USDC)             │                                          │
     ├─────────────────────────────────────────────────▶│                                          │
     │    (Funds locked securely in contract)           │                                          │
     │                                                  │    3. View Escrow & Dispatch Item        │
     │                                                  │◀─────────────────────────────────────────┤
     │                                                  │    4. submit_tracking(AWB_NUMBER)        │
     │                                                  │                                          │
     │                     [ COURIER ORACLE ]           │                                          │
     │                            │                     │                                          │
     │                            │ 5. Poll Courier API │                                          │
     │                            │ (J&T / JNE / etc.)  │                                          │
     │                            ▼                     │                                          │
     │                     Status: DELIVERED            │                                          │
     │                            │                     │                                          │
     │                            │ 6. confirm_delivery()                                          │
     │                            └────────────────────▶│                                          │
     │                                                  │                                          │
     │                                                  │ 7. Contract automatically transfers      │
     │                                                  │    payout directly to Seller             │
     │                                                  ├─────────────────────────────────────────▶│
     ▼                                                  ▼                                          ▼
```

---

## 🛠️ Architecture & Monorepo Structure

```
titip-protocol/
├── apps/
│   ├── web/                     # Next.js 14 App Router web application
│   │   ├── app/                 # Client pages & secure API routes
│   │   ├── components/          # Reusable UI components & escrow widgets
│   │   ├── lib/                 # Stellar SDK, QRIS parser, SEP-10 auth
│   │   └── hooks/               # Custom hooks for wallet and contract state
│   └── oracle/                  # BullMQ + Redis background logistics polling worker
├── packages/
│   ├── contracts/               # Soroban smart contract source code (Rust)
│   ├── db/                      # PostgreSQL schema & Prisma ORM definitions
│   └── shared-types/            # Shared TypeScript interfaces & types
├── scripts/                     # Deployment, funding & end-to-end simulation scripts
├── docker-compose.yml           # PostgreSQL & Redis development stack
└── README.md
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v18.18.0 or higher
- **npm**: v9.0.0 or higher
- **Docker & Docker Compose**: (for local PostgreSQL & Redis)
- **Freighter Wallet Extension**: [freighter.app](https://www.freighter.app/) (switched to **Testnet**)

### 2. Clone & Install
```bash
git clone https://github.com/rafboa/titip-protocol.git
cd titip-protocol
npm install
```

### 3. Spin Up Infrastructure
Start local PostgreSQL and Redis containers:
```bash
docker compose up -d
```

### 4. Configure Environment
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
> Fill in the variables in `.env.local`. For local testing, default database and testnet endpoints are preconfigured.

### 5. Initialize Database
Push schema migrations and generate the Prisma client:
```bash
npm run setup
```

### 6. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser and connect your Freighter wallet.

---

## 📜 Deployed Smart Contract (Stellar Testnet)

| Contract / Asset | Identifier | Explorer |
|---|---|---|
| **Titip Escrow Contract** | `CDXU2C4KKP7M2NCQM2SD73I7H4UMCU6STLGAF66WPDFOTNYGFENIZV6Z` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDXU2C4KKP7M2NCQM2SD73I7H4UMCU6STLGAF66WPDFOTNYGFENIZV6Z) |
| **USDC SAC (Contract)** | `CAWMLY7NIWOOL4766XQMN7B7ETXPMQMU2JKUGHY5ROQIAU6GBPKJV34K` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAWMLY7NIWOOL4766XQMN7B7ETXPMQMU2JKUGHY5ROQIAU6GBPKJV34K) |
| **USDC Issuer** | `GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2` | [Stellar Expert](https://stellar.expert/explorer/testnet/account/GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2) |

---

## 🧪 Testing & Verification

### Running Automated Unit & Integration Tests
```bash
# Run unit tests (QRIS TLV parser, CRC16 verification, utilities)
npm test

# Type-check TypeScript codebase
npx tsc --noEmit
npm --prefix apps/oracle run build

# Run Next.js production build verification
npm run build
```

### Compiling Smart Contracts
```bash
# Requires Rust 1.84+ and wasm32v1-none target
npm run build:contract

# Run Rust smart contract unit tests
cd packages/contracts
cargo test
```

---

## 🔐 Security & Best Practices

- **Zero Private Keys in Client:** All client transactions are signed directly via the user's Freighter extension. No private keys are ever collected or stored on the server.
- **On-Chain Proof Verification:** State transitions are verified against on-chain transaction hashes and Soroban RPC simulation data before database synchronization.
- **Timing-Safe Oracle Endpoints:** Internal webhook routes utilize constant-time buffer comparisons (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
- **Rate-Limited API Layer:** Sliding-window rate limiters prevent API spam and brute-force tracking lookups.

---

## 📄 License

This repository is licensed under the [MIT License](LICENSE).

---
*Built with ❤️ for the Stellar Community.*
