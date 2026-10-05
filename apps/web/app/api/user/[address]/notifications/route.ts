import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'
import { verifyJwt } from '@/lib/auth/sep10'

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
        { error: 'Forbidden: you can only view your own notifications' },
        { status: 403 }
      )
    }

    const notifications = await prisma.notification.findMany({
      where: { userAddress: address },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    const unreadCount = notifications.filter((n) => !n.read).length

    return NextResponse.json({ notifications, unreadCount })
  } catch (error: unknown) {
    console.error('[GET /api/user/:address/notifications] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
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
        { error: 'Forbidden: you can only update your own notifications' },
        { status: 403 }
      )
    }

    const { count } = await prisma.notification.updateMany({
      where: { userAddress: address, read: false },
      data:  { read: true },
    })

    return NextResponse.json({ marked: count })
  } catch (error: unknown) {
    console.error('[PATCH /api/user/:address/notifications] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
