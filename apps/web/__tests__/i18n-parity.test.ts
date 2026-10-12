import { describe, it, expect } from 'vitest'
import { translations } from '@/lib/i18n/translations'

// `translations` only `satisfies Record<Locale, unknown>`, so tsc cannot tell when a key exists in one
// language but not the other. Missing keys would render as the raw path, so check it here.
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

describe('translations', () => {
  const en = new Set(flatten(translations.en))
  const id = new Set(flatten(translations.id))

  it('has the same keys in English and Indonesian', () => {
    expect([...en].filter((key) => !id.has(key))).toEqual([])
    expect([...id].filter((key) => !en.has(key))).toEqual([])
  })

  it('uses the same {{placeholders}} in both languages for every key', () => {
    const placeholders = (text: unknown) =>
      typeof text === 'string' ? [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort() : []
    const get = (locale: 'en' | 'id', path: string) =>
      path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], translations[locale])
    const mismatched = [...en].filter(
      (key) => id.has(key) && placeholders(get('en', key)).join() !== placeholders(get('id', key)).join()
    )
    expect(mismatched).toEqual([])
  })
})
