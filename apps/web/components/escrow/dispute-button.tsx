'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { signTx } from '@/lib/stellar/freighter';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from '@/lib/i18n/use-translation';

export function DisputeButton({
  escrowId,
  onDisputed,
}: {
  escrowId: string;
  onDisputed: () => void;
}) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDispute = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      const getRes = await fetch(`/api/escrow/${escrowId}/dispute`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('titip_jwt')}` },
      });
      const getData = await getRes.json();

      if (!getRes.ok) throw new Error(getData.error || 'Failed to prepare dispute transaction');

      const signedXdr = await signTx(getData.unsignedDisputeXdr);

      const submitRes = await fetch(`/api/escrow/${escrowId}/dispute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify({ signedXdr }),
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Failed to submit dispute');

      onDisputed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        variant="outline"
        onClick={handleDispute}
        disabled={isSubmitting}
        className="w-full sm:w-auto text-danger border-danger/30 hover:bg-danger/10 hover:text-danger"
      >
        {isSubmitting ? (
          <>
            <Loader2 size={16} className="animate-spin" /> {t('dispute.submitting')}
          </>
        ) : (
          <>
            <AlertTriangle size={16} /> {t('dispute.openDispute')}
          </>
        )}
      </Button>
    </div>
  );
}
