'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/store/auth';
import { useLocaleStore } from '@/lib/store/locale';
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
  const { setAuth, setRestored } = useAuthStore();
  const setLocale = useLocaleStore((s) => s.setLocale);

  // Restore saved language preference on mount — defaults to English
  // (matches server-rendered HTML) until this runs.
  useEffect(() => {
    const saved = localStorage.getItem('titip_locale');
    if (saved === 'id' || saved === 'en') {
      setLocale(saved as Locale);
    }
  }, [setLocale]);

  // Restore the session from the HttpOnly cookie (JWT is never exposed to JavaScript).
  useEffect(() => {
    try {
      // Drop tokens left in localStorage by earlier versions.
      localStorage.removeItem('titip_jwt');
      localStorage.removeItem('titip_pubkey');
    } catch {
      // Storage unavailable — nothing to clean.
    }
    fetch('/api/auth/session')
      .then(async (res) => {
        if (!res.ok) return null;
        const data: { address?: string } = await res.json();
        return data.address ?? null;
      })
      .then((address) => {
        if (address) setAuth(address);
        else setRestored();
      })
      .catch(() => setRestored());
  }, [setAuth, setRestored]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
