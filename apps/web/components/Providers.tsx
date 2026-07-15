'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/store/auth';
import { useLocaleStore } from '@/lib/store/locale';
import { checkConnection } from '@/lib/stellar/freighter';
import type { Locale } from '@/lib/i18n/translations';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  }));
  const { setAuth } = useAuthStore();
  const setLocale = useLocaleStore((s) => s.setLocale);

  // Restore saved language preference on mount — defaults to English
  // (matches server-rendered HTML) until this runs.
  useEffect(() => {
    const saved = localStorage.getItem('titip_locale');
    if (saved === 'id' || saved === 'en') {
      setLocale(saved as Locale);
    }
  }, [setLocale]);

  // Restore session from localStorage on mount (if Freighter is still connected)
  useEffect(() => {
    const savedJwt = localStorage.getItem('titip_jwt');
    const savedPubkey = localStorage.getItem('titip_pubkey');

    if (savedJwt && savedPubkey) {
      checkConnection()
        .then((connected) => {
          if (connected) {
            setAuth(savedPubkey, savedJwt);
          } else {
            // Wallet disconnected — clear stale session
            localStorage.removeItem('titip_jwt');
            localStorage.removeItem('titip_pubkey');
          }
        })
        .catch(() => {
          // Freighter not available (SSR, not installed) — silently ignore
        });
    }
  }, [setAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
