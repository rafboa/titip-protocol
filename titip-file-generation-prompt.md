# Titip Protocol — File Generation Master Prompt

Paste the prompt below into any capable LLM (Claude, GPT-4, Gemini). It will generate three complete project files in sequence: `plan.md`, `instruction.md`, and `claude.md`. Copy each output block into its respective file in the root of your repository.

---

## THE PROMPT

You are a senior full-stack blockchain engineer and technical architect. Your task is to generate three complete project scaffold files for **Titip Protocol** — a trustless social commerce QRIS escrow dApp built on Stellar/Soroban — fully tailored to the tech stack and architecture described below.

Generate all three files in sequence, clearly separated. Do not truncate any file for brevity. Each file must be production-ready and immediately usable as a working reference.

---

### Project Summary

**Titip Protocol** is a trustless escrow dApp for informal Indonesian social commerce. When a buyer pays a seller's QRIS code, instead of settling immediately, the payment is converted to a stablecoin and locked in a Soroban smart contract. A courier oracle monitors delivery status via J&T, JNE, and SiCepat APIs. When delivery is confirmed, the contract releases funds to the seller as fiat via normal QRIS settlement. If the timeout expires without delivery confirmation, the contract refunds the buyer. Neither party experiences the underlying blockchain; they only see a QRIS scan and a payout.

---

### Full Tech Stack

**Frontend / Full-stack Framework**
- Next.js 14+ (App Router, Server Components, Server Actions)
- TypeScript (strict mode, no `any`)
- shadcn/ui for all UI components (prefer it over custom components; use Radix primitives underneath)
- Tailwind CSS (utility-first, no custom CSS unless strictly necessary)
- Recommended additional UI/tooling: v0.dev for rapid shadcn component scaffolding, Lucide React for icons, Framer Motion for transitions

**Blockchain Layer**
- Stellar network (Testnet for MVP, Mainnet-ready architecture)
- Soroban smart contracts (Rust, soroban-sdk)
- Stellar JS SDK (`@stellar/stellar-sdk`) for all transaction building and submission
- Horizon API for account info, transaction history, and ledger queries
- Soroban RPC for smart contract interactions
- Freighter Wallet (browser extension) as the primary wallet connector — use `@stellar/freighter-api` for connection, signing, and network detection
- Stablecoin: USDC on Stellar (issued by Circle, well-supported in Indonesian Stellar ecosystem) as primary; design to support IDR-pegged alternatives later
- Indonesian Stellar Ecosystem to be aware of: TEMPO (tempo.eu.com) as a Stellar anchor supporting IDR fiat on/off-ramp; MoneyGram on Stellar for cross-border; SatoshiPay; Stellar Quest Indonesia community resources; Lobstr wallet as a secondary wallet option

**Backend / API Layer**
- Next.js API routes (Route Handlers) for lightweight backend endpoints
- Courier oracle as a separate long-running Node.js/TypeScript service (runs in its own Docker container)
- Horizon API webhooks or polling for Stellar payment stream monitoring

**Database**
- Primary: PostgreSQL (via Docker, or managed Supabase — recommend Supabase for built-in auth, realtime, and Row Level Security)
- ORM: Prisma (TypeScript-native, great DX)
- Alternative considered: Firebase Firestore (acceptable if team prefers NoSQL; note trade-offs in schema section)
- Include the decision matrix and final recommendation in plan.md

**Infrastructure / DevOps**
- Docker + Docker Compose for local development (Next.js app, PostgreSQL, oracle service, optionally Redis for queue)
- Environment: `.env.local` for local, `.env.production` for prod
- Deployment target: Vercel (Next.js app) + Railway or Render (oracle service + PostgreSQL)
- Recommended CI: GitHub Actions

**AI Tooling (to include in claude.md)**
- Claude (Anthropic) via Claude.ai or API for code generation, architecture review, and smart contract logic
- Cursor IDE with Claude integration for in-editor AI assistance
- v0.dev (Vercel) for scaffolding shadcn/ui components rapidly
- GitHub Copilot as secondary in-editor assistant
- If AI features are built into the app itself: use Vercel AI SDK with Claude claude-sonnet-4-6 model

---

### Smart Contract Architecture (Soroban / Rust)

The escrow contract must implement the following state machine:

**States:** `Pending → Funded → Shipped → Delivered → Refunded`

