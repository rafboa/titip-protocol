'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Scale, Package, Clock, FileImage, AlertCircle } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { formatUsdc, truncateAddress } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

type DisputeListItem = {
  id: string;
  amountUsdc: string;
  buyerAddress: string;
  sellerAddress: string;
  createdAt: string;
  evidenceCount: number;
  resolvable: boolean;
};

export default function AdminDisputesPage() {
  const { isAuthenticated, isConnecting, isRestoring } = useAuthStore();
  const { t, locale } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated && !isConnecting && !isRestoring) {
      router.push('/');
    }
  }, [isAuthenticated, isConnecting, isRestoring, router]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'disputes'],
    queryFn: async () => {
      const res = await fetch('/api/admin/disputes');
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (!res.ok) throw new Error('Failed to fetch disputes');
      const body: { disputes: DisputeListItem[] } = await res.json();
      return body.disputes;
    },
    enabled: isAuthenticated,
    retry: false,
  });

  if (!isAuthenticated) return null;

  const disputes = data ?? [];
  const dateLocale = locale === 'id' ? 'id-ID' : 'en-US';
  const isForbidden = error instanceof Error && error.message === 'FORBIDDEN';

  return (
    <main className="container py-10 sm:py-16">
      <div className="mb-8 sm:mb-12">
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">{t('admin.disputesTitle')}</h1>
        <p className="text-muted-foreground">{t('admin.disputesSubtitle')}</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle size={20} />
          <AlertDescription>{isForbidden ? t('admin.forbidden') : t('admin.loadError')}</AlertDescription>
        </Alert>
      ) : disputes.length === 0 ? (
        <Card className="p-10 text-center sm:p-16">
          <Scale size={48} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="mb-2 text-xl font-semibold">{t('admin.emptyTitle')}</h3>
          <p className="text-muted-foreground">{t('admin.emptyBody')}</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {disputes.map((dispute, index) => (
            <Card
              key={dispute.id}
              className="animate-fade-in flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="flex items-center gap-4 sm:gap-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-destructive/10">
                  <Scale size={24} className="text-destructive" />
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-base font-semibold sm:text-lg">ID: {dispute.id.substring(0, 8)}...</span>
                    <Badge variant="secondary">
                      <FileImage size={12} className="mr-1" /> {t('admin.evidenceCount', { count: dispute.evidenceCount })}
                    </Badge>
                    {!dispute.resolvable && <Badge variant="warning">{t('admin.notResolvable')}</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Package size={14} /> {formatUsdc(dispute.amountUsdc)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={14} /> {new Date(dispute.createdAt).toLocaleDateString(dateLocale)}
                    </span>
                    <span className="font-mono">
                      {truncateAddress(dispute.buyerAddress)} / {truncateAddress(dispute.sellerAddress)}
                    </span>
                  </div>
                </div>
              </div>

              <Button variant="secondary" asChild className="w-full sm:w-auto">
                <Link href={`/admin/disputes/${dispute.id}`}>{t('admin.review')}</Link>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
