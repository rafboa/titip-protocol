'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Scale, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { signTx, FreighterError } from '@/lib/stellar/freighter';
import { useTranslation } from '@/lib/i18n/use-translation';
import { baseUnitsToDecimal, decimalToBaseUnits, splitAmounts } from '@/lib/admin/split';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const PRESETS = [
  { key: 'admin.presetBuyer', percent: 100 },
  { key: 'admin.presetSplit', percent: 50 },
  { key: 'admin.presetSeller', percent: 0 },
] as const;

/**
 * The admin's decision for a disputed escrow: how much of the locked amount goes back to the buyer.
 * The amounts shown are computed exactly like the contract does (buyer rounded down, seller gets the
 * rest). One Freighter signature pays out on-chain; the server decodes what was signed and records that.
 */
export function DisputeResolution({ escrowId, amountUsdc }: { escrowId: string; amountUsdc: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [percent, setPercent] = useState('50');
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  const parsedPercent = /^\d{1,3}$/.test(percent) ? Number(percent) : Number.NaN;
  const isValid = Number.isInteger(parsedPercent) && parsedPercent >= 0 && parsedPercent <= 100;
  const buyerBps = isValid ? parsedPercent * 100 : 0;
  const split = isValid ? splitAmounts(decimalToBaseUnits(amountUsdc), buyerBps) : null;
  const buyerUsdc = split ? baseUnitsToDecimal(split.buyer) : '-';
  const sellerUsdc = split ? baseUnitsToDecimal(split.seller) : '-';

  const handleResolve = async () => {
    if (!isValid) return;
    try {
      setIsSubmitting(true);
      setError(null);

      // 1. The server builds the transaction for the admin account
      const getRes = await fetch(`/api/admin/disputes/${escrowId}/resolve?buyerBps=${buyerBps}`);
      const getData = await getRes.json();
      if (!getRes.ok) throw new Error(getData.error || 'Failed to prepare the resolution');

      // 2. Sign with Freighter
      const signedXdr = await signTx(getData.unsignedXdr);

      // 3. Submit: the server decodes the signed transaction and records what it contains
      const submitRes = await fetch(`/api/admin/disputes/${escrowId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedXdr }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Failed to resolve the dispute');

      setIsOpen(false);
      setResolved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'dispute', escrowId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'disputes'] }),
      ]);
    } catch (err) {
      setIsOpen(false);
      if (err instanceof FreighterError) {
        setError(t(`freighterErrors.${err.code}`, err.vars));
      } else {
        setError(err instanceof Error ? err.message : 'Failed to resolve the dispute');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card variant="glass" className="mb-8 p-5 sm:p-8">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold sm:text-xl">
        <Scale size={20} className="text-primary" /> {t('admin.decisionTitle')}
      </h3>
      <p className="mb-6 text-muted-foreground">{t('admin.decisionSubtitle')}</p>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle size={20} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {resolved && (
        <Alert variant="success" className="mb-6">
          <CheckCircle2 size={20} />
          <AlertDescription>{t('admin.resolved')}</AlertDescription>
        </Alert>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        {PRESETS.map((preset) => (
          <Button
            key={preset.key}
            type="button"
            variant={parsedPercent === preset.percent ? 'default' : 'outline'}
            onClick={() => setPercent(String(preset.percent))}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            {t(preset.key)}
          </Button>
        ))}
      </div>

      <div className="mb-6">
        <Label htmlFor="buyer-percent" className="mb-2 block">
          {t('admin.buyerShare')}
        </Label>
        <Input
          id="buyer-percent"
          inputMode="numeric"
          value={percent}
          onChange={(e) => setPercent(e.target.value.trim())}
          disabled={isSubmitting}
          className="sm:max-w-[10rem]"
          aria-invalid={!isValid}
        />
      </div>

      <div className="mb-2 grid gap-2 rounded-md bg-black/20 p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4 sm:block">
          <span className="text-muted-foreground">{t('admin.buyerGets')}</span>
          <span className="font-semibold sm:block">{buyerUsdc} USDC</span>
        </div>
        <div className="flex justify-between gap-4 sm:block">
          <span className="text-muted-foreground">{t('admin.sellerGets')}</span>
          <span className="font-semibold sm:block">{sellerUsdc} USDC</span>
        </div>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{t('admin.roundingNote')}</p>

      <Button onClick={() => setIsOpen(true)} disabled={!isValid || isSubmitting} className="w-full sm:w-auto">
        {t('admin.reviewDecision')}
      </Button>

      <Dialog open={isOpen} onOpenChange={(open) => !isSubmitting && setIsOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('admin.confirmBody', { buyer: buyerUsdc, seller: sellerUsdc })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting} className="w-full sm:w-auto">
              {t('admin.cancel')}
            </Button>
            <Button onClick={handleResolve} disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> {t('admin.resolving')}
                </>
              ) : (
                t('admin.confirm')
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
