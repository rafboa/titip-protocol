# Titip Protocol — Next Development Phases & Engineering Playbook

> **Strategic Roadmap, Architecture Extensions, Implementation Techniques, and Governance Rules**  
> *Target: Scaling Titip Protocol from Post-MVP Testnet to Mainnet Production & Enterprise Integration.*

---

## 🗺️ Master Development Roadmap

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       PHASE PROGRESSION                                           │
│                                                                                                   │
│  [PHASE 1: COMPLETED]                                                                             │
│  • Soroban Escrow State Machine (Rust WASM)                                                       │
│  • QRIS EMVCo Tag Parsing & Checksum Verification                                                 │
│  • Next.js 14 App with SEP-10 Auth & Freighter Wallet                                            │
│  • BullMQ Logistics Oracle & Rate-Limited API Layer                                               │
│  • Dispute State, Tempo Anchor UI & PWA Manifest                                                  │
│                                                                                                   │
│  [PHASE 2: PRODUCTION LOGISTICS & ENTERPRISE WEBHOOKS] ◀ (NEXT PRIORITY)                        │
│  • Real Courier API Agreements & Signed Webhook Handlers (J&T, JNE, SiCepat)                      │
│  • Courier Waybill OCR Scanning (Extract AWB from receipt photos)                                │
│  • Multi-Hop International Logistics (EMS / Pos Indonesia + Local Courier)                        │
│                                                                                                   │
│  [PHASE 3: MULTI-SIG ORACLE & DECENTRALIZED DISPUTE DAO]                                         │
│  • Multi-party Oracle Quorum (m-of-n signatures required for delivery payout)                     │
│  • Staked Oracle Slashing Mechanism (Bonded couriers)                                             │
│  • Community Arbiter Panel & Evidence Locker (IPFS/Arweave image hashes)                          │
│                                                                                                   │
│  [PHASE 4: YIELD-BEARING ESCROW (BLEND PROTOCOL DEFI)]                                            │
│  • Escrow Idle Capital Optimization (Deposit locked USDC into Blend pool)                         │
│  • Yield Distribution: Platform fee discount + Seller bonus                                       │
│  • Emergency Unwind & Instant Liquidity Fallback                                                  │
│                                                                                                   │
│  [PHASE 5: MAINNET HARDENING, AUDIT & NATIVE MOBILE]                                              │
│  • Formal Verification & Third-Party Smart Contract Audit                                         │
│  • Stellar Mainnet Deployment & Production USDC SAC                                               │
│  • React Native / Expo Mobile App with Hardware Biometrics                                        │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📌 Phase 2: Production Logistics & Enterprise Webhooks

### 1. Objective
Transition the oracle from simulated polling to production enterprise integrations with Indonesian couriers (J&T Express, JNE, SiCepat) and international postal trackers.

### 2. Architecture & Components
```
[ Courier Carrier Server ]
          │
          │ HTTPS POST (Signed HMAC-SHA256 Webhook)
          ▼
[ Next.js Edge / Ingestion API ] ───▶ [ Redis Webhook Queue ]
                                               │
                                               ▼
                                  [ BullMQ Idempotent Worker ]
                                               │
                                               ▼ (Validate Status == "DELIVERED")
                                  [ Soroban confirm_delivery() ]
```

### 3. Implementation Techniques
- **Webhook Signature Verification:**  
  Reject any incoming carrier webhook that lacks an authentic HMAC signature in its header:
  ```typescript
  // Technique: Constant-time HMAC comparison
  const signature = req.headers.get("x-courier-signature");
  const computedHash = crypto
    .createHmac("sha256", process.env.COURIER_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedHash))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  ```
- **Idempotency Keys:** Every carrier webhook event contains a unique `event_id` or timestamped tracking event. Store processed `event_id` in Redis with a 72-hour TTL to prevent replay triggers.
- **Waybill Photo OCR (Client-side):** Integrate Tesseract.js / Google Cloud Vision to allow sellers to photograph physical courier receipts, automatically extracting the tracking barcode.

