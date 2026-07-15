// GET /api/health
// Health check endpoint — verifies DB and chain connectivity

import { NextResponse } from 'next/server'
import { prisma } from '@titip/db'

export async function GET() {
  const health: {
    ok: boolean
    db: boolean
    chain: boolean
    timestamp: string
    errors: string[]
  } = {
    ok: true,
    db: false,
    chain: false,
    timestamp: new Date().toISOString(),
    errors: [],
  }

  // Check DB connectivity
  try {
    await prisma.$queryRaw`SELECT 1`
    health.db = true
  } catch (error: unknown) {
    health.ok = false
    health.errors.push(
      `DB: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  // Check Soroban RPC connectivity
  try {
    const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
    const response = await fetch(`${rpcUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth',
      }),
    })

    if (response.ok) {
      health.chain = true
    } else {
      health.ok = false
      health.errors.push(`Chain: HTTP ${response.status}`)
    }
  } catch (error: unknown) {
    health.ok = false
    health.errors.push(
      `Chain: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  return NextResponse.json(health, {
    status: health.ok ? 200 : 503,
  })
}
