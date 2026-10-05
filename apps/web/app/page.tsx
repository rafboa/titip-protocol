'use client';

import Link from 'next/link';
import { ShieldCheck, Zap, Globe2 } from 'lucide-react';

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

      <main className="container py-24">
        {/* Hero — centered, single CTA */}
        <section className="mx-auto max-w-3xl text-center">
          <div className="animate-fade-in">
            <Badge className="mb-4">{t('landing.badge')}</Badge>
            <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
              {t('landing.titlePrefix')} <span className="text-gradient">{t('landing.titleHighlight')}</span>
            </h1>
            <p className="mb-10 text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {t('landing.subtitle')}
            </p>

            <div className="flex justify-center gap-4">
              {isAuthenticated ? (
                <Button size="lg" asChild>
                  <Link href="/dashboard">{t('landing.enterDashboard')}</Link>
                </Button>
              ) : (
                <div className="text-muted-foreground">{t('landing.connectPrompt')}</div>
              )}
            </div>
          </div>
        </section>

        {/* Features — Feature 1 full-width (core value prop), Features 2+3 two-column grid */}
        <section className="mt-24">
          {/* Feature 1: Trustless Escrow — the core differentiator, gets the most space */}
          <Card className="animate-fade-in animate-delay-1 mb-4 flex flex-col gap-6 p-8 sm:flex-row sm:items-start sm:gap-8 sm:p-10">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-success/10">
              <ShieldCheck size={28} className="text-success" />
            </div>
            <div>
              <h3 className="mb-2 text-xl font-semibold">{t('landing.feature1Title')}</h3>
              <p className="leading-relaxed text-muted-foreground">{t('landing.feature1Body')}</p>
            </div>
          </Card>

          {/* Features 2 & 3: supporting mechanisms, equal weight */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="animate-fade-in animate-delay-2 flex flex-col gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/10">
                <Zap size={24} className="text-secondary" />
              </div>
              <h3 className="text-lg font-semibold">{t('landing.feature2Title')}</h3>
              <p className="text-sm text-muted-foreground">{t('landing.feature2Body')}</p>
            </Card>
            <Card className="animate-fade-in animate-delay-3 flex flex-col gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Globe2 size={24} className="text-primary" />
              </div>
              <h3 className="text-lg font-semibold">{t('landing.feature3Title')}</h3>
              <p className="text-sm text-muted-foreground">{t('landing.feature3Body')}</p>
            </Card>
          </div>
        </section>
      </main>

      <footer className="container pb-12 pt-4 text-center text-xs text-muted-foreground">
        Titip Protocol &mdash; built for Stellar Hackathon 2026
      </footer>
    </div>
  );
}
