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

export async function POST(request: NextRequest) {
  // Authenticate via Bearer token
  const authHeader = request.headers.get('authorization')
  const expectedToken = process.env.ORACLE_INTERNAL_API_KEY

  if (!expectedToken) {
    console.error('[POST /api/oracle/confirm] ORACLE_INTERNAL_API_KEY not set in environment')
    return NextResponse.json(
      { error: 'Server misconfiguration' },
      { status: 500 }
    )
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
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

    // Use a transaction to atomically update escrow + create oracle event + notifications
    // NOTE: We do the on-chain submission FIRST, before the DB update.
    // If the DB update fails, we can recover because the contract is already DELIVERED.
    // If the contract call fails, the DB stays SHIPPED.

    let txHashRelease: string | null = null
    const oracleSecret = process.env.ORACLE_SECRET_KEY

    if (oracleSecret) {
      try {
        console.log(`[POST /api/oracle/confirm] Submitting confirm_delivery on-chain for contract escrow ID ${escrow.contractEscrowId}...`)
        const { submitConfirmDeliveryTx } = await import('@/lib/stellar/contracts/escrow')
        txHashRelease = await submitConfirmDeliveryTx(
          BigInt(escrow.contractEscrowId.toString()),
          oracleSecret
        )
        console.log(`[POST /api/oracle/confirm] On-chain confirm_delivery successful: ${txHashRelease}`)
      } catch (err: unknown) {
        console.error(`[POST /api/oracle/confirm] Failed to submit confirm_delivery on-chain:`, err)
        return NextResponse.json(
          { error: 'Failed to submit on-chain transaction' },
          { status: 502 }
        )
      }
    } else {
      console.warn(`[POST /api/oracle/confirm] WARNING: ORACLE_SECRET_KEY not set. Skipping on-chain confirm_delivery!`)
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
