import { beforeAll, describe, expect, it } from 'vitest'
import committedDraft from '../../docs/data/G3A_SYNTHETIC_WEEK_DRAFT.json'
import { canonicalIngredients } from '../data/pilotCatalog'
import { recipeApprovalManifestV3 } from '../data/recipeApprovalManifestV3'
import { reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments } from '../data/reviewedRecipeCatalogV3'
import { g3aCompleteWeekRequest, g3aSyntheticRecipes } from './g3aWeekFixtures'
import { summarizeBatchAllocation } from './planningV3'
import { applyRecipeApprovalManifest } from './recipeApprovalV3'
import { buildRealCatalogCoverageScenarios } from './realCatalogCoverageV3'
import { generateWeekDraft, weekDraftSchema, type WeekDraft } from './weekGeneratorV3'

const options = { maxSearchNodes: 20_000, maxOptionsPerRequirement: 10, maxRoutes: 2_000, maxStoredMealsPerBatch: 3 }
const generate = () => generateWeekDraft({ request: g3aCompleteWeekRequest, ingredients: canonicalIngredients, options })
let completeDraft: WeekDraft
beforeAll(() => { completeDraft = generate() }, 30_000)

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
      storageMode: 'refrigerated',
      storedAt: '2027-01-31T16:30:00.000Z',
      bestUseWindow: { start: '2027-01-31T16:30:00.000Z', end: '2027-02-02T16:30:00.000Z', evidenceIds: recipe.suitability.storageModes[0].evidenceIds },
      initialAmount: { kind: 'fixed-portion', amount: 1 },
      remainingAmount: { kind: 'fixed-portion', amount: 1 },
      state: 'available',
      version: 1,
    }]
    const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { ...options, maxSearchNodes: 500 } })
    expect(draft.status).toBe('complete')
    expect(draft.selectedRoutes).toEqual([expect.objectContaining({ pattern: 'prepared-inventory', preparedFoodLotId: 'prepared-lot-g3a-office-lunch', candidateId: null })])
    expect(draft.allocations[0].source).toEqual({ kind: 'prepared-lot', preparedFoodLotId: 'prepared-lot-g3a-office-lunch' })
    expect(draft.batches).toEqual([])
    expect(draft.cookEvents).toEqual([])
    expect(draft.groceryDemand.lines).toEqual([])
  }, 15_000)

  it('explores alternatives when the first local dinner choice conflicts with the locked diverse week', () => {
    const draft = completeDraft
    expect(draft.status).toBe('complete')
    expect(draft.search.nodesVisited).toBeGreaterThan(draft.selectedRoutes.length)
    expect(draft.score.distinctDinners).toBeGreaterThanOrEqual(5)
    expect(draft.rejectedAlternatives.some(({ reasons }) => reasons.some(({ code }) => code === 'locked-choice-mismatch'))).toBe(true)
  }, 30_000)
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
