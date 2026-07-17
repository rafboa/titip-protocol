# Titip Protocol — Developer Setup Instructions

Complete setup guide from a clean machine to a running full-stack local environment.

---

## 1. Prerequisites

Install all tools before starting. Exact versions matter for Soroban.

### Required Tools

| Tool | Version | Install |
|---|---|---|
| Node.js | 20.x LTS | `nvm install 20 && nvm use 20` |
| npm | 10.x+ | Bundled with Node.js |
| Rust | stable (1.75+) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| soroban-cli | latest | `cargo install --locked soroban-cli` |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| Git | 2.x | OS package manager |

### Browser

- Chrome or Brave (required for Freighter extension)
- Install **Freighter Wallet**: https://www.freighter.app

### Recommended VS Code Extensions

```
rust-lang.rust-analyzer
Prisma.prisma
bradlc.vscode-tailwindcss
dbaeumer.vscode-eslint
esbenp.prettier-vscode
rangav.vscode-thunder-client
```

If using **Cursor IDE**, the above extensions also apply. Enable Claude integration under Cursor Settings → AI → Model: claude-sonnet-4-6.

### AI Tooling Setup

- **Claude (claude.ai):** Primary code generation. Reference `claude.md` in every session.
- **Cursor:** In-repo AI assistance. Opens `claude.md` automatically via `.cursorrules` symlink.
- **v0.dev:** Rapid shadcn/ui component generation. Use for `escrow-card`, `qris-scanner` UI.

---

## 2. Repository Setup

```bash
# Clone the repo
git clone https://github.com/your-org/titip-protocol.git
cd titip-protocol

# Install all workspace dependencies
npm install

# Verify workspace structure
ls apps/        # web  oracle
ls packages/    # contracts  db  shared-types
```

### Monorepo Structure

```
titip-protocol/
├── apps/
│   ├── web/              # Next.js 14 App Router (frontend + API)
│   └── oracle/           # Node.js courier polling service
├── packages/
│   ├── contracts/        # Soroban smart contract (Rust)
│   ├── db/               # Prisma schema + migrations
│   └── shared-types/     # TypeScript types shared across apps
├── docker-compose.yml
├── .env.example
├── plan.md
├── instruction.md
├── claude.md
└── package.json              # npm workspaces config
```

---

## 3. Environment Configuration

```bash
# Copy example env file
cp .env.example .env.local

# Open and fill in values (instructions for each variable below)
code .env.local
```

### Variable-by-Variable Setup

**`DATABASE_URL`** — Local Docker PostgreSQL:
```
DATABASE_URL=postgresql://titip:titip@localhost:5432/titip_db
```

**`NEXT_PUBLIC_CONTRACT_ADDRESS`** — Leave blank for now; fill after contract deploy (Step 6).

**`JWT_SECRET`** — Generate a random secret:
```bash
openssl rand -base64 32
```

**`ORACLE_SECRET_KEY`** — Generate a dedicated oracle Stellar keypair:
```bash
soroban keys generate oracle-key --network testnet
soroban keys show oracle-key   # copy the Secret Key (S...)
```
Paste the secret key as `ORACLE_SECRET_KEY`.

**`ORACLE_INTERNAL_API_KEY`** — Any random string for internal service auth:
```bash
openssl rand -hex 32
```

**Courier API Keys** — Leave blank for MVP (mock courier is used). Real keys obtained from:
- J&T: https://developer.jet.co.id
- JNE: https://apiv2.jne.co.id/documentation
- SiCepat: https://developer.sicepat.com

---

## 4. Docker Setup

### Start All Services

```bash
# Start PostgreSQL + Redis in background
# docker compose up -d db redis  (if Docker is available)

# Verify containers are healthy
# docker compose ps  (if Docker is available)
```

### `docker-compose.yml`

```yaml
version: '3.9'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: titip
      POSTGRES_PASSWORD: titip
      POSTGRES_DB: titip_db
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U titip']
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5

  oracle:
    build:
      context: ./apps/oracle
      dockerfile: Dockerfile
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - ORACLE_SECRET_KEY=${ORACLE_SECRET_KEY}
      - NEXT_PUBLIC_CONTRACT_ADDRESS=${NEXT_PUBLIC_CONTRACT_ADDRESS}
      - NEXT_PUBLIC_SOROBAN_RPC_URL=${NEXT_PUBLIC_SOROBAN_RPC_URL}
      - NEXT_PUBLIC_STELLAR_NETWORK=${NEXT_PUBLIC_STELLAR_NETWORK}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
```

### Connecting a DB Client

Use TablePlus, DBeaver, or Postico:
- Host: `localhost`
- Port: `5432`
- User: `titip`
- Password: `titip`
- Database: `titip_db`

