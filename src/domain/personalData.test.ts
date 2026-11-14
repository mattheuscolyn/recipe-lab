import { describe, expect, it } from 'vitest'
import { pilotRecipes } from '../data/pilotCatalog'
import { emptyPersonalData, emptyPreference, exportPersonalData, importPersonalData, loadPersonalData, migratePersonalData, PERSONAL_DATA_KEY, savePersonalData } from './personalData'

const knownRecipeIds = new Set(pilotRecipes.map(({ id }) => id))
const slot = (id: string, recipeId: string) => ({ id, date: '2026-11-09', meal: 'Dinner' as const, recipeId, servings: 4, locked: false })

describe('personal data persistence', () => {
  it('round-trips a versioned JSON backup without losing personal state', () => {
    const data = {
      ...emptyPersonalData(),
      preferences: { recipe: { ...emptyPreference(), status: 'saved' as const, cooked: true, personalRating: 5, note: 'Double the lemon.' } },
      plan: [{ id: 'monday-dinner', date: '2026-11-09', meal: 'Dinner' as const, recipeId: '813d36f1-f9ce-431b-b2f4-594af0510b78', servings: 6, locked: true }],
      checkedGroceries: { '2026-11-09:ingredient-garlic:variant-garlic': true },
    }
    expect(importPersonalData(exportPersonalData(data), knownRecipeIds)).toEqual(data)
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
    expect(loadPersonalData(storage)).toEqual({ data, persistent: true, error: null, recoveryBackup: null })
    expect(loadPersonalData(null)).toMatchObject({ data, persistent: false, error: expect.stringContaining('unavailable') })
  })
  it('rejects a valid-shaped import with an orphaned recipe reference', () => {
    const backup = exportPersonalData({ ...emptyPersonalData(), plan: [slot('orphan', '00000000-0000-4000-8000-000000000099')] })
    expect(() => importPersonalData(backup, knownRecipeIds)).toThrow(/not imported.*not in this catalog/i)
  })
  it('rejects a valid-shaped import with duplicate date and meal slots', () => {
    const backup = exportPersonalData({ ...emptyPersonalData(), plan: [slot('first', pilotRecipes[0].id), slot('duplicate', pilotRecipes[1].id)] })
    expect(() => importPersonalData(backup, knownRecipeIds)).toThrow(/not imported.*appears more than once/i)
  })
  it('quarantines invalid persisted slots and preserves the exact recovery backup', () => {
    const saved = exportPersonalData({ ...emptyPersonalData(), plan: [slot('kept', pilotRecipes[0].id), slot('duplicate', pilotRecipes[1].id), { ...slot('orphan', '00000000-0000-4000-8000-000000000099'), date: '2026-11-10' }] })
    const storage = { getItem: () => saved, setItem: () => undefined }
    const loaded = loadPersonalData(storage, knownRecipeIds)
    expect(loaded.data.plan).toEqual([slot('kept', pilotRecipes[0].id)])
    expect(loaded.error).toMatch(/2 invalid saved meal slots were quarantined/i)
    expect(loaded.recoveryBackup).toBe(saved)
  })
  it('reports write failures instead of claiming persistence', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota exceeded') } }
    expect(savePersonalData(storage, emptyPersonalData())).toMatch(/could not be saved/i)
  })
  it('rejects unsupported backups', () => {
    expect(() => importPersonalData('{"schemaVersion":99}')).toThrow(/not a supported/i)
  })
})
