'use client';

import { useState } from 'react';
import { Loader2, Wallet, ShieldCheck } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { checkConnection, getPublicKey, signTx, FreighterError } from '@/lib/stellar/freighter';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

type Step = 'IDLE' | 'DETECTING' | 'CHALLENGE' | 'SIGNING' | 'VERIFYING';

export function ConnectWalletCard({ onSuccess }: { onSuccess?: () => void }) {
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('IDLE');
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    try {
      setError(null);
      setStep('DETECTING');

      const isConnected = await checkConnection();
      if (!isConnected) {
        throw new FreighterError('NOT_INSTALLED', 'Freighter wallet not detected or connection refused.');
      }

      const pubkey = await getPublicKey();

      setStep('CHALLENGE');
      const challengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: pubkey }),
      });

      if (!challengeRes.ok) {
        const data = await challengeRes.json().catch(() => null);
        throw new Error(data?.error || 'Failed to get auth challenge');
      }
      const { challengeXdr } = await challengeRes.json();

      setStep('SIGNING');
      // SEP-10 challenges are classic transactions, not Soroban authorization
      // entries — sign with signTransaction (signTx), not signAuthEntry.
      // Network guard runs inside signTx() before any signature is requested.
      const signedXdr = await signTx(challengeXdr);

      setStep('VERIFYING');
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedXdr }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => null);
        throw new Error(data?.error || 'Verification failed');
      }

      const { token } = await verifyRes.json();

      localStorage.setItem('titip_jwt', token);
      localStorage.setItem('titip_pubkey', pubkey);
      setAuth(pubkey, token);

      onSuccess?.();
    } catch (err) {
      if (err instanceof FreighterError) {
        setError(t(`freighterErrors.${err.code}`, err.vars));
      } else {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
      setStep('IDLE');
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
          <Wallet size={32} className="text-primary" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold">{t('connectWallet.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('connectWallet.subtitle')}</p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'IDLE' ? (
        <Button className="w-full" onClick={handleConnect}>
          {t('connectWallet.connectFreighter')}
        </Button>
      ) : (
        <div className="flex flex-col items-center gap-4 py-4">
          <Loader2 size={32} className="text-gradient animate-spin" />
          <span className="text-center text-muted-foreground">{t(`connectSteps.${step}`)}</span>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck size={14} />
        <span>{t('connectWallet.sep10')}</span>
      </div>
    </div>
  );
}
