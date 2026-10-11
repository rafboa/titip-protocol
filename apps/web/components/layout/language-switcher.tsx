'use client';

import { useTranslation } from '@/lib/i18n/use-translation';
import { cn } from '@/lib/utils';

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <div role="group" aria-label="Language" className="glass flex items-center gap-0.5 rounded-md p-0.5 text-xs font-semibold">
      <button
        type="button"
        lang="en"
        aria-label="English"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        className={cn(
          'rounded px-2 py-1 transition-colors',
          locale === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        EN
      </button>
      <button
        type="button"
        lang="id"
        aria-label="Bahasa Indonesia"
        onClick={() => setLocale('id')}
        aria-pressed={locale === 'id'}
        className={cn(
          'rounded px-2 py-1 transition-colors',
          locale === 'id' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        ID
      </button>
    </div>
  );
}
