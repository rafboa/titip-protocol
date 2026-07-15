'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthStore } from '@/lib/store/auth';
import { Card } from '@/components/ui/card';
import { ConnectWalletCard } from '@/components/wallet/connect-wallet-card';

export default function ConnectPage() {
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) router.push('/dashboard');
  }, [isAuthenticated, router]);

  return (
    <div className="container flex min-h-screen items-center justify-center py-16">
      <Card className="w-full max-w-md p-8">
        <ConnectWalletCard onSuccess={() => router.push('/dashboard')} />
      </Card>
    </div>
  );
}
