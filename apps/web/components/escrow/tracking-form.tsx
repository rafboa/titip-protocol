'use client';

import { useState } from 'react';
import { Truck, Loader2, AlertCircle } from 'lucide-react';
import { signTx, FreighterError } from '@/lib/stellar/freighter';
import { useTranslation } from '@/lib/i18n/use-translation';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const COURIER_CODES = ['JNT', 'JNE', 'SICEPAT', 'ANTERAJA', 'POS_INDONESIA'] as const;

export function TrackingForm({
  escrowId,
  sellerAddress,
  onSubmitted,
}: {
  escrowId: string;
  sellerAddress: string;
  onSubmitted: () => void;
}) {
  const { t } = useTranslation();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [courierCode, setCourierCode] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!trackingNumber.trim() || !courierCode) return;
    try {
      setIsSubmitting(true);
      setError(null);

      // 1. Get unsigned transaction
      const getRes = await fetch(
        `/api/escrow/${escrowId}/tracking?trackingNumber=${encodeURIComponent(trackingNumber.trim())}&courierCode=${encodeURIComponent(courierCode)}`
      );
      const getData = await getRes.json();

      if (!getRes.ok) throw new Error(getData.error || 'Failed to prepare tracking transaction');

      // 2. Sign with Freighter
      const signedXdr = await signTx(getData.unsignedTrackingXdr);

      // 3. Submit signed transaction
      const submitRes = await fetch(`/api/escrow/${escrowId}/tracking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('titip_jwt')}`,
        },
        body: JSON.stringify({ trackingNumber: trackingNumber.trim(), courierCode, signedXdr }),
      });

      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error || 'Failed to submit tracking');

      onSubmitted();
    } catch (err) {
      if (err instanceof FreighterError) {
        setError(t(`freighterErrors.${err.code}`, err.vars));
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit tracking');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="p-5 sm:p-8">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold sm:text-xl">
        <Truck size={20} className="text-primary" /> {t('tracking.title')}
      </h3>
      <p className="mb-6 text-muted-foreground">{t('tracking.subtitle')}</p>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle size={20} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="courier" className="mb-2 block">
            {t('tracking.courier')}
          </Label>
          <Select value={courierCode} onValueChange={setCourierCode} disabled={isSubmitting}>
            <SelectTrigger id="courier">
              <SelectValue placeholder={t('tracking.selectCourier')} />
            </SelectTrigger>
            <SelectContent>
              {COURIER_CODES.map((code) => (
                <SelectItem key={code} value={code}>
                  {t(`courier.${code}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="tracking-number" className="mb-2 block">
            {t('tracking.trackingNumber')}
          </Label>
          <Input
            id="tracking-number"
            placeholder="JT12345678"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || !trackingNumber.trim() || !courierCode}
        className="w-full sm:w-auto"
      >
        {isSubmitting ? (
          <>
            <Loader2 size={18} className="animate-spin" /> {t('tracking.submitting')}
          </>
        ) : (
          t('tracking.submit')
        )}
      </Button>
    </Card>
  );
}