**Functions to implement:**
- `initialize(buyer, seller, amount, token, timeout_ledger)` → creates escrow, returns escrow_id
- `fund(escrow_id)` → buyer sends stablecoin, transitions Pending → Funded
- `submit_tracking(escrow_id, tracking_number, courier_code)` → seller submits shipment info, transitions Funded → Shipped
- `confirm_delivery(escrow_id)` → only callable by whitelisted oracle address, transitions Shipped → Delivered, releases funds to seller
- `claim_refund(escrow_id)` → callable by buyer after timeout_ledger is passed, transitions Shipped/Funded → Refunded
- `get_escrow(escrow_id)` → read-only, returns full escrow struct
- `get_escrows_by_buyer(buyer)` → returns list of escrow IDs

**Storage:** use Soroban `Map` for escrow records, `Vec` for buyer index, instance storage for admin/oracle config

---

### Database Schema (PostgreSQL / Prisma)

Design tables for:
- `users` (stellar_address as primary key, display_name, created_at, wallet_type)
- `escrows` (escrow_id, contract_address, buyer_address, seller_address, amount_usdc, status, tracking_number, courier_code, qris_merchant_id, qris_merchant_name, created_at, funded_at, shipped_at, delivered_at, refunded_at, timeout_at, stellar_tx_hash_fund, stellar_tx_hash_release)
- `oracle_events` (id, escrow_id, event_type, courier_response_raw, confirmed_at, oracle_node_id)
- `qris_sessions` (session_id, qris_payload_raw, merchant_id, merchant_name, merchant_category_code, amount, parsed_at, linked_escrow_id)
- `notifications` (id, user_address, type, message, read, created_at)

---

### Key API Routes to Define

- `POST /api/escrow/create` — parse QRIS payload, create on-chain escrow, persist to DB
- `GET /api/escrow/[id]` — return escrow status from DB + latest on-chain state
- `POST /api/escrow/[id]/submit-tracking` — seller submits tracking number
- `GET /api/escrow/[id]/tracking` — poll current courier status
- `POST /api/oracle/confirm` — internal oracle callback (protected, signed)
- `GET /api/user/[address]/escrows` — list all escrows for a Stellar address
- `POST /api/qris/parse` — validate and parse an EMVCo QRIS payload string

---

### Docker Compose Services

- `app` — Next.js (port 3000)
- `db` — PostgreSQL 16 (port 5432)
- `oracle` — Node.js courier polling service (no exposed port, internal only)
- `redis` (optional) — BullMQ job queue for oracle polling jobs (port 6379)

---

## FILE 1: Generate `plan.md`

Generate a comprehensive `plan.md` file. This is the single source of truth for the entire project. Include:

**1. Project Overview**
- One-paragraph summary of Titip Protocol
- Problem statement (quantified where possible)
- Solution summary
- Target users and personas
- Hackathon track alignment (Track 3 primary, Track 2 depth)

**2. Architecture Overview**
- Full system architecture narrative (prose + ASCII diagram showing: Browser/Freighter → Next.js App → Stellar Network/Soroban → Oracle Service → Courier APIs → PostgreSQL)
- Data flow walkthrough: step-by-step from "buyer scans QRIS" to "seller receives fiat payout"
- Component responsibility matrix (table: component | owns | does not own)

**3. Tech Stack Decision Log**
- For every technology choice (Next.js, Soroban, PostgreSQL vs Firebase, USDC vs IDR stablecoin, Freighter vs Lobstr, Prisma vs Drizzle, shadcn vs other UI libs), write a short decision record: Options Considered | Decision | Rationale | Trade-offs accepted

**4. Smart Contract Specification**
- Full Soroban contract spec: every function, every state transition, every storage key
- Escrow state machine diagram (ASCII)
- Security constraints per function (access control, validation rules)
- On-chain cost estimate per transaction on Stellar testnet and mainnet
- Contract deployment plan (testnet address placeholder, upgrade strategy)

**5. Database Schema**
- Full Prisma schema (copy-pasteable into `schema.prisma`)
- ERD description
- Indexing strategy
- PostgreSQL vs Firebase trade-off table with final recommendation

**6. API Design**
- Full API route table (method, path, auth, request body, response body, error codes)
- Authentication strategy (Stellar address-based auth via signed challenge, or Supabase Auth)
- Rate limiting strategy

