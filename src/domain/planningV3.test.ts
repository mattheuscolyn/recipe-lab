import { describe, expect, it } from 'vitest'
import { pilotRecipes } from '../data/pilotCatalog'
import { adaptRecipeV2ToDraftV3 } from './recipeV3Migration'
import type { RecipeV3 } from './recipeV3'
import {
  allocateBatchToMeals,
  adjustPreparedFoodRemaining,
  batchSchema,
  cancelCookEvent,
  cancelPlannedBatch,
  cancelPreparedFoodReservation,
  changeRequestedPortions,
  confirmCookEvent,
  discardPreparedFood,
  mealAllocationSchema,
  mealRequirementSchema,
  planCookingBatch,
  replaceMealAllocation,
  reservePreparedFood,
  scheduleCookEvent,
  servePreparedFood,
  summarizeBatchAllocation,
  validatePlanningSnapshot,
  type Batch,
  type MealAllocation,
  type MealRequirement,
  type PlanningSnapshot,
} from './planningV3'

const source = pilotRecipes.find(({ slug }) => slug === 'smoky-black-bean-soup')!

function reviewedRecipe(overrides: { sourceServingsPerMealPortion?: number; allowedMultipliers?: number[] } = {}): RecipeV3 {
  const recipe = adaptRecipeV2ToDraftV3(source)
  recipe.identity = { ...recipe.identity, recipeId: '11111111-1111-4111-8111-111111111111', revisionId: 'revision-synthetic-planning-soup-v1', slug: 'synthetic-planning-soup', title: 'Synthetic Planning Soup' }
  const evidenceId = recipe.source.evidence[0].evidenceId
  recipe.output.scaling = { policy: 'linear-reviewed', allowedMultipliers: overrides.allowedMultipliers ?? [0.5, 1, 2], note: 'Synthetic reviewed planning fixture.' }
  recipe.output.planningGuidance.sourceServingsPerMealPortion = { value: overrides.sourceServingsPerMealPortion ?? 1, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }
  recipe.output.planningGuidance.adequacyNote = overrides.sourceServingsPerMealPortion === 2 ? 'Synthetic fixture: one publisher serving is light for this dinner role.' : null
  recipe.requirements = recipe.requirements.map((requirement) => ({ ...requirement, scaling: 'linear' as const }))
  recipe.suitability = {
    ...recipe.suitability,
    reviewState: 'editor-reviewed',
    storageModes: [
      { mode: 'refrigerated', maxDurationHours: 120, evidenceIds: [evidenceId], confidence: 'reviewed' },
      { mode: 'frozen', maxDurationHours: 720, evidenceIds: [evidenceId], confidence: 'reviewed' },
    ],
  }
  return recipe
}

function meal(id: string, date: string, mealName: MealRequirement['meal'], requestedPortions: number, intendedAt: string | null = `${date}T19:00:00.000Z`, locked = false, timeZone = 'America/Los_Angeles'): MealRequirement {
  return mealRequirementSchema.parse({
    mealRequirementId: `meal-requirement-${id}`,
    date,
    intendedAt,
    timeZone,
    meal: mealName,
    requestedPortions,
    status: requestedPortions ? 'unplanned' : 'skipped',
    constraints: { maxActiveMinutes: null, maxElapsedMinutes: null, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: true },
    lock: { locked, reason: locked ? 'Owner locked this meal.' : null },
  })
}

function plan(recipe = reviewedRecipe(), multiplier = 1, suffix = 'one', intendedAt = '2026-11-16T17:00:00.000Z') {
  const batch = planCookingBatch(recipe, { batchId: `batch-${suffix}`, groceryDemandId: `grocery-demand-${suffix}`, multiplier })
  const event = scheduleCookEvent(recipe, batch, { cookEventId: `cook-event-${suffix}`, intendedAt })
  return { recipe, batch, event }
}

