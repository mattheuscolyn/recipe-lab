import { describe, expect, it } from 'vitest'
import { emptyPersonalData, emptyPreference, exportPersonalData, importPersonalData, loadPersonalData, migratePersonalData, PERSONAL_DATA_KEY, savePersonalData } from './personalData'

describe('personal data persistence', () => {
  it('round-trips a versioned JSON backup without losing personal state', () => {
    const data = {
      ...emptyPersonalData(),
      preferences: { recipe: { ...emptyPreference(), status: 'saved' as const, cooked: true, personalRating: 5, note: 'Double the lemon.' } },
      plan: [{ id: 'monday-dinner', date: '2026-11-09', meal: 'Dinner' as const, recipeId: '813d36f1-f9ce-431b-b2f4-594af0510b78', servings: 6, locked: true }],
      checkedGroceries: { '2026-11-09:ingredient-garlic:variant-garlic': true },
    }
    expect(importPersonalData(exportPersonalData(data))).toEqual(data)
  })
  it('migrates the pre-versioned shape into schema version 1', () => {
    expect(migratePersonalData({ preferences: {}, plan: [], checkedGroceries: {} })).toEqual(emptyPersonalData())
  })
  it('loads saved data and reports unavailable storage without crashing', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const data = emptyPersonalData()
    expect(savePersonalData(storage, data)).toBeNull()
    expect(values.has(PERSONAL_DATA_KEY)).toBe(true)
    expect(loadPersonalData(storage)).toEqual({ data, persistent: true, error: null })
    expect(loadPersonalData(null)).toMatchObject({ data, persistent: false, error: expect.stringContaining('unavailable') })
  })
  it('rejects unsupported backups', () => {
    expect(() => importPersonalData('{"schemaVersion":99}')).toThrow(/not a supported/i)
  })
})
