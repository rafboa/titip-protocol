'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Package, Clock, AlertCircle, ExternalLink } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { formatUsdc, truncateAddress } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { EscrowStatusBadge } from '@/components/escrow/escrow-status-badge';
import { EscrowTimeline } from '@/components/escrow/escrow-timeline';
import { TrackingForm } from '@/components/escrow/tracking-form';
import { RefundButton } from '@/components/escrow/refund-button';

type EscrowDetail = {
  id: string;
  status: string;
  amountUsdc: string;
  buyerAddress: string;
  sellerAddress: string;
  createdAt: string;
  fundedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  refundedAt: string | null;
  timeoutAt: string;
  txHashFund: string | null;
  txHashRelease: string | null;
  txHashFundUrl: string | null;
  txHashReleaseUrl: string | null;
};

export default function EscrowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, publicKey, isConnecting } = useAuthStore();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated && !isConnecting && !localStorage.getItem('titip_jwt')) {
      router.push('/');
    }
  }, [isAuthenticated, isConnecting, router]);

  const { data: escrow, isLoading, error } = useQuery<EscrowDetail>({
    queryKey: ['escrow', id],
    queryFn: async () => {
      const res = await fetch(`/api/escrow/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('titip_jwt')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch escrow');
      return res.json();
    },
    enabled: !!id && isAuthenticated,
    refetchInterval: 10000,
  });

  if (!isAuthenticated) return null;

  const isBuyer = escrow?.buyerAddress === publicKey;
  const isSeller = escrow?.sellerAddress === publicKey;
  const isPastTimeout = escrow ? new Date(escrow.timeoutAt).getTime() <= Date.now() : false;
  const refetch = () => queryClient.invalidateQueries({ queryKey: ['escrow', id] });
  const dateLocale = locale === 'id' ? 'id-ID' : 'en-US';

  return (
    <main className="container max-w-3xl py-10 sm:py-16">
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle size={20} />
          <AlertDescription>{t('escrowDetail.loadError')}</AlertDescription>
        </Alert>
      ) : escrow ? (
        <div className="animate-fade-in">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">Escrow #{escrow.id.substring(0, 8)}</h1>
            <EscrowStatusBadge status={escrow.status} />
          </div>

          <Card className="mb-8 p-5 sm:p-8">
            <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold sm:text-xl">
              <Package size={20} className="text-primary" /> {t('escrowDetail.contractDetails')}
            </h3>

            <div className="grid gap-4">
              <div className="flex justify-between gap-4 pb-4">
                <span className="text-muted-foreground">{t('escrowDetail.lockedAmount')}</span>
                <span className="text-xl font-bold text-primary">{formatUsdc(escrow.amountUsdc)}</span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4 pb-4">
                <span className="text-muted-foreground">{t('escrowDetail.buyerLabel')}</span>
                <span className="font-mono text-sm">
                  {isBuyer ? t('escrowDetail.you') : truncateAddress(escrow.buyerAddress)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4 pb-4">
                <span className="text-muted-foreground">{t('escrowDetail.sellerLabel')}</span>
                <span className="font-mono text-sm">
                  {isSeller ? t('escrowDetail.you') : truncateAddress(escrow.sellerAddress)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4 pb-4">
                <span className="text-muted-foreground">{t('escrowDetail.createdAt')}</span>
                <span className="text-right">{new Date(escrow.createdAt).toLocaleString(dateLocale)}</span>
              </div>
              {escrow.txHashFundUrl && (
                <>
                  <Separator />
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t('escrowDetail.fundingTx')}</span>
                    <a
                      href={escrow.txHashFundUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      {truncateAddress(escrow.txHashFund!, 6)} <ExternalLink size={14} />
                    </a>
                  </div>
                </>
              )}
              {escrow.txHashReleaseUrl && (
                <>
                  <Separator />
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      {escrow.status === 'REFUNDED' ? t('escrowDetail.refundTx') : t('escrowDetail.releaseTx')}
                    </span>
                    <a
                      href={escrow.txHashReleaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      {truncateAddress(escrow.txHashRelease!, 6)} <ExternalLink size={14} />
                    </a>
                  </div>
                </>
              )}
            </div>
          </Card>

          <EscrowTimeline
            createdAt={escrow.createdAt}
            fundedAt={escrow.fundedAt}
            shippedAt={escrow.shippedAt}
            deliveredAt={escrow.deliveredAt}
            refundedAt={escrow.refundedAt}
          />

          {escrow.status === 'FUNDED' && isBuyer && (
            <Card className="mb-8 border-secondary/20 bg-secondary/5 p-5 sm:p-8">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-secondary sm:text-xl">
                <ShieldCheck size={20} /> {t('escrowDetail.fundsSecuredTitle')}
              </h3>
              <p className="mb-6 leading-relaxed text-muted-foreground">{t('escrowDetail.fundsSecuredBody')}</p>
              <div className="flex items-center gap-3 rounded-md bg-black/20 p-4 text-sm text-muted-foreground">
                <Clock size={16} className="shrink-0" />
                <span>{t('escrowDetail.waitingShip')}</span>
              </div>
            </Card>
          )}

          {escrow.status === 'FUNDED' && isSeller && (
            <div className="mb-8">
              <TrackingForm escrowId={escrow.id} sellerAddress={escrow.sellerAddress} onSubmitted={refetch} />
            </div>
          )}

          {(escrow.status === 'FUNDED' || escrow.status === 'SHIPPED') && isBuyer && isPastTimeout && (
            <div className="mb-8">
              <RefundButton escrowId={escrow.id} onRefunded={refetch} />
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}