describe('cooking batches and meal allocations', () => {
  it('S01 uses reviewed output guidance, never calories, for meal allocation', () => {
    const recipe = reviewedRecipe({ sourceServingsPerMealPortion: 2 })
    recipe.nutrition.caloriesKcal = { value: 200, evidenceIds: recipe.source.evidence.map(({ evidenceId }) => evidenceId), confidence: 'reported', unknownReason: null }
    const { batch, event } = plan(recipe)
    const dinner = meal('monday-dinner', '2026-11-16', 'dinner', 2)
    const result = allocateBatchToMeals(recipe, batch, event, [{ allocationId: 'allocation-monday-dinner', requirement: dinner, mealPortions: 2, service: 'fresh' }])
    expect(result.allocations[0].amount).toEqual({ kind: 'source-serving', amount: 4 })
    expect(result.remainder.amount).toBe(0)
    expect(result.mealRequirements[0].status).toBe('planned')
  })

  it('S02/S03/S05 allocates fresh and leftover portions with exact conservation', () => {
    const { recipe, batch, event } = plan()
    const requirements = [
      meal('monday-dinner', '2026-11-16', 'dinner', 2),
      meal('tuesday-lunch', '2026-11-17', 'lunch', 1, '2026-11-17T12:00:00.000Z'),
    ]
    const result = allocateBatchToMeals(recipe, batch, event, [
      { allocationId: 'allocation-monday-dinner', requirement: requirements[0], mealPortions: 2, service: 'fresh' },
      { allocationId: 'allocation-tuesday-lunch', requirement: requirements[1], mealPortions: 1, service: 'refrigerated-leftover' },
    ])
    expect(result.allocations.map(({ amount }) => amount.amount)).toEqual([2, 1])
    expect(summarizeBatchAllocation(batch, result.allocations).remainder.amount).toBe(1)

    const confirmed = confirmCookEvent({ recipe, cookEvent: event, batch, allocations: result.allocations, mealRequirements: result.mealRequirements, confirmedAt: '2026-11-16T18:00:00.000Z', preparedFoodLotId: 'prepared-lot-one', storageMode: 'refrigerated' })
    expect(confirmed.cookEvent.state).toBe('completed')
    expect(confirmed.batch.actualOutput?.amount).toBe(4)
    expect(confirmed.allocations.map(({ state }) => state)).toEqual(['served', 'reserved'])
    expect(confirmed.preparedFoodLot).toMatchObject({ initialAmount: { amount: 2 }, remainingAmount: { amount: 1 }, state: 'available' })
  })

  it('S02 supplies four weekday lunches from one Sunday batch without lunchtime cooking', () => {
    const { recipe, batch, event } = plan(reviewedRecipe(), 1, 'sunday-prep', '2026-11-15T17:00:00.000Z')
    const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']
    const requirements = dates.map((date, index) => meal(`weekday-${index + 1}`, date, 'lunch', 1, `${date}T12:00:00.000Z`))
    const result = allocateBatchToMeals(recipe, batch, event, requirements.map((requirement, index) => ({
      allocationId: `allocation-weekday-${index + 1}`,
      requirement,
      mealPortions: 1,
      service: 'refrigerated-leftover' as const,
    })))
    expect(result.allocations).toHaveLength(4)
    expect(result.allocations.reduce((sum, allocation) => sum + allocation.amount.amount, 0)).toBe(4)
    expect(result.remainder.amount).toBe(0)
    expect(event.intendedAt).toBe('2026-11-15T17:00:00.000Z')
  })

  it('S04 represents an intentionally skipped meal without a cook event or grocery demand', () => {
    const skipped = meal('wednesday-dinner', '2026-11-18', 'dinner', 0)
    expect(skipped.status).toBe('skipped')
    expect(() => allocateBatchToMeals(plan().recipe, plan().batch, plan().event, [{ allocationId: 'allocation-skipped', requirement: skipped, mealPortions: 1, service: 'fresh' }])).toThrow(/Skipped meal/)
    expect(validatePlanningSnapshot({ mealRequirements: [skipped], cookEvents: [], batches: [], allocations: [], preparedFoodLots: [] }).success).toBe(true)
  })

  it('uses Pacific local calendar dates for evening, midnight, and DST-boundary meals', () => {
    const recipe = reviewedRecipe()
    const batch = planCookingBatch(recipe, { batchId: 'batch-pacific-time', groceryDemandId: 'grocery-demand-pacific-time', multiplier: 1 })
    const pacificDinner = meal('pacific-dinner', '2026-11-16', 'dinner', 1, '2026-11-17T03:00:00.000Z')
    const eveningEvent = scheduleCookEvent(recipe, batch, { cookEventId: 'cook-event-pacific-evening', intendedAt: '2026-11-17T01:00:00.000Z' })
    expect(pacificDinner.date).toBe('2026-11-16')
    expect(allocateBatchToMeals(recipe, batch, eveningEvent, [{ allocationId: 'allocation-pacific-dinner', requirement: pacificDinner, mealPortions: 1, service: 'fresh' }]).allocations).toHaveLength(1)

    const midnightMeal = meal('pacific-midnight', '2026-11-16', 'breakfast', 1, '2026-11-16T08:00:00.000Z')
    const priorLocalDayEvent = scheduleCookEvent(recipe, batch, { cookEventId: 'cook-event-before-midnight', intendedAt: '2026-11-16T07:30:00.000Z' })
    expect(() => allocateBatchToMeals(recipe, batch, priorLocalDayEvent, [{ allocationId: 'allocation-midnight', requirement: midnightMeal, mealPortions: 1, service: 'fresh' }])).toThrow(/cook-event date/)
    expect(mealRequirementSchema.safeParse({ ...midnightMeal, intendedAt: '2026-11-16T07:59:59.000Z' }).success).toBe(false)

    const dstMeal = meal('dst-spring-forward', '2026-03-08', 'breakfast', 1, '2026-03-08T10:30:00.000Z')
    const dstEvent = scheduleCookEvent(recipe, batch, { cookEventId: 'cook-event-dst', intendedAt: '2026-03-08T09:30:00.000Z' })
    expect(allocateBatchToMeals(recipe, batch, dstEvent, [{ allocationId: 'allocation-dst', requirement: dstMeal, mealPortions: 1, service: 'fresh' }]).allocations).toHaveLength(1)
    const fallBackMeal = meal('dst-fall-back', '2026-11-01', 'breakfast', 1, '2026-11-01T09:30:00.000Z')
    const fallBackEvent = scheduleCookEvent(recipe, batch, { cookEventId: 'cook-event-dst-fall-back', intendedAt: '2026-11-01T08:30:00.000Z' })
    expect(allocateBatchToMeals(recipe, batch, fallBackEvent, [{ allocationId: 'allocation-dst-fall-back', requirement: fallBackMeal, mealPortions: 1, service: 'fresh' }]).allocations).toHaveLength(1)
    expect(mealRequirementSchema.safeParse({ ...dstMeal, timeZone: 'Not/A_Time_Zone' }).success).toBe(false)
  })

  it('S10 permits a fractional batch only when output and whole-item requirements support it', () => {
    const recipe = reviewedRecipe({ allowedMultipliers: [0.5, 1, 2] })
    recipe.output.kind = 'discrete-items'
    recipe.output.sourceYield = { ...recipe.output.sourceYield, amount: 6, range: null, unit: 'muffins', label: '6 muffins' }
    recipe.output.discreteItem = { itemName: 'muffins', itemCount: 6, itemsPerSourceServing: null, evidenceIds: recipe.output.sourceYield.evidenceIds }
    recipe.output.planningGuidance.sourceServingsPerMealPortion = { value: 2, evidenceIds: recipe.output.sourceYield.evidenceIds, confidence: 'reviewed', unknownReason: null }
    const eggLike = recipe.requirements.find(({ selectedPlanningQuantity }) => selectedPlanningQuantity?.amount === 1)
    expect(eggLike).toBeDefined()
    eggLike!.scaling = 'whole-item'
    expect(() => planCookingBatch(recipe, { batchId: 'batch-half', groceryDemandId: 'grocery-demand-half', multiplier: 0.5 })).toThrow(/does not support multiplier/)
    eggLike!.scaling = 'fixed'
    const batch = planCookingBatch(recipe, { batchId: 'batch-half', groceryDemandId: 'grocery-demand-half', multiplier: 0.5 })
    expect(batch.plannedOutput).toEqual({ kind: 'discrete-item', amount: 3, itemName: 'muffins' })
    const event = scheduleCookEvent(recipe, batch, { cookEventId: 'cook-event-half', intendedAt: '2026-11-16T16:00:00.000Z' })
    const allocation = allocateBatchToMeals(recipe, batch, event, [{ allocationId: 'allocation-muffins', requirement: meal('muffins', '2026-11-16', 'breakfast', 1), mealPortions: 1, service: 'fresh' }])
    expect(allocation.allocations[0].amount.amount).toBe(2)
    expect(allocation.remainder.amount).toBe(1)

    const fixed = reviewedRecipe()
    fixed.output.kind = 'fixed-portions'
    fixed.output.discreteItem = null
    expect(planCookingBatch(fixed, { batchId: 'batch-fixed', groceryDemandId: 'grocery-demand-fixed', multiplier: 1 }).plannedOutput).toEqual({ kind: 'fixed-portion', amount: 4 })
    fixed.output.scaling = { policy: 'fixed-batch', allowedMultipliers: [1, 2], note: 'Only the original batch has been reviewed.' }
    expect(() => planCookingBatch(fixed, { batchId: 'batch-fixed-double', groceryDemandId: 'grocery-demand-fixed-double', multiplier: 2 })).toThrow(/not approved/)
  })

  it('rejects ambiguous source yield until an exact reviewed output is supplied', () => {
    const recipe = reviewedRecipe()
    recipe.output.sourceYield = { ...recipe.output.sourceYield, amount: null, range: { min: 4, max: 6 } }
    expect(recipe.nutrition.caloriesKcal.value).toBeNull()
    expect(() => planCookingBatch(recipe, { batchId: 'batch-range', groceryDemandId: 'grocery-demand-range', multiplier: 1 })).toThrow(/reviewed exact selection/)
    expect(planCookingBatch(recipe, { batchId: 'batch-range', groceryDemandId: 'grocery-demand-range', multiplier: 1, sourceYieldSelection: { amount: 5, evidenceIds: recipe.output.sourceYield.evidenceIds, confidence: 'reviewed' } }).plannedOutput.amount).toBe(5)
  })

  it('rejects unsafe storage timing and fractional discrete allocations', () => {
    const { recipe, batch, event } = plan()
    const late = meal('late-lunch', '2026-11-22', 'lunch', 1, '2026-11-22T12:00:00.000Z')
    expect(() => allocateBatchToMeals(recipe, batch, event, [{ allocationId: 'allocation-late', requirement: late, mealPortions: 1, service: 'refrigerated-leftover' }])).toThrow(/Storage window/)
    const discrete = reviewedRecipe({ sourceServingsPerMealPortion: 0.5 })
    discrete.output.kind = 'discrete-items'
    discrete.output.discreteItem = { itemName: 'muffins', itemCount: 4, itemsPerSourceServing: null, evidenceIds: discrete.output.sourceYield.evidenceIds }
    expect(() => allocateBatchToMeals(discrete, { ...batch, plannedOutput: { kind: 'discrete-item', amount: 4, itemName: 'muffins' } }, event, [{ allocationId: 'allocation-fractional', requirement: meal('muffin', '2026-11-16', 'breakfast', 1), mealPortions: 1, service: 'fresh' }])).toThrow(/fractional items/)
  })
})

