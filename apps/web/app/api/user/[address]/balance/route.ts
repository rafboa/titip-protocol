import { NextRequest, NextResponse } from 'next/server';
import { getUsdcBalance } from '@/lib/stellar/horizon/accounts';

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } | Promise<{ address: string }> }
) {
  try {
    const { address } = await Promise.resolve(params);
    
    // In a real app we'd verify auth here, but public balance query is harmless
    
    const balance = await getUsdcBalance(address);
    
    return NextResponse.json({ balance: balance || '0' });
  } catch (error: unknown) {
    console.error('[GET /api/user/:address/balance] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
}
