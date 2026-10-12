// Who is the admin, and the gate every /api/admin route goes through.
//
// The admin is whoever the CONTRACT says it is (`get_config().admin`), proven by a normal SEP-10
// session for that address: there is no admin list in the database or the environment to drift. The
// UI only hides the link from everyone else; the 403 here is the real check.

import { NextResponse } from 'next/server'
import { resolveParty } from '@/lib/evidence/access'
import { isContractAdmin } from './chain-admin'

export type AdminGate = { ok: true; address: string } | { ok: false; response: NextResponse }

/** 401 without a session, 403 for anyone who is not the contract admin, 502 if the chain cannot be read. */
export async function requireAdmin(request: Request): Promise<AdminGate> {
  const caller = await resolveParty(request)
  if (!caller) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    if (!(await isContractAdmin(caller.address))) {
      return { ok: false, response: NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 }) }
    }
  } catch (err: unknown) {
    console.error('[admin] could not read the contract admin:', err)
    return { ok: false, response: NextResponse.json({ error: 'Failed to read the contract admin' }, { status: 502 }) }
  }
  return { ok: true, address: caller.address }
}
