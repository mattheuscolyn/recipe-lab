import { describe, expect, it } from 'vitest'
import { canonicalIngredients } from '../data/pilotCatalog'
import { activePersonalRecipes, buildPersonalRecipeRevision, emptyPersonalRecipeLibrary, loadPersonalRecipeLibrary, PERSONAL_RECIPE_STORAGE_KEY, savePersonalRecipeRevision, type PersonalRecipeInput } from './personalRecipesV3'
import { buildGenerateWeekPreviewRequest } from './generateWeekPreview'
import { generateWeekDraft } from './weekGeneratorV3'

const ingredient = canonicalIngredients[0]
const input = (revision = 1): PersonalRecipeInput => ({
  personalRecipeId: '90000000-0000-4000-8000-000000000001',
  revision,
  title: 'Our Weeknight Bowl',
  description: 'A private household dinner used for fresh meal planning.',
  emoji: '🥣',
  servings: 2,
  activeMinutes: 20,
  totalMinutes: 35,
  mealRoles: ['dinner'],
  ingredients: [{ ingredientId: ingredient.id, variantId: ingredient.variants[0].id, amount: 200, unit: ingredient.baseUnit, optional: false }],
  authorshipConfirmed: true,
  authorshipStatement: 'I wrote this recipe or have permission to use it privately.',
  freshUseReviewed: true,
  createdAt: '2026-11-22T18:00:00.000Z',
  updatedAt: `2026-11-22T18:0${revision}:00.000Z`,
})

describe('private personal recipe library', () => {
  it('creates a recommendation-ready fresh-only v3 revision without inventing storage guidance', () => {
    const recipe = buildPersonalRecipeRevision(input(), canonicalIngredients)
    expect(recipe.review.readiness.recommendationReady).toBe(true)
    expect(recipe.review.readiness.cookingModeReady).toBe(false)
    expect(recipe.source.evidence[0]).toMatchObject({ kind: 'user-entered', sourceUrl: null })
    expect(recipe.source.rights.factualMetadataUse).toBe('approved')
    expect(recipe.suitability).toMatchObject({ reviewState: 'unknown', storageModes: [] })
    expect(recipe.suitability.leftoverQuality.value).toBeNull()
  })

  it('persists immutable revisions locally and keeps prior versions', () => {
    const first = savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), input(1), canonicalIngredients)
    const second = savePersonalRecipeRevision(window.localStorage, first, { ...input(2), title: 'Our Weeknight Bowl v2' }, canonicalIngredients)
    expect(second.recipes[0].revisions).toHaveLength(2)
    expect(activePersonalRecipes(second)[0].identity.title).toBe('Our Weeknight Bowl v2')
    expect(second.recipes[0].revisions[0].recipe.identity.title).toBe('Our Weeknight Bowl')
    expect(loadPersonalRecipeLibrary(window.localStorage)).toEqual(second)
    expect(() => savePersonalRecipeRevision(window.localStorage, second, input(2), canonicalIngredients)).toThrow(/immutable/)
    window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
  })

  it('never overwrites unreadable private recipe data with an empty library', () => {
    const broken = '{"schemaVersion":1,"recipes":['
    window.localStorage.setItem(PERSONAL_RECIPE_STORAGE_KEY, broken)
    try {
      const fallback = loadPersonalRecipeLibrary(window.localStorage)
      expect(fallback).toEqual(emptyPersonalRecipeLibrary())
      expect(() => savePersonalRecipeRevision(window.localStorage, fallback, input(), canonicalIngredients)).toThrow(/unreadable/)
      expect(window.localStorage.getItem(PERSONAL_RECIPE_STORAGE_KEY)).toBe(broken)
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY) }
  })

  it('protects newer private recipe changes against stale editor saves', () => {
    window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
    try {
      const original = savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), input(1), canonicalIngredients)
      const updated = savePersonalRecipeRevision(window.localStorage, original, { ...input(2), title: 'Edited in another tab' }, canonicalIngredients)
      const savedRaw = window.localStorage.getItem(PERSONAL_RECIPE_STORAGE_KEY)
      expect(() => savePersonalRecipeRevision(window.localStorage, original, { ...input(3), title: 'Stale edit' }, canonicalIngredients)).toThrow(/changed since this view loaded/)
      expect(window.localStorage.getItem(PERSONAL_RECIPE_STORAGE_KEY)).toBe(savedRaw)
      expect(loadPersonalRecipeLibrary(window.localStorage)).toEqual(updated)
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY) }
  })

  it('rejects unknown ingredient variants and unsupported claims', () => {
    expect(() => buildPersonalRecipeRevision({ ...input(), ingredients: [{ ...input().ingredients[0], variantId: 'variant-not-real' }] }, canonicalIngredients)).toThrow(/not in the local catalog/)
    expect(() => buildPersonalRecipeRevision({ ...input(), authorshipConfirmed: false } as unknown as PersonalRecipeInput, canonicalIngredients)).toThrow()
  })

  it('uses an eligible private recipe in the real engine without authorizing stored meals', () => {
    const recipe = buildPersonalRecipeRevision(input(), canonicalIngredients)
    const request = buildGenerateWeekPreviewRequest({
      weekStart: '2027-06-07', timeZone: 'America/Los_Angeles', mode: 'real', includedMeals: { breakfast: false, lunch: false, dinner: true }, portions: { breakfast: 2, lunch: 2, dinner: 2 }, sundayPrep: false, maxDinnerActiveMinutes: 45, officeLunches: true, avoidedRecipeIds: [], preferredRecipeIds: [], personalRecipes: [recipe],
    })
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { maxCompleteSolutions: 1, maxSearchNodes: 500, maxOptionsPerRequirement: 2, maxRoutes: 100 } })
    expect(draft.status).toBe('complete')
    expect(draft.meals.filter(({ status }) => status === 'planned')).toHaveLength(7)
    expect(draft.selectedRoutes.every(({ pattern }) => pattern === 'fresh')).toBe(true)
    expect(draft.selectedRoutes.every(({ recipeId }) => recipeId === recipe.identity.recipeId)).toBe(true)
  }, 20_000)
})
