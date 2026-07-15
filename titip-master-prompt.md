# Titip Protocol — Master Planning Prompt

Paste this prompt into any LLM to generate a full, multi-perspective project plan for the Titip Protocol hackathon build.

---

## THE PROMPT

You are a senior product architect, blockchain engineer, UX strategist, and startup advisor simultaneously. Your task is to produce an exhaustive, multi-perspective project plan for **Titip Protocol** — a trustless social commerce escrow system built on Stellar/Soroban — intended for submission to the APAC Stellar Hackathon.

Use the following project brief as your source of truth, then generate a full plan covering every perspective listed below. Be concrete, opinionated, and technically precise. Do not hedge with vague language. Every section should be detailed enough that a team member could pick it up and immediately begin execution.

---

### Project Brief

**Name:** Titip Protocol
**Track:** Track 3 — Payment & Consumer (with Track 2 DeFi depth)
**Tagline:** Your money, held until it's really yours.

**Core Problem:** Billions of rupiah move through informal Indonesian social commerce channels (WhatsApp, Instagram DMs, TikTok Shop live) every month with zero buyer protection. A seller posts a static QRIS code, the buyer pays upfront, and the only guarantee is trust. Non-delivery fraud is endemic, and there is no recourse once the transfer clears.

**Core Solution:** Titip Protocol intercepts a payment destined for a seller's existing static QRIS code and routes it into a Soroban escrow smart contract, converting it to a stablecoin and holding it trustlessly until a backend courier oracle (polling J&T, JNE, or SiCepat APIs) confirms delivery status as "Delivered." On confirmation, the contract releases funds and bridges them back to fiat for the seller's normal QRIS payout. On timeout (delivery never confirmed), the contract returns funds to the buyer. Neither the buyer's payment UX nor the seller's payout UX changes — all innovation is in the protocol layer between them.

**Target Users:**
- Buyers in informal social commerce (WhatsApp groups, Instagram DMs, TikTok Shop)
- Small sellers running peer-to-peer storefronts without formal marketplace presence
- Group buyers coordinating shared orders

**Technical Stack:**
- Frontend: EMVCo-compliant QRIS payload parser + lightweight web or mobile app
- Smart contract: Soroban (Rust) — escrow state machine, timeout logic, oracle interface
- Backend/Oracle: Webhook or polling service tracking courier APIs (J&T Express, JNE, SiCepat)
- Chain: Stellar Testnet (MVP), Stellar Mainnet (post-hackathon)
- Stablecoin: USDC or IDR-pegged stablecoin on Stellar

**Hackathon Constraints:**
- Must deploy a functional MVP on Stellar Testnet
- Demo must show a complete escrow lifecycle (lock → oracle trigger → release or refund)
- Judges prioritize genuine APAC financial friction, technical depth, and UX clarity
- Slide-only projects do not place

---

### Required Perspectives

Generate a complete, structured plan for each of the following eight perspectives. Each section must be standalone and detailed enough to act as a working reference document.

---

#### 1. Technical Architecture & Engineering Plan

Cover the following in full:

- **System architecture overview:** Draw (in text/ASCII) the full data flow from QRIS scan to final settlement, including all components (frontend parser, Soroban contract, oracle backend, Stellar network, fiat bridge)
- **Soroban smart contract design:**
  - Contract state variables and their types (escrow ID, buyer address, seller address, amount, status enum, timeout timestamp, tracking number)
  - Complete list of contract functions with their signatures, inputs, outputs, and access control (who can call each function): `initialize_escrow`, `lock_funds`, `submit_tracking`, `confirm_delivery`, `trigger_timeout_refund`, `get_escrow_status`
  - Contract state machine: enumerate every state (Pending, Funded, Shipped, Delivered, Refunded, Disputed) and every valid state transition with its trigger
  - Storage design: what is stored on-chain vs off-chain
  - Security considerations: reentrancy, oracle manipulation, front-running, fake delivery confirmation
