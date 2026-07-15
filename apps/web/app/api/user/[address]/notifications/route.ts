// GET  /api/user/:address/notifications — fetch the 20 most recent notifications
// PATCH /api/user/:address/notifications — mark all unread as read (bulk)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@titip/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params

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
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params

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
