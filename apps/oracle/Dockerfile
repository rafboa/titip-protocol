# apps/oracle/Dockerfile
# Multi-stage build for the Titip Protocol Oracle Service

# ── Stage 1: builder ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Dependencies are installed with npm (no pnpm needed)

# Copy all source
COPY . .

# Install all workspace deps
RUN npm ci

# Generate Prisma client
WORKDIR /app/packages/db
RUN npx prisma generate

# Build oracle TypeScript
WORKDIR /app/apps/oracle
RUN npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts
COPY --from=builder /app/apps/oracle/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/node_modules/.prisma ./node_modules/.prisma

CMD ["node", "dist/index.js"]
