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

export function EscrowStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{t(`status.${status}`)}</Badge>;
}
