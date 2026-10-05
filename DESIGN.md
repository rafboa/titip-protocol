# Design System: Titip Protocol

## 1. Product Identity

**What Titip Protocol is:** a trustless QRIS escrow dApp on Stellar/Soroban for Indonesian social commerce. Buyers and sellers transacting through WhatsApp, Instagram, and TikTok lock payment in a smart contract. A courier oracle confirms delivery before releasing funds.

**Target users:** Indonesian consumers buying and selling informally via chat apps. Not traders, not developers, not security analysts. People who scan QRIS codes at warung and track J&T packages. The interface must feel as familiar as a banking app and as clear as a Tokopedia order page.

**Product personality:** confident but approachable, precise but not intimidating. The UI earns trust through clarity and directness, not through density or jargon.

**One-line identity test:** if you swapped the name to "GudangEscrow" or "AmanBeli", would the design still feel like it belongs to this product? If yes, the identity is too generic.

---

## 2. Dials

```
ENERGY:  2  (Balanced — confident fintech, not a government form, not a portfolio showpiece)
RHYTHM:  2  (Consistent with intentional breaks — the dashboard is uniform, the landing shifts pace)
MOTION:  1  (Hover states and page transitions only — no parallax, no perpetual pulses, no scroll choreography)
```

**Why these values:** the audience expects a reliable financial tool, not a creative experiment. Energy 2 says "professional product with character". Rhythm 2 allows the landing page to vary sections without forcing the dashboard into asymmetric layouts. Motion 1 keeps the app fast on mid-range Android phones (the primary device class for Indonesian social commerce users).

---

## 3. Color Palette

### Foundations

| Token              | Value       | Role                                                      |
|---------------------|-------------|-----------------------------------------------------------|
| `--bg-main`         | `#0B0E14`   | Root canvas. Deep blue-black, not pure black.              |
| `--bg-secondary`    | `#131A26`   | Recessed panels, sidebar, card interiors.                  |
| `--bg-glass`        | `rgba(19, 26, 38, 0.6)` | Glassmorphism surface for primary cards.       |
| `--bg-glass-hover`  | `rgba(29, 39, 56, 0.8)` | Hover state on glass surfaces.                 |
| `--border-glass`    | `rgba(255, 255, 255, 0.08)` | Structural 1px borders.                    |

**Why dark:** this is a financial transaction app handling real money. Dark conveys seriousness and reduces visual noise when users are reviewing escrow amounts and tracking statuses. The audience is also accustomed to dark-mode fintech apps (OVO, DANA, GoPay).

### Functional Colors

| Token         | Value       | Role                                                          |
|---------------|-------------|---------------------------------------------------------------|
| `--primary`   | `#2563EB`   | Blue. Primary CTAs, active states, focused inputs.          |
| `--secondary` | `#06B6D4`   | Cyan. Secondary accent, informational highlights.             |
| `--success`   | `#10B981`   | Emerald. Delivery confirmed, escrow completed, funded state.  |
| `--warning`   | `#F59E0B`   | Amber. Pending states, timeout approaching.                   |
| `--danger`    | `#EF4444`   | Red. Refund, dispute, expired, error states.                  |