- **EMVCo QRIS payload parser:**
  - Structure of an EMVCo-compliant QRIS string
  - Which fields must be parsed (Merchant Account Info, Transaction Amount, Merchant Category Code, Merchant Name, Merchant City)
  - How to validate the CRC checksum
  - Edge cases to handle (static vs dynamic QR, missing fields, malformed payloads)
- **Courier oracle design:**
  - Architecture choice (polling vs webhook) and justification
  - How to map a tracking number to a courier (J&T, JNE, SiCepat prefix detection)
  - How oracle results are signed and submitted to the Soroban contract
  - How to prevent oracle manipulation or spoofed delivery confirmations
  - Fallback strategy if courier API is unavailable
- **Fiat bridge / settlement layer:**
  - How the stablecoin release is converted back to fiat and routed into the seller's standard QRIS settlement
  - Which Stellar anchor or fiat gateway handles the off-ramp
  - Latency and confirmation time considerations
- **Tech stack specifics:** exact libraries, Soroban SDK version, Rust crate dependencies, frontend framework, oracle language/runtime
- **Repository structure:** recommended folder layout for a mono-repo containing the Soroban contract, oracle backend, and frontend
- **Testing strategy:** unit tests for the contract, oracle mock strategy for testnet, integration test scenarios covering all state transitions including edge cases
- **Known technical risks and mitigations**

---

#### 2. Product & Feature Scope Plan

Cover the following in full:

- **MVP feature set (hackathon demo scope):** List every feature that IS in scope and IS NOT in scope, with justification for each cut
- **User stories (must cover buyer, seller, and oracle/admin roles):** Write at least 8 user stories in the format "As a [role], I want to [action] so that [outcome]"
- **Feature prioritization matrix:** Rate each feature by impact (High/Medium/Low) and effort (High/Medium/Low), and produce a recommended build order
- **Post-hackathon product roadmap:** Define three phases (v1.0 MVP polish, v1.1 core expansion, v2.0 ecosystem scale) with specific feature additions in each
- **Success metrics:** Define 5 quantitative KPIs that would indicate the protocol is working (e.g., escrow completion rate, median lock duration, dispute rate, oracle accuracy, time-to-fiat-settlement)
- **Competitive analysis:** Compare Titip Protocol against at least four alternatives (Tokopedia/Shopee built-in escrow, bank transfer + manual confirmation, crypto escrow apps, informal trust-based commerce) across dimensions of trustlessness, UX friction, merchant setup cost, and buyer protection strength

---

#### 3. UX & Design Plan

Cover the following in full:

- **Full user flow for the buyer:** Step-by-step from "I found a product in a WhatsApp group" to "I received my item and the seller was paid" — include every screen, decision point, and system event in between
- **Full user flow for the seller:** Step-by-step from "I posted my QRIS in a group chat" to "I received my fiat payout after delivery" — include every touchpoint
- **Screen inventory:** List every screen/view required for the MVP frontend, with a brief description of its purpose and primary action
- **Key UX principles for this product:** Identify 4 design principles specific to Titip Protocol (e.g., "the buyer should never feel like they are using crypto") and explain how each principle constrains design decisions
- **Onboarding flow:** How does a first-time buyer set up a Titip wallet? How does a seller register their QRIS with the protocol? Keep both flows under 3 steps if possible
- **Trust signals:** What visual and interaction design elements communicate to both parties that funds are safe and the protocol is reliable? List at least 5 specific UI/UX patterns to implement
- **Error states and edge cases:** Design the UX response for: courier API timeout, failed stablecoin conversion, seller never submitting tracking number, buyer disputing a confirmed delivery
- **Accessibility and localization:** What language(s) must the interface support for the target market? What accessibility baseline should the MVP hit?

---

#### 4. Business & Go-to-Market Plan

Cover the following in full:

