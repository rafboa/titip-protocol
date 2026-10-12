'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package, AlertCircle } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { formatUsdc, truncateAddress } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EscrowStatusBadge } from '@/components/escrow/escrow-status-badge';
import { DisputeEvidence } from '@/components/escrow/dispute-evidence';
import { DisputeResolutionSummary } from '@/components/escrow/dispute-resolution-summary';
import { DisputeResolution } from '@/components/admin/dispute-resolution';

type AdminDispute = {
  id: string;
  status: string;
  amountUsdc: string;
  buyerAddress: string;
  sellerAddress: string;
  createdAt: string;
  resolutionBuyerBps: number | null;
  resolvedAt: string | null;
  onCurrentContract: boolean;
  involvesAdmin: boolean;
  resolvable: boolean;
};

export default function AdminDisputePage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isConnecting, isRestoring } = useAuthStore();
  const { t, locale } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated && !isConnecting && !isRestoring) {
      router.push('/');
    }
  }, [isAuthenticated, isConnecting, isRestoring, router]);

  const { data: dispute, isLoading, error } = useQuery<AdminDispute>({
    queryKey: ['admin', 'dispute', id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/disputes/${id}`);
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (!res.ok) throw new Error('Failed to fetch dispute');
      return res.json();
    },
    enabled: !!id && isAuthenticated,
    retry: false,
  });

  if (!isAuthenticated) return null;

  const dateLocale = locale === 'id' ? 'id-ID' : 'en-US';
  const isForbidden = error instanceof Error && error.message === 'FORBIDDEN';

  return (
    <main className="container max-w-3xl py-10 sm:py-16">
      <Button variant="ghost" asChild className="mb-6 -ml-3">
        <Link href="/admin/disputes">
          <ArrowLeft size={18} /> {t('admin.back')}
        </Link>
      </Button>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle size={20} />
          <AlertDescription>{isForbidden ? t('admin.forbidden') : t('admin.detailLoadError')}</AlertDescription>
        </Alert>
      ) : dispute ? (
        <div className="animate-fade-in">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">
              {t('admin.disputeHeading', { id: dispute.id.substring(0, 8) })}
            </h1>
            <EscrowStatusBadge status={dispute.status} />
          </div>

          <Card variant="glass" className="mb-8 p-5 sm:p-8">
            <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold sm:text-xl">
              <Package size={20} className="text-primary" /> {t('escrowDetail.contractDetails')}
            </h3>
            <div className="grid gap-4">
              <div className="flex justify-between gap-4 pb-4">
                <span className="text-muted-foreground">{t('admin.amount')}</span>
                <span className="text-xl font-bold text-primary">{formatUsdc(dispute.amountUsdc)}</span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4 pb-4">
                <span className="text-muted-foreground">{t('admin.buyer')}</span>
                <span className="font-mono text-sm">{truncateAddress(dispute.buyerAddress)}</span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('admin.seller')}</span>
                <span className="font-mono text-sm">{truncateAddress(dispute.sellerAddress)}</span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('admin.opened')}</span>
                <span className="text-right">{new Date(dispute.createdAt).toLocaleString(dateLocale)}</span>
              </div>
            </div>
          </Card>

          <DisputeEvidence escrowId={dispute.id} readOnly />

          {dispute.resolvable ? (
            <DisputeResolution escrowId={dispute.id} amountUsdc={dispute.amountUsdc} />
          ) : dispute.resolutionBuyerBps !== null ? (
            <DisputeResolutionSummary amountUsdc={dispute.amountUsdc} buyerBps={dispute.resolutionBuyerBps} />
          ) : (
            <Alert variant="warning" className="mb-8">
              <AlertCircle size={20} />
              <AlertDescription>
                {dispute.status !== 'DISPUTED'
                  ? t('admin.alreadyResolved')
                  : dispute.involvesAdmin
                    ? t('admin.involvesYou')
                    : t('admin.oldContract')}
              </AlertDescription>
            </Alert>
          )}
        </div>
      ) : null}
    </main>
  );
}
