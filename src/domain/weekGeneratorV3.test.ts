import { beforeAll, describe, expect, it } from 'vitest'
import committedDraft from '../../docs/data/G3A_SYNTHETIC_WEEK_DRAFT.json'
import { canonicalIngredients } from '../data/pilotCatalog'
import { recipeApprovalManifestV3 } from '../data/recipeApprovalManifestV3'
import { reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments } from '../data/reviewedRecipeCatalogV3'
import { g3aCompleteWeekRequest, g3aSyntheticRecipes, g3aSyntheticServiceAssessments } from './g3aWeekFixtures'
import { summarizeBatchAllocation } from './planningV3'
import { applyRecipeApprovalManifest } from './recipeApprovalV3'
import { buildRealCatalogCoverageScenarios } from './realCatalogCoverageV3'
import { generateWeekDraft, weekDraftSchema, type WeekDraft } from './weekGeneratorV3'

const options = { maxSearchNodes: 20_000, maxOptionsPerRequirement: 10, maxRoutes: 2_000, maxStoredMealsPerBatch: 3 }
const generate = () => generateWeekDraft({ request: g3aCompleteWeekRequest, ingredients: canonicalIngredients, options })
let completeDraft: WeekDraft
beforeAll(() => { completeDraft = generate() }, 30_000)

function preparedLunchRequest() {
  const request = structuredClone(g3aCompleteWeekRequest)
  request.requestId = 'planning-request-g3a-prepared-inventory'
  request.lockedChoices = []
  request.mealRequirements = request.mealRequirements.map((requirement) => requirement.mealRequirementId === 'meal-requirement-2027-02-01-lunch'
    ? { ...requirement, lock: { locked: false, reason: null } }
    : { ...requirement, requestedPortions: 0, status: 'skipped' as const, lock: { locked: false, reason: null } })
  const recipe = g3aSyntheticRecipes.find(({ mealRoles }) => mealRoles.primary.includes('lunch'))!
  request.preparedLots = [{
    preparedFoodLotId: 'prepared-lot-g3a-office-lunch',
    batchId: 'batch-g3a-existing-office-lunch',
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    createdAt: '2027-01-31T16:00:00.000Z',
    storageMode: 'refrigerated' as const,
    storedAt: '2027-01-31T16:30:00.000Z',
    bestUseWindow: { start: '2027-01-31T16:30:00.000Z', end: '2027-02-02T16:30:00.000Z', evidenceIds: recipe.suitability.storageModes[0].evidenceIds },
    initialAmount: { kind: 'fixed-portion' as const, amount: 1 },
    remainingAmount: { kind: 'fixed-portion' as const, amount: 1 },
    state: 'available' as const,
    version: 1,
  }]
  return { request, recipe }
}

