'use client';

import { useLocaleStore } from '@/lib/store/locale';
import { translations } from './translations';

function resolve(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, dict);
}

export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  function t(path: string, vars?: Record<string, string>): string {
    const value = resolve(translations[locale], path);
    if (typeof value !== 'string') return path;
    if (!vars) return value;
    return Object.entries(vars).reduce(
      (str, [key, val]) => str.replaceAll(`{{${key}}}`, val),
      value
    );
  }

  return { t, locale, setLocale };
}