- **Market sizing:** Estimate the total addressable market (TAM), serviceable addressable market (SAM), and serviceable obtainable market (SOM) for informal social commerce in Indonesia, using real or reasonably estimated figures
- **Revenue model:** Propose at least three monetization mechanisms (e.g., per-transaction escrow fee, premium seller verification badge, B2B oracle API licensing) — for each, specify the fee structure, who pays, and projected revenue at 10k, 100k, and 1M monthly transactions
- **Unit economics:** What is the cost per escrow transaction (oracle API call cost, gas, fiat bridge fee)? What fee does the protocol need to charge to be margin-positive?
- **Go-to-market strategy:** Identify the single highest-leverage distribution channel for initial user acquisition (WhatsApp group admins, micro-influencer sellers, TikTok Shop communities, etc.) and write a concrete 30-day launch plan
- **Partnerships required:** List at least 5 specific partnership types needed (courier companies, Stellar anchors, social commerce platforms, QRIS operators, NGOs) and what the value exchange is for each
- **Regulatory landscape:** What Indonesian financial regulations apply to an escrow protocol dealing in stablecoins? What licenses might be required? What is the safest initial legal structure to operate under during the hackathon phase?
- **Risk register (business):** List at least 5 business risks (regulatory crackdown, courier API deprecation, low seller adoption, QRIS operator opposition, stablecoin depegging) and a mitigation strategy for each

---

#### 5. Blockchain & Protocol Economics Plan

Cover the following in full:

- **On-chain cost analysis:** Estimate the Stellar/Soroban transaction fees for a full escrow lifecycle (lock, oracle call, release). Are these costs acceptable for small transactions (e.g., a Rp50,000 purchase)?
- **Stablecoin selection:** Compare USDC on Stellar vs an IDR-pegged stablecoin vs USDT for use in this protocol across dimensions of liquidity, peg stability, regulatory risk, and user familiarity. Recommend one and justify
- **Liquidity and float:** When funds are locked in escrow, what happens to them? Should idle escrow funds be deployed into yield-bearing instruments (connecting to Blueprint C mechanics)? What are the risks?
- **Oracle incentive design:** If the oracle becomes a critical infrastructure component, how should it be decentralized over time? Who runs oracle nodes? How are they compensated and penalized for inaccurate reporting?
- **Fee structure design:** What is the optimal fee split between the protocol, the oracle operator, and the fiat bridge? Design a fee table showing total buyer cost at various transaction sizes (Rp50k, Rp200k, Rp500k, Rp1M, Rp5M)
- **Timeout parameter design:** What is the right default timeout window? How should it vary by merchant category or courier type? What are the second-order effects of setting it too short or too long?
- **Protocol governance:** Who controls contract upgrades? How should the protocol transition from a centralized hackathon deploy to a community-governed protocol?

---

#### 6. Hackathon Execution Plan

Cover the following in full:

- **Build timeline:** Produce a day-by-day execution plan for a 48–72 hour hackathon sprint, broken into phases (environment setup, contract development, oracle backend, frontend integration, testing, demo preparation, pitch rehearsal). Assign realistic time budgets to each phase
- **Team role breakdown:** Define 4 roles (smart contract engineer, backend/oracle engineer, frontend engineer, pitch/product lead) and list the specific deliverables each role owns
- **Minimum viable demo script:** Write a step-by-step demo narrative that a judge can follow in under 3 minutes — what does the presenter click, what does the judge see on screen, what is said at each step?
- **Judging criteria alignment:** Map each of the hackathon's evaluation criteria (technical implementation, innovation, feasibility, UX, APAC relevance) to a specific Titip Protocol feature or decision and explain how it scores positively against each
- **Contingency plans:** What is the fallback if the Soroban contract fails to deploy? What is the fallback if the courier API is unreachable during the demo? What is the cut-down scope if the team is behind schedule at the 36-hour mark?
- **Presentation structure:** Outline the full pitch deck (slides 1–10) with the title, key message, and visual or demo moment for each slide
- **Common judge questions and answers:** Anticipate at least 8 questions a skeptical judge might ask (Why not just use Tokopedia? What stops the oracle from lying? What happens if Stellar goes down? etc.) and write concise, confident answers