---

## 5. Database Setup

```bash
# Navigate to the db package
cd packages/db

# Generate Prisma client
npx prisma generate

# Run migrations (creates all tables)
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio for visual inspection
npx prisma studio
# Opens at http://localhost:5555
```

### Seed Test Data

```bash
# Seed 2 test users, 1 funded escrow, 1 shipped escrow
npx prisma db seed
```

Seed file is at `packages/db/prisma/seed.ts`. Edit to add more test scenarios.

---

## 6. Soroban Smart Contract Setup

### Configure soroban-cli

```bash
# Add testnet network config
soroban network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Import your funded testnet account
soroban keys add buyer-account --secret-key <YOUR_TESTNET_SECRET>

# Or generate a new one
soroban keys generate buyer-account --network testnet

# Fund via Friendbot
curl "https://friendbot.stellar.org?addr=$(soroban keys address buyer-account)"
```

### Build the Contract

```bash
cd packages/contracts

# Add WASM target (first time only)
rustup target add wasm32-unknown-unknown

# Build
cargo build --target wasm32-unknown-unknown --release

# Optimized WASM is at:
# target/wasm32-unknown-unknown/release/titip_escrow.wasm
```

### Run Contract Unit Tests

```bash
cargo test
# All tests should pass before deploying
```

### Deploy to Testnet

```bash
# Deploy the contract
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/titip_escrow.wasm \
  --source buyer-account \
  --network testnet

# Output: C... (contract address)
# Copy this address into your .env.local:
# NEXT_PUBLIC_CONTRACT_ADDRESS=C...
```

### Initialize the Contract

```bash
# Replace with your actual addresses
ORACLE_ADDRESS=$(soroban keys address oracle-key)
CONTRACT_ID=<YOUR_CONTRACT_ADDRESS>

soroban contract invoke \
  --id $CONTRACT_ID \
  --source buyer-account \
  --network testnet \
  -- \
  initialize \
  --admin $(soroban keys address buyer-account) \
  --oracle $ORACLE_ADDRESS \
  --token GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2  # testnet USDC issuer (mock)
```

### Useful Contract Invoke Commands (Dev Reference)

```bash
# Read an escrow
soroban contract invoke \
  --id $CONTRACT_ID --source buyer-account --network testnet \
  -- get_escrow --escrow_id 1

# Manually confirm delivery (useful for testing)
soroban contract invoke \
  --id $CONTRACT_ID --source oracle-key --network testnet \
  -- confirm_delivery --escrow_id 1

# Get buyer escrow list
soroban contract invoke \
  --id $CONTRACT_ID --source buyer-account --network testnet \
  -- get_buyer_escrows --buyer $(soroban keys address buyer-account)
```

---

## 7. Next.js App Setup

```bash
cd apps/web

# Start development server
npm run dev
# App runs at http://localhost:3000
```

### First-Time shadcn/ui Setup

```bash
# Initialize shadcn (run once)
npx shadcn-ui@latest init
# Choose: TypeScript ✓, Default style, Slate color, CSS variables ✓

# Install all required components
npx shadcn-ui@latest add button card badge dialog sheet \
  form input label select textarea alert alert-dialog toast \
  tabs separator skeleton dropdown-menu avatar progress \
  tooltip popover command
```

### TypeScript Path Aliases (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@db/*": ["../../packages/db/*"],
      "@shared/*": ["../../packages/shared-types/*"]
    }
  }
}
```

### Configure Tailwind for shadcn

The `tailwind.config.ts` must extend the shadcn config. This is done automatically by the shadcn init command. Verify `content` includes:
```ts
content: [
  './src/**/*.{ts,tsx}',
  '../../packages/shared-types/**/*.{ts,tsx}',
]
```

---

## 8. Oracle Service Setup

```bash
cd apps/oracle

# Start oracle in dev mode (watches for changes)
npm run dev

# Or start via Docker
# docker compose up oracle  (if Docker is available)
```

### Inspect the Job Queue (Bull Board)

```bash
# Start the Bull Board UI (built into oracle service dev mode)
# Visit: http://localhost:3001/queues
```

### Manually Trigger a Courier Poll (Dev Testing)

```bash
# Simulate a poll for a specific escrow
curl -X POST http://localhost:3001/dev/trigger-poll \
  -H "Content-Type: application/json" \
  -d '{ "escrowId": "clxyz123" }'
