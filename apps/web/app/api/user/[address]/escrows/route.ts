// GET /api/user/:address/escrows
// Returns all escrows where the user is buyer OR seller, sorted newest first.
// Supports optional ?role=buyer|seller filter and ?status=PENDING|FUNDED|... filter.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'

// Escrow statuses matching the Prisma EscrowStatus enum
const ESCROW_STATUSES = ['PENDING', 'FUNDED', 'SHIPPED', 'DELIVERED', 'REFUNDED'] as const

/** JSON replacer that converts BigInt and Decimal to string */
function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  // Prisma Decimal has a toFixed method
  if (value !== null && typeof value === 'object' && 'toFixed' in value) {
    return String(value)
  }
  return value
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params
    const { searchParams } = new URL(request.url)

    const roleFilter = searchParams.get('role')
    const statusFilter = searchParams.get('status')

    // Validate status filter if provided
    const validStatus =
      statusFilter && (ESCROW_STATUSES as readonly string[]).includes(statusFilter)
        ? (statusFilter as (typeof ESCROW_STATUSES)[number])
        : undefined

    // Use separate queries per role to keep Prisma types happy
    let escrows
    if (roleFilter === 'buyer') {
      escrows = await prisma.escrow.findMany({
        where: { buyerAddress: address, ...(validStatus ? { status: validStatus } : {}) },
        orderBy: { createdAt: 'desc' },
      })
    } else if (roleFilter === 'seller') {
      escrows = await prisma.escrow.findMany({
        where: { sellerAddress: address, ...(validStatus ? { status: validStatus } : {}) },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      escrows = await prisma.escrow.findMany({
        where: {
          OR: [{ buyerAddress: address }, { sellerAddress: address }],
          ...(validStatus ? { status: validStatus } : {}),
        },
        orderBy: { createdAt: 'desc' },
      })
    }

    // Serialize BigInt/Decimal safely via JSON round-trip
    const body = JSON.parse(JSON.stringify({
      address,
      count: escrows.length,
      escrows,
    }, jsonSafe))

    return NextResponse.json(body)
  } catch (error: unknown) {
    console.error('[GET /api/user/:address/escrows] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
