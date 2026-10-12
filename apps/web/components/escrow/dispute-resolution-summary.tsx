'use client';

import { Scale } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/use-translation';
import { baseUnitsToDecimal, decimalToBaseUnits, splitAmounts, toPlainDecimal } from '@/lib/admin/split';

import { Card } from '@/components/ui/card';

/**
 * How an admin resolved a dispute, in the parties' own amounts. A split ends with the status
 * DELIVERED just like a normal release, so the status alone would hide who received what.
 */
export function DisputeResolutionSummary({ amountUsdc, buyerBps }: { amountUsdc: string; buyerBps: number }) {
  const { t } = useTranslation();
  const { buyer, seller } = splitAmounts(decimalToBaseUnits(toPlainDecimal(amountUsdc)), buyerBps);
  const vars = { buyer: baseUnitsToDecimal(buyer), seller: baseUnitsToDecimal(seller), buyerPercent: buyerBps / 100 };
  const body =
    seller === 0n ? t('dispute.resolvedBuyerAll', vars) : buyer === 0n ? t('dispute.resolvedSellerAll', vars) : t('dispute.resolvedBody', vars);

  return (
    <Card variant="glass" className="mb-8 border-primary/20 bg-primary/5 p-5 sm:p-8">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-primary sm:text-xl">
        <Scale size={20} /> {t('dispute.resolvedTitle')}
      </h3>
      <p className="leading-relaxed text-muted-foreground">{body}</p>
    </Card>
  );
}