```

### Simulate Delivery Confirmation (Mock Oracle)

```bash
# This bypasses the courier API and directly triggers confirm_delivery
# Only available when NEXT_PUBLIC_ENVIRONMENT=testnet
curl -X POST http://localhost:3000/api/oracle/confirm \
  -H "Content-Type: application/json" \
  -H "X-Oracle-Api-Key: <your ORACLE_INTERNAL_API_KEY>" \
  -d '{ "escrowId": "clxyz123", "contractEscrowId": "1" }'
```

---

## 9. Freighter Wallet Integration (Local Setup)

### Step 1 — Install Freighter

Install the Freighter browser extension: https://www.freighter.app

### Step 2 — Create a Testnet Account

1. Open Freighter → Create new wallet → Save seed phrase
2. Click the network selector (top right) → Switch to **Testnet**

### Step 3 — Fund via Friendbot

```bash
# Get your Freighter testnet address from the extension
# Then fund it:
curl "https://friendbot.stellar.org?addr=<YOUR_FREIGHTER_ADDRESS>"
# Response: transaction hash confirming 10,000 XLM airdrop
```

### Step 4 — Add USDC Testnet Asset

1. In Freighter → Manage Assets → Add Asset
2. Asset Code: `USDC`
3. Issuer: `GDPQBFYZYWZZHUANOLL2TOIJVIP4JLVRHXTYGGVDGASOW6RGM26MSXZ2` (mock testnet issuer)
4. Click Add → You should see USDC appear with 0 balance

### Step 5 — Get Testnet USDC

The testnet USDC issuer provides free tokens. You can claim via the Stellar testnet anchor or request from Stellar's testnet USDC faucet. Alternatively, build and invoke a mint transaction against the testnet USDC contract (ask Claude for the exact command).

### Step 6 — Connect to Local App

1. Open `http://localhost:3000`
2. Click "Connect Wallet" → Approve in Freighter popup
3. App should display your G... address and USDC balance
4. The network guard will warn if Freighter is on mainnet

---

## 10. Running a Full Local Escrow Lifecycle

Follow these steps to verify the entire system works end-to-end.

### Step 1 — Parse a Sample QRIS Payload

```bash
curl -X POST http://localhost:3000/api/qris/parse \
  -H "Content-Type: application/json" \
  -H "Cookie: titip_session=<your_jwt>" \
  -d '{
    "payload": "00020101021126560014ID.CO.BNI.WWW011893600009150000000102150000000000000000303UBE5204000053033605802ID5920MERCHANT TEST NAME6013Jakarta Pusat61051044062070503***6304ABCD"
  }'
```

Expected response:
```json
{
  "isValid": true,
  "merchantId": "ID.CO.BNI.WWW",
  "merchantName": "MERCHANT TEST NAME",
  "merchantCity": "Jakarta Pusat",
  "categoryCode": "0000",
  "amount": null
}
```

### Step 2 — Create an Escrow

```bash
curl -X POST http://localhost:3000/api/escrow/create \
  -H "Content-Type: application/json" \
  -H "Cookie: titip_session=<jwt>" \
  -d '{
    "qrisPayload": "00020101021126560014...",
    "sellerAddress": "GSELLERADDRESS...",
    "amountUsdc": "50.0000000",
    "timeoutHours": 72
  }'
```

Response includes `unsignedFundXdr` — paste this into Freighter's "Sign Transaction" panel.

### Step 3 — Fund via Freighter

In the UI: go to the escrow detail page → click "Fund Escrow" → approve in Freighter → wait for confirmation. Or use the API:

```bash
curl -X POST http://localhost:3000/api/escrow/<ID>/fund \
  -H "Content-Type: application/json" \
  -H "Cookie: titip_session=<jwt>" \
  -d '{ "txHash": "<transaction_hash_after_signing>" }'
```

Verify on Stellar Expert: `https://stellar.expert/explorer/testnet/tx/<txHash>`

### Step 4 — Submit Tracking (as Seller)

```bash
curl -X POST http://localhost:3000/api/escrow/<ID>/tracking \
  -H "Content-Type: application/json" \
  -H "Cookie: titip_session=<seller_jwt>" \
  -d '{
    "trackingNumber": "JT12345678",
    "courierCode": "JNT"
  }'
```

### Step 5 — Simulate Delivery Confirmation

```bash
curl -X POST http://localhost:3000/api/oracle/confirm \
  -H "Content-Type: application/json" \
  -H "X-Oracle-Api-Key: <ORACLE_INTERNAL_API_KEY>" \
  -d '{
    "escrowId": "<DB_ESCROW_ID>",
    "contractEscrowId": "1"
  }'
```

### Step 6 — Verify Resolution

Check in Prisma Studio (`npx prisma studio`) that:
- `escrows.status` = `DELIVERED`
- `escrows.delivered_at` is set
- `escrows.tx_hash_release` is set

