'use client';

import { Circle, Package, ShieldCheck, Truck, CheckCircle2, RotateCcw, type LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/use-translation';

type TimelineStep = {
  labelKey: string;
  timestamp: string;
  icon: LucideIcon;
};

export function EscrowTimeline({
  createdAt,
  fundedAt,
  shippedAt,
  deliveredAt,
  refundedAt,
}: {
  createdAt: string;
  fundedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  refundedAt: string | null;
}) {
  const { t, locale } = useTranslation();
  const dateLocale = locale === 'id' ? 'id-ID' : 'en-US';

  // Only include transitions that actually happened, in chronological order —
  // not a static list of all possible states.
  const steps: TimelineStep[] = [{ labelKey: 'timeline.created', timestamp: createdAt, icon: Circle }];

  if (fundedAt) steps.push({ labelKey: 'timeline.funded', timestamp: fundedAt, icon: ShieldCheck });
  if (shippedAt) steps.push({ labelKey: 'timeline.shipped', timestamp: shippedAt, icon: Truck });
  if (deliveredAt) steps.push({ labelKey: 'timeline.delivered', timestamp: deliveredAt, icon: CheckCircle2 });
  if (refundedAt) steps.push({ labelKey: 'timeline.refunded', timestamp: refundedAt, icon: RotateCcw });

  return (
    <Card className="mb-8 p-5 sm:p-8">
      <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold sm:text-xl">
        <Package size={20} className="text-primary" /> {t('timeline.title')}
      </h3>

      <div className="grid gap-6">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isLast = index === steps.length - 1;
          return (
            <div key={step.labelKey} className="relative flex gap-4">
              {!isLast && (
                <div className="absolute left-[15px] top-8 h-[calc(100%-8px)] w-px bg-border" aria-hidden />
              )}
              <div
                className={cn(
                  'z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                  isLast ? 'border-primary bg-primary/10 text-primary' : 'border-success bg-success/10 text-success'
                )}
              >
                <Icon size={16} />
              </div>
              <div className="pb-2">
                <div className="font-semibold">{t(step.labelKey)}</div>
                <div className="text-sm text-muted-foreground">
                  {new Date(step.timestamp).toLocaleString(dateLocale)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
