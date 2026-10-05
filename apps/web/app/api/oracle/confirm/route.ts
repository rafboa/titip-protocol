// POST /api/oracle/confirm
// Internal endpoint called by the oracle service when delivery is confirmed.
// Protected by ORACLE_INTERNAL_API_KEY in the Authorization header.
// Updates escrow status to DELIVERED, records an oracle event, and notifies both parties.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'

const ConfirmSchema = z.object({
  escrowId: z.string().min(1, 'escrowId is required'),
  // v1.1: Accept courierResponse JSON for audit trail
  courierResponse: z.record(z.string(), z.any()).optional(),
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

    const { escrowId, courierResponse } = parsed.data

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

    const oracleSecret = process.env.ORACLE_SECRET_KEY
    if (!oracleSecret) {
      console.error('[POST /api/oracle/confirm] ORACLE_SECRET_KEY is missing; cannot release funds on-chain')
      return NextResponse.json(
        { error: 'Server misconfiguration: ORACLE_SECRET_KEY missing' },
        { status: 500 }
      )
    }

    let txHashRelease: string
    try {
      const { submitConfirmDeliveryTx } = await import('@/lib/stellar/contracts/escrow')
      txHashRelease = await submitConfirmDeliveryTx(
        BigInt(escrow.contractEscrowId.toString()),
        oracleSecret
      )
    } catch (err: unknown) {
      console.error('[POST /api/oracle/confirm] Failed to submit confirm_delivery on-chain:', err)
      return NextResponse.json(
        { error: 'Failed to submit on-chain transaction' },
        { status: 502 }
      )
    }

    const [updated] = await prisma.$transaction([
      prisma.escrow.update({
        where: { id: escrowId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          txHashRelease: txHashRelease,
        },
      }),
      prisma.oracleEvent.create({
        data: {
          escrowId,
          eventType: 'DELIVERY_CONFIRMED',
          courierResponse: (courierResponse ?? undefined) as Prisma.InputJsonValue | undefined,
          oracleNodeId: 'oracle-primary', // v1.1: Support multiple oracle nodes
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
