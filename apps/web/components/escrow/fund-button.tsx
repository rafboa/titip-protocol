'use client';

import { useState } from 'react';
import { ArrowDownToLine, Loader2, AlertCircle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { signTx, FreighterError } from '@/lib/stellar/freighter';
import { useTranslation } from '@/lib/i18n/use-translation';

export function FundButton({
  escrowId,
  amountUsdc,
  onFunded,
}: {
  escrowId: string;
  amountUsdc: number;
  onFunded: () => void;
}) {
  const { t } = useTranslation();
  const [isFunding, setIsFunding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFund = async () => {
    try {
      setIsFunding(true);
      setError(null);

      const buildRes = await fetch(`/api/escrow/${escrowId}/fund`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('titip_jwt')}` },
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || 'Failed to build funding transaction');

      const signedXdr = await signTx(buildData.unsignedFundXdr);

      const submitRes = await fetch(`/api/escrow/${escrowId}/fund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify({ signedXdr }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Failed to submit funding transaction');

      onFunded();
    } catch (err) {
      if (err instanceof FreighterError) {
        setError(t(`freighterErrors.${err.code}`, err.vars));
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fund escrow');
      }
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5 p-5 sm:p-8">
      <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-primary sm:text-xl">
        <ArrowDownToLine size={20} /> {t('fund.awaitingFunding')}
      </h3>
      <p className="mb-6 leading-relaxed text-muted-foreground text-sm">
        {t('fund.awaitingFundingBody', { amount: amountUsdc })}
      </p>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle size={20} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button onClick={handleFund} disabled={isFunding} className="w-full sm:w-auto">
        {isFunding ? (
          <>
            <Loader2 size={18} className="animate-spin" /> {t('fund.funding')}
          </>
        ) : (
          t('fund.signFund')
        )}
      </Button>
    </Card>
  );
}
