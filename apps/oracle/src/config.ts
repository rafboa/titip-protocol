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

  // Internal API (oracle → Next.js web app)
  APP_INTERNAL_API_URL: z.string().default('http://localhost:3000'),
  ORACLE_INTERNAL_API_KEY: z.string().min(1, 'ORACLE_INTERNAL_API_KEY is required'),

  // Oracle identity
  ORACLE_NODE_ID: z.string().default('oracle-primary'),

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
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('❌ Oracle config validation failed:')
    console.error(parsed.error.flatten().fieldErrors)
    process.exit(1)
  }
  return parsed.data
}

export const config = loadConfig()

export type Config = typeof config