**7. Frontend Architecture**
- Next.js App Router folder structure (full directory tree)
- Page inventory (every page/route with its purpose, auth requirement, and key components)
- State management approach (Zustand, React Context, or server state only — decide and justify)
- Freighter wallet integration flow (connect, sign transaction, handle network mismatch)
- shadcn/ui component list (which components to install from the shadcn CLI)
- Key custom hooks: `useFreighter`, `useEscrow`, `useQRISParser`, `useCourierStatus`

**8. Oracle Service Architecture**
- Oracle service folder structure
- Polling strategy per courier (J&T, JNE, SiCepat)
- Job queue design (BullMQ jobs: `PollCourierJob`, `ConfirmDeliveryJob`, `TriggerTimeoutJob`)
- Oracle signing mechanism (how the oracle signs its confirmation before calling the contract)
- Failure handling and retry logic

**9. Indonesian Stellar Ecosystem Integration**
- TEMPO anchor: how to use it for IDR ↔ USDC conversion (SEP-24 flow)
- USDC on Stellar: asset code, issuer address (testnet and mainnet), where to acquire
- Freighter Wallet: network configuration for testnet vs mainnet, how to prompt users to switch
- Horizon API endpoints to use (testnet: https://horizon-testnet.stellar.org, mainnet: https://horizon.stellar.org)
- Soroban RPC endpoints (testnet and mainnet)
- Stellar Ecosystem Proposals (SEPs) relevant to Titip: SEP-10 (auth), SEP-24 (hosted deposit/withdrawal), SEP-6 (transfer)

**10. Feature Scope**
- MVP feature list (in scope) with acceptance criteria for each
- Out of scope for MVP (with reason)
- Post-hackathon v1.1 and v2.0 roadmap features

**11. Milestones & Timeline**
- Hackathon sprint plan: day-by-day breakdown (Day 1: env + contract, Day 2: oracle + API, Day 3: frontend + demo)
- Post-hackathon milestone table (weeks 1–12)

**12. Risk Register**
- Technical risks (Soroban deployment failure, courier API changes, Freighter compatibility)
- Product risks (low seller adoption, courier API rate limits)
- Regulatory risks (OJK stablecoin classification, Bank Indonesia QRIS rules)
- Mitigation for each

**13. Testing Strategy**
- Unit testing: Soroban contract (soroban-sdk test harness), Next.js API routes (Jest + supertest), oracle service (Jest)
- Integration testing: full escrow lifecycle on testnet
- E2E testing: Playwright for critical user flows (create escrow, fund, confirm delivery)
- Test coverage targets

**14. Environment Variables Reference**
- Full `.env.example` file (copy-pasteable) covering all services

---

## FILE 2: Generate `instruction.md`

Generate a complete `instruction.md` file. This is the step-by-step technical setup guide for a developer joining the project. Everything must be runnable from a clean machine. Include:

**1. Prerequisites**
- Required tools with exact versions: Node.js (specify version), Rust + cargo, soroban-cli, Docker Desktop, Git, pnpm (preferred over npm/yarn — justify), Freighter browser extension
- Recommended VS Code extensions: Rust Analyzer, Prisma, Tailwind CSS IntelliSense, ESLint, Prettier, Thunder Client
- Recommended Cursor extensions if using Cursor IDE

**2. Repository Setup**
- `git clone` + `cd` commands
- `pnpm install` (root workspace)
- Explanation of monorepo structure (apps/web, apps/oracle, packages/contracts, packages/shared-types)

**3. Environment Configuration**
- Copy `.env.example` to `.env.local`
- Walk through every environment variable: what it is, where to get it, example value
- Stellar testnet account creation (friendbot funding)
- Freighter wallet testnet setup

**4. Docker Setup**
- Full `docker-compose.yml` (copy-pasteable): services for app, db, oracle, redis
- `docker compose up -d` to start all services
- Health check commands for each service
- How to connect a DB client (TablePlus, DBeaver) to the containerized PostgreSQL

**5. Database Setup**
- `pnpm prisma generate`
- `pnpm prisma migrate dev --name init`
- `pnpm prisma db seed` (seed file with test data)
- Prisma Studio command for visual inspection

**6. Soroban Contract Setup**
- Install soroban-cli: exact command
- Configure Stellar testnet network in soroban-cli
- Add testnet account identity to soroban-cli
- `cd packages/contracts && cargo build --target wasm32-unknown-unknown --release`
- Deploy to testnet: `soroban contract deploy ...` with full flags
- Initialize the contract: `soroban contract invoke ...` with `initialize` function call
- Save the deployed contract ID to `.env.local`
- How to invoke contract functions manually for testing (full soroban-cli examples for each function)

**7. Next.js App Setup**
- `cd apps/web && pnpm dev`
- Installing shadcn/ui: `pnpm dlx shadcn-ui@latest init` + full list of `pnpm dlx shadcn-ui@latest add` commands for all required components
- Configuring Tailwind for shadcn
- Setting up path aliases in `tsconfig.json`

**8. Oracle Service Setup**
- `cd apps/oracle && pnpm dev`
- BullMQ + Redis setup: how to connect, how to inspect the queue (Bull Board UI)
- How to manually trigger a courier poll for a tracking number (curl command)
- How to simulate a delivery confirmation for local testing (mock oracle endpoint)

**9. Freighter Wallet Integration**
- Install Freighter browser extension (link)
- Create a testnet account inside Freighter
- Fund via Friendbot (exact URL with instructions)
- Add USDC testnet asset to Freighter (testnet USDC asset code and issuer address)
- How to switch Freighter to testnet mode
- Connecting Freighter to the local Next.js app

**10. Running a Full Local Escrow Lifecycle**
- Step-by-step walkthrough: create escrow → fund → submit tracking → simulate delivery confirmation → verify release
- Curl/Thunder Client commands for each API call
- Where to verify on-chain state (Stellar Expert testnet link)
- Where to verify DB state (Prisma Studio)

**11. Running Tests**
- `pnpm test` (all)
- `pnpm test:contract` (Soroban Rust tests)
- `pnpm test:api` (API route tests)
- `pnpm test:e2e` (Playwright)

**12. Common Errors & Fixes**
- List at least 10 common setup errors with their fix (Freighter network mismatch, USDC asset not trusted, Soroban RPC timeout, Prisma migration conflict, Docker port collision, WASM build error, etc.)

**13. Deployment**
- Vercel deployment: `vercel deploy`, required env vars, build config
- Oracle service deployment to Railway: Dockerfile, Railway config
- Contract deployment to Stellar mainnet: network flag change, mainnet account funding, verification
- PostgreSQL on Supabase: connection string format, SSL mode

**14. Useful Commands Cheatsheet**
- One-liner reference table of every command a dev will run repeatedly

---

## FILE 3: Generate `claude.md`

Generate a complete `claude.md` file (also compatible as `AGENTS.md` or `.cursorrules`). This file is read by Claude Code, Cursor, and other AI coding assistants to understand the project and follow its conventions. Include:

**1. Project Identity**
- What Titip Protocol is in 3 sentences
- What problem it solves
- Who uses it
- The single most important architectural fact an AI must not violate

**2. Repository Structure**
- Full annotated directory tree of the entire monorepo (every folder and key file with a one-line description of its purpose)

**3. Technology Stack Quick Reference**
- Flat list of every technology with its role in the project (AI uses this to pick the right tool for every task)

**4. Coding Conventions**

For TypeScript:
- Strict mode always on. No `any` — use `unknown` and narrow properly.
- Prefer `type` over `interface` except for objects that will be extended
- Named exports only (no default exports except Next.js pages/layouts)
- File naming: `kebab-case.ts` for utilities, `PascalCase.tsx` for components
- Folder naming: `kebab-case` always
- No barrel `index.ts` files that re-export everything (causes circular dependency issues)

For React / Next.js:
- App Router only — never use `pages/` directory
- Server Components by default; add `"use client"` only when necessary (Freighter, state, event handlers)
- Server Actions for all form submissions and mutations
- Never fetch data in a Client Component if it can be fetched in a Server Component
- `loading.tsx` and `error.tsx` required for every route segment
- `zod` for all form validation and API input parsing

For shadcn/ui:
- Never modify files inside `components/ui/` — these are generated and will be overwritten
- Custom components go in `components/` (not `components/ui/`)
- Use `cn()` utility from `lib/utils.ts` for all conditional classNames
- Prefer shadcn primitives (Dialog, Sheet, Tabs, etc.) over custom implementations

For Stellar / Soroban:
- Always check Freighter network before building a transaction (testnet vs mainnet guard)
- Always use `TransactionBuilder` from `@stellar/stellar-sdk` — never construct transactions manually
- Always set `fee` explicitly (recommend `BASE_FEE * 100` as minimum for contract calls)
- Always handle `Freighter not installed`, `user rejected`, and `network mismatch` error states
- Soroban contract invocations go in `lib/stellar/contracts/` — never inline in components
- Horizon API calls go in `lib/stellar/horizon/` — use the SDK's `Server` class, not raw fetch

For PostgreSQL / Prisma:
- Never use raw SQL unless Prisma cannot express the query
- Always use `prisma.$transaction()` for multi-table writes
- Migration naming: `pnpm prisma migrate dev --name describe_the_change_in_snake_case`
- Never expose the Prisma client on the client side — all DB access via Server Actions or API routes

For the Oracle Service:
- All courier API calls must have a timeout of 10 seconds and a retry with exponential backoff (max 3 retries)
- Oracle confirmations must be signed with the oracle's Stellar keypair before calling the contract
- Log every oracle event to the `oracle_events` table regardless of outcome
- Never hardcode courier API keys — always use environment variables

**5. Key Files & What They Do**
- List every important file in the project with its exact path and a description of what it contains and what should/should not be edited

**6. What the AI Should Always Do**
- Generate TypeScript types for every API response and Stellar transaction result
- Add `// TODO:` comments for anything that needs testnet verification before mainnet
- Include error boundary handling for every Freighter wallet interaction
- Check if Prisma schema changes require a migration before writing queries
- Wrap every Soroban RPC call in try/catch with specific error type handling
- Suggest shadcn/ui components before suggesting custom implementations

**7. What the AI Should Never Do**
- Never use `fetch()` directly for Stellar — always use `@stellar/stellar-sdk`
- Never store secret keys in the codebase or `.env` files committed to git
- Never trust user-supplied QRIS payloads without running them through the CRC validation function
- Never call the courier oracle directly from the Next.js frontend
- Never use `useEffect` for data fetching — use Server Components or React Query / SWR
- Never modify the Prisma-generated client types
- Never use `as any` or `@ts-ignore` — fix the type properly
- Never deploy a Soroban contract change without updating the ABI types in `packages/shared-types/`
- Never skip the Freighter network guard (testnet vs mainnet check) when building transactions

**8. Stellar-Specific AI Instructions**
- The testnet Horizon URL is `https://horizon-testnet.stellar.org`
- The mainnet Horizon URL is `https://horizon.stellar.org`
- USDC on Stellar testnet: asset code `USDC`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- USDC on Stellar mainnet: asset code `USDC`, issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
- Freighter network IDs: `TESTNET` and `PUBLIC` (mainnet)
- Soroban RPC testnet: `https://soroban-testnet.stellar.org`
- When generating Soroban contract invocation code, always use `SorobanRpc.Server` not the Horizon server
- Always check `account.balances` for USDC trustline before attempting a USDC transfer
- The TEMPO anchor for IDR on/off-ramp uses SEP-24 — use the stellar-base SEP-24 flow helpers

**9. Escrow Business Logic Rules (never violate these)**
- Funds can only be released by the oracle — never by the seller calling the contract directly
- Refunds can only be claimed after `timeout_ledger` has passed — never before
- A `Delivered` escrow can never be refunded
- A `Refunded` escrow can never be released
- The QRIS merchant ID extracted from the payload is the source of truth for seller identity on-chain
- All monetary amounts in the smart contract and database are in stroops (1 XLM = 10,000,000 stroops) or USDC base units (7 decimal places on Stellar)

**10. Environment Variables the AI Can Reference**
- List all env var names (not values) with their type and what they configure

**11. Testing Expectations**
- Every new API route needs a corresponding test in `__tests__/api/`
- Every Soroban contract function needs a Rust test in `packages/contracts/src/test.rs`
- Every new custom hook needs a test in `__tests__/hooks/`
- Minimum coverage target: 70% for MVP, 85% for post-hackathon

**12. AI Persona for This Project**
- You are building infrastructure for informal Indonesian commerce. Prioritize reliability and trust over cleverness.
- When in doubt between a simple solution and a complex one, always choose the simple one for the MVP.
- The user (Roff, CS student at Universitas Diponegoro) is comfortable with TypeScript, Next.js, and system-level thinking. Do not over-explain basics; focus on Stellar/Soroban-specific patterns he may not have encountered before.
- When suggesting UI, always reach for a shadcn component first, then Radix, then custom.
- Stellar SDK patterns change frequently — if generating SDK code, note which SDK version the pattern applies to and flag if it may need verification against the latest docs.