Check on Stellar Expert that the USDC transfer from contract → seller appears.

---

## 11. Running Tests

```bash
# All tests across all packages
npm test

# Smart contract tests (Rust)
cd packages/contracts && cargo test -- --nocapture

# API route tests (Jest)
cd apps/web && npm test

# E2E tests (Playwright)
cd apps/web && npm run test:e2e

# Watch mode for active development
cd apps/web && npm test -- --watch
```

---

## 12. Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `Freighter not detected` | Extension not installed or inactive | Install Freighter; reload page |
| `Network mismatch: expected TESTNET` | Freighter is on mainnet | Freighter → Settings → Network → Testnet |
| `USDC asset not trusted` | Wallet missing USDC trustline | Add USDC asset in Freighter (Step 9.4) |
| `Transaction rejected by user` | User clicked Cancel in Freighter | Retry; check UX wording is clear |
| `Soroban RPC timeout` | Network latency spike | Retry logic in `lib/stellar/contracts/escrow.ts`; check RPC status |
| `WASM build error: linker not found` | Missing `wasm32` target | `rustup target add wasm32-unknown-unknown` |
| `soroban-cli: command not found` | cargo bin not in PATH | `export PATH="$HOME/.cargo/bin:$PATH"` |
| `Docker port 5432 already in use` | Local Postgres running | `sudo lsof -i :5432` → kill the process |
| `Prisma migration conflict` | Schema changed without migrate | `npx prisma migrate reset` (⚠️ deletes data) |
| `JWT malformed / expired` | Cookie expired or wrong secret | Clear cookies; check `JWT_SECRET` matches in env |
| `contract invoke: insufficient funds` | Test account out of XLM | Refund via Friendbot |
| `Error: Contract not initialized` | `initialize()` not called | Re-run soroban contract invoke for `initialize` |

---

## 13. Deployment

### Next.js App → Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from apps/web
cd apps/web
vercel deploy

# Set environment variables in Vercel dashboard or CLI:
vercel env add NEXT_PUBLIC_CONTRACT_ADDRESS production
vercel env add JWT_SECRET production
# ... add all variables from .env.example
```

Vercel Build Settings:
- Root Directory: `apps/web`
- Build Command: `npm run build`
- Output Directory: `.next`

### Oracle Service → Railway

```dockerfile
# apps/oracle/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
```

On Railway: new project → Deploy from GitHub → select `apps/oracle` as root → add all env vars.

### PostgreSQL → Supabase

1. Create project at `supabase.com`
2. Copy the connection string (Project Settings → Database → Connection String → URI mode)
3. Replace `DATABASE_URL` in Vercel and Railway with Supabase URI
4. Run migrations: `npx prisma migrate deploy`

### Contract → Stellar Mainnet

```bash
# Switch soroban-cli to mainnet
soroban network add mainnet \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015"

# Deploy (use a funded mainnet account)
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/titip_escrow.wasm \
  --source mainnet-deployer \
  --network mainnet

# Initialize with mainnet USDC issuer
# USDC mainnet issuer: GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

---

## 14. Command Cheatsheet

```bash
# ── Development ──────────────────────────────────────────
npm install                           # Install all workspace deps
# docker compose up -d db redis       # Start DB + Redis (if Docker available)
npm run dev                           # Start Next.js dev server
cd apps/oracle && npm run dev         # Start oracle service

# ── Database ─────────────────────────────────────────────
npx prisma generate                   # Regenerate Prisma client
npx prisma migrate dev --name <x>     # Create + apply migration
npx prisma db seed                    # Seed test data
npx prisma studio                     # Open DB GUI at :5555
npx prisma migrate reset              # ⚠️ Reset DB (destroys data)

# ── Soroban Contract ─────────────────────────────────────
cargo build --target wasm32-unknown-unknown --release
cargo test                            # Run Rust unit tests
soroban contract deploy ...           # Deploy to testnet
soroban contract invoke ...           # Call contract functions
soroban keys generate <name> --network testnet
soroban keys address <name>           # Get public key
soroban keys show <name>              # Get secret key

# ── Stellar Testnet ──────────────────────────────────────
curl "https://friendbot.stellar.org?addr=<ADDRESS>"  # Fund account

# ── Testing ──────────────────────────────────────────────
npm test                              # All tests
cd packages/contracts && cargo test   # Contract tests only
cd apps/web && npm run test:e2e       # Playwright E2E

# ── Deployment ───────────────────────────────────────────
vercel deploy                         # Deploy Next.js to Vercel
vercel deploy --prod                  # Production deployment
npx prisma migrate deploy             # Apply migrations to prod DB
```
