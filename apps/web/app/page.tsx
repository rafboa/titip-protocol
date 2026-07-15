'use client';

import Link from 'next/link';
import { ArrowRight, ShieldCheck, Zap, Globe2 } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function Home() {
  const { isAuthenticated } = useAuthStore();
  const { t } = useTranslation();

  return (
    <div className="relative">
      <Navbar />

      <div
        className="pointer-events-none absolute -top-[10%] left-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 rounded-full opacity-30 blur-[120px]"
        style={{ background: 'var(--primary-glow)' }}
      />

      <main className="container py-24">
        <section className="mx-auto max-w-3xl text-center">
          <div className="animate-fade-in">
            <Badge className="mb-6">{t('landing.badge')}</Badge>
            <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
              {t('landing.titlePrefix')} <span className="text-gradient">{t('landing.titleHighlight')}</span>
            </h1>
            <p className="mb-10 text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {t('landing.subtitle')}
            </p>

            <div className="flex justify-center gap-4">
              {isAuthenticated ? (
                <Button size="lg" asChild>
                  <Link href="/dashboard">
                    {t('landing.enterDashboard')} <ArrowRight size={20} />
                  </Link>
                </Button>
              ) : (
                <div className="text-muted-foreground">{t('landing.connectPrompt')}</div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-32 grid gap-8" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <Card className="animate-fade-in animate-delay-1 flex flex-col gap-4 p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success/10">
              <ShieldCheck size={24} className="text-success" />
            </div>
            <h3 className="text-xl font-semibold">{t('landing.feature1Title')}</h3>
            <p className="text-muted-foreground">{t('landing.feature1Body')}</p>
          </Card>

          <Card className="animate-fade-in animate-delay-2 flex flex-col gap-4 p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/10">
              <Zap size={24} className="text-secondary" />
            </div>
            <h3 className="text-xl font-semibold">{t('landing.feature2Title')}</h3>
            <p className="text-muted-foreground">{t('landing.feature2Body')}</p>
          </Card>

          <Card className="animate-fade-in animate-delay-3 flex flex-col gap-4 p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Globe2 size={24} className="text-primary" />
            </div>
            <h3 className="text-xl font-semibold">{t('landing.feature3Title')}</h3>
            <p className="text-muted-foreground">{t('landing.feature3Body')}</p>
          </Card>
        </section>
      </main>
    </div>
  );
}
