import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@titip/db';
import { buildDisputeEscrowTx, submitSignedTx } from '@/lib/stellar/contracts/escrow';
import { verifyJwt } from '@/lib/auth/sep10';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await verifyJwt(authHeader);
    const callerAddress = payload.address;

    const escrow = await prisma.escrow.findUnique({ where: { id } });

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }

    if (callerAddress !== escrow.buyerAddress && callerAddress !== escrow.sellerAddress) {
      return NextResponse.json({ error: 'Unauthorized: Only buyer or seller can dispute' }, { status: 403 });
    }

    if (escrow.status !== 'FUNDED' && escrow.status !== 'SHIPPED') {
      return NextResponse.json(
        { error: `Cannot dispute escrow with status "${escrow.status}". Expected "FUNDED" or "SHIPPED".` },
        { status: 409 }
      );
    }

    const unsignedDisputeXdr = await buildDisputeEscrowTx(callerAddress, escrow.contractEscrowId);
    return NextResponse.json({ unsignedDisputeXdr });
  } catch (error: unknown) {
    console.error('[GET /api/escrow/:id/dispute] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized: missing authorization header' }, { status: 401 });

    let payload;
    try {
      payload = await verifyJwt(authHeader);
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired session' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { signedXdr } = body;

    if (!signedXdr) {
      return NextResponse.json({ error: 'Missing signedXdr' }, { status: 400 });
    }

    const escrow = await prisma.escrow.findUnique({ where: { id } });

    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }

    if (payload.address !== escrow.buyerAddress && payload.address !== escrow.sellerAddress) {
      return NextResponse.json({ error: 'Forbidden: only buyer or seller can dispute this escrow' }, { status: 403 });
    }

    if (escrow.status !== 'FUNDED' && escrow.status !== 'SHIPPED') {
      return NextResponse.json(
        { error: `Cannot dispute escrow with status "${escrow.status}". Expected "FUNDED" or "SHIPPED".` },
        { status: 409 }
      );
    }

    let txHash: string;
    try {
      txHash = await submitSignedTx(signedXdr);
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : 'Unknown error';
      return NextResponse.json(
        { error: 'Failed to submit dispute transaction', details: message },
        { status: 502 }
      );
    }

    const { getOnChainEscrow } = await import('@/lib/stellar/contracts/escrow');
    const onChain = await getOnChainEscrow(escrow.contractEscrowId);
    if (onChain.status !== 'Disputed') {
      return NextResponse.json(
        { error: `Transaction submitted but contract status is "${onChain.status}", expected "Disputed"` },
        { status: 502 }
      );
    }

    const updated = await prisma.escrow.update({
      where: { id },
      data: {
        status: 'DISPUTED',
      },
    });

    // Notify both parties
    await prisma.notification.create({
      data: {
        userAddress: escrow.buyerAddress,
        type: 'ESCROW_DISPUTED',
        message: `Escrow ${escrow.id} has been disputed and is under review.`,
      },
    });
    
    await prisma.notification.create({
      data: {
        userAddress: escrow.sellerAddress,
        type: 'ESCROW_DISPUTED',
        message: `Escrow ${escrow.id} has been disputed and is under review.`,
      },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
    });
  } catch (error: unknown) {
    console.error('[POST /api/escrow/:id/dispute] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
