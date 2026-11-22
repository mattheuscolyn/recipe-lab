import { describe, expect, it } from 'vitest'
import { canonicalIngredients } from '../data/pilotCatalog'
import { buildGenerateWeekPreviewRequest, localDateTimeToIso, previewCatalog } from './generateWeekPreview'
import { generateWeekDraft } from './weekGeneratorV3'

const configuration = {
  weekStart: '2027-06-07',
  timeZone: 'America/Los_Angeles',
  mode: 'demo' as const,
  includedMeals: { breakfast: true, lunch: true, dinner: true },
  portions: { breakfast: 2, lunch: 2, dinner: 2 },
  sundayPrep: true,
  maxDinnerActiveMinutes: 45,
  officeLunches: true,
  avoidedRecipeIds: [],
  preferredRecipeIds: [],
}

describe('interactive Generate Week request builder', () => {
  it('uses Pacific-local wall times across DST boundaries', () => {
    expect(localDateTimeToIso('2026-03-08', '08:00', 'America/Los_Angeles')).toBe('2026-03-08T15:00:00.000Z')
    expect(localDateTimeToIso('2026-11-01', '08:00', 'America/Los_Angeles')).toBe('2026-11-01T16:00:00.000Z')
  })

  it('builds arbitrary selected weeks rather than reusing the G3a fixture dates', () => {
    const request = buildGenerateWeekPreviewRequest(configuration)
    expect(request.horizon).toEqual({ start: '2027-06-07', end: '2027-06-13' })
    expect(request.mealRequirements).toHaveLength(21)
    expect(request.mealRequirements[0]).toMatchObject({ date: '2027-06-07', intendedAt: '2027-06-07T15:00:00.000Z', requestedPortions: 2 })
    expect(request.cookingWindows.some(({ cookingWindowId }) => cookingWindowId === 'cooking-window-sunday-prep')).toBe(true)
  })

  it('keeps the real production catalog empty until authorized revisions are eligible', () => {
    expect(previewCatalog('real').productionEligibleCount).toBe(0)
    const request = buildGenerateWeekPreviewRequest({ ...configuration, mode: 'real' })
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { maxCompleteSolutions: 1, maxSearchNodes: 100 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.meals.filter(({ status }) => status === 'planned')).toHaveLength(0)
    expect(draft.unmetRequirements).toHaveLength(21)
  })

  it('generates a complete synthetic demonstration for an arbitrary selected week', () => {
    const request = buildGenerateWeekPreviewRequest(configuration)
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { maxCompleteSolutions: 6, maxSearchNodes: 12_000, maxOptionsPerRequirement: 8, maxRoutes: 900, maxPrepWindowsPerRoute: 1, maxStoredMealsPerBatch: 3 } })
    expect(draft.status).toBe('complete')
    expect(draft.meals.filter(({ status }) => status === 'planned')).toHaveLength(21)
    expect(draft.selectedRoutes.some(({ pattern }) => pattern === 'prior-meal-leftovers')).toBe(true)
    expect(draft.batches).toHaveLength(draft.cookEvents.length)
    expect(draft.shoppingReadiness.pricesAvailable).toBe(false)
  }, 45_000)
})