describe('prepared-food inventory', () => {
  function confirmedLot(storageMode: 'refrigerated' | 'frozen' = 'refrigerated') {
    const { recipe, batch, event } = plan()
    const dinner = meal('monday-dinner', '2026-11-16', 'dinner', 2)
    const planned = allocateBatchToMeals(recipe, batch, event, [{ allocationId: 'allocation-monday-dinner', requirement: dinner, mealPortions: 2, service: 'fresh' }])
    return { recipe, ...confirmCookEvent({ recipe, cookEvent: event, batch, allocations: planned.allocations, mealRequirements: planned.mealRequirements, confirmedAt: '2026-11-16T18:00:00.000Z', preparedFoodLotId: 'prepared-lot-one', storageMode }) }
  }

  it('S11 creates inventory only on confirmation and prevents stale or excessive reservations', () => {
    const { batch } = plan()
    expect(batch.state).toBe('planned')
    const confirmed = confirmedLot('frozen')
    const lot = confirmed.preparedFoodLot!
    const nextWeek = meal('next-monday-lunch', '2026-11-23', 'lunch', 1, '2026-11-23T12:00:00.000Z')
    const proposed = mealAllocationSchema.parse({ allocationId: 'allocation-next-week', mealRequirementId: nextWeek.mealRequirementId, source: { kind: 'prepared-lot', preparedFoodLotId: lot.preparedFoodLotId }, amount: { kind: 'source-serving', amount: 1 }, mealPortionsSatisfied: 1, service: 'frozen-leftover', storageEvidenceIds: lot.bestUseWindow.evidenceIds, state: 'proposed' })
    const reserved = reservePreparedFood(lot, proposed, nextWeek, lot.version)
    expect(reserved.lot.remainingAmount.amount).toBe(1)
    expect(() => reservePreparedFood(reserved.lot, { ...proposed, allocationId: 'allocation-stale' }, nextWeek, lot.version)).toThrow(/version conflict/)
    expect(() => reservePreparedFood(reserved.lot, { ...proposed, allocationId: 'allocation-too-large', amount: { kind: 'source-serving', amount: 2 } }, nextWeek, reserved.lot.version)).toThrow(/negative/)
  })

  it('rejects a direct reservation for a meal before the food was stored', () => {
    const lot = confirmedLot().preparedFoodLot!
    const beforeStorage = meal('before-storage', '2026-11-16', 'dinner', 1, '2026-11-16T17:30:00.000Z')
    const allocation = mealAllocationSchema.parse({ allocationId: 'allocation-before-storage', mealRequirementId: beforeStorage.mealRequirementId, source: { kind: 'prepared-lot', preparedFoodLotId: lot.preparedFoodLotId }, amount: { kind: 'source-serving', amount: 1 }, mealPortionsSatisfied: 1, service: 'refrigerated-leftover', storageEvidenceIds: lot.bestUseWindow.evidenceIds, state: 'proposed' })
    expect(() => reservePreparedFood(lot, allocation, beforeStorage, lot.version)).toThrow(/before the food is prepared and stored/)
  })

  it('revalidates stored allocations against actual completion when cooking finishes late', () => {
    const { recipe, batch, event } = plan()
    const lunch = meal('dependent-lunch', '2026-11-17', 'lunch', 1, '2026-11-17T20:00:00.000Z')
    const planned = allocateBatchToMeals(recipe, batch, event, [{ allocationId: 'allocation-dependent-lunch', requirement: lunch, mealPortions: 1, service: 'refrigerated-leftover' }])
    expect(() => confirmCookEvent({ recipe, cookEvent: event, batch, allocations: planned.allocations, mealRequirements: planned.mealRequirements, confirmedAt: '2026-11-17T21:00:00.000Z', preparedFoodLotId: 'prepared-lot-late', storageMode: 'refrigerated' })).toThrow(/before actual cook completion/)
    expect(batch.state).toBe('planned')
    expect(planned.allocations[0].state).toBe('proposed')
  })

  it('revalidates fresh service against actual completion time and Pacific local midnight', () => {
    const lateSetup = plan(reviewedRecipe(), 1, 'late-fresh')
    const lateDinner = meal('late-fresh-dinner', '2026-11-16', 'dinner', 1, '2026-11-16T19:00:00.000Z')
    const latePlanned = allocateBatchToMeals(lateSetup.recipe, lateSetup.batch, lateSetup.event, [{ allocationId: 'allocation-late-fresh', requirement: lateDinner, mealPortions: 1, service: 'fresh' }])
    expect(() => confirmCookEvent({ recipe: lateSetup.recipe, cookEvent: lateSetup.event, batch: lateSetup.batch, allocations: latePlanned.allocations, mealRequirements: latePlanned.mealRequirements, confirmedAt: '2026-11-16T20:00:00.000Z', preparedFoodLotId: 'prepared-lot-late-fresh', storageMode: 'refrigerated' })).toThrow(/before actual cook completion/)

    const midnightRecipe = reviewedRecipe()
    const midnightBatch = planCookingBatch(midnightRecipe, { batchId: 'batch-pacific-midnight-confirmation', groceryDemandId: 'grocery-demand-pacific-midnight-confirmation', multiplier: 1 })
    const midnightEvent = scheduleCookEvent(midnightRecipe, midnightBatch, { cookEventId: 'cook-event-pacific-midnight-confirmation', intendedAt: '2026-11-16T07:30:00.000Z' })
    const untimedFreshMeal = meal('pacific-midnight-untimed', '2026-11-15', 'dinner', 1, null)
    const midnightPlanned = allocateBatchToMeals(midnightRecipe, midnightBatch, midnightEvent, [{ allocationId: 'allocation-pacific-midnight-confirmation', requirement: untimedFreshMeal, mealPortions: 1, service: 'fresh' }])
    expect(() => confirmCookEvent({ recipe: midnightRecipe, cookEvent: midnightEvent, batch: midnightBatch, allocations: midnightPlanned.allocations, mealRequirements: midnightPlanned.mealRequirements, confirmedAt: '2026-11-16T08:05:00.000Z', preparedFoodLotId: 'prepared-lot-pacific-midnight', storageMode: 'refrigerated' })).toThrow(/does not match its local meal date/)
    expect(midnightPlanned.allocations[0].state).toBe('proposed')
  })

  it('supports reserve, serve, cancel, adjust, and discard transitions without double consumption', () => {
    const confirmed = confirmedLot()
    const lot = confirmed.preparedFoodLot!
    const requirement = meal('wednesday-lunch', '2026-11-18', 'lunch', 1, '2026-11-18T12:00:00.000Z')
    const allocation = mealAllocationSchema.parse({ allocationId: 'allocation-wednesday-lunch', mealRequirementId: requirement.mealRequirementId, source: { kind: 'prepared-lot', preparedFoodLotId: lot.preparedFoodLotId }, amount: { kind: 'source-serving', amount: 1 }, mealPortionsSatisfied: 1, service: 'refrigerated-leftover', storageEvidenceIds: lot.bestUseWindow.evidenceIds, state: 'proposed' })
    const reserved = reservePreparedFood(lot, allocation, requirement, 1)
    const cancelled = cancelPreparedFoodReservation(reserved.lot, reserved.allocation, 2)
    expect(cancelled.lot.remainingAmount.amount).toBe(2)
    const reservedAgain = reservePreparedFood(cancelled.lot, { ...allocation, allocationId: 'allocation-reserved-again' }, requirement, 3)
    const served = servePreparedFood(reservedAgain.lot, reservedAgain.allocation, 4)
    expect(served.allocation.state).toBe('served')
    const adjusted = adjustPreparedFoodRemaining(served.lot, { kind: 'source-serving', amount: 0.5 }, 5)
    expect(() => adjustPreparedFoodRemaining(adjusted, { kind: 'source-serving', amount: 1 }, 6)).toThrow(/cannot restore/)
    expect(discardPreparedFood(adjusted, 6, [served.allocation])).toMatchObject({ state: 'discarded', remainingAmount: { amount: 0 }, version: 7 })
  })
})

