'use client';

import { useState } from 'react';
import { Route, Loader2, AlertCircle, Plus, Check, X } from 'lucide-react';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Card } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { WaybillScanner } from '@/components/escrow/waybill-scanner';

const COURIER_CODES = ['JNT', 'JNE', 'SICEPAT', 'ANTERAJA', 'POS_INDONESIA'] as const;
const MAX_LIVE_LEGS = 5; // keep in sync with the legs API route

export type ShipmentLeg = {
  id: string;
  seq: number;
  courier: string;
  trackingNumber: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  stage: string | null;
};

const STATUS_VARIANT: Record<ShipmentLeg['status'], BadgeProps['variant']> = {
  PROPOSED: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

/**
 * Multi-leg shipping (e.g. Pos Indonesia -> local courier). The escrow's own tracking number is
 * leg 1; the seller proposes further legs and the buyer must approve each one. Funds are only
 * released when the final approved leg is delivered (enforced by the oracle, not by this UI).
 */
export function ShipmentLegs({
  escrowId,
  escrowStatus,
  isBuyer,
  isSeller,
  primary,
  legs,
  onChanged,
}: {
  escrowId: string;
  escrowStatus: string;
  isBuyer: boolean;
  isSeller: boolean;
  primary: { courierCode: string | null; trackingNumber: string | null };
  legs: ShipmentLeg[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [courierCode, setCourierCode] = useState<string>('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = legs.filter((l) => l.status !== 'REJECTED');
  const hasPending = legs.some((l) => l.status === 'PROPOSED');
  const canPropose = isSeller && escrowStatus === 'SHIPPED' && !hasPending && live.length < MAX_LIVE_LEGS;
  const canDecide = isBuyer && escrowStatus === 'SHIPPED';

  // Nothing to show or do for a plain single-parcel escrow that the seller cannot extend.
  if (legs.length === 0 && !canPropose) return null;

  const call = async (key: string, url: string, body: unknown) => {
    try {
      setBusy(key);
      setError(null);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('legs.genericError'));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('legs.genericError'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const propose = async () => {
    if (!courierCode || !trackingNumber.trim()) return;
    const ok = await call('propose', `/api/escrow/${escrowId}/legs`, {
      courierCode,
      trackingNumber: trackingNumber.trim(),
    });
    if (ok) {
      setCourierCode('');
      setTrackingNumber('');
      onChanged();
    }
  };

  const decide = async (legId: string, decision: 'APPROVE' | 'REJECT') => {
    const ok = await call(`${legId}:${decision}`, `/api/escrow/${escrowId}/legs/${legId}`, { decision });
    if (ok) onChanged();
  };

  const courierLabel = (code: string | null) => (code ? t(`courier.${code}`) : '-');

  return (
    <Card variant="glass" className="mb-8 p-5 sm:p-8">
      <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold sm:text-xl">
        <Route size={20} className="text-primary" /> {t('legs.title')}
      </h3>
      <p className="mb-6 text-muted-foreground">{t('legs.subtitle')}</p>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle size={20} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ol className="mb-6 grid gap-3">
        {primary.trackingNumber && (
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/20 p-3">
            <span>
              <span className="mr-2 text-muted-foreground">1.</span>
              {courierLabel(primary.courierCode)} · <span className="font-mono text-sm">{primary.trackingNumber}</span>
            </span>
          </li>
        )}
        {legs.map((leg) => (
          <li key={leg.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/20 p-3">
            <span>
              <span className="mr-2 text-muted-foreground">{leg.seq + 1}.</span>
              {courierLabel(leg.courier)} · <span className="font-mono text-sm">{leg.trackingNumber}</span>
              {leg.stage && leg.status === 'APPROVED' && (
                <span className="ml-2 text-sm text-muted-foreground">({t(`legs.stage.${leg.stage}`)})</span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[leg.status]}>{t(`legs.status.${leg.status}`)}</Badge>
              {canDecide && leg.status === 'PROPOSED' && (
                <>
                  <Button
                    size="sm"
                    onClick={() => void decide(leg.id, 'APPROVE')}
                    disabled={busy !== null}
                    aria-label={t('legs.approve')}
                  >
                    {busy === `${leg.id}:APPROVE` ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    {t('legs.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decide(leg.id, 'REJECT')}
                    disabled={busy !== null}
                    aria-label={t('legs.reject')}
                  >
                    {busy === `${leg.id}:REJECT` ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                    {t('legs.reject')}
                  </Button>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>

      {isBuyer && hasPending && escrowStatus === 'SHIPPED' && (
        <p className="mb-6 text-sm text-muted-foreground">{t('legs.buyerHint')}</p>
      )}
      {isSeller && hasPending && escrowStatus === 'SHIPPED' && (
        <p className="mb-6 text-sm text-muted-foreground">{t('legs.waitingBuyer')}</p>
      )}

      {canPropose && (
        <div>
          <h4 className="mb-3 flex items-center gap-2 font-medium">
            <Plus size={16} /> {t('legs.addTitle')}
          </h4>
          <WaybillScanner
            disabled={busy !== null}
            onPick={(candidate) => {
              setTrackingNumber(candidate.value);
              if (!courierCode && candidate.couriers.length === 1) setCourierCode(candidate.couriers[0]);
            }}
          />
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="leg-courier" className="mb-2 block">
                {t('tracking.courier')}
              </Label>
              <Select value={courierCode} onValueChange={setCourierCode} disabled={busy !== null}>
                <SelectTrigger id="leg-courier">
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
              <Label htmlFor="leg-tracking" className="mb-2 block">
                {t('tracking.trackingNumber')}
              </Label>
              <Input
                id="leg-tracking"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                disabled={busy !== null}
              />
            </div>
          </div>
          <Button
            onClick={() => void propose()}
            disabled={busy !== null || !courierCode || trackingNumber.trim().length < 3}
            className="w-full sm:w-auto"
          >
            {busy === 'propose' ? (
              <>
                <Loader2 size={18} className="animate-spin" /> {t('legs.proposing')}
              </>
            ) : (
              t('legs.propose')
            )}
          </Button>
        </div>
      )}
    </Card>
  );
}