---

#### 7. Risk & Security Plan

Cover the following in full:

- **Smart contract attack surface:** For each contract function, identify the most likely attack vector and the mitigation (e.g., `confirm_delivery` — oracle address spoofing → only whitelisted oracle addresses can call this function)
- **Oracle security model:** How does the contract verify that a delivery confirmation is genuine? What prevents a malicious actor from deploying a fake oracle and calling `confirm_delivery` early?
- **Fraud scenarios:** Design the protocol's response to at least 6 specific fraud scenarios: (1) seller ships an empty box to trigger delivery confirmation, (2) buyer claims non-delivery after actually receiving goods, (3) oracle is bribed to confirm fake delivery, (4) seller and oracle collude, (5) buyer initiates a chargeback on the fiat-to-stablecoin conversion, (6) man-in-the-middle attack on the QRIS payload
- **Dispute resolution mechanism:** What happens when buyer and seller genuinely disagree and the oracle data is ambiguous? Design a lightweight on-chain or hybrid dispute resolution path
- **Protocol-level risks:** What are the risks of Stellar network downtime, stablecoin depegging, or Soroban contract bugs during a live transaction? How does the user experience these failures and what is the recovery path?
- **Privacy considerations:** What data is stored on-chain? Is any PII (buyer/seller identity, transaction contents) exposed? How does this interact with Indonesian data protection law (UU PDP)?
- **Security audit checklist:** Produce a 15-point security checklist that the Soroban contract should pass before any mainnet deployment

---

#### 8. Ecosystem & Integration Plan

Cover the following in full:

- **Courier API integration spec:** For J&T Express, JNE, and SiCepat — list the specific API endpoints to poll, the authentication mechanism, the response schema, the field that maps to delivery status, and the polling frequency. If real API docs are unknown, specify what the oracle should assume and flag for validation
- **QRIS ecosystem integration:** How does Titip Protocol integrate with the existing QRIS infrastructure without requiring merchant re-registration? What is the technical mechanism for "intercepting" a payment headed to a static QR and routing it through the escrow layer instead?
- **Stellar ecosystem dependencies:** List every Stellar-native component the protocol depends on (anchors, DEX, Soroban runtime, Stellar SDK) and the maturity/risk level of each
- **Social commerce platform strategy:** How does a seller activate Titip Protocol for their WhatsApp group or Instagram storefront? Is there a browser extension, a QR code generator, or a Titip-wrapped link? Design the onboarding touchpoint
- **Future composability with other Stellar protocols:** How could Titip Protocol compose with Blueprint A (smart account spending policies), Blueprint C (merchant yield), or Blueprint E (streaming payroll) on the same Soroban runtime? Identify at least 3 specific composability opportunities
- **International expansion path:** Which other APAC social commerce markets (Philippines, Vietnam, Thailand, Malaysia) have analogous informal commerce + QR payment combinations that Titip Protocol could expand into? For each, identify the local QR standard, the dominant couriers, and the regulatory environment
- **Developer ecosystem:** What would a Titip Protocol SDK look like? What APIs should be exposed for third-party developers to integrate escrow into their own social commerce tools?

---

### Output Format Instructions

- Use clear H2 and H3 headings for each perspective and sub-section
- Use bullet points for lists, numbered lists for sequences and steps, and tables where comparisons are made
- For the technical sections, include pseudocode, function signatures, and schema definitions where applicable
- Be specific with numbers: name actual APIs, actual fee estimates, actual transaction counts, actual Indonesian regulations
- Where data is uncertain, state the assumption clearly and flag it for validation
- Total output length should be comprehensive — do not truncate any section for brevity
- End each perspective section with a "Key decisions to confirm" subsection listing 3–5 open questions the team must resolve before that perspective's plan can be finalized
