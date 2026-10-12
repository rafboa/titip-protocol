// POST /api/oracle/confirm
// Internal endpoint called by the oracle service when delivery is confirmed.
// Protected by ORACLE_INTERNAL_API_KEY in the Authorization header.
// The oracle service has already signed and submitted confirm_delivery on-chain with its
// own key; this endpoint never holds the oracle secret. It re-reads the contract state
// (the source of truth) and only then syncs the DB, records an oracle event and notifies parties.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'

const ConfirmSchema = z.object({
  escrowId: z.string().min(1, 'escrowId is required'),
  // Stellar tx hash (64 hex chars). Absent when the oracle found the escrow already Delivered on-chain.
  txHash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'txHash must be a 64-char hex string').optional(),
  // v1.1: Accept courierResponse JSON for audit trail
  courierResponse: z.record(z.string(), z.any()).optional(),
  // Which oracle node synced this delivery; a label for oracle_events (callers are already
  // authenticated by the shared internal key, so this is not an identity claim).
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'nodeId must be 1-64 chars of A-Z a-z 0-9 _ -').optional(),
})

import crypto from 'crypto'

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedToken = process.env.ORACLE_INTERNAL_API_KEY

  if (!expectedToken) {
    console.error('[POST /api/oracle/confirm] ORACLE_INTERNAL_API_KEY not set in environment')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (!authHeader || !timingSafeEqualStr(authHeader, `Bearer ${expectedToken}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body: unknown = await request.json()
    const parsed = ConfirmSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { escrowId, courierResponse, txHash, nodeId } = parsed.data

    const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } })

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }

    if (escrow.status !== 'SHIPPED') {
      return NextResponse.json(
        { error: `Cannot confirm delivery for escrow with status "${escrow.status}". Expected "SHIPPED".` },
        { status: 409 }
      )
    }

    // Chain wins: only sync the DB once the contract itself says Delivered.
    // Mock mode (demo/dev scripts) has no chain to verify and is refused in production.
    const mockMode =
      process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT === 'true' && process.env.NODE_ENV !== 'production'
    if (!mockMode) {
      try {
        const { getOnChainEscrow } = await import('@/lib/stellar/contracts/escrow')
        const onChain = await getOnChainEscrow(BigInt(escrow.contractEscrowId.toString()))
        if (onChain.status !== 'Delivered') {
          return NextResponse.json(
            { error: `On-chain status is "${onChain.status}", not "Delivered"` },
            { status: 409 }
          )
        }
      } catch (err: unknown) {
        console.error('[POST /api/oracle/confirm] Failed to verify on-chain state:', err)
        return NextResponse.json({ error: 'Failed to verify on-chain state' }, { status: 502 })
      }
    }

    const [updated] = await prisma.$transaction([
      prisma.escrow.update({
        where: { id: escrowId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          ...(txHash ? { txHashRelease: txHash } : {}),
        },
      }),
      prisma.oracleEvent.create({
        data: {
          escrowId,
          eventType: 'DELIVERY_CONFIRMED',
          courierResponse: (courierResponse ?? undefined) as Prisma.InputJsonValue | undefined,
          oracleNodeId: nodeId ?? 'unknown',
        },
      }),
      // Notify seller — funds released
      prisma.notification.create({
        data: {
          userAddress: escrow.sellerAddress,
          type: 'FUNDS_RELEASED',
          message: `Delivery confirmed! ${escrow.amountUsdc} USDC has been released to your account.`,
        },
      }),
      // Notify buyer — delivery confirmed
      prisma.notification.create({
        data: {
          userAddress: escrow.buyerAddress,
          type: 'DELIVERY_CONFIRMED',
          message: `Your order has been delivered. Escrow ${escrow.id} is now complete.`,
        },
      }),
    ])

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      deliveredAt: updated.deliveredAt?.toISOString(),
    })
  } catch (error: unknown) {
    console.error('[POST /api/oracle/confirm] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
