import { describe, expect, it } from 'vitest'
import { pilotRecipes } from '../data/pilotCatalog'
import { emptyPersonalData, emptyPreference, PERSONAL_DATA_KEY, type PersonalData } from './personalData'
import { commitPersonalDataV3, exportPersonalDataV3, importPersonalDataV3, loadPersonalDataV3, loadPersonalDataV3MigrationSource, personalDataFingerprint, personalDataV3Schema, PERSONAL_DATA_V3_KEY, previewPersonalDataV3Migration } from './personalDataV3'

const knownRecipeIds = new Set(pilotRecipes.map(({ id }) => id))
const slot = (id: string, date: string, meal: 'Breakfast' | 'Lunch' | 'Dinner', recipeId = pilotRecipes[0].id, servings = 2, locked = false) => ({ id, date, meal, recipeId, servings, locked })

function realisticData(): PersonalData {
  return {
    ...emptyPersonalData(),
    preferences: { [pilotRecipes[0].id]: { ...emptyPreference(), status: 'saved', cooked: true, personalRating: 5, note: 'Keep this choice.' } },
    plan: [slot('monday-dinner', '2026-11-16', 'Dinner', pilotRecipes[0].id, 2, true), slot('tuesday-lunch', '2026-11-17', 'Lunch', pilotRecipes[1].id, 1)],
    checkedGroceries: { '2026-11-16:ingredient-garlic:variant-garlic-fresh-clove': true },
    pantry: [{ id: 'garlic-lot', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 4, unit: 'clove', bestBy: '2026-11-20', note: 'Top shelf' }],
  }
}

describe('PersonalDataV3 migration preview', () => {
  it('preserves the complete v2 payload and creates only unallocated meal requirements and choices', () => {
    const source = realisticData()
    const preview = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    expect(preview.summary).toEqual({ legacySlots: 2, convertedMeals: 2, preservedChoices: 2, needsReview: 0 })
    expect(preview.data).toMatchObject({
      schemaVersion: 3,
      preferences: source.preferences,
      plan: source.plan,
      checkedGroceries: source.checkedGroceries,
      pantry: source.pantry,
      cookEvents: [], batches: [], allocations: [], preparedFoodLots: [], tasks: [],
    })
    expect(preview.data.migrationRecovery?.originalPayload).toEqual(source)
    expect(preview.data.mealRequirements[0]).toMatchObject({ date: '2026-11-16', meal: 'dinner', requestedPortions: 2, intendedAt: null, timeZone: 'America/Los_Angeles', status: 'unplanned', lock: { locked: true } })
    expect(preview.data.legacyRecipeChoices[0]).toMatchObject({ legacySlotId: 'monday-dinner', recipeId: pilotRecipes[0].id, mealRequirementId: preview.data.mealRequirements[0].mealRequirementId })
    expect(personalDataV3Schema.parse(preview.data)).toEqual(preview.data)
  })

  it('does not round fractional servings or map duplicate and unknown slots', () => {
    const source = {
      ...emptyPersonalData(),
      plan: [
        slot('fractional', '2026-11-16', 'Dinner', pilotRecipes[0].id, 1.5),
        slot('first', '2026-11-17', 'Lunch', pilotRecipes[0].id, 1),
        slot('duplicate-meal', '2026-11-17', 'Lunch', pilotRecipes[1].id, 2),
        slot('unknown', '2026-11-18', 'Dinner', '00000000-0000-4000-8000-000000000099', 2),
        slot('first', '2026-11-19', 'Dinner', pilotRecipes[1].id, 2),
      ],
    }
    const preview = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    expect(preview.issues.map(({ code }) => code)).toEqual(['fractional-portions', 'duplicate-slot-id', 'duplicate-meal', 'unknown-recipe', 'duplicate-slot-id'])
    expect(preview.data.plan).toEqual(source.plan)
    expect(preview.data.migrationRecovery?.originalPayload.plan).toEqual(source.plan)
    expect(preview.data.mealRequirements).toHaveLength(0)
    expect(preview.data.legacyRecipeChoices).toHaveLength(0)
    expect(preview.data.cookEvents).toEqual([])
    expect(preview.data.batches).toEqual([])
    expect(preview.data.allocations).toEqual([])
    expect(preview.data.preparedFoodLots).toEqual([])
  })

  it('is deterministic, preserves unknown meal times, and validates the IANA zone', () => {
    const source = realisticData()
    const first = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    const second = previewPersonalDataV3Migration(structuredClone(source), { timeZone: 'America/Los_Angeles', knownRecipeIds })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.data.mealRequirements.every(({ intendedAt }) => intendedAt === null)).toBe(true)
    expect(() => previewPersonalDataV3Migration(source, { timeZone: 'Not/A_Time_Zone', knownRecipeIds })).toThrow(/IANA time zone/)
  })

  it('rejects corrupted legacy choice links and requirement identity fields', () => {
    const preview = previewPersonalDataV3Migration(realisticData(), { timeZone: 'America/Los_Angeles', knownRecipeIds }).data
    const cases: Array<[string, (data: typeof preview) => void]> = [
      ['original plan slot', (data) => { data.legacyRecipeChoices[0].legacySlotId = 'missing-slot' }],
      ['recipe must match', (data) => { data.legacyRecipeChoices[0].recipeId = pilotRecipes[2].id }],
      ['date must match', (data) => { data.mealRequirements[0].date = '2026-11-18' }],
      ['meal must match', (data) => { data.mealRequirements[0].meal = 'breakfast' }],
      ['portions must match', (data) => { data.mealRequirements[0].requestedPortions = 3 }],
      ['lock must match', (data) => { data.mealRequirements[0].lock.locked = false }],
    ]
    cases.forEach(([message, mutate]) => {
      const corrupted = structuredClone(preview)
      mutate(corrupted)
      const result = personalDataV3Schema.safeParse(corrupted)
      expect(result.success, message).toBe(false)
      if (!result.success) expect(result.error.issues.map(({ message: issue }) => issue).join(' ')).toMatch(new RegExp(message, 'i'))
    })
  })
})

