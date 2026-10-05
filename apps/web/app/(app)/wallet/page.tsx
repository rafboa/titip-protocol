'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Loader2 } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { formatUsdc } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchStellarToml } from '@/lib/stellar/tempo';

export default function WalletPage() {
  const { isAuthenticated, publicKey, isConnecting } = useAuthStore();
  const { t } = useTranslation();
  const router = useRouter();

  const [isIframeOpen, setIsIframeOpen] = useState(false);
  const [iframeUrl, setIframeUrl] = useState('');
  const [isLoadingTempo, setIsLoadingTempo] = useState(false);

  useEffect(() => {
    if (!isAuthenticated && !isConnecting && !localStorage.getItem('titip_jwt')) {
      router.push('/');
    }
  }, [isAuthenticated, isConnecting, router]);

  const { data: balanceData, isLoading: isLoadingBalance } = useQuery({
    queryKey: ['balance', publicKey],
    queryFn: async () => {
      if (!publicKey) return { balance: '0' };
      const res = await fetch(`/api/user/${publicKey}/balance`);
      if (!res.ok) throw new Error('Failed to fetch balance');
      return res.json();
    },
    enabled: !!publicKey && isAuthenticated,
    refetchInterval: 10000,
  });

  if (!isAuthenticated) return null;

  // Mock SEP-24 Flow mixed with real TOML fetching
  const handleTempoAction = async (action: 'deposit' | 'withdraw') => {
    setIsLoadingTempo(true);
    try {
      // 1. Fetch real stellar.toml from tempo.eu.com
      const toml = await fetchStellarToml('tempo.eu.com');
      const transferServer = toml.TRANSFER_SERVER_SEP0024 || 'https://api.tempo.eu.com/sep24';
      
      // 2. Perform SEP-10 Auth with TEMPO using Freighter (MOCKED here to prevent popup fatigue)
      // 3. Call SEP-24 /transactions/deposit/interactive or withdraw/interactive (MOCKED)
      
      setTimeout(() => {
        setIsLoadingTempo(false);
        setIframeUrl(`${transferServer}/mock-interactive-${action}?account=${publicKey}&asset_code=USDC`);
        setIsIframeOpen(true);
      }, 1000);
    } catch (err) {
      console.error(err);
      setIsLoadingTempo(false);
    }
  };

  const balance = balanceData?.balance || '0';

  return (
    <main className="container py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t('wallet.title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('wallet.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="overflow-hidden">
            <div className="bg-primary/5 border-b border-border p-6 text-center">
              <p className="text-sm font-medium text-muted-foreground mb-2">{t('wallet.balanceTitle')}</p>
              {isLoadingBalance ? (
                <div className="flex justify-center h-12 items-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                </div>
              ) : (
                <h2 className="text-4xl font-bold tracking-tight text-primary">
                  {formatUsdc(balance)}
                </h2>
              )}
            </div>
            <div className="p-6 flex flex-col sm:flex-row gap-4">
              <Button 
                className="flex-1 gap-2" 
                size="lg" 
                onClick={() => handleTempoAction('deposit')}
                disabled={isLoadingTempo}
              >
                {isLoadingTempo ? <Loader2 size={18} className="animate-spin" /> : <ArrowDownToLine size={18} />}
                {t('wallet.depositBtn')}
              </Button>
              <Button 
                variant="outline" 
                className="flex-1 gap-2" 
                size="lg"
                onClick={() => handleTempoAction('withdraw')}
                disabled={isLoadingTempo}
              >
                {isLoadingTempo ? <Loader2 size={18} className="animate-spin" /> : <ArrowUpFromLine size={18} />}
                {t('wallet.withdrawBtn')}
              </Button>
            </div>
          </Card>

          <div className="flex items-start gap-3 rounded-md bg-secondary/5 border border-secondary/20 p-4 text-sm text-muted-foreground">
            <ShieldCheck size={18} className="text-secondary shrink-0 mt-0.5" />
            <p>{t('wallet.tempoInfo')}</p>
          </div>
        </div>
      </div>

      <Dialog open={isIframeOpen} onOpenChange={setIsIframeOpen}>
        <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border">
            <DialogTitle>{t('wallet.interactiveModalTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-background relative">
            {iframeUrl && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm flex-col gap-4">
                <Loader2 size={32} className="animate-spin text-primary/50" />
                <p>Loading TEMPO Interactive Flow...</p>
                <p className="text-xs max-w-xs text-center opacity-50">
                  (In a live environment, this would display the TEMPO anchor KYC/Deposit iframe: {iframeUrl})
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
