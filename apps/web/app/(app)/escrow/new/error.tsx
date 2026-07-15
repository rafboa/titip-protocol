'use client';

import { AlertCircle } from 'lucide-react';

import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/use-translation';

export default function CreateEscrowError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();
  return (
    <main className="container max-w-2xl py-16">
      <Alert variant="destructive">
        <AlertCircle size={20} />
        <div>
          <AlertTitle>{t('errors.somethingWrong')}</AlertTitle>
          <AlertDescription>{error.message || t('errors.createFormLoadFailed')}</AlertDescription>
        </div>
      </Alert>
      <Button className="mt-6" onClick={reset}>
        {t('errors.tryAgain')}
      </Button>
    </main>
  );
}