### 4. Verification Checklist
- [ ] Mock webhook server simulates all carrier events (`PICKUP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `RETURN_TO_SENDER`).
- [ ] Replay attacks with identical payloads are blocked by idempotency filters.
- [ ] Non-delivery and return-to-sender flags automatically pause the escrow and notify the buyer.

---

## 📌 Phase 3: Multi-Sig Oracle & Decentralized Dispute DAO

### 1. Objective
Eliminate single-point-of-failure oracle trust by deploying the multi-sig oracle blueprint (`packages/contracts/src/oracle.rs`) and decentralized arbitration.

### 2. Architecture & Components
- **Staked Oracles:** Node operators stake 5,000 XLM / 500 USDC to join the validation network.
- **Threshold Signatures:** A delivery payout requires consensus from $M$-of-$N$ (e.g. 2-of-3) independent oracle operators before `confirm_delivery` is accepted by the contract.
- **Evidence Locker:** When a dispute is raised, buyer and seller upload unboxing videos and packaging photos. Media hashes (SHA-256) are committed to IPFS/Arweave and pinned to the contract.

### 3. Implementation Techniques
- **Soroban Multi-Sig Verification:**
  ```rust
  // Technique: Verifying multiple oracle signatures on-chain
  pub fn confirm_delivery_multisig(
      env: Env,
      escrow_id: u64,
      signatures: Vec<(Address, Signature)>,
  ) -> Result<(), EscrowError> {
      let valid_count = verify_oracle_threshold(&env, escrow_id, signatures)?;
      if valid_count < MIN_THRESHOLD {
          return Err(EscrowError::InsufficientSignatures);
      }
      execute_payout(&env, escrow_id)?;
      Ok(())
  }
  ```
- **Slashing Protocol:** If an oracle signs a fraudulent delivery that is later overturned with indisputable carrier evidence, the admin or DAO triggers `slash_oracle(operator_address)`.

### 4. Verification Checklist
- [ ] Contract rejects payouts with fewer than $M$ valid signatures.
- [ ] Slashed oracles are immediately evicted from the whitelist and their stakes locked.
- [ ] Arbiters can execute proportional split payouts (e.g. 70% refund to buyer, 30% compensation to seller).

---

## 📌 Phase 4: Yield-Bearing Escrow (Blend Protocol Integration)

### 1. Objective
Put idle escrow funds to work. In typical cross-border e-commerce, funds sit locked for 5 to 14 days. By routing locked USDC into Soroban lending protocols (such as Blend), funds earn yield during the transit window.

### 2. Architecture & Components
```
[ Buyer Funds Escrow (1,000 USDC) ]
                │
                ▼
[ Titip Escrow Contract ]
                │ deposit()
                ▼
[ Blend Protocol Lending Pool ] ───▶ Accrues Lending APY (e.g. ~5-8% annual)
                │
    Package Delivered (~7 Days Later)
                │
                ▼
[ Withdraw Principal + Accrued Yield ]
       ├── Principal (1,000 USDC) ──────▶ Sent to Seller
       ├── 70% Yield ───────────────────▶ Rebated to Buyer as Platform Reward
       └── 30% Yield ───────────────────▶ Protocol Treasury / Insurance Reserve
```

### 3. Implementation Techniques
- Use the contract adapter implemented in `packages/contracts/src/yield_adapter.rs`.
- Enforce strict slippage bounds and check lending pool liquidity prior to deposit.
- Provide a synchronous fallback: if the lending pool cannot instantly redeem tokens due to utilization caps, the protocol uses its reserve buffer to pay the seller immediately without delay.

### 4. Verification Checklist
- [ ] Unit tests verify that the exact principal is never placed at loss risk.
- [ ] Emergency `unwind_pool()` function allows contract admins to recall all funds to base escrow in the event of upstream protocol pause.

---

## 📌 Phase 5: Mainnet Launch, Security Audit & Mobile Native

### 1. Objective
Complete professional security audits, launch on Stellar Mainnet with native USDC SAC, and release mobile native wrappers for high-frequency shoppers.

### 2. Audit & Verification Standards
- **Formal Verification:** Verify mathematical invariants using Soroban formal verification tools.
- **Third-Party Security Audit:** Engage reputable Stellar ecosystem audit firms (e.g. OtterSec, Certora, OpenZeppelin).
- **Bug Bounty Program:** Run a public Immunefi bug bounty with tiered rewards for smart contract vulnerabilities.

### 3. Mainnet Launch Steps
1. Deploy production Soroban contract targeting Stellar Mainnet.
2. Initialize with Mainnet Circle USDC SAC address:
   `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`
3. Configure multi-sig cold storage for the contract Admin key.
4. Establish redundancy for Oracle nodes across AWS, GCP, and bare-metal servers.

---

## ⚖️ Engineering Rules & Development Standards

To ensure software quality and user asset safety, all contributions must strictly abide by these rules:

### 1. Smart Contract Invariants (Non-Negotiable)
- **Zero-Custody Rule:** The contract must never transfer funds to any address other than the explicit buyer, seller, or designated arbiter under valid state conditions.
- **Auth Guard Rule:** Every state-modifying function must invoke `.require_auth()` for the appropriate caller.
- **Storage TTL Hygiene:** Every storage write must calculate and extend instance storage TTL to avoid contract archiving.

### 2. API & Backend Security Rules
- **No Unchecked State Changes:** The backend database status must never advance to `FUNDED`, `DELIVERED`, or `REFUNDED` without on-chain ledger proof.
- **Constant-Time Cryptography:** All secret token comparisons must use `crypto.timingSafeEqual`.
- **Sliding-Window Rate Limits:** All public API routes must remain shielded behind rate-limiting middleware.

### 3. Frontend & UX Standards (Anti-Slop Protocol)
- **WCAG 2.1 AAA Contrast:** All text must maintain a minimum contrast ratio of 7:1 against backgrounds.
- **Instant Error Feedback:** Provide human-readable, localized error messages for wallet rejections, insufficient balances, and RPC timeouts.
- **Bilingual Completeness:** Every user-facing string must exist in both `id` (Indonesian) and `en` (English) translation catalogs.

### 4. Git & Code Hygiene
- Never commit private keys, secret seeds, or `.env` files.
- All Pull Requests must pass:
  1. `cargo test` and `cargo build --target wasm32v1-none --release`
  2. `npm test` (all unit and parser tests passing)
  3. `npm run build` (Next.js production build zero errors)
  4. TypeScript type-check (`tsc --noEmit`)

---
*Titip Protocol Engineering Working Group.*
