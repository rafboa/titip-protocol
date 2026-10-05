'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Wallet, Globe, Globe2 } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LanguageSwitcher } from '@/components/layout/language-switcher';

export default function SettingsPage() {
  const { isAuthenticated, publicKey, isConnecting, logout } = useAuthStore();
  const { t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated && !isConnecting && !localStorage.getItem('titip_jwt')) {
      router.push('/');
    }
  }, [isAuthenticated, isConnecting, router]);

  if (!isAuthenticated) return null;

  return (
    <main className="container py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('settings.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-8">
          {/* Wallet Section */}
          <section>
            <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
              <Wallet size={20} className="text-muted-foreground" />
              {t('settings.walletSection')}
            </h2>
            <Card className="p-6">
              <div className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">
                    {t('settings.addressLabel')}
                  </label>
                  <div className="font-mono text-sm break-all bg-background/50 rounded-md p-3 border border-border">
                    {publicKey}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">
                    {t('settings.networkLabel')}
                  </label>
                  <div className="text-sm font-medium">
                    Testnet
                  </div>
                </div>
              </div>
            </Card>
          </section>

          {/* Language Section */}
          <section>
            <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
              <Globe size={20} className="text-muted-foreground" />
              {t('settings.languageSection')}
            </h2>
            <Card className="p-6 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Select your preferred language
              </div>
              <LanguageSwitcher />
            </Card>
          </section>

          {/* Disconnect Section */}
          <section>
            <Card className="p-6 border-danger/20 bg-danger/5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-danger">{t('settings.disconnectLabel')}</h3>
                  <p className="text-sm text-danger/80">End your current session</p>
                </div>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    logout();
                    router.push('/');
                  }}
                  className="gap-2"
                >
                  <LogOut size={16} />
                  {t('settings.disconnectBtn')}
                </Button>
              </div>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
