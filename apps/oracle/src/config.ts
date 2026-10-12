// apps/oracle/src/config.ts
// Single source of truth for oracle service configuration.
// All env access is centralised here — never read process.env elsewhere.

import { z } from 'zod'

const EnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Stellar
  ORACLE_SECRET_KEY: z.string().min(1, 'ORACLE_SECRET_KEY is required'),
  STELLAR_NETWORK: z
    .enum(['testnet', 'mainnet'])
    .default('testnet'),
  // TODO(mainnet): set to a mainnet Soroban RPC endpoint
  SOROBAN_RPC_URL: z.string().default('https://soroban-testnet.stellar.org'),

  // Internal API (oracle → Next.js web app)
  APP_INTERNAL_API_URL: z.string().default('http://localhost:3000'),
  ORACLE_INTERNAL_API_KEY: z.string().min(1, 'ORACLE_INTERNAL_API_KEY is required'),

  // The escrow contract this node serves. Falls back to NEXT_PUBLIC_CONTRACT_ADDRESS (the shared .env.local).
  // When set, the pollers skip rows of older contracts, whose escrow ids collide with the current one.
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^C[A-Z2-7]{55}$/, 'CONTRACT_ADDRESS must be a Soroban contract id (C...)')
    .optional(),

  // Oracle identity
  // Also names this node's BullMQ queue, so it must be unique per node and queue-name safe
  // (BullMQ rejects ":"); same character set the web app accepts for oracle_events.
  ORACLE_NODE_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'ORACLE_NODE_ID must be 1-64 chars of A-Z a-z 0-9 _ -')
    .default('oracle-primary'),

  // Courier API keys (optional — adapters handle missing keys gracefully)
  JNT_API_KEY: z.string().optional(),
  JNE_API_KEY: z.string().optional(),
  SICEPAT_API_KEY: z.string().optional(),

  // Poll interval: how often we scan SHIPPED escrows (ms)
  POLL_INTERVAL_MS: z
    .string()
    .transform(Number)
    .default('60000'), // 60 seconds

  // Max concurrent tracking jobs per poll cycle
  MAX_CONCURRENCY: z
    .string()
    .transform(Number)
    .default('5'),
})

function loadConfig() {
  const parsed = EnvSchema.safeParse({
    ...process.env,
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || undefined,
  })
  if (!parsed.success) {
    console.error('❌ Oracle config validation failed:')
    console.error(parsed.error.flatten().fieldErrors)
    process.exit(1)
  }
  return parsed.data
}

export const config = loadConfig()

export type Config = typeof config
