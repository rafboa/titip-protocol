import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@titip/db';
import { submitResolveDisputeTx } from '@/lib/stellar/contracts/escrow';
import { recordResolution, toAmountString } from '@/lib/admin/resolve';
import { z } from 'zod';

const ResolveSchema = z.object({
  winnerAddress: z.string().min(1, 'winnerAddress is required'),
});

import crypto from 'crypto';

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.ORACLE_INTERNAL_API_KEY;

    if (!expectedToken) {
      return NextResponse.json({ error: 'Server misconfiguration: internal key missing' }, { status: 500 });
    }

    if (!authHeader || !timingSafeEqualStr(authHeader, `Bearer ${expectedToken}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = ResolveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { winnerAddress } = parsed.data;

    const escrow = await prisma.escrow.findUnique({ where: { id } });

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }

    if (escrow.status !== 'DISPUTED') {
      return NextResponse.json(
        { error: `Cannot resolve escrow with status "${escrow.status}". Expected "DISPUTED".` },
        { status: 409 }
      );
    }

    if (winnerAddress !== escrow.buyerAddress && winnerAddress !== escrow.sellerAddress) {
      return NextResponse.json({ error: 'Winner must be either buyer or seller' }, { status: 400 });
    }

    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!adminSecret) {
      console.error('[POST /api/escrow/:id/resolve] ADMIN_SECRET_KEY is missing');
      return NextResponse.json({ error: 'Server misconfiguration: ADMIN_SECRET_KEY missing' }, { status: 500 });
    }

    let txHash: string;
    try {
      txHash = await submitResolveDisputeTx(escrow.contractEscrowId, adminSecret, winnerAddress);
    } catch (err: unknown) {
      console.error('[POST /api/escrow/:id/resolve] Failed to submit on-chain:', err);
      return NextResponse.json(
        { error: 'Failed to submit on-chain transaction' },
        { status: 502 }
      );
    }

    // Same record as the admin screen: a winner is just a split of 100% / 0% to the buyer.
    const isBuyerWinner = winnerAddress === escrow.buyerAddress;
    const recorded = await recordResolution(
      {
        id: escrow.id,
        buyerAddress: escrow.buyerAddress,
        sellerAddress: escrow.sellerAddress,
        amountUsdc: toAmountString(escrow.amountUsdc),
      },
      isBuyerWinner ? 10000 : 0,
      txHash,
      'internal'
    );
    if (!recorded) {
      return NextResponse.json({ error: 'The dispute was resolved by someone else in the meantime' }, { status: 409 });
    }

    return NextResponse.json({
      id: escrow.id,
      status: isBuyerWinner ? 'REFUNDED' : 'DELIVERED',
    });
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/resolve] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
