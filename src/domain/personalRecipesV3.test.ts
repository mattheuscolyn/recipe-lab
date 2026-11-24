import { describe, expect, it } from 'vitest'
import { canonicalIngredients } from '../data/pilotCatalog'
import { activePersonalRecipes, buildPersonalRecipeRevision, emptyPersonalRecipeLibrary, exportPersonalRecipeLibrary, importPersonalRecipeLibrary, inspectPersonalRecipeLibrary, loadPersonalRecipeLibrary, PERSONAL_RECIPE_IMPORT_PENDING_KEY, PERSONAL_RECIPE_STORAGE_KEY, previewPersonalRecipeImport, removePersonalRecipe, savePersonalRecipeRevision, type PersonalRecipeInput } from './personalRecipesV3'
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
      expect(inspectPersonalRecipeLibrary(window.localStorage)).toEqual({ library: null, rawRecovery: broken, error: expect.stringContaining('not replaced with an empty library') })
      expect(() => savePersonalRecipeRevision(window.localStorage, fallback, input(), canonicalIngredients)).toThrow(/unreadable/)
      expect(window.localStorage.getItem(PERSONAL_RECIPE_STORAGE_KEY)).toBe(broken)
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY) }
  })

  it('exports and safely merges immutable histories without losing either side', () => {
    window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
    try {
      const current = savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), input(1), canonicalIngredients)
      const importedBase = emptyPersonalRecipeLibrary()
      const otherInput = { ...input(1), personalRecipeId: '90000000-0000-4000-8000-000000000002', title: 'Imported Breakfast', mealRoles: ['breakfast' as const] }
      const otherRecipe = buildPersonalRecipeRevision(otherInput, canonicalIngredients)
      const incoming = { ...importedBase, recipes: [{ personalRecipeId: otherInput.personalRecipeId, activeRevisionId: otherRecipe.identity.revisionId, revisions: [{ input: otherInput, recipe: otherRecipe }] }] }
      const raw = exportPersonalRecipeLibrary(incoming)
      const preview = previewPersonalRecipeImport(current, raw)
      expect(preview).toMatchObject({ addedRecipes: 1, addedRevisions: 1, conflicts: [] })
      const merged = importPersonalRecipeLibrary(window.localStorage, current, raw)
      expect(merged.recipes.map(({ personalRecipeId }) => personalRecipeId)).toEqual([input().personalRecipeId, otherInput.personalRecipeId])
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY) }
  })

  it('blocks conflicting immutable revisions and requires an explicit active-revision choice', () => {
    window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
    try {
      const first = savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), input(1), canonicalIngredients)
      const second = savePersonalRecipeRevision(window.localStorage, first, input(2), canonicalIngredients)
      const collision = structuredClone(first)
      collision.recipes[0].revisions[0].input.title = 'Mutated immutable content'
      expect(previewPersonalRecipeImport(second, JSON.stringify(collision)).conflicts.map(({ code }) => code)).toContain('revision-collision')
      expect(previewPersonalRecipeImport(first, exportPersonalRecipeLibrary(second)).conflicts.map(({ code }) => code)).toContain('active-revision-choice')
      const selected = previewPersonalRecipeImport(first, exportPersonalRecipeLibrary(second), { [input().personalRecipeId]: second.recipes[0].activeRevisionId })
      expect(selected.merged?.recipes[0]).toMatchObject({ activeRevisionId: second.recipes[0].activeRevisionId, revisions: expect.arrayContaining(second.recipes[0].revisions) })
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY) }
  })

  it('deletes only after an explicit domain call and protects against a stale tab', () => {
    window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
    try {
      const current = savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), input(1), canonicalIngredients)
      const newer = savePersonalRecipeRevision(window.localStorage, current, input(2), canonicalIngredients)
      expect(() => removePersonalRecipe(window.localStorage, current, input().personalRecipeId)).toThrow(/another tab/)
      expect(removePersonalRecipe(window.localStorage, newer, input().personalRecipeId).recipes).toEqual([])
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY) }
  })

  it('surfaces an interrupted import without treating it as authoritative', () => {
    window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
    window.localStorage.removeItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY)
    try {
      const current = savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), input(1), canonicalIngredients)
      const pending = { ...current, recipes: [] }
      window.localStorage.setItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY, JSON.stringify(pending))
      const result = inspectPersonalRecipeLibrary(window.localStorage)
      expect(result.library).toEqual(current)
      expect(result.error).toMatch(/interrupted/)
      expect(result.rawRecovery).toContain('interruptedImport')
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY); window.localStorage.removeItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY) }
  })

  it('protects an interrupted import journal from create, edit, and delete attempts', () => {
    window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
    window.localStorage.removeItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY)
    try {
      const current = savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), input(1), canonicalIngredients)
      const authoritative = window.localStorage.getItem(PERSONAL_RECIPE_STORAGE_KEY)
      const interrupted = JSON.stringify({ ...current, recipes: [] })
      window.localStorage.setItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY, interrupted)
      expect(() => savePersonalRecipeRevision(window.localStorage, current, input(2), canonicalIngredients)).toThrow(/interrupted.*recovery/)
      expect(() => removePersonalRecipe(window.localStorage, current, input().personalRecipeId)).toThrow(/interrupted.*recovery/)
      expect(window.localStorage.getItem(PERSONAL_RECIPE_STORAGE_KEY)).toBe(authoritative)
      expect(window.localStorage.getItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY)).toBe(interrupted)
      expect(inspectPersonalRecipeLibrary(window.localStorage).rawRecovery).toContain('interruptedImport')
    } finally {
      window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY)
      window.localStorage.removeItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY)
    }
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
