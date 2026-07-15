'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Package, Clock, ShieldCheck, AlertCircle } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { formatUsdc } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { EscrowStatusBadge } from '@/components/escrow/escrow-status-badge';

type EscrowListItem = {
  id: string;
  status: string;
  amountUsdc: string;
  buyerAddress: string;
  sellerAddress: string;
  createdAt: string;
};

export default function DashboardPage() {
  const { isAuthenticated, publicKey, isConnecting } = useAuthStore();
  const { t, locale } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated && !isConnecting && !localStorage.getItem('titip_jwt')) {
      router.push('/');
    }
  }, [isAuthenticated, isConnecting, router]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['escrows', publicKey],
    queryFn: async () => {
      const res = await fetch(`/api/user/${publicKey}/escrows`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('titip_jwt')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch escrows');
      const body: { escrows: EscrowListItem[] } = await res.json();
      return body.escrows;
    },
    enabled: !!publicKey && isAuthenticated,
  });

  if (!isAuthenticated) return null;

  const escrows = data ?? [];
  const dateLocale = locale === 'id' ? 'id-ID' : 'en-US';

  return (
    <main className="container py-10 sm:py-16">
      <div className="mb-8 flex flex-col gap-4 sm:mb-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold sm:text-4xl">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/escrow/new">
            <Plus size={20} /> {t('dashboard.newEscrow')}
          </Link>
        </Button>
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
          <AlertDescription>{t('dashboard.loadError')}</AlertDescription>
        </Alert>
      ) : escrows.length === 0 ? (
        <Card className="p-10 text-center sm:p-16">
          <Package size={48} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="mb-2 text-xl font-semibold">{t('dashboard.emptyTitle')}</h3>
          <p className="mb-6 text-muted-foreground">{t('dashboard.emptyBody')}</p>
          <Button variant="secondary" asChild>
            <Link href="/escrow/new">{t('dashboard.emptyCta')}</Link>
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {escrows.map((escrow, index) => {
            const isBuyer = escrow.buyerAddress === publicKey;
            return (
              <Card
                key={escrow.id}
                className="animate-fade-in flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="flex items-center gap-4 sm:gap-6">
                  <div
                    className={
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ' +
                      (isBuyer ? 'bg-primary/10' : 'bg-secondary/10')
                    }
                  >
                    <ShieldCheck size={24} className={isBuyer ? 'text-primary' : 'text-secondary'} />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className="text-base font-semibold sm:text-lg">
                        ID: {escrow.id.substring(0, 8)}...
                      </span>
                      <EscrowStatusBadge status={escrow.status} />
                      <Badge variant="secondary">{isBuyer ? t('dashboard.buyer') : t('dashboard.seller')}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package size={14} /> {formatUsdc(escrow.amountUsdc)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={14} /> {new Date(escrow.createdAt).toLocaleDateString(dateLocale)}
                      </span>
                    </div>
                  </div>
                </div>

                <Button variant="secondary" asChild className="w-full sm:w-auto">
                  <Link href={`/escrow/${escrow.id}`}>{t('dashboard.viewDetails')}</Link>
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
