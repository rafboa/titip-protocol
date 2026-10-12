// GET /api/admin/me — is the signed-in user the contract admin? Only used to show or hide the
// "Admin" link; every /api/admin route checks again on its own.

import { NextRequest, NextResponse } from 'next/server'
import { resolveParty } from '@/lib/evidence/access'
import { isContractAdmin } from '@/lib/admin/chain-admin'

export async function GET(request: NextRequest) {
  const caller = await resolveParty(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ isAdmin: await isContractAdmin(caller.address) })
  } catch (err: unknown) {
    console.error('[GET /api/admin/me] could not read the contract admin:', err)
    return NextResponse.json({ isAdmin: false }) // cannot prove it: show nothing
  }
}
