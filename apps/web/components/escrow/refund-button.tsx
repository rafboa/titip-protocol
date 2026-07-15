'use client';

import { useState } from 'react';
import { RotateCcw, Loader2, AlertCircle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { signTx, FreighterError } from '@/lib/stellar/freighter';
import { useTranslation } from '@/lib/i18n/use-translation';

export function RefundButton({ escrowId, onRefunded }: { escrowId: string; onRefunded: () => void }) {
  const { t } = useTranslation();
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClaim = async () => {
    try {
      setIsClaiming(true);
      setError(null);

      const buildRes = await fetch(`/api/escrow/${escrowId}/refund`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('titip_jwt')}` },
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || 'Failed to build refund transaction');

      // Network guard runs inside signTx().
      const signedXdr = await signTx(buildData.unsignedRefundXdr);

      const submitRes = await fetch(`/api/escrow/${escrowId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify({ signedXdr }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Failed to submit refund transaction');

      onRefunded();
    } catch (err) {
      if (err instanceof FreighterError) {
        setError(t(`freighterErrors.${err.code}`, err.vars));
      } else {
        setError(err instanceof Error ? err.message : 'Failed to claim refund');
      }
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <Card className="border-warning/20 bg-warning/5 p-5 sm:p-8">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-warning sm:text-xl">
        <RotateCcw size={20} /> {t('refund.title')}
      </h3>
      <p className="mb-6 leading-relaxed text-muted-foreground">{t('refund.body')}</p>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle size={20} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button variant="secondary" onClick={handleClaim} disabled={isClaiming} className="w-full sm:w-auto">
        {isClaiming ? (
          <>
            <Loader2 size={18} className="animate-spin" /> {t('refund.claiming')}
          </>
        ) : (
          t('refund.claim')
        )}
      </Button>
    </Card>
  );
}
