import { describe, it, expect } from 'vitest'
import { translations } from '@/lib/i18n/translations'

// `translations` only `satisfies Record<Locale, unknown>`, so tsc cannot tell when a key exists in one
// language but not the other. Missing keys would render as the raw path, so check it here.
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

const valueAt = (locale: 'en' | 'id', path: string) =>
  path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], translations[locale])

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
    const mismatched = [...en].filter(
      (key) => id.has(key) && placeholders(valueAt('en', key)).join() !== placeholders(valueAt('id', key)).join()
    )
    expect(mismatched).toEqual([])
  })

  it('has no empty strings', () => {
    const empty = (locale: 'en' | 'id', keys: Set<string>) =>
      [...keys]
        .filter((path) => {
          const value = valueAt(locale, path)
          return typeof value === 'string' && value.trim() === ''
        })
        .map((path) => `${locale}:${path}`)
    expect([...empty('en', en), ...empty('id', id)]).toEqual([])
  })

  it('defines every key the shipment legs UI uses', () => {
    const used = [
      'legs.title', 'legs.subtitle', 'legs.approve', 'legs.reject', 'legs.buyerHint', 'legs.waitingBuyer',
      'legs.addTitle', 'legs.propose', 'legs.proposing', 'legs.genericError',
      ...['PROPOSED', 'APPROVED', 'REJECTED'].map((s) => `legs.status.${s}`),
      ...['PICKUP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_TO_SENDER'].map((s) => `legs.stage.${s}`),
    ]
    expect(used.filter((key) => !en.has(key))).toEqual([])
  })
})
