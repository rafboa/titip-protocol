import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { verifyJwt } from '@/lib/auth/sep10'

const ESCROW_STATUSES = ['PENDING', 'FUNDED', 'SHIPPED', 'DELIVERED', 'REFUNDED'] as const

function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value !== null && typeof value === 'object' && 'toFixed' in value) {
    return String(value)
  }
  return value
}

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } | Promise<{ address: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized: missing authorization header' }, { status: 401 })
    }

    let payload
    try {
      payload = await verifyJwt(authHeader)
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired session' }, { status: 401 })
    }

    const { address } = await Promise.resolve(params)

    if (payload.address !== address) {
      return NextResponse.json(
        { error: 'Forbidden: you can only query your own escrows' },
        { status: 403 }
      )
    }
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
