import { create } from 'zustand';
import type { Locale } from '@/lib/i18n/translations';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  // Always starts 'en' — server-rendered HTML has no access to localStorage,
  // so the client's first render must match. Providers.tsx restores the
  // saved locale after mount, same pattern as auth session restoration.
  locale: 'en',
  setLocale: (locale) => {
    localStorage.setItem('titip_locale', locale);
    set({ locale });
  },
}));