describe('G3a weekly recommendation engine', () => {
  it('generates a complete, readable seven-day plan with repeats, variety, skips, prep and leftovers', () => {
    const draft = completeDraft
    const required = g3aCompleteWeekRequest.mealRequirements.filter(({ status }) => status !== 'skipped')
    const dinners = draft.meals.filter(({ meal, status }) => meal === 'dinner' && status === 'planned')
    const breakfasts = draft.meals.filter(({ meal, status }) => meal === 'breakfast' && status === 'planned')
    expect(draft.status).toBe('complete')
    expect(draft.unmetRequirements).toEqual([])
    expect(draft.meals.filter(({ status }) => status === 'planned')).toHaveLength(required.length)
    expect(draft.meals.filter(({ status }) => status === 'skipped')).toHaveLength(2)
    expect(new Set(dinners.map(({ recipeId }) => recipeId)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(breakfasts.map(({ recipeId }) => recipeId)).size).toBeLessThan(breakfasts.length)
    expect(draft.selectedRoutes.some(({ pattern }) => pattern === 'dedicated-prep')).toBe(true)
    expect(draft.selectedRoutes.some(({ pattern }) => pattern === 'prior-meal-leftovers')).toBe(true)
    expect(draft.meals.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2027-02-03-dinner')).toMatchObject({ recipeId: '30000000-0000-4000-8000-000000000006', status: 'planned' })
    expect(draft.score.dislikedMealCount).toBe(0)
  }, 30_000)

  it('is deterministic and JSON-schema-valid', () => {
    const first = completeDraft
    const second = generate()
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(weekDraftSchema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first)
    expect(weekDraftSchema.parse(committedDraft)).toEqual(first)
  }, 45_000)

  it('conserves every selected batch and derives groceries once per cooking batch', () => {
    const draft = completeDraft
    for (const batch of draft.batches) {
      const summary = summarizeBatchAllocation(batch, draft.allocations)
      expect(summary.allocated.amount + summary.remainder.amount).toBeCloseTo(batch.plannedOutput.amount)
    }
    const contributionBatchIds = new Set(draft.groceryDemand.lines.flatMap(({ contributions }) => contributions.map(({ batchId }) => batchId)))
    expect(contributionBatchIds).toEqual(new Set(draft.batches.map(({ batchId }) => batchId)))
    expect(draft.allocations.filter(({ service }) => service !== 'fresh').length).toBeGreaterThan(0)
    expect(new Set(draft.batches.map(({ batchId }) => batchId)).size).toBe(draft.batches.length)
  }, 30_000)

  it('never schedules overlapping cooking events', () => {
    const draft = completeDraft
    const cooked = draft.selectedRoutes.filter((route) => route.cookingStartsAt !== null && route.expectedReadyAt !== null)
    for (let left = 0; left < cooked.length; left += 1) {
      for (let right = left + 1; right < cooked.length; right += 1) {
        const overlaps = Date.parse(cooked[left].cookingStartsAt!) < Date.parse(cooked[right].expectedReadyAt!)
          && Date.parse(cooked[right].cookingStartsAt!) < Date.parse(cooked[left].expectedReadyAt!)
        expect(overlaps).toBe(false)
      }
    }
    for (const window of g3aCompleteWeekRequest.cookingWindows) {
      const activeMinutes = draft.selectedRoutes.filter(({ cookingWindowId }) => cookingWindowId === window.cookingWindowId).reduce((sum, route) => sum + route.activeMinutes, 0)
      expect(activeMinutes).toBeLessThanOrEqual(window.maxActiveMinutes)
    }
  }, 30_000)

  it('leaves a requirement unmet instead of overlapping two required cooking events', () => {
    const request = structuredClone(g3aCompleteWeekRequest)
    request.requestId = 'planning-request-g3a-cooking-conflict'
    const breakfast = request.mealRequirements.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2027-02-01-breakfast')!
    request.mealRequirements = [
      { ...breakfast, mealRequirementId: 'meal-requirement-g3a-conflict-one' },
      { ...breakfast, mealRequirementId: 'meal-requirement-g3a-conflict-two' },
    ]
    request.recipeSnapshot = [g3aSyntheticRecipes.find(({ identity }) => identity.slug === 'synthetic-tofu-scramble')!]
    request.serviceAssessments = []
    request.pantry = []
    request.cookingWindows = request.cookingWindows.filter(({ cookingWindowId }) => cookingWindowId === 'cooking-window-2027-02-01-breakfast')
    request.lockedChoices = []
    request.preferences = { preferredRecipeIds: [], householdRecipePreferences: [] }
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 500, maxRoutes: 100 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.meals.filter(({ status }) => status === 'planned')).toHaveLength(1)
    expect(draft.meals.filter(({ status }) => status === 'unmet')).toHaveLength(1)
    expect(draft.unselectedEligibleAlternatives.some(({ reason }) => reason === 'cooking-conflict')).toBe(true)
  })

  it('enforces aggregate active-minute capacity for sequential batches in one window', () => {
    const request = structuredClone(g3aCompleteWeekRequest)
    request.requestId = 'planning-request-g3a-window-capacity'
    const breakfast = request.mealRequirements.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2027-02-01-breakfast')!
    request.mealRequirements = [
      { ...breakfast, mealRequirementId: 'meal-requirement-g3a-capacity-one', intendedAt: '2027-02-01T14:55:00.000Z' },
      { ...breakfast, mealRequirementId: 'meal-requirement-g3a-capacity-two', intendedAt: '2027-02-01T16:00:00.000Z' },
    ]
    request.recipeSnapshot = [g3aSyntheticRecipes.find(({ identity }) => identity.slug === 'synthetic-banana-muffins')!]
    request.serviceAssessments = []
    request.pantry = []
    request.cookingWindows = [{ cookingWindowId: 'cooking-window-g3a-shared-capacity', start: '2027-02-01T14:00:00.000Z', end: '2027-02-01T16:00:00.000Z', maxActiveMinutes: 20 }]
    request.lockedChoices = []
    request.preferences = { preferredRecipeIds: [], householdRecipePreferences: [] }
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 500, maxRoutes: 100, maxCompleteSolutions: 2 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.meals.filter(({ status }) => status === 'planned')).toHaveLength(1)
    expect(draft.selectedRoutes.filter(({ cookingWindowId }) => cookingWindowId === 'cooking-window-g3a-shared-capacity').reduce((sum, route) => sum + route.activeMinutes, 0)).toBeLessThanOrEqual(20)
    expect(draft.unmetRequirements[0].blockers).toContainEqual(expect.objectContaining({ code: 'cooking-window-capacity-exceeded' }))
  })

  it('completes a legitimate small fresh-only week without requiring leftovers', () => {
    const request = structuredClone(g3aCompleteWeekRequest)
    request.requestId = 'planning-request-g3a-small-fresh-week'
    request.mealRequirements = request.mealRequirements.filter(({ mealRequirementId }) => ['meal-requirement-2027-02-01-dinner', 'meal-requirement-2027-02-02-dinner'].includes(mealRequirementId)).map((requirement) => ({ ...requirement, lock: { locked: false, reason: null } }))
    request.recipeSnapshot = g3aSyntheticRecipes.filter(({ mealRoles }) => mealRoles.primary.includes('dinner')).slice(0, 2)
    request.serviceAssessments = []
    request.pantry = []
    request.cookingWindows = request.cookingWindows.filter(({ cookingWindowId }) => ['cooking-window-2027-02-01-dinner', 'cooking-window-2027-02-02-dinner'].includes(cookingWindowId))
    request.lockedChoices = []
    request.preferences = { preferredRecipeIds: [], householdRecipePreferences: [] }
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 500, maxRoutes: 100, maxCompleteSolutions: 1 } })
    expect(draft.status).toBe('complete')
    expect(draft.selectedRoutes).toHaveLength(2)
    expect(draft.selectedRoutes.every(({ pattern }) => pattern === 'fresh')).toBe(true)
    expect(draft.search).toMatchObject({ completeSolutionsEvaluated: 1, completeSolutionLimit: 1, exhausted: false })
  })

  it('backtracks when the highest-ranked first route blocks later complete coverage', () => {
    const request = structuredClone(g3aCompleteWeekRequest)
    request.requestId = 'planning-request-g3a-real-backtracking'
    const breakfast = request.mealRequirements.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2027-02-01-breakfast')!
    const tofu = g3aSyntheticRecipes.find(({ identity }) => identity.slug === 'synthetic-tofu-scramble')!
    const muffins = g3aSyntheticRecipes.find(({ identity }) => identity.slug === 'synthetic-banana-muffins')!
    request.mealRequirements = [
      { ...breakfast, mealRequirementId: 'meal-requirement-g3a-backtrack-one', intendedAt: '2027-02-01T15:00:00.000Z' },
      { ...breakfast, mealRequirementId: 'meal-requirement-g3a-backtrack-two', intendedAt: '2027-02-01T15:10:00.000Z', constraints: { ...breakfast.constraints, avoidRecipeIds: [tofu.identity.recipeId] } },
    ]
    request.recipeSnapshot = [tofu, muffins]
    request.serviceAssessments = g3aSyntheticServiceAssessments.filter(({ recipeId }) => recipeId === tofu.identity.recipeId)
    request.pantry = []
    request.cookingWindows = [{ cookingWindowId: 'cooking-window-g3a-backtracking', start: '2027-02-01T13:00:00.000Z', end: '2027-02-01T15:10:00.000Z', maxActiveMinutes: 30 }]
    request.lockedChoices = []
    request.preferences = { preferredRecipeIds: [], householdRecipePreferences: [] }
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 1_000, maxRoutes: 200, maxStoredMealsPerBatch: 1, maxCompleteSolutions: 1 } })
    expect(draft.status).toBe('complete')
    expect(draft.search.backtrackCount).toBeGreaterThan(0)
    expect(draft.meals.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-g3a-backtrack-one')?.service).toBe('refrigerated-leftover')
    expect(draft.meals.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-g3a-backtrack-two')?.service).toBe('fresh')
  })

  it('returns an honest incomplete result when all recipes are hard-avoided', () => {
    const request = structuredClone(g3aCompleteWeekRequest)
    request.requestId = 'planning-request-g3a-impossible-week'
    request.hardConstraints.avoidedRecipeIds = g3aSyntheticRecipes.map(({ identity }) => identity.recipeId)
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 5_000 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.meals.some(({ status }) => status === 'unmet')).toBe(true)
    expect(draft.unmetRequirements.every(({ blockers }) => blockers.some(({ code }) => code === 'hard-recipe-avoid'))).toBe(true)
    expect(draft.batches).toEqual([])
    expect(draft.groceryDemand.lines).toEqual([])
  }, 30_000)

  it('keeps the zero-approval production catalog honestly incomplete', () => {
    const active = applyRecipeApprovalManifest(reviewedRecipeCatalogV3, recipeApprovalManifestV3).activeRecipes
    const request = buildRealCatalogCoverageScenarios(active, reviewedRecipeServiceAssessments)[0].request
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { maxRoutes: 400, maxSearchNodes: 100, maxOptionsPerRequirement: 4, maxStoredMealsPerBatch: 2 } })
    expect(recipeApprovalManifestV3.bundles).toEqual([])
    expect(draft.status).toBe('incomplete')
    expect(draft.batches).toEqual([])
    expect(draft.unmetRequirements.length).toBeGreaterThan(0)
    expect(draft.rejectedAlternatives.some(({ reasons }) => reasons.some(({ code }) => code === 'recommendation-readiness-required'))).toBe(true)
  }, 30_000)

  it('uses prepared inventory once without adding a phantom cooking batch or grocery demand', () => {
    const { request } = preparedLunchRequest()
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 500 } })
    expect(draft.status).toBe('complete')
    expect(draft.selectedRoutes).toEqual([expect.objectContaining({ pattern: 'prepared-inventory', preparedFoodLotId: 'prepared-lot-g3a-office-lunch', candidateId: null })])
    expect(draft.allocations[0].source).toEqual({ kind: 'prepared-lot', preparedFoodLotId: 'prepared-lot-g3a-office-lunch' })
    expect(draft.batches).toEqual([])
    expect(draft.cookEvents).toEqual([])
    expect(draft.groceryDemand.lines).toEqual([])
  }, 15_000)

  it('caps prepared inventory at the recipe-reviewed storage maximum', () => {
    const { request, recipe } = preparedLunchRequest()
    request.requestId = 'planning-request-g3a-expired-prepared-inventory'
    const reviewedRecipe = structuredClone(recipe)
    reviewedRecipe.suitability.storageModes = reviewedRecipe.suitability.storageModes.map((storage) => storage.mode === 'refrigerated' ? { ...storage, maxDurationHours: 24 } : storage)
    request.recipeSnapshot = [reviewedRecipe]
    request.serviceAssessments = request.serviceAssessments.filter(({ recipeId }) => recipeId === recipe.identity.recipeId)
    request.cookingWindows = []
    request.preparedLots[0].bestUseWindow.end = '2027-02-02T16:30:00.000Z'
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 200, maxRoutes: 50 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.selectedRoutes).toEqual([])
    expect(draft.unmetRequirements[0].blockers).toContainEqual(expect.objectContaining({ code: 'prepared-inventory-storage-expired' }))
  })

  it('fails closed for an unbounded prepared-lot best-use window', () => {
    const { request, recipe } = preparedLunchRequest()
    request.requestId = 'planning-request-g3a-unbounded-prepared-inventory'
    request.recipeSnapshot = [recipe]
    request.serviceAssessments = request.serviceAssessments.filter(({ recipeId }) => recipeId === recipe.identity.recipeId)
    request.cookingWindows = []
    request.preparedLots[0].bestUseWindow.end = null
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 200, maxRoutes: 50 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.unmetRequirements[0].blockers).toContainEqual(expect.objectContaining({ code: 'prepared-inventory-best-use-end-required' }))
  })

  it('keeps frozen prepared inventory unavailable when thaw evidence is missing', () => {
    const { request, recipe } = preparedLunchRequest()
    request.requestId = 'planning-request-g3a-frozen-review-needed'
    const reviewedRecipe = structuredClone(recipe)
    reviewedRecipe.suitability.thawRequired = { value: null, evidenceIds: [], confidence: 'unknown', unknownReason: 'A reviewed thaw route has not been established.' }
    request.recipeSnapshot = [reviewedRecipe]
    request.serviceAssessments = request.serviceAssessments.filter(({ recipeId }) => recipeId === recipe.identity.recipeId)
    request.cookingWindows = []
    request.preparedLots[0].storageMode = 'frozen'
    request.preparedLots[0].bestUseWindow.evidenceIds = reviewedRecipe.suitability.storageModes.find(({ mode }) => mode === 'frozen')!.evidenceIds
    request.preparedLots[0].bestUseWindow.end = '2027-02-28T16:30:00.000Z'
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 200, maxRoutes: 50 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.unmetRequirements[0].blockers).toContainEqual(expect.objectContaining({ code: 'prepared-inventory-thaw-review-required' }))
  })

  it('keeps frozen prepared inventory unavailable when reheating evidence is missing', () => {
    const { request, recipe } = preparedLunchRequest()
    request.requestId = 'planning-request-g3a-frozen-reheat-review-needed'
    const reviewedRecipe = structuredClone(recipe)
    reviewedRecipe.suitability.reheatMethod = { value: null, evidenceIds: [], confidence: 'unknown', unknownReason: 'A reviewed frozen reheating route has not been established.' }
    request.recipeSnapshot = [reviewedRecipe]
    request.serviceAssessments = request.serviceAssessments.filter(({ recipeId }) => recipeId === recipe.identity.recipeId)
    request.cookingWindows = []
    request.preparedLots[0].storageMode = 'frozen'
    request.preparedLots[0].bestUseWindow.evidenceIds = reviewedRecipe.suitability.storageModes.find(({ mode }) => mode === 'frozen')!.evidenceIds
    request.preparedLots[0].bestUseWindow.end = '2027-02-28T16:30:00.000Z'
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 200, maxRoutes: 50 } })
    expect(draft.status).toBe('incomplete')
    expect(draft.unmetRequirements[0].blockers).toContainEqual(expect.objectContaining({ code: 'prepared-inventory-reheat-review-required' }))
  })

  it('keeps hard ingredient avoids out of selected routes', () => {
    const request = structuredClone(g3aCompleteWeekRequest)
    request.requestId = 'planning-request-g3a-ingredient-avoid'
    request.lockedChoices = []
    request.mealRequirements = request.mealRequirements.map((requirement) => requirement.mealRequirementId === 'meal-requirement-2027-02-01-dinner'
      ? { ...requirement, lock: { locked: false, reason: null } }
      : { ...requirement, requestedPortions: 0, status: 'skipped' as const, lock: { locked: false, reason: null } })
    const recipes = g3aSyntheticRecipes.filter(({ mealRoles }) => mealRoles.primary.includes('dinner')).slice(0, 2)
    const secondIngredients = new Set(recipes[1].requirements.map(({ canonicalIngredientId }) => canonicalIngredientId))
    const avoided = recipes[0].requirements.find(({ canonicalIngredientId }) => !secondIngredients.has(canonicalIngredientId))!.canonicalIngredientId
    request.recipeSnapshot = recipes
    request.serviceAssessments = []
    request.hardConstraints.avoidedIngredientIds = [avoided]
    request.preferences = { preferredRecipeIds: [], householdRecipePreferences: [] }
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 500 } })
    expect(draft.status).toBe('complete')
    expect(draft.meals.find(({ status }) => status === 'planned')?.recipeId).toBe(recipes[1].identity.recipeId)
    expect(draft.rejectedAlternatives.some(({ reasons }) => reasons.some(({ code }) => code.startsWith('hard-ingredient-avoid')))).toBe(true)
  })
})
