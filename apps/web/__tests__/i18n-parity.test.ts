import { describe, it, expect } from 'vitest'
import { translations } from '@/lib/i18n/translations'

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  )
}

describe('translations', () => {
  const en = keyPaths(translations.en).sort()
  const id = keyPaths(translations.id).sort()

  it('has the same keys in English and Indonesian', () => {
    expect(id.filter((k) => !en.includes(k))).toEqual([])
    expect(en.filter((k) => !id.includes(k))).toEqual([])
  })

  it('has no empty strings', () => {
    const empty = (dict: unknown, locale: string) =>
      keyPaths(dict)
        .filter((path) => {
          const value = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], dict)
          return typeof value === 'string' && value.trim() === ''
        })
        .map((p) => `${locale}:${p}`)
    expect([...empty(translations.en, 'en'), ...empty(translations.id, 'id')]).toEqual([])
  })

  it('defines every key the shipment legs UI uses', () => {
    const used = [
      'legs.title', 'legs.subtitle', 'legs.approve', 'legs.reject', 'legs.buyerHint', 'legs.waitingBuyer',
      'legs.addTitle', 'legs.propose', 'legs.proposing', 'legs.genericError',
      ...['PROPOSED', 'APPROVED', 'REJECTED'].map((s) => `legs.status.${s}`),
      ...['PICKUP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_TO_SENDER'].map((s) => `legs.stage.${s}`),
    ]
    expect(used.filter((k) => !en.includes(k))).toEqual([])
  })
})