**Why blue primary:** Blue (#2563EB) conveys trust, stability, and aligns with fintech standards (banking/escrow) while avoiding the crypto "generic blue-purple gradient" trap. It is a single solid color used at specific interaction points, not a gradient wash. The secondary cyan provides contrast for informational elements without competing for attention.

**Palette cap:** 2 core colors (blue + slate neutrals) + 1 accent (cyan) + 3 semantic status colors (success/warning/danger). Status colors are never decorative — each maps to a real escrow state.

### Status Color Mapping

| Escrow State | Color       | Token          |
|-------------|-------------|----------------|
| Pending     | Amber       | `--warning`    |
| Funded      | Blue        | `--primary`    |
| Shipped     | Cyan        | `--secondary`  |
| Delivered   | Emerald     | `--success`    |
| Refunded    | Red         | `--danger`     |
| Expired     | Red (muted) | `--danger` at 60% opacity |

---

## 4. Typography

### Font Stack

| Use             | Family   | Reason                                                        |
|-----------------|----------|---------------------------------------------------------------|
| Display + Body  | `Outfit` | Geometric sans-serif with a warm, rounded character. Reads well at small sizes on mobile. Distinct from Inter/Geist (the AI-default roster) while remaining neutral enough for a financial product. |
| Monospace       | System monospace stack (`ui-monospace, SFMono-Regular, monospace`) | Used only for Stellar addresses, transaction hashes, and USDC amounts — nowhere else. No decorative monospace. |

**Why Outfit:** the product needs a typeface that feels approachable to non-technical Indonesian users. Outfit's slightly rounded terminals soften the fintech severity without looking childish. It is already loaded via Google Fonts in `globals.css` and set as `font-sans` in `tailwind.config.ts`.

### Scale

| Level | Size   | Weight    | Use                                   |
|-------|--------|-----------|---------------------------------------|
| H1    | 2rem   | 700 (bold) | Page titles only (one per page)      |
| H2    | 1.5rem | 600 (semibold) | Section headers                 |
| H3    | 1.125rem | 600    | Card titles, form section headers     |
| Body  | 1rem   | 400       | All running text                      |
| Small | 0.875rem | 400     | Labels, metadata, secondary info      |
| Mono  | 0.8125rem | 400    | Stellar addresses, TX hashes, amounts |

**Line height:** 1.5 for body text, 1.2 for headings.

---

## 5. Component Patterns

### Cards

- Background: `var(--bg-glass)` with `backdrop-filter: blur(16px)`.
- Border: 1px `var(--border-glass)`.
- Border radius: `var(--radius-md)` (12px).
- Glass is used for **escrow cards and the create-escrow form** — these are the primary interactive surfaces that benefit from the layered depth. The sidebar, navbar, and settings page use flat solid backgrounds.

**Glassmorphism dose cap:** glass on escrow cards + the connect-wallet dialog. Maximum 2 glass surfaces visible at any time. Everything else is solid.

### Buttons

| Variant    | Background        | Text          | Use                                  |
|------------|-------------------|---------------|--------------------------------------|
| Primary    | `var(--primary)` solid | White     | One per screen: the main action (Lock USDC, Create Escrow, Connect Wallet) |
| Ghost      | `var(--bg-secondary)` | `var(--text-muted)` → white on hover | Secondary actions (Cancel, View Details) |
| Destructive | `var(--danger)` at 12% opacity | `var(--danger)` | Claim Refund, report dispute |

- Border radius: `var(--radius-sm)` (8px). Not pill-shaped.
- No arrows on buttons. No glow on buttons. No gradient fills.
- `:active` depression via `translateY(1px)` — physical feedback, not a bounce.

### Status Badges

- Compact pill with a **6px dot** matching the escrow state color.
- Uppercase monospace label for the state name.
- The dot marks a real state (Pending, Funded, Shipped, Delivered, Refunded). It is not decorative.
- No glow. No pulse animation. The dot is a static color indicator.

### Forms

- Input backgrounds: `var(--bg-secondary)`.
- Input borders: 1px `var(--border-glass)`, transitioning to `var(--primary)` on focus.
- Border radius: `var(--radius-sm)` (8px).
- Labels above inputs, never floating.
- Validation errors: red text below the field with a specific message, never "Invalid input".

### Tables (Escrow List)

- Column order follows the user's decision path: **Status → Amount → Counterparty → Date → Action**.
- Status is the first column because it answers the immediate question: "what do I need to do?"
- Row hover: `rgba(79, 70, 229, 0.04)` — subtle indigo tint, not a full highlight.

---

## 6. Layout Architecture

### Screens

| Screen          | Layout                                        |
|-----------------|-----------------------------------------------|
| Landing page    | Full-width, single-column, section-based      |
| Dashboard       | Left sidebar (collapsible) + main content area |
| Create Escrow   | Centered form card, max-width 600px           |
| Escrow Detail   | Single-column detail view with timeline       |
| Connect Wallet  | Centered dialog card                          |

### Landing Page Structure

Built around the product's actual content needs, not a template:

1. **Hero:** headline + subtitle + single CTA (Connect Wallet / Enter Dashboard). No eyebrow badge. No screenshot. No logo bar.
2. **Three features:** trustless escrow, decentralized oracle, QRIS integration. These are the product's real differentiators, presented as a simple text grid — not icon cards with identical padding.
3. **How it works:** follows the real escrow flow (Scan QRIS → Lock USDC → Courier delivers → Funds released). Four steps because that is the actual process, not three.

No testimonials section (there are no real testimonials). No FAQ (there are no real FAQs yet). No pricing section. No footer columns — a single line with the project name and links.

### Dashboard Structure

The dashboard's job: **show the user their escrows and let them act on them.**

- Sidebar: navigation only (Escrows, New Escrow, Settings). No stat cards. No activity feed. No charts.
- Main area: escrow list or detail view.
- Empty state says: "Belum ada escrow. Buat escrow pertama Anda lewat QRIS." with a single CTA.

### Responsive

- Sidebar collapses to a hamburger menu below 768px.
- Cards stack vertically on mobile.
- All tap targets minimum 44px.
- Max content width: 1200px (`container.screens['2xl']` in tailwind config).

---

## 7. Motion

Motion dial: **1 (hover states and page transitions only).**

| Interaction          | Animation                                          |
|----------------------|---------------------------------------------------|
| Page content load    | `fadeIn` — 0.6s ease-out, 10px Y-translate. One animation per page, not per element. |
| Button hover         | Background color transition, 0.2s ease.            |
| Glass card hover     | Background opacity shift, 0.3s ease.               |
| Button press         | `translateY(1px)`, instant.                         |
| Status badge update  | None — color changes immediately.                   |

**Explicitly banned:**
- Perpetual pulsing dots or beacons.
- Scroll-triggered reveal on every section.
- Stacked animations (fade + scale + bounce).
- Parallax or mouse-tracking effects.
- Floating elements.

**Reason:** the primary device is a mid-range Android phone on a 4G connection. Motion is a cost. The one `fadeIn` animation on page load gives the interface a polished entry without taxing the GPU on every scroll.

---

## 8. Identity Motif

**The escrow state timeline** is the identity motif. It is the one visual element unique to this product: a vertical sequence of colored dots connected by lines, mapping the real escrow lifecycle (Created → Funded → Shipped → Delivered or Refunded). This pattern appears in:

- The escrow detail page (full timeline with dates and transaction links).
- The escrow card (condensed: current state dot + label).

The timeline uses the status color mapping from section 3 and the 6px dot from the status badge spec. It is the same visual language at two scales.

---

## 9. Anti-Patterns (Specific to This Product)

These are not general rules — they are decisions specific to Titip Protocol's context.

1. **No "cockpit" or "command center" language.** The users are WhatsApp sellers, not SOC analysts. Copy uses plain Indonesian/English financial terms.
2. **No telemetry grids.** There is no real-time data stream to display. Escrow states update when the oracle confirms delivery — that is an event, not a feed.
3. **No 3D visualizations.** No Three.js, no WebGL. The product is a form-and-list app. The visual weight goes into clarity, not decoration.
4. **No fabricated metrics.** Do not show "X transactions processed" or "Y% success rate" unless those numbers come from real chain data.
5. **No gradient text.** The `.text-gradient` utility in `globals.css` (cyan → indigo gradient) is decoration without purpose. Use solid text colors from the palette.
6. **No background radial glows.** The body background currently has two `radial-gradient` blurs (indigo and cyan). These are ambient decoration. The background should be flat `var(--bg-main)`.

---

## 10. File References

This design system maps to the following implementation files:

| File | What it controls |
|------|-----------------|
| [`globals.css`](file:///c:/vscdddd/My_own/stellar_hackaton/titip-protocol/apps/web/app/globals.css) | CSS custom properties (palette, radii), `.glass` utility, body styling |
| [`tailwind.config.ts`](file:///c:/vscdddd/My_own/stellar_hackaton/titip-protocol/apps/web/tailwind.config.ts) | Color mappings, border radius scale, font family, `fadeIn` animation |
| [`translations.ts`](file:///c:/vscdddd/My_own/stellar_hackaton/titip-protocol/apps/web/lib/i18n/translations.ts) | All UI copy (en + id), button labels, status labels, error messages |
