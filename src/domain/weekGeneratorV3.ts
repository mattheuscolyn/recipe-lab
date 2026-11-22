import { z } from 'zod'
import { unitCodeSchema, type CanonicalIngredient } from './catalog'
import { enumerateGeneratorCandidates, type CandidateEnumerationOptions, type EnumeratedCandidateRoute } from './candidateEnumerationV3'
import { planningRequestSchema, rejectedReasonSchema, type PlanningRequest } from './generatorV3'
import { buildBatchGroceryDemand, type BatchGroceryDemand, type BatchIngredientSelection } from './planningGroceryV3'
import { allocateBatchToMeals, batchSchema, cookEventSchema, mealAllocationSchema, planCookingBatch, scheduleCookEvent, type Batch, type CookEvent, type MealAllocation } from './planningV3'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`))

const groceryDemandSchema: z.ZodType<BatchGroceryDemand> = z.object({
  scope: z.enum(['historical', 'outstanding']),
  lines: z.array(z.object({
    canonicalIngredientId: id('ingredient'),
    variantId: id('variant'),
    name: z.string(),
    variant: z.string(),
    total: z.number().nullable(),
    knownSubtotal: z.number().nonnegative(),
    unit: unitCodeSchema,
    contributions: z.array(z.object({
      batchId: id('batch'), recipeId: z.string().uuid(), recipeRevisionId: id('revision'), requirementId: id('requirement'), originalText: z.string(), amount: z.number().nullable(), unit: unitCodeSchema, approximate: z.boolean(), optional: z.boolean(), confidence: z.enum(['reviewed', 'needs-review']), note: z.string().nullable(),
    })),
    optional: z.boolean(),
    unresolved: z.boolean(),
    uncertainties: z.array(z.string()),
    pantry: z.object({ applied: z.number().nonnegative(), toBuy: z.number().nullable(), knownToBuy: z.number().nonnegative(), matchedAvailabilityIds: z.array(id('availability')), checkAvailabilityIds: z.array(id('availability')) }),
  })),
  uncertainties: z.array(z.string()),
}) as z.ZodType<BatchGroceryDemand>

const scoreSchema = z.object({
  total: z.number(),
  coveredRequirements: z.number().int().nonnegative(),
  distinctDinners: z.number().int().nonnegative(),
  preferredMealCount: z.number().int().nonnegative(),
  likedMealCount: z.number().int().nonnegative(),
  dislikedMealCount: z.number().int().nonnegative(),
  dinnerRepeatCount: z.number().int().nonnegative(),
  consecutiveDinnerRepeatCount: z.number().int().nonnegative(),
  breakfastRepeatCount: z.number().int().nonnegative(),
  activeCookingMinutes: z.number().nonnegative(),
  pantryMatchedRequirementCount: z.number().int().nonnegative(),
  plannedRemainder: z.number().nonnegative(),
})

export const weekDraftSchema = z.object({
  schemaVersion: z.literal(1),
  proposalId: id('proposal'),
  requestId: id('planning-request'),
  status: z.enum(['complete', 'incomplete']),
  search: z.object({ bounded: z.literal(true), nodesVisited: z.number().int().positive(), nodeLimit: z.number().int().positive(), routeLimit: z.number().int().positive(), routeLimitReached: z.boolean(), enumeratedRouteCount: z.number().int().nonnegative(), eligibleRouteCount: z.number().int().nonnegative(), completeSolutionsEvaluated: z.number().int().nonnegative(), completeSolutionLimit: z.number().int().positive(), backtrackCount: z.number().int().nonnegative(), exhausted: z.boolean() }),
  score: scoreSchema,
  selectedRoutes: z.array(z.object({ routeId: id('route'), pattern: z.enum(['fresh', 'dedicated-prep', 'prior-meal-leftovers', 'prepared-inventory']), candidateId: id('candidate').nullable(), recipeId: z.string().uuid(), recipeRevisionId: id('revision'), mealRequirementIds: z.array(id('meal-requirement')).min(1), cookingStartsAt: z.iso.datetime().nullable(), expectedReadyAt: z.iso.datetime().nullable(), cookingWindowId: id('cooking-window').nullable(), activeMinutes: z.number().nonnegative(), preparedFoodLotId: id('prepared-lot').nullable(), ingredientSelections: z.array(z.object({ requirementId: id('requirement'), selection: z.enum(['primary', 'alternative', 'excluded-optional']), alternativeId: id('alternative').nullable() })), explanations: z.array(z.string()) })),
  meals: z.array(z.object({ mealRequirementId: id('meal-requirement'), date: z.iso.date(), meal: z.enum(['breakfast', 'lunch', 'dinner']), requestedPortions: z.number().int().nonnegative(), status: z.enum(['planned', 'skipped', 'unmet']), recipeId: z.string().uuid().nullable(), recipeRevisionId: id('revision').nullable(), allocationId: id('allocation').nullable(), service: z.enum(['fresh', 'refrigerated-leftover', 'frozen-leftover']).nullable(), routeId: id('route').nullable() })),
  cookEvents: z.array(cookEventSchema),
  batches: z.array(batchSchema),
  allocations: z.array(mealAllocationSchema),
  groceryDemand: groceryDemandSchema,
  shoppingReadiness: z.object({ status: z.enum(['ready', 'review-needed']), unresolvedLineCount: z.number().int().nonnegative(), uncertaintyCount: z.number().int().nonnegative(), pricesAvailable: z.literal(false) }),
  explanations: z.array(z.object({ code: z.string(), message: z.string(), entityIds: z.array(z.string()) })),
  rejectedAlternatives: z.array(z.object({ routeId: id('route'), recipeId: z.string().uuid(), recipeRevisionId: id('revision'), mealRequirementIds: z.array(id('meal-requirement')), status: z.enum(['rejected', 'review-needed']), reasons: z.array(rejectedReasonSchema) })),
  unselectedEligibleAlternatives: z.array(z.object({ routeId: id('route'), recipeId: z.string().uuid(), recipeRevisionId: id('revision'), mealRequirementIds: z.array(id('meal-requirement')), reason: z.enum(['slot-already-covered', 'cooking-conflict', 'lower-score']) })),
  unmetRequirements: z.array(z.object({ mealRequirementId: id('meal-requirement'), blockers: z.array(z.object({ code: z.string(), count: z.number().int().positive() })) })),
})

export type WeekDraft = z.infer<typeof weekDraftSchema>

export type GenerateWeekDraftOptions = CandidateEnumerationOptions & {
  maxSearchNodes?: number
  maxOptionsPerRequirement?: number
  maxCompleteSolutions?: number
}

type RealizedRoute = {
  routeId: string
  pattern: 'fresh' | 'dedicated-prep' | 'prior-meal-leftovers' | 'prepared-inventory'
  candidate: EnumeratedCandidateRoute['candidate'] | null
  recipeId: string
  recipeRevisionId: string
  recipeTitle: string
  batch: Batch | null
  cookEvent: CookEvent | null
  allocations: MealAllocation[]
  remainder: number
  activeMinutes: number
  cookingWindowId: string | null
  cookingStartsAt: string | null
  expectedReadyAt: string | null
  preparedFoodLotId: string | null
}

type SearchState = { routes: RealizedRoute[]; covered: Set<string> }

const DEFAULT_SEARCH = { maxSearchNodes: 40_000, maxOptionsPerRequirement: 16, maxCompleteSolutions: 25, maxRoutes: 2_000 }

function realizeRoute(request: PlanningRequest, route: EnumeratedCandidateRoute): RealizedRoute | null {
  if (route.feasibility.status !== 'eligible' || !route.feasibility.timing) return null
  const recipe = request.recipeSnapshot.find(({ identity }) => identity.recipeId === route.candidate.recipeId && identity.revisionId === route.candidate.recipeRevisionId)
  if (!recipe) return null
  try {
    const suffix = route.routeId.replace(/^route-/, '')
    const batch = planCookingBatch(recipe, { batchId: `batch-${suffix}`, groceryDemandId: `grocery-demand-${suffix}`, multiplier: route.candidate.batchMultiplier, sourceYieldSelection: route.candidate.sourceYieldSelection ?? undefined })
    const cookEvent = scheduleCookEvent(recipe, batch, { cookEventId: `cook-event-${suffix}`, intendedAt: route.feasibility.timing.expectedReadyAt })
    const requirements = new Map(request.mealRequirements.map((requirement) => [requirement.mealRequirementId, requirement]))
    const result = allocateBatchToMeals(recipe, batch, cookEvent, route.candidate.allocations.map((allocation, index) => ({
      allocationId: `allocation-${suffix}-${index + 1}`,
      requirement: requirements.get(allocation.mealRequirementId)!,
      mealPortions: allocation.mealPortions,
      service: allocation.service,
      storageStartedAt: allocation.service === 'fresh' ? null : route.candidate.storageStartsAt,
    })))
    return {
      routeId: route.routeId,
      pattern: route.pattern,
      candidate: route.candidate,
      recipeId: route.candidate.recipeId,
      recipeRevisionId: route.candidate.recipeRevisionId,
      recipeTitle: recipe.identity.title,
      batch,
      cookEvent,
      allocations: result.allocations,
      remainder: result.remainder.amount,
      activeMinutes: typeof recipe.effort.activeMinutes.value === 'number' ? recipe.effort.activeMinutes.value : 0,
      cookingWindowId: route.feasibility.timing.cookingWindowId,
      cookingStartsAt: route.candidate.cookingStartsAt,
      expectedReadyAt: route.feasibility.timing.expectedReadyAt,
      preparedFoodLotId: null,
    }
  } catch {
    return null
  }
}

function reviewedFact(value: { value: unknown; confidence: string; evidenceIds: string[] }): boolean {
  return value.value !== null && ['reported', 'reviewed'].includes(value.confidence) && value.evidenceIds.length > 0
}

function inventoryServiceAllowed(request: PlanningRequest, recipeId: string, recipeRevisionId: string, requirement: PlanningRequest['mealRequirements'][number], service: MealAllocation['service']): boolean {
  const assessment = request.serviceAssessments.find((item) => item.recipeId === recipeId && item.recipeRevisionId === recipeRevisionId && item.applicableServices.includes(service))
  if ((requirement.constraints.maxActiveMinutes !== null || requirement.constraints.maxElapsedMinutes !== null || (requirement.meal === 'lunch' && request.officeLunchPolicy.enabled)) && !assessment) return false
  if (!assessment) return true
  if (requirement.constraints.maxActiveMinutes !== null && (!reviewedFact(assessment.activeMinutes) || Number(assessment.activeMinutes.value) > requirement.constraints.maxActiveMinutes)) return false
  if (requirement.constraints.maxElapsedMinutes !== null && (!reviewedFact(assessment.elapsedMinutes) || Number(assessment.elapsedMinutes.value) > requirement.constraints.maxElapsedMinutes)) return false
  if (requirement.meal !== 'lunch' || !request.officeLunchPolicy.enabled) return true
  const policy = request.officeLunchPolicy
  if (!reviewedFact(assessment.assembly) || (policy.maxAssembly === 'none' && assessment.assembly.value !== 'none') || (policy.maxAssembly === 'simple' && assessment.assembly.value === 'intensive')) return false
  if (policy.requireReheatingSuitable && (!reviewedFact(assessment.reheating) || !['not-needed', 'suitable'].includes(String(assessment.reheating.value)))) return false
  if (!policy.allowIntrusiveOdors && (!reviewedFact(assessment.odor) || assessment.odor.value !== 'low')) return false
  if (!policy.allowRiceBased && (!reviewedFact(assessment.riceBased) || assessment.riceBased.value !== false)) return false
  return true
}

type InventoryEnumeration = { routes: RealizedRoute[]; blockers: Map<string, Set<string>> }

function inventoryRoutes(request: PlanningRequest): InventoryEnumeration {
  const routes: RealizedRoute[] = []
  const blockers = new Map<string, Set<string>>()
  const addBlocker = (requirementIds: string[], code: string) => requirementIds.forEach((requirementId) => {
    const values = blockers.get(requirementId) ?? new Set<string>()
    values.add(code)
    blockers.set(requirementId, values)
  })
  for (const lot of request.preparedLots.filter(({ state }) => state === 'available')) {
    const recipe = request.recipeSnapshot.find(({ identity }) => identity.recipeId === lot.recipeId && identity.revisionId === lot.recipeRevisionId)
    if (!recipe?.review.readiness.recommendationReady) continue
    if (request.hardConstraints.avoidedRecipeIds.includes(recipe.identity.recipeId)) continue
    if (!reviewedFact(recipe.suitability.leftoverQuality) || !['good', 'acceptable'].includes(String(recipe.suitability.leftoverQuality.value))) continue
    const possibleIngredients = new Set(recipe.requirements.flatMap((requirement) => [requirement.canonicalIngredientId, ...requirement.alternatives.map(({ canonicalIngredientId }) => canonicalIngredientId)]))
    if (request.hardConstraints.avoidedIngredientIds.some((ingredientId) => possibleIngredients.has(ingredientId))) continue
    const guidance = recipe.output.planningGuidance.sourceServingsPerMealPortion
    if (!guidance || !reviewedFact(guidance) || typeof guidance.value !== 'number') continue
    const servingsPerPortion = guidance.value
    const service: MealAllocation['service'] | null = lot.storageMode === 'refrigerated' ? 'refrigerated-leftover' : lot.storageMode === 'frozen' ? 'frozen-leftover' : null
    if (!service) continue
    const potential = request.mealRequirements.filter((requirement) => {
      if (requirement.status === 'skipped' || !requirement.intendedAt || requirement.requestedPortions <= 0) return false
      const role = recipe.mealRoles.primary.includes(requirement.meal) || (requirement.meal === 'lunch' && recipe.mealRoles.primary.includes('dinner'))
      if (!role || requirement.constraints.avoidRecipeIds.includes(recipe.identity.recipeId)) return false
      const selectedIngredients = new Set(recipe.requirements.filter(({ optional }) => !optional).map(({ canonicalIngredientId }) => canonicalIngredientId))
      if (requirement.constraints.mustUseIngredientIds.some((ingredientId) => !selectedIngredients.has(ingredientId))) return false
      const lock = request.lockedChoices.find(({ mealRequirementId }) => mealRequirementId === requirement.mealRequirementId)
      return !requirement.lock.locked || Boolean(lock && lock.recipeId === recipe.identity.recipeId && lock.recipeRevisionId === recipe.identity.revisionId)
    })
    const potentialIds = potential.map(({ mealRequirementId }) => mealRequirementId)
    const storage = recipe.suitability.storageModes.find(({ mode }) => mode === lot.storageMode)
    if (!storage || storage.maxDurationHours === null || !['reported', 'reviewed'].includes(storage.confidence) || !storage.evidenceIds.length || lot.bestUseWindow.evidenceIds.some((evidenceId) => !storage.evidenceIds.includes(evidenceId))) {
      addBlocker(potentialIds, 'prepared-inventory-storage-review-required')
      continue
    }
    if (lot.bestUseWindow.end === null) {
      addBlocker(potentialIds, 'prepared-inventory-best-use-end-required')
      continue
    }
    if (service === 'frozen-leftover') {
      if (!reviewedFact(recipe.suitability.thawRequired)) {
        addBlocker(potentialIds, 'prepared-inventory-thaw-review-required')
        continue
      }
      if (recipe.suitability.thawRequired.value === true) {
        addBlocker(potentialIds, 'prepared-inventory-thaw-task-required')
        continue
      }
      const frozenAssessment = request.serviceAssessments.find((assessment) => assessment.recipeId === recipe.identity.recipeId && assessment.recipeRevisionId === recipe.identity.revisionId && assessment.applicableServices.includes('frozen-leftover'))
      if (!reviewedFact(recipe.suitability.reheatMethod) || !frozenAssessment || !reviewedFact(frozenAssessment.reheating) || !['not-needed', 'suitable'].includes(String(frozenAssessment.reheating.value))) {
        addBlocker(potentialIds, 'prepared-inventory-reheat-review-required')
        continue
      }
    }
    const reviewedStorageEnd = Date.parse(lot.storedAt) + storage.maxDurationHours * 3_600_000
    const effectiveStorageEnd = Math.min(Date.parse(lot.bestUseWindow.end), reviewedStorageEnd)
    const expectedOutputKind = recipe.output.kind === 'discrete-items' ? 'discrete-item' : recipe.output.kind === 'fixed-portions' ? 'fixed-portion' : 'source-serving'
    if (lot.remainingAmount.kind !== expectedOutputKind) continue
    const matching = potential.filter((requirement) => {
      const instant = Date.parse(requirement.intendedAt!)
      if (instant < Date.parse(lot.bestUseWindow.start) || instant > effectiveStorageEnd) {
        addBlocker([requirement.mealRequirementId], 'prepared-inventory-storage-expired')
        return false
      }
      if (!inventoryServiceAllowed(request, recipe.identity.recipeId, recipe.identity.revisionId, requirement, service)) {
        addBlocker([requirement.mealRequirementId], 'prepared-inventory-service-review-required')
        return false
      }
      return true
    }).sort((left, right) => left.intendedAt!.localeCompare(right.intendedAt!))
    for (let start = 0; start < matching.length; start += 1) {
      let amount = 0
      for (let end = start; end < Math.min(matching.length, start + 4); end += 1) {
        amount += matching[end].requestedPortions * servingsPerPortion
        if (amount > lot.remainingAmount.amount + 1e-9) break
        if (lot.remainingAmount.kind === 'discrete-item' && !Number.isInteger(amount)) continue
        const suffix = `${lot.preparedFoodLotId.replace(/^prepared-lot-/, '')}-${start + 1}-${end + 1}`
        const group = matching.slice(start, end + 1)
        const allocations = group.map((requirement, index) => mealAllocationSchema.parse({
          allocationId: `allocation-inventory-${suffix}-${index + 1}`,
          mealRequirementId: requirement.mealRequirementId,
          source: { kind: 'prepared-lot', preparedFoodLotId: lot.preparedFoodLotId },
          amount: lot.remainingAmount.kind === 'discrete-item' ? { kind: 'discrete-item', amount: requirement.requestedPortions * servingsPerPortion, itemName: lot.remainingAmount.itemName } : { kind: lot.remainingAmount.kind, amount: requirement.requestedPortions * servingsPerPortion },
          mealPortionsSatisfied: requirement.requestedPortions,
          service,
          storageEvidenceIds: lot.bestUseWindow.evidenceIds,
          state: 'proposed',
        }))
        routes.push({
          routeId: `route-inventory-${suffix}`,
          pattern: 'prepared-inventory',
          candidate: null,
          recipeId: recipe.identity.recipeId,
          recipeRevisionId: recipe.identity.revisionId,
          recipeTitle: recipe.identity.title,
          batch: null,
          cookEvent: null,
          allocations,
          remainder: lot.remainingAmount.amount - amount,
          activeMinutes: 0,
          cookingWindowId: null,
          cookingStartsAt: null,
          expectedReadyAt: null,
          preparedFoodLotId: lot.preparedFoodLotId,
        })
      }
    }
  }
  return { routes, blockers }
}

function overlaps(left: RealizedRoute, right: RealizedRoute): boolean {
  if (!left.cookingStartsAt || !left.expectedReadyAt || !right.cookingStartsAt || !right.expectedReadyAt) return false
  const leftStart = Date.parse(left.cookingStartsAt)
  const leftEnd = Date.parse(left.expectedReadyAt)
  const rightStart = Date.parse(right.cookingStartsAt)
  const rightEnd = Date.parse(right.expectedReadyAt)
  return leftStart < rightEnd && rightStart < leftEnd
}

function routeIncompatibility(request: PlanningRequest, route: RealizedRoute, state: SearchState): string | null {
  if (route.allocations.some(({ mealRequirementId }) => state.covered.has(mealRequirementId))) return 'meal-already-covered'
  if (route.preparedFoodLotId && state.routes.some(({ preparedFoodLotId }) => preparedFoodLotId === route.preparedFoodLotId)) return 'prepared-inventory-already-allocated'
  if (route.cookingWindowId) {
    const window = request.cookingWindows.find(({ cookingWindowId }) => cookingWindowId === route.cookingWindowId)
    if (!window) return 'cooking-window-unavailable'
    const activeMinutes = state.routes.filter(({ cookingWindowId }) => cookingWindowId === route.cookingWindowId).reduce((sum, selected) => sum + selected.activeMinutes, route.activeMinutes)
    if (activeMinutes > window.maxActiveMinutes) return 'cooking-window-capacity-exceeded'
  }
  if (state.routes.some((selected) => overlaps(route, selected))) return 'cooking-conflict'
  return null
}

function routeCompatible(request: PlanningRequest, route: RealizedRoute, state: SearchState): boolean {
  return routeIncompatibility(request, route, state) === null
}

function planScore(request: PlanningRequest, routes: RealizedRoute[]): z.infer<typeof scoreSchema> {
  const recipeById = new Map(request.recipeSnapshot.map((recipe) => [recipe.identity.recipeId, recipe]))
  const requirementById = new Map(request.mealRequirements.map((requirement) => [requirement.mealRequirementId, requirement]))
  const dinnerMeals = routes.flatMap((route) => route.allocations.filter(({ mealRequirementId }) => requirementById.get(mealRequirementId)?.meal === 'dinner').map(({ mealRequirementId }) => ({ recipeId: route.recipeId, intendedAt: requirementById.get(mealRequirementId)?.intendedAt ?? requirementById.get(mealRequirementId)?.date ?? '' }))).sort((left, right) => left.intendedAt.localeCompare(right.intendedAt)).map(({ recipeId }) => recipeId)
  const breakfastMeals = routes.flatMap((route) => route.allocations.filter(({ mealRequirementId }) => requirementById.get(mealRequirementId)?.meal === 'breakfast').map(() => route.recipeId))
  const distinctDinners = new Set(dinnerMeals).size
  const dinnerRepeatCount = dinnerMeals.length - distinctDinners
  const consecutiveDinnerRepeatCount = dinnerMeals.slice(1).filter((recipeId, index) => recipeId === dinnerMeals[index]).length
  const breakfastRepeatCount = breakfastMeals.length - new Set(breakfastMeals).size
  let preferredMealCount = 0
  let likedMealCount = 0
  let dislikedMealCount = 0
  for (const route of routes) {
    const preference = request.preferences.householdRecipePreferences.find(({ recipeId }) => recipeId === route.recipeId)
    if (request.preferences.preferredRecipeIds.includes(route.recipeId)) preferredMealCount += route.allocations.length
    if (preference?.likedVotes && !preference.dislikedVotes) likedMealCount += route.allocations.length
    if (preference?.dislikedVotes) dislikedMealCount += route.allocations.length
  }
  let pantryMatchedRequirementCount = 0
  for (const route of routes) {
    const recipe = recipeById.get(route.recipeId)!
    pantryMatchedRequirementCount += recipe.requirements.filter((requirement) => request.pantry.some((availability) => availability.canonicalIngredientId === requirement.canonicalIngredientId && availability.variantId === requirement.variantId && availability.confidence !== 'missing')).length
  }
  const coveredRequirements = new Set(routes.flatMap(({ allocations }) => allocations.map(({ mealRequirementId }) => mealRequirementId))).size
  const activeCookingMinutes = routes.reduce((sum, route) => sum + route.activeMinutes, 0)
  const plannedRemainder = routes.reduce((sum, route) => sum + route.remainder, 0)
  const total = coveredRequirements * 100_000 + distinctDinners * 10_000 + preferredMealCount * 2_000 + likedMealCount * 2_000 - dislikedMealCount * 50_000 - dinnerRepeatCount * 1_000 - consecutiveDinnerRepeatCount * 4_000 - breakfastRepeatCount * 25 - activeCookingMinutes * 5 + pantryMatchedRequirementCount * 10 - plannedRemainder * 20
  return { total, coveredRequirements, distinctDinners, preferredMealCount, likedMealCount, dislikedMealCount, dinnerRepeatCount, consecutiveDinnerRepeatCount, breakfastRepeatCount, activeCookingMinutes, pantryMatchedRequirementCount, plannedRemainder }
}

function routeOrderingScore(request: PlanningRequest, route: RealizedRoute, state: SearchState): number {
  const requirements = new Map(request.mealRequirements.map((item) => [item.mealRequirementId, item]))
  const selectedDinnerIds = new Set(state.routes.flatMap((item) => item.allocations.some(({ mealRequirementId }) => requirements.get(mealRequirementId)?.meal === 'dinner') ? [item.recipeId] : []))
  const coversDinner = route.allocations.some(({ mealRequirementId }) => requirements.get(mealRequirementId)?.meal === 'dinner')
  const variety = coversDinner && !selectedDinnerIds.has(route.recipeId) ? 10_000 : 0
  const preference = request.preferences.householdRecipePreferences.find(({ recipeId }) => recipeId === route.recipeId)
  const dislike = preference?.dislikedVotes ? 50_000 : 0
  const acceptance = request.preferences.preferredRecipeIds.includes(route.recipeId) || (preference?.likedVotes && !preference.dislikedVotes) ? 2_000 : 0
  const batchReuse = route.pattern === 'prior-meal-leftovers' ? 20_000 : 0
  const inventoryReuse = route.pattern === 'prepared-inventory' ? 30_000 : 0
  return route.allocations.length * 100_000 + variety + acceptance + batchReuse + inventoryReuse - dislike - route.activeMinutes * 5 - route.remainder * 20
}

function requirementOrder(request: PlanningRequest) {
  const rank = { dinner: 0, breakfast: 1, lunch: 2 }
  return request.mealRequirements.filter(({ status }) => status !== 'skipped').sort((left, right) => Number(right.lock.locked) - Number(left.lock.locked) || rank[left.meal] - rank[right.meal] || left.date.localeCompare(right.date) || left.mealRequirementId.localeCompare(right.mealRequirementId))
}

function selectedRouteExplanation(request: PlanningRequest, route: RealizedRoute): string[] {
  const requirements = new Map(request.mealRequirements.map((item) => [item.mealRequirementId, item]))
  const messages = [`Selected ${route.recipeTitle} for ${route.allocations.length} meal slot${route.allocations.length === 1 ? '' : 's'}.`]
  if (route.pattern === 'prior-meal-leftovers') messages.push('One cooking batch supplies a fresh dinner and verified later leftovers.')
  if (route.pattern === 'dedicated-prep') messages.push('Advance preparation fits a cooking window and verified storage/service limits.')
  if (route.pattern === 'prepared-inventory') messages.push('Existing prepared food is reserved within its versioned best-use window and adds no grocery demand.')
  if (route.allocations.some(({ mealRequirementId }) => requirements.get(mealRequirementId)?.meal === 'dinner')) messages.push('Dinner variety is scored ahead of ingredient reuse and waste.')
  return messages
}

export function generateWeekDraft(input: { request: PlanningRequest; ingredients: CanonicalIngredient[]; options?: GenerateWeekDraftOptions }): WeekDraft {
  const request = planningRequestSchema.parse(input.request)
  const options = { ...DEFAULT_SEARCH, ...(input.options ?? {}) }
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  }
  const enumerated = enumerateGeneratorCandidates(request, options)
  const routeLimitReached = enumerated.length >= options.maxRoutes
  const cookedRoutes = enumerated.map((route) => realizeRoute(request, route)).filter((route): route is RealizedRoute => route !== null)
  const inventory = inventoryRoutes(request)
  const eligible = [...inventory.routes, ...cookedRoutes]
  const required = requirementOrder(request)
  const routesByRequirement = new Map(required.map(({ mealRequirementId }) => [mealRequirementId, eligible.filter(({ allocations }) => allocations.some((allocation) => allocation.mealRequirementId === mealRequirementId))]))
  let nodesVisited = 0
  let best: SearchState = { routes: [], covered: new Set() }
  let bestScore = planScore(request, [])
  let exhausted = false
  let completeSolutionsEvaluated = 0
  let completeSolutionLimitReached = false
  let backtrackCount = 0

  const visit = (state: SearchState) => {
    if (nodesVisited >= options.maxSearchNodes) { exhausted = true; return }
    nodesVisited += 1
    const score = planScore(request, state.routes)
    if (score.coveredRequirements > bestScore.coveredRequirements || (score.coveredRequirements === bestScore.coveredRequirements && (score.total > bestScore.total || (score.total === bestScore.total && state.routes.map(({ routeId }) => routeId).join('|') < best.routes.map(({ routeId }) => routeId).join('|'))))) {
      best = { routes: [...state.routes], covered: new Set(state.covered) }
      bestScore = score
    }
    const next = required.find(({ mealRequirementId }) => !state.covered.has(mealRequirementId))
    if (!next) {
      if (score.coveredRequirements === required.length) {
        completeSolutionsEvaluated += 1
        if (completeSolutionsEvaluated >= options.maxCompleteSolutions) completeSolutionLimitReached = true
      }
      return
    }
    const choices = (routesByRequirement.get(next.mealRequirementId) ?? [])
      .filter((route) => routeCompatible(request, route, state))
      .sort((left, right) => routeOrderingScore(request, right, state) - routeOrderingScore(request, left, state) || left.routeId.localeCompare(right.routeId))
      .slice(0, options.maxOptionsPerRequirement)
    for (const route of choices) {
      const covered = new Set(state.covered)
      route.allocations.forEach(({ mealRequirementId }) => covered.add(mealRequirementId))
      visit({ routes: [...state.routes, route], covered })
      if (completeSolutionLimitReached || nodesVisited >= options.maxSearchNodes) return
      backtrackCount += 1
    }
    visit({ routes: state.routes, covered: new Set([...state.covered, next.mealRequirementId]) })
  }
  visit({ routes: [], covered: new Set() })
  if (nodesVisited >= options.maxSearchNodes) exhausted = true

  const selectedRouteByRequirement = new Map<string, RealizedRoute>()
  best.routes.forEach((route) => route.allocations.forEach(({ mealRequirementId }) => selectedRouteByRequirement.set(mealRequirementId, route)))
  const allocations = best.routes.flatMap(({ allocations: routeAllocations }) => routeAllocations)
  const allocationByRequirement = new Map(allocations.map((allocation) => [allocation.mealRequirementId, allocation]))
  const batches = best.routes.map(({ batch }) => batch).filter((batch): batch is Batch => batch !== null)
  const ingredientSelections: BatchIngredientSelection[] = best.routes.flatMap((route) => route.batch && route.candidate ? route.candidate.ingredientSelections.map((selection) => ({ batchId: route.batch!.batchId, ...selection })) : [])
  const groceryDemand = buildBatchGroceryDemand({ recipes: request.recipeSnapshot, ingredients: input.ingredients, batches, scope: 'outstanding', pantry: request.pantry, includeOptional: false, ingredientSelections })
  const shoppingReadiness = { status: groceryDemand.lines.some(({ unresolved }) => unresolved) || groceryDemand.uncertainties.length ? 'review-needed' as const : 'ready' as const, unresolvedLineCount: groceryDemand.lines.filter(({ unresolved }) => unresolved).length, uncertaintyCount: groceryDemand.uncertainties.length, pricesAvailable: false as const }
  const rejectedAlternatives = enumerated.filter(({ feasibility }) => feasibility.status !== 'eligible').slice(0, 50).map((route) => ({
    routeId: route.routeId,
    recipeId: route.candidate.recipeId,
    recipeRevisionId: route.candidate.recipeRevisionId,
    mealRequirementIds: route.candidate.allocations.map(({ mealRequirementId }) => mealRequirementId),
    status: route.feasibility.status as 'rejected' | 'review-needed',
    reasons: route.feasibility.reasons,
  }))
  const selectedRouteIds = new Set(best.routes.map(({ routeId }) => routeId))
  const unselectedEligibleAlternatives = cookedRoutes.filter(({ routeId }) => !selectedRouteIds.has(routeId)).slice(0, 50).map((route) => ({
    routeId: route.routeId,
    recipeId: route.recipeId,
    recipeRevisionId: route.recipeRevisionId,
    mealRequirementIds: route.allocations.map(({ mealRequirementId }) => mealRequirementId),
    reason: route.allocations.some(({ mealRequirementId }) => selectedRouteByRequirement.has(mealRequirementId))
      ? 'slot-already-covered' as const
      : best.routes.some((selected) => overlaps(route, selected)) ? 'cooking-conflict' as const : 'lower-score' as const,
  }))
  const unmetRequirements = required.filter(({ mealRequirementId }) => !selectedRouteByRequirement.has(mealRequirementId)).map((requirement) => {
    const blockers = new Map<string, number>()
    enumerated.filter(({ candidate }) => candidate.allocations.some(({ mealRequirementId }) => mealRequirementId === requirement.mealRequirementId)).forEach(({ feasibility }) => feasibility.reasons.forEach(({ code }) => blockers.set(code, (blockers.get(code) ?? 0) + 1)))
    eligible.filter(({ allocations: routeAllocations }) => routeAllocations.some(({ mealRequirementId }) => mealRequirementId === requirement.mealRequirementId)).forEach((route) => {
      const code = routeIncompatibility(request, route, best)
      if (code) blockers.set(code, (blockers.get(code) ?? 0) + 1)
    })
    inventory.blockers.get(requirement.mealRequirementId)?.forEach((code) => blockers.set(code, (blockers.get(code) ?? 0) + 1))
    if (routeLimitReached) blockers.set('route-enumeration-limit-reached', 1)
    if (!blockers.size) blockers.set(exhausted ? 'search-limit-exhausted' : 'no-eligible-route', 1)
    return { mealRequirementId: requirement.mealRequirementId, blockers: [...blockers].map(([code, count]) => ({ code, count })).sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)) }
  })
  const complete = unmetRequirements.length === 0
  return weekDraftSchema.parse({
    schemaVersion: 1,
    proposalId: `proposal-${request.requestId.replace(/^planning-request-/, '')}`,
    requestId: request.requestId,
    status: complete ? 'complete' : 'incomplete',
    search: { bounded: true, nodesVisited: Math.max(1, nodesVisited), nodeLimit: options.maxSearchNodes, routeLimit: options.maxRoutes, routeLimitReached, enumeratedRouteCount: enumerated.length, eligibleRouteCount: eligible.length, completeSolutionsEvaluated, completeSolutionLimit: options.maxCompleteSolutions, backtrackCount, exhausted },
    score: planScore(request, best.routes),
    selectedRoutes: best.routes.map((route) => ({ routeId: route.routeId, pattern: route.pattern, candidateId: route.candidate?.candidateId ?? null, recipeId: route.recipeId, recipeRevisionId: route.recipeRevisionId, mealRequirementIds: route.allocations.map(({ mealRequirementId }) => mealRequirementId), cookingStartsAt: route.cookingStartsAt, expectedReadyAt: route.expectedReadyAt, cookingWindowId: route.cookingWindowId, activeMinutes: route.activeMinutes, preparedFoodLotId: route.preparedFoodLotId, ingredientSelections: route.candidate?.ingredientSelections ?? [], explanations: selectedRouteExplanation(request, route) })),
    meals: request.mealRequirements.map((requirement) => {
      if (requirement.status === 'skipped') return { mealRequirementId: requirement.mealRequirementId, date: requirement.date, meal: requirement.meal, requestedPortions: requirement.requestedPortions, status: 'skipped', recipeId: null, recipeRevisionId: null, allocationId: null, service: null, routeId: null }
      const route = selectedRouteByRequirement.get(requirement.mealRequirementId)
      const allocation = allocationByRequirement.get(requirement.mealRequirementId)
      return { mealRequirementId: requirement.mealRequirementId, date: requirement.date, meal: requirement.meal, requestedPortions: requirement.requestedPortions, status: route ? 'planned' : 'unmet', recipeId: route?.recipeId ?? null, recipeRevisionId: route?.recipeRevisionId ?? null, allocationId: allocation?.allocationId ?? null, service: allocation?.service ?? null, routeId: route?.routeId ?? null }
    }),
    cookEvents: best.routes.map(({ cookEvent }) => cookEvent).filter((event): event is CookEvent => event !== null),
    batches,
    allocations,
    groceryDemand,
    shoppingReadiness,
    explanations: [
      { code: complete ? 'complete-week' : 'incomplete-week', message: complete ? 'Every non-skipped requirement has one feasible allocation.' : `${unmetRequirements.length} requirement(s) remain explicitly unmet.`, entityIds: [request.requestId] },
      { code: 'score-priority', message: 'Completion, explicit household acceptability, and dinner variety precede effort, repeats, pantry reuse, and waste; dislikes are penalties, unknown preferences receive no positive score, and consecutive identical dinners receive an extra penalty.', entityIds: [request.requestId] },
      { code: 'grocery-once-per-batch', message: 'Grocery demand is derived once from each selected cooking batch; leftover allocations add no duplicate demand.', entityIds: batches.map(({ batchId }) => batchId) },
    ],
    rejectedAlternatives,
    unselectedEligibleAlternatives,
    unmetRequirements,
  })
}
