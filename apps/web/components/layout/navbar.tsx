'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Wallet, LogOut, Package } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { truncateAddress } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ConnectWalletCard } from '@/components/wallet/connect-wallet-card';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { LanguageSwitcher } from '@/components/layout/language-switcher';

export function Navbar() {
  const { isAuthenticated, publicKey, logout } = useAuthStore();
  const { t } = useTranslation();
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-[rgba(11,14,20,0.8)] px-6 py-4 backdrop-blur-md">
      {/* Left: logo + nav links */}
      <div className="flex items-center gap-4 sm:gap-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold sm:text-xl">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-white">
            T
          </div>
          <span className="hidden xs:inline sm:inline">
            Titip <span className="text-gradient">Protocol</span>
          </span>
        </Link>

        {isAuthenticated && (
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Package size={18} /> <span className="hidden sm:inline">{t('nav.dashboard')}</span>
          </Link>
        )}
      </div>

      {/* Right: language switcher + wallet badge + notification bell + disconnect */}
      <div className="flex items-center gap-1 sm:gap-2">
        <LanguageSwitcher />

        {isAuthenticated && publicKey ? (
          <>
            {/* Wallet address chip — hides address text on very small screens */}
            <div className="glass flex items-center gap-2 rounded-md px-2 py-2 sm:px-4">
              <Wallet size={16} className="shrink-0 text-primary" />
              <span className="hidden font-mono text-sm xs:inline">{truncateAddress(publicKey)}</span>
            </div>

            {/* Notification bell — renders null when not authenticated */}
            <NotificationBell />

            {/* Disconnect */}
            <Button variant="ghost" size="icon" onClick={logout} title={t('nav.disconnect')}>
              <LogOut size={20} />
            </Button>
          </>
        ) : (
          <Dialog open={isConnectOpen} onOpenChange={setIsConnectOpen}>
            <Button className="animate-fade-in" onClick={() => setIsConnectOpen(true)}>
              <Wallet size={18} />
              <span className="hidden sm:inline">{t('nav.connectWallet')}</span>
              <span className="sm:hidden">{t('nav.connectShort')}</span>
            </Button>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle className="sr-only">{t('nav.connectWallet')}</DialogTitle>
              <ConnectWalletCard onSuccess={() => setIsConnectOpen(false)} />
            </DialogContent>
          </Dialog>
        )}
      </div>
    </nav>
  );
}