describe('PersonalDataV3 safe storage and recovery', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial))
    return { values, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } }
  }

  it('writes a validated snapshot under a separate key and leaves v2 byte-for-byte unchanged', () => {
    const source = realisticData()
    const original = JSON.stringify(source)
    const { values, storage } = memoryStorage({ [PERSONAL_DATA_KEY]: original })
    const preview = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    expect(commitPersonalDataV3(storage, preview.data)).toEqual({ persisted: true, error: null })
    expect(values.get(PERSONAL_DATA_KEY)).toBe(original)
    expect(JSON.parse(values.get(PERSONAL_DATA_V3_KEY)!)).toEqual(preview.data)
    expect(loadPersonalDataV3(storage, source)).toMatchObject({ data: preview.data, stale: false, error: null })
  })

  it('detects v2 changes and refuses stale or silent replacement', () => {
    const source = realisticData()
    const original = JSON.stringify(source)
    const { values, storage } = memoryStorage({ [PERSONAL_DATA_KEY]: original })
    const preview = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    expect(commitPersonalDataV3(storage, preview.data).persisted).toBe(true)
    const changed = { ...source, checkedGroceries: { ...source.checkedGroceries, changed: true } }
    expect(loadPersonalDataV3(storage, changed).stale).toBe(true)
    values.set(PERSONAL_DATA_KEY, JSON.stringify(changed))
    expect(commitPersonalDataV3(storage, preview.data).error).toMatch(/persisted original planner changed/i)
    values.set(PERSONAL_DATA_KEY, original)
    expect(commitPersonalDataV3(storage, preview.data).error).toMatch(/already exists/i)
    expect(commitPersonalDataV3(storage, preview.data, { replaceExisting: true }).persisted).toBe(true)
  })

  it('allows replacement of an empty compatibility snapshot but protects meaningful v3-only state', () => {
    const source = realisticData()
    const original = JSON.stringify(source)
    const preview = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    const { values, storage } = memoryStorage({ [PERSONAL_DATA_KEY]: original, [PERSONAL_DATA_V3_KEY]: JSON.stringify(preview.data) })
    expect(commitPersonalDataV3(storage, preview.data, { replaceExisting: true }).persisted).toBe(true)

    const populated = structuredClone(preview.data)
    populated.tasks.push({ taskId: 'task-existing-prep', cookEventId: null, mealRequirementId: null, kind: 'prep', title: 'Existing v3-only prep', timingWindow: { earliest: null, latest: null }, durationMinutes: 10, evidenceIds: [], state: 'scheduled', safetyNote: null })
    values.set(PERSONAL_DATA_V3_KEY, JSON.stringify(populated))
    const before = values.get(PERSONAL_DATA_V3_KEY)
    expect(commitPersonalDataV3(storage, preview.data, { replaceExisting: true }).error).toMatch(/contains planning, cooking, inventory, or task state/i)
    expect(values.get(PERSONAL_DATA_V3_KEY)).toBe(before)
  })

  it('keeps v2 untouched when storage fails and reports corrupt v3 recovery text', () => {
    const source = realisticData()
    const original = JSON.stringify(source)
    const failing = { getItem: (key: string) => key === PERSONAL_DATA_KEY ? original : null, setItem: () => { throw new Error('quota') } }
    const preview = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    expect(commitPersonalDataV3(failing, preview.data)).toMatchObject({ persisted: false, error: expect.stringContaining('original planner remains unchanged') })
    expect(failing.getItem(PERSONAL_DATA_KEY)).toBe(original)

    const corrupt = memoryStorage({ [PERSONAL_DATA_KEY]: original, [PERSONAL_DATA_V3_KEY]: '{broken' })
    expect(loadPersonalDataV3(corrupt.storage, source)).toEqual({ data: null, stale: false, error: 'The saved v3 snapshot is invalid. The original v2 planner was not changed.', recoveryBackup: '{broken' })
    expect(corrupt.values.get(PERSONAL_DATA_KEY)).toBe(original)
  })

  it('round-trips v3 exports atomically and rejects invalid imports before any write', () => {
    const source = realisticData()
    const preview = previewPersonalDataV3Migration(source, { timeZone: 'America/Los_Angeles', knownRecipeIds })
    expect(importPersonalDataV3(exportPersonalDataV3(preview.data))).toEqual(preview.data)
    expect(() => importPersonalDataV3('{"schemaVersion":3}')).toThrow()
    expect(preview.data.migrationRecovery?.sourceFingerprint).toBe(personalDataFingerprint(source))
  })

  it('reads the unfiltered persisted source exactly and blocks an unparseable source', () => {
    const source = realisticData()
    const raw = `  ${JSON.stringify(source)}\n`
    const valid = memoryStorage({ [PERSONAL_DATA_KEY]: JSON.stringify(emptyPersonalData()) })
    expect(loadPersonalDataV3MigrationSource(valid.storage, emptyPersonalData(), raw)).toEqual({ data: source, raw, error: null })
    const corrupt = memoryStorage({ [PERSONAL_DATA_KEY]: '{not-json' })
    expect(loadPersonalDataV3MigrationSource(corrupt.storage, emptyPersonalData())).toMatchObject({ data: null, raw: '{not-json', error: expect.stringContaining('conversion is disabled') })
  })
})