describe('planning edits and invariants', () => {
  function editablePlan(): { snapshot: PlanningSnapshot; replacement: { batch: Batch; allocation: MealAllocation; cookEvent: ReturnType<typeof scheduleCookEvent> } } {
    const first = plan(reviewedRecipe(), 1, 'shared')
    const monday = meal('monday-dinner', '2026-11-16', 'dinner', 2)
    const tuesday = meal('tuesday-lunch', '2026-11-17', 'lunch', 1, '2026-11-17T12:00:00.000Z')
    const allocated = allocateBatchToMeals(first.recipe, first.batch, first.event, [
      { allocationId: 'allocation-monday-dinner', requirement: monday, mealPortions: 2, service: 'fresh' },
      { allocationId: 'allocation-tuesday-lunch', requirement: tuesday, mealPortions: 1, service: 'refrigerated-leftover' },
    ])
    const locked = meal('wednesday-dinner', '2026-11-18', 'dinner', 1, '2026-11-18T19:00:00.000Z', true)
    const second = plan(reviewedRecipe(), 1, 'locked')
    const lockedAllocated = allocateBatchToMeals(second.recipe, second.batch, second.event, [{ allocationId: 'allocation-wednesday-dinner', requirement: locked, mealPortions: 1, service: 'refrigerated-leftover' }])
    const replacementPlan = plan(reviewedRecipe(), 1, 'replacement')
    const replacementAllocation = allocateBatchToMeals(replacementPlan.recipe, replacementPlan.batch, replacementPlan.event, [{ allocationId: 'allocation-replacement', requirement: monday, mealPortions: 2, service: 'fresh' }]).allocations[0]
    return {
      snapshot: { mealRequirements: [...allocated.mealRequirements, ...lockedAllocated.mealRequirements], batches: [first.batch, second.batch], cookEvents: [first.event, second.event], allocations: [...allocated.allocations, ...lockedAllocated.allocations], preparedFoodLots: [] },
      replacement: { batch: replacementPlan.batch, cookEvent: replacementPlan.event, allocation: replacementAllocation },
    }
  }

  it('S08 replaces a meal, invalidates only its dependency chain, and preserves locked unrelated plans', () => {
    const { snapshot, replacement } = editablePlan()
    const lockedBefore = JSON.stringify({ requirement: snapshot.mealRequirements[2], batch: snapshot.batches[1], event: snapshot.cookEvents[1], allocation: snapshot.allocations[2] })
    const result = replaceMealAllocation(snapshot, 'meal-requirement-monday-dinner', replacement)
    expect(result.diff.invalidatedEntityIds).toEqual(expect.arrayContaining(['allocation-monday-dinner', 'allocation-tuesday-lunch']))
    expect(result.after.mealRequirements.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-tuesday-lunch')?.status).toBe('unplanned')
    const lockedAfter = JSON.stringify({ requirement: result.after.mealRequirements[2], batch: result.after.batches[1], event: result.after.cookEvents[1], allocation: result.after.allocations[2] })
    expect(lockedAfter).toBe(lockedBefore)
    expect(result.diff.preservedLockedMealRequirementIds).toEqual(['meal-requirement-wednesday-dinner'])
  })

  it('blocks destructive edits to locked dependencies and reports changed identifiers', () => {
    const { snapshot } = editablePlan()
    snapshot.mealRequirements[1].lock = { locked: true, reason: 'Keep leftovers.' }
    expect(() => cancelPlannedBatch(snapshot, 'batch-shared')).toThrow(/Locked meal/)
    expect(() => changeRequestedPortions(snapshot, 'meal-requirement-wednesday-dinner', 2)).toThrow(/Locked meal/)
    const changeInput = editablePlan().snapshot
    const changed = changeRequestedPortions(changeInput, 'meal-requirement-monday-dinner', 0)
    expect(changed.after.mealRequirements[0]).toMatchObject({ requestedPortions: 0, status: 'skipped' })
    expect(changed.before).toBe(changeInput)
    expect(changed.diff.invalidatedEntityIds).toContain('allocation-monday-dinner')
    const cancellable = editablePlan().snapshot
    cancellable.cookEvents[0].derivedTaskIds = ['task-thaw-one']
    const cancelled = cancelCookEvent(cancellable, 'cook-event-shared')
    expect(cancelled.diff.invalidatedEntityIds).toEqual(expect.arrayContaining(['grocery-demand-shared', 'task-thaw-one', 'allocation-tuesday-lunch']))
  })

  it('protects served-meal history for shared and sole prepared batches', () => {
    const confirmedSnapshot = (suffix: string, requirements: MealRequirement[]): PlanningSnapshot => {
      const setup = plan(reviewedRecipe(), 1, suffix)
      const planned = allocateBatchToMeals(setup.recipe, setup.batch, setup.event, requirements.map((requirement, index) => ({ allocationId: `allocation-${suffix}-${index + 1}`, requirement, mealPortions: 1, service: 'fresh' as const })))
      const confirmed = confirmCookEvent({ recipe: setup.recipe, cookEvent: setup.event, batch: setup.batch, allocations: planned.allocations, mealRequirements: planned.mealRequirements, confirmedAt: '2026-11-16T17:00:00.000Z', preparedFoodLotId: `prepared-lot-${suffix}`, storageMode: 'refrigerated' })
      return { mealRequirements: planned.mealRequirements, cookEvents: [confirmed.cookEvent], batches: [confirmed.batch], allocations: confirmed.allocations, preparedFoodLots: confirmed.preparedFoodLot ? [confirmed.preparedFoodLot] : [] }
    }
    const sharedMeals = [
      meal('served-shared-one', '2026-11-16', 'lunch', 1, '2026-11-16T18:00:00.000Z'),
      meal('served-shared-two', '2026-11-16', 'dinner', 1, '2026-11-16T19:00:00.000Z'),
    ]
    const shared = confirmedSnapshot('served-shared', sharedMeals)
    const sharedBefore = JSON.stringify(shared)
    expect(() => changeRequestedPortions(shared, sharedMeals[0].mealRequirementId, 2)).toThrow(/served meal is history/)
    const replacementSetup = plan(reviewedRecipe(), 1, 'served-replacement')
    const replacementAllocation = allocateBatchToMeals(replacementSetup.recipe, replacementSetup.batch, replacementSetup.event, [{ allocationId: 'allocation-served-replacement', requirement: sharedMeals[0], mealPortions: 1, service: 'fresh' }]).allocations[0]
    expect(() => replaceMealAllocation(shared, sharedMeals[0].mealRequirementId, { batch: replacementSetup.batch, cookEvent: replacementSetup.event, allocation: replacementAllocation })).toThrow(/served meal is history/)
    expect(JSON.stringify(shared)).toBe(sharedBefore)

    const soleMeal = meal('served-sole', '2026-11-16', 'dinner', 1, '2026-11-16T19:00:00.000Z')
    const sole = confirmedSnapshot('served-sole', [soleMeal])
    expect(() => changeRequestedPortions(sole, soleMeal.mealRequirementId, 0)).toThrow(/served meal is history/)
    expect(sole.allocations[0].state).toBe('served')
    expect(sole.batches[0].state).toBe('prepared')
  })

  it('validates references, uniqueness, allocation bounds, and exact revision links', () => {
    const { snapshot } = editablePlan()
    expect(validatePlanningSnapshot(snapshot).success).toBe(true)
    const broken = structuredClone(snapshot)
    broken.cookEvents[0].recipeRevisionId = 'revision-wrong'
    broken.allocations.push({ ...broken.allocations[0], allocationId: 'allocation-over', mealPortionsSatisfied: 2 })
    const result = validatePlanningSnapshot(broken)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining(['revision-mismatch', 'meal-overallocated']))
  })

  it('maintains conservation and deterministic JSON across a matrix of valid allocations', () => {
    const recipe = reviewedRecipe({ sourceServingsPerMealPortion: 1, allowedMultipliers: [1, 2] })
    for (const multiplier of [1, 2]) {
      for (const portions of [1, 2, 3, 4]) {
        if (portions > 4 * multiplier) continue
        const { batch, event } = plan(recipe, multiplier, `property-${multiplier}-${portions}`)
        const requirement = meal(`property-${multiplier}-${portions}`, '2026-11-16', 'dinner', portions)
        const input = [{ allocationId: `allocation-property-${multiplier}-${portions}`, requirement, mealPortions: portions, service: 'fresh' as const }]
        const first = allocateBatchToMeals(recipe, batch, event, input)
        const second = allocateBatchToMeals(recipe, batch, event, input)
        expect(first.allocations[0].amount.amount + first.remainder.amount).toBe(batch.plannedOutput.amount)
        expect(first.remainder.amount).toBeGreaterThanOrEqual(0)
        expect(JSON.stringify(first)).toBe(JSON.stringify(second))
      }
    }
  })

  it('rejects malformed schema records directly', () => {
    expect(batchSchema.safeParse({}).success).toBe(false)
    expect(mealRequirementSchema.safeParse({ ...meal('valid', '2026-11-16', 'dinner', 1), status: 'skipped' }).success).toBe(false)
  })
})
