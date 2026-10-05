'use client';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n/use-translation';

// Matches the Prisma EscrowStatus enum (packages/db/prisma/schema.prisma)
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PENDING: 'warning',
  FUNDED: 'default',
  SHIPPED: 'secondary',
  DELIVERED: 'success',
  REFUNDED: 'destructive',
};

// 6px dot color per status — DESIGN.md Section 3 & 5
const STATUS_DOT: Record<string, string> = {
  PENDING: 'bg-warning',
  FUNDED: 'bg-primary',
  SHIPPED: 'bg-secondary',
  DELIVERED: 'bg-success',
  REFUNDED: 'bg-destructive',
};

export function EscrowStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const dot = STATUS_DOT[status] ?? 'bg-muted-foreground';
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'secondary'} className="gap-1.5">
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      {t(`status.${status}`)}
    </Badge>
  );
}
