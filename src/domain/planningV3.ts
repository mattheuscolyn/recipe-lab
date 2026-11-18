import { z } from 'zod'
import type { RecipeV3 } from './recipeV3'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`), `Expected a ${prefix}- identifier`)
const nullableText = (max = 300) => z.string().trim().min(1).max(max).nullable()
const nonnegativeFinite = z.number().nonnegative().finite()
const positiveFinite = z.number().positive().finite()
const EPSILON = 1e-9

export const outputAmountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source-serving'), amount: nonnegativeFinite }),
  z.object({ kind: z.literal('fixed-portion'), amount: nonnegativeFinite }),
  z.object({ kind: z.literal('discrete-item'), amount: z.number().int().nonnegative(), itemName: z.string().trim().min(1).max(80) }),
])

export const mealRequirementSchema = z.object({
  mealRequirementId: id('meal-requirement'),
  date: z.iso.date(),
  intendedAt: z.iso.datetime().nullable(),
  meal: z.enum(['breakfast', 'lunch', 'dinner']),
  requestedPortions: z.number().int().nonnegative(),
  status: z.enum(['unplanned', 'planned', 'skipped']),
  constraints: z.object({
    maxActiveMinutes: z.number().int().nonnegative().nullable(),
    maxElapsedMinutes: z.number().int().nonnegative().nullable(),
    mustUseIngredientIds: z.array(id('ingredient')),
    avoidRecipeIds: z.array(z.string().uuid()),
    allowLunchCooking: z.boolean(),
  }),
  lock: z.object({ locked: z.boolean(), reason: nullableText() }),
}).superRefine((requirement, context) => {
  if (requirement.requestedPortions === 0 && requirement.status !== 'skipped') context.addIssue({ code: 'custom', path: ['status'], message: 'Zero portions must be explicitly skipped' })
  if (requirement.requestedPortions > 0 && requirement.status === 'skipped') context.addIssue({ code: 'custom', path: ['status'], message: 'A skipped meal must request zero portions' })
  if (requirement.intendedAt && !requirement.intendedAt.startsWith(requirement.date)) context.addIssue({ code: 'custom', path: ['intendedAt'], message: 'Meal time must fall on the requirement date' })
})

export const cookEventSchema = z.object({
  cookEventId: id('cook-event'),
  intendedAt: z.iso.datetime(),
  recipeId: z.string().uuid(),
  recipeRevisionId: id('revision'),
  state: z.enum(['proposed', 'planned', 'started', 'completed', 'cancelled']),
  batchId: id('batch'),
  derivedTaskIds: z.array(id('task')),
  completedAt: z.iso.datetime().nullable(),
}).superRefine((event, context) => {
  if ((event.state === 'completed') !== (event.completedAt !== null)) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Only a completed cook event has a completion time' })
})

export const batchSchema = z.object({
  batchId: id('batch'),
  recipeId: z.string().uuid(),
  recipeRevisionId: id('revision'),
  state: z.enum(['planned', 'prepared', 'cancelled']),
  multiplier: positiveFinite,
  plannedOutput: outputAmountSchema,
  actualOutput: outputAmountSchema.nullable(),
  groceryDemandId: id('grocery-demand'),
  outputEvidenceIds: z.array(id('evidence')).min(1),
}).superRefine((batch, context) => {
  if (batch.plannedOutput.amount <= 0) context.addIssue({ code: 'custom', path: ['plannedOutput', 'amount'], message: 'A planned batch must produce a positive output' })
  if (batch.state === 'prepared' && batch.actualOutput === null) context.addIssue({ code: 'custom', path: ['actualOutput'], message: 'A prepared batch needs actual output' })
  if (batch.state !== 'prepared' && batch.actualOutput !== null) context.addIssue({ code: 'custom', path: ['actualOutput'], message: 'Only a prepared batch may have actual output' })
  if (batch.actualOutput && !sameOutputUnit(batch.plannedOutput, batch.actualOutput)) context.addIssue({ code: 'custom', path: ['actualOutput'], message: 'Actual and planned output units must match' })
})

export const mealAllocationSchema = z.object({
  allocationId: id('allocation'),
  mealRequirementId: id('meal-requirement'),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('planned-batch'), batchId: id('batch') }),
    z.object({ kind: z.literal('prepared-lot'), preparedFoodLotId: id('prepared-lot') }),
  ]),
  amount: outputAmountSchema,
  mealPortionsSatisfied: z.number().int().positive(),
  service: z.enum(['fresh', 'refrigerated-leftover', 'frozen-leftover']),
  storageEvidenceIds: z.array(id('evidence')),
  state: z.enum(['proposed', 'reserved', 'served', 'cancelled']),
}).superRefine((allocation, context) => {
  if (allocation.amount.amount <= 0) context.addIssue({ code: 'custom', path: ['amount', 'amount'], message: 'An allocation must consume positive output' })
  if (allocation.service === 'fresh' && allocation.storageEvidenceIds.length) context.addIssue({ code: 'custom', path: ['storageEvidenceIds'], message: 'Fresh service does not use storage evidence' })
  if (allocation.service !== 'fresh' && !allocation.storageEvidenceIds.length) context.addIssue({ code: 'custom', path: ['storageEvidenceIds'], message: 'Stored service needs reviewed storage evidence' })
})

export const preparedFoodLotSchema = z.object({
  preparedFoodLotId: id('prepared-lot'),
  batchId: id('batch'),
  recipeId: z.string().uuid(),
  recipeRevisionId: id('revision'),
  createdAt: z.iso.datetime(),
  storageMode: z.enum(['refrigerated', 'frozen', 'room-temperature']),
  storedAt: z.iso.datetime(),
  bestUseWindow: z.object({ start: z.iso.datetime(), end: z.iso.datetime().nullable(), evidenceIds: z.array(id('evidence')).min(1) }),
  initialAmount: outputAmountSchema,
  remainingAmount: outputAmountSchema,
  state: z.enum(['available', 'depleted', 'discarded']),
  version: z.number().int().positive(),
}).superRefine((lot, context) => {
  if (!sameOutputUnit(lot.initialAmount, lot.remainingAmount)) context.addIssue({ code: 'custom', path: ['remainingAmount'], message: 'Initial and remaining output units must match' })
  if (lot.initialAmount.amount <= 0) context.addIssue({ code: 'custom', path: ['initialAmount', 'amount'], message: 'Prepared inventory must start positive' })
  if (lot.remainingAmount.amount > lot.initialAmount.amount + EPSILON) context.addIssue({ code: 'custom', path: ['remainingAmount', 'amount'], message: 'Remaining output cannot exceed initial output' })
  if (lot.state === 'available' && lot.remainingAmount.amount <= 0) context.addIssue({ code: 'custom', path: ['state'], message: 'Available inventory needs positive remaining output' })
  if (lot.state !== 'available' && lot.remainingAmount.amount !== 0) context.addIssue({ code: 'custom', path: ['remainingAmount', 'amount'], message: 'Depleted or discarded inventory has no unreserved remainder' })
  if (lot.bestUseWindow.end && Date.parse(lot.bestUseWindow.end) < Date.parse(lot.bestUseWindow.start)) context.addIssue({ code: 'custom', path: ['bestUseWindow', 'end'], message: 'Best-use window cannot end before it starts' })
  if (Date.parse(lot.storedAt) < Date.parse(lot.createdAt)) context.addIssue({ code: 'custom', path: ['storedAt'], message: 'Food cannot be stored before its lot is created' })
  if (lot.bestUseWindow.start !== lot.storedAt) context.addIssue({ code: 'custom', path: ['bestUseWindow', 'start'], message: 'Best-use timing starts when food is stored' })
})

export const planningSnapshotSchema = z.object({
  mealRequirements: z.array(mealRequirementSchema),
  cookEvents: z.array(cookEventSchema),
  batches: z.array(batchSchema),
  allocations: z.array(mealAllocationSchema),
  preparedFoodLots: z.array(preparedFoodLotSchema),
})

export type OutputAmount = z.infer<typeof outputAmountSchema>
export type MealRequirement = z.infer<typeof mealRequirementSchema>
export type CookEvent = z.infer<typeof cookEventSchema>
export type Batch = z.infer<typeof batchSchema>
export type MealAllocation = z.infer<typeof mealAllocationSchema>
export type PreparedFoodLot = z.infer<typeof preparedFoodLotSchema>
export type PlanningSnapshot = z.infer<typeof planningSnapshotSchema>

export type PlanningIssue = { path: string; code: string; message: string }
export type PlanningValidationResult = { success: true; data: PlanningSnapshot } | { success: false; issues: PlanningIssue[] }
export type PlanExplanation = { code: string; message: string; entityIds: string[] }
export type PlanDiff = {
  changedEntityIds: string[]
  invalidatedEntityIds: string[]
  preservedLockedMealRequirementIds: string[]
  explanations: PlanExplanation[]
}
export type PlanEditResult = { before: PlanningSnapshot; after: PlanningSnapshot; diff: PlanDiff }

function sameOutputUnit(left: OutputAmount, right: OutputAmount): boolean {
  return left.kind === right.kind && (left.kind !== 'discrete-item' || (right.kind === 'discrete-item' && left.itemName === right.itemName))
}

function outputLike(template: OutputAmount, amount: number): OutputAmount {
  const normalized = Math.abs(amount) < EPSILON ? 0 : amount
  if (template.kind === 'discrete-item') {
    if (!Number.isInteger(normalized)) throw new Error('Discrete output cannot be fractional')
    return { kind: 'discrete-item', amount: normalized, itemName: template.itemName }
  }
  return { kind: template.kind, amount: normalized }
}

function addOutput(left: OutputAmount, right: OutputAmount): OutputAmount {
  if (!sameOutputUnit(left, right)) throw new Error('Output units are incompatible')
  return outputLike(left, left.amount + right.amount)
}

function subtractOutput(left: OutputAmount, right: OutputAmount): OutputAmount {
  if (!sameOutputUnit(left, right)) throw new Error('Output units are incompatible')
  const amount = left.amount - right.amount
  if (amount < -EPSILON) throw new Error('Output conservation would become negative')
  return outputLike(left, Math.max(0, amount))
}

function sumOutputs(template: OutputAmount, values: OutputAmount[]): OutputAmount {
  return values.reduce(addOutput, outputLike(template, 0))
}

function exactSourceYield(recipe: RecipeV3, selection?: { amount: number; evidenceIds: string[]; confidence: 'reported' | 'reviewed' }): { amount: number; evidenceIds: string[] } {
  const sourceYield = recipe.output.sourceYield
  if (sourceYield.amount !== null) return { amount: sourceYield.amount, evidenceIds: sourceYield.evidenceIds }
  if (!selection || !selection.evidenceIds.length) throw new Error('Ambiguous source yield needs a reviewed exact selection')
  if (!['reported', 'reviewed'].includes(selection.confidence)) throw new Error('Source-yield selection must be reported or reviewed')
  if (!sourceYield.range || selection.amount < sourceYield.range.min || selection.amount > sourceYield.range.max) throw new Error('Selected source yield is outside the publisher range')
  const recipeEvidence = new Set(recipe.source.evidence.filter(({ confidence }) => ['reported', 'reviewed'].includes(confidence)).map(({ evidenceId }) => evidenceId))
  if (selection.evidenceIds.some((evidenceId) => !recipeEvidence.has(evidenceId))) throw new Error('Source-yield selection must cite reported or reviewed recipe evidence')
  return { amount: selection.amount, evidenceIds: selection.evidenceIds }
}

function multiplierAllowed(recipe: RecipeV3, multiplier: number): boolean {
  if (multiplier === 1) return true
  if (['fixed-batch', 'review-required'].includes(recipe.output.scaling.policy)) return false
  return recipe.output.scaling.allowedMultipliers?.some((allowed) => Math.abs(allowed - multiplier) < EPSILON) ?? false
}

export function planCookingBatch(recipe: RecipeV3, input: {
  batchId: string
  groceryDemandId: string
  multiplier: number
  sourceYieldSelection?: { amount: number; evidenceIds: string[]; confidence: 'reported' | 'reviewed' }
}): Batch {
  if (!Number.isFinite(input.multiplier) || input.multiplier <= 0) throw new Error('Batch multiplier must be positive')
  if (!multiplierAllowed(recipe, input.multiplier)) throw new Error(`Batch multiplier ${input.multiplier} is not approved for ${recipe.identity.slug}`)
  if (input.multiplier !== 1) {
    const unsafe = recipe.requirements.find((requirement) => requirement.scaling === 'review-required' || (requirement.scaling === 'whole-item' && (requirement.selectedPlanningQuantity?.amount == null || !Number.isInteger(requirement.selectedPlanningQuantity.amount * input.multiplier))))
    if (unsafe) throw new Error(`Requirement ${unsafe.requirementId} does not support multiplier ${input.multiplier}`)
  }
  const source = exactSourceYield(recipe, input.sourceYieldSelection)
  const amount = source.amount * input.multiplier
  let plannedOutput: OutputAmount
  if (recipe.output.kind === 'discrete-items') {
    if (!recipe.output.discreteItem || !Number.isInteger(amount)) throw new Error('Discrete batch output must be a whole number')
    plannedOutput = { kind: 'discrete-item', amount, itemName: recipe.output.discreteItem.itemName }
  } else plannedOutput = { kind: recipe.output.kind === 'fixed-portions' ? 'fixed-portion' : 'source-serving', amount }
  return batchSchema.parse({
    batchId: input.batchId,
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    state: 'planned',
    multiplier: input.multiplier,
    plannedOutput,
    actualOutput: null,
    groceryDemandId: input.groceryDemandId,
    outputEvidenceIds: source.evidenceIds,
  })
}

export function scheduleCookEvent(recipe: RecipeV3, batch: Batch, input: { cookEventId: string; intendedAt: string }): CookEvent {
  if (batch.recipeId !== recipe.identity.recipeId || batch.recipeRevisionId !== recipe.identity.revisionId) throw new Error('Cook event recipe does not match its batch')
  return cookEventSchema.parse({
    cookEventId: input.cookEventId,
    intendedAt: input.intendedAt,
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    state: 'planned',
    batchId: batch.batchId,
    derivedTaskIds: [],
    completedAt: null,
  })
}

function outputForMealPortions(recipe: RecipeV3, mealPortions: number): OutputAmount {
  if (!Number.isInteger(mealPortions) || mealPortions <= 0) throw new Error('Meal portions must be a positive integer')
  const guidance = recipe.output.planningGuidance.sourceServingsPerMealPortion
  if (!guidance || guidance.value === null || !guidance.evidenceIds.length || !['reported', 'reviewed'].includes(guidance.confidence)) throw new Error('Meal allocation needs reviewed source-output guidance')
  const amount = guidance.value * mealPortions
  if (recipe.output.kind === 'discrete-items') {
    if (!recipe.output.discreteItem || !Number.isInteger(amount)) throw new Error('Meal allocation cannot contain fractional items')
    return { kind: 'discrete-item', amount, itemName: recipe.output.discreteItem.itemName }
  }
  return { kind: recipe.output.kind === 'fixed-portions' ? 'fixed-portion' : 'source-serving', amount }
}

function storageModeForService(service: MealAllocation['service']): PreparedFoodLot['storageMode'] | null {
  if (service === 'refrigerated-leftover') return 'refrigerated'
  if (service === 'frozen-leftover') return 'frozen'
  return null
}

function reviewedStorage(recipe: RecipeV3, service: MealAllocation['service']): RecipeV3['suitability']['storageModes'][number] | null {
  const mode = storageModeForService(service)
  if (!mode) return null
  if (recipe.suitability.reviewState === 'unknown') throw new Error('Stored allocation needs reviewed suitability')
  const storage = recipe.suitability.storageModes.find((candidate) => candidate.mode === mode)
  if (!storage || storage.maxDurationHours === null || !storage.evidenceIds.length || !['reported', 'reviewed'].includes(storage.confidence)) throw new Error(`Stored allocation needs reviewed ${mode} timing evidence`)
  return storage
}

function validateAllocationTiming(recipe: RecipeV3, event: CookEvent, requirement: MealRequirement, service: MealAllocation['service']): string[] {
  const cookDate = event.intendedAt.slice(0, 10)
  if (service === 'fresh' && requirement.date !== cookDate) throw new Error('Fresh allocation must be served on the cook-event date')
  if (!requirement.intendedAt) {
    if (service === 'fresh') return []
    throw new Error('Stored allocation needs an exact intended meal time')
  }
  const elapsedHours = (Date.parse(requirement.intendedAt) - Date.parse(event.intendedAt)) / 3_600_000
  if (elapsedHours < 0) throw new Error('A meal cannot consume food before the cook event')
  const storage = reviewedStorage(recipe, service)
  if (storage && elapsedHours > storage.maxDurationHours!) throw new Error('Storage window is exceeded')
  return storage?.evidenceIds ?? []
}

export type MealAllocationRequest = {
  allocationId: string
  requirement: MealRequirement
  mealPortions: number
  service: MealAllocation['service']
}

export function allocateBatchToMeals(recipe: RecipeV3, batch: Batch, event: CookEvent, requests: MealAllocationRequest[]): { allocations: MealAllocation[]; mealRequirements: MealRequirement[]; remainder: OutputAmount } {
  if (batch.state !== 'planned' || event.state === 'cancelled' || event.batchId !== batch.batchId) throw new Error('Allocations need an active planned cook event and batch')
  if (batch.recipeRevisionId !== recipe.identity.revisionId || event.recipeRevisionId !== recipe.identity.revisionId) throw new Error('Allocation recipe revision does not match the batch')
  if (new Set(requests.map(({ allocationId }) => allocationId)).size !== requests.length) throw new Error('Allocation ids must be unique')
  const portionsByRequirement = new Map<string, number>()
  const allocations = requests.map((request) => {
    const requirement = mealRequirementSchema.parse(request.requirement)
    if (requirement.status === 'skipped') throw new Error(`Skipped meal ${requirement.mealRequirementId} cannot receive an allocation`)
    const nextPortions = (portionsByRequirement.get(requirement.mealRequirementId) ?? 0) + request.mealPortions
    if (nextPortions > requirement.requestedPortions) throw new Error(`Allocation exceeds requested portions for ${requirement.mealRequirementId}`)
    portionsByRequirement.set(requirement.mealRequirementId, nextPortions)
    return mealAllocationSchema.parse({
      allocationId: request.allocationId,
      mealRequirementId: requirement.mealRequirementId,
      source: { kind: 'planned-batch', batchId: batch.batchId },
      amount: outputForMealPortions(recipe, request.mealPortions),
      mealPortionsSatisfied: request.mealPortions,
      service: request.service,
      storageEvidenceIds: validateAllocationTiming(recipe, event, requirement, request.service),
      state: 'proposed',
    })
  })
  const allocated = sumOutputs(batch.plannedOutput, allocations.map(({ amount }) => amount))
  const remainder = subtractOutput(batch.plannedOutput, allocated)
  const uniqueRequirements = new Map(requests.map(({ requirement }) => [requirement.mealRequirementId, requirement]))
  const mealRequirements = [...uniqueRequirements.values()].map((requirement) => ({
    ...requirement,
    status: portionsByRequirement.get(requirement.mealRequirementId) === requirement.requestedPortions ? 'planned' as const : 'unplanned' as const,
  }))
  return { allocations, mealRequirements, remainder }
}

export function summarizeBatchAllocation(batch: Batch, allocations: MealAllocation[]): { allocated: OutputAmount; remainder: OutputAmount } {
  const active = allocations.filter((allocation) => allocation.state !== 'cancelled' && allocation.source.kind === 'planned-batch' && allocation.source.batchId === batch.batchId)
  const allocated = sumOutputs(batch.plannedOutput, active.map(({ amount }) => amount))
  return { allocated, remainder: subtractOutput(batch.plannedOutput, allocated) }
}

function storageForMode(recipe: RecipeV3, mode: PreparedFoodLot['storageMode']) {
  if (recipe.suitability.reviewState === 'unknown') throw new Error('Prepared inventory needs reviewed storage suitability')
  const storage = recipe.suitability.storageModes.find((candidate) => candidate.mode === mode)
  if (!storage || storage.maxDurationHours === null || !storage.evidenceIds.length || !['reported', 'reviewed'].includes(storage.confidence)) throw new Error(`Prepared inventory needs reviewed ${mode} evidence`)
  return storage
}

export function confirmCookEvent(input: {
  recipe: RecipeV3
  cookEvent: CookEvent
  batch: Batch
  allocations: MealAllocation[]
  confirmedAt: string
  actualOutput?: OutputAmount
  preparedFoodLotId: string
  storageMode: PreparedFoodLot['storageMode']
}): { cookEvent: CookEvent; batch: Batch; allocations: MealAllocation[]; preparedFoodLot: PreparedFoodLot | null } {
  const { recipe, cookEvent, batch } = input
  if (cookEvent.state === 'completed' || cookEvent.state === 'cancelled' || batch.state !== 'planned') throw new Error('Only an active unprepared cook event can be confirmed')
  if (cookEvent.batchId !== batch.batchId || batch.recipeRevisionId !== recipe.identity.revisionId) throw new Error('Cook event, batch, and recipe revision do not match')
  if (Date.parse(input.confirmedAt) < Date.parse(cookEvent.intendedAt)) throw new Error('Cook completion cannot precede its intended cook event')
  const actualOutput = outputAmountSchema.parse(input.actualOutput ?? batch.plannedOutput)
  if (!sameOutputUnit(batch.plannedOutput, actualOutput) || actualOutput.amount <= 0) throw new Error('Actual output must be positive and use the planned output unit')
  const active = input.allocations.filter((allocation) => allocation.state !== 'cancelled' && allocation.source.kind === 'planned-batch' && allocation.source.batchId === batch.batchId)
  const allocated = sumOutputs(actualOutput, active.map(({ amount }) => amount))
  subtractOutput(actualOutput, allocated)
  const fresh = active.filter(({ service }) => service === 'fresh')
  const stored = active.filter(({ service }) => service !== 'fresh')
  const freshAmount = sumOutputs(actualOutput, fresh.map(({ amount }) => amount))
  const leftoverInitial = subtractOutput(actualOutput, freshAmount)
  const storedAmount = sumOutputs(actualOutput, stored.map(({ amount }) => amount))
  const remaining = subtractOutput(leftoverInitial, storedAmount)
  const storage = leftoverInitial.amount > 0 ? storageForMode(recipe, input.storageMode) : null
  stored.forEach((allocation) => {
    const expectedMode = storageModeForService(allocation.service)
    if (expectedMode !== input.storageMode) throw new Error('Stored allocation service must match the prepared lot storage mode')
  })
  const preparedFoodLot = storage ? preparedFoodLotSchema.parse({
    preparedFoodLotId: input.preparedFoodLotId,
    batchId: batch.batchId,
    recipeId: batch.recipeId,
    recipeRevisionId: batch.recipeRevisionId,
    createdAt: input.confirmedAt,
    storageMode: input.storageMode,
    storedAt: input.confirmedAt,
    bestUseWindow: {
      start: input.confirmedAt,
      end: new Date(Date.parse(input.confirmedAt) + storage.maxDurationHours! * 3_600_000).toISOString(),
      evidenceIds: storage.evidenceIds,
    },
    initialAmount: leftoverInitial,
    remainingAmount: remaining,
    state: remaining.amount > 0 ? 'available' : 'depleted',
    version: 1,
  }) : null
  const updatedAllocations = input.allocations.map((allocation) => {
    if (!active.some(({ allocationId }) => allocationId === allocation.allocationId)) return allocation
    if (allocation.service === 'fresh') return mealAllocationSchema.parse({ ...allocation, state: 'served' })
    if (!preparedFoodLot) throw new Error('Stored allocation requires prepared inventory')
    return mealAllocationSchema.parse({ ...allocation, source: { kind: 'prepared-lot', preparedFoodLotId: preparedFoodLot.preparedFoodLotId }, state: 'reserved' })
  })
  return {
    cookEvent: cookEventSchema.parse({ ...cookEvent, state: 'completed', completedAt: input.confirmedAt }),
    batch: batchSchema.parse({ ...batch, state: 'prepared', actualOutput }),
    allocations: updatedAllocations,
    preparedFoodLot,
  }
}

function requireLotVersion(lot: PreparedFoodLot, expectedVersion: number): void {
  if (lot.version !== expectedVersion) throw new Error(`Prepared lot version conflict: expected ${expectedVersion}, found ${lot.version}`)
}

function serviceMatchesLot(service: MealAllocation['service'], mode: PreparedFoodLot['storageMode']): boolean {
  return (service === 'refrigerated-leftover' && mode === 'refrigerated') || (service === 'frozen-leftover' && mode === 'frozen')
}

export function reservePreparedFood(lot: PreparedFoodLot, allocation: MealAllocation, requirement: MealRequirement, expectedVersion: number): { lot: PreparedFoodLot; allocation: MealAllocation } {
  requireLotVersion(lot, expectedVersion)
  if (lot.state !== 'available') throw new Error('Prepared lot has no available inventory')
  if (allocation.source.kind !== 'prepared-lot' || allocation.source.preparedFoodLotId !== lot.preparedFoodLotId || allocation.state !== 'proposed') throw new Error('Allocation is not a proposed reservation for this lot')
  if (allocation.mealRequirementId !== requirement.mealRequirementId || requirement.status === 'skipped' || allocation.mealPortionsSatisfied > requirement.requestedPortions) throw new Error('Prepared-food allocation does not match active meal demand')
  if (!serviceMatchesLot(allocation.service, lot.storageMode)) throw new Error('Allocation storage service does not match the lot')
  if (allocation.storageEvidenceIds.some((evidenceId) => !lot.bestUseWindow.evidenceIds.includes(evidenceId))) throw new Error('Allocation storage evidence does not match the prepared lot')
  if (!requirement.intendedAt) throw new Error('Prepared-food reservation needs an exact meal time')
  if (lot.bestUseWindow.end && Date.parse(requirement.intendedAt) > Date.parse(lot.bestUseWindow.end)) throw new Error('Prepared-food reservation exceeds the best-use window')
  const remainingAmount = subtractOutput(lot.remainingAmount, allocation.amount)
  return {
    lot: preparedFoodLotSchema.parse({ ...lot, remainingAmount, state: remainingAmount.amount > 0 ? 'available' : 'depleted', version: lot.version + 1 }),
    allocation: mealAllocationSchema.parse({ ...allocation, state: 'reserved' }),
  }
}

export function servePreparedFood(lot: PreparedFoodLot, allocation: MealAllocation, expectedVersion: number): { lot: PreparedFoodLot; allocation: MealAllocation } {
  requireLotVersion(lot, expectedVersion)
  if (allocation.source.kind !== 'prepared-lot' || allocation.source.preparedFoodLotId !== lot.preparedFoodLotId || allocation.state !== 'reserved') throw new Error('Only a reservation for this lot can be served')
  return { lot: preparedFoodLotSchema.parse({ ...lot, version: lot.version + 1 }), allocation: mealAllocationSchema.parse({ ...allocation, state: 'served' }) }
}

export function cancelPreparedFoodReservation(lot: PreparedFoodLot, allocation: MealAllocation, expectedVersion: number): { lot: PreparedFoodLot; allocation: MealAllocation } {
  requireLotVersion(lot, expectedVersion)
  if (allocation.source.kind !== 'prepared-lot' || allocation.source.preparedFoodLotId !== lot.preparedFoodLotId || allocation.state !== 'reserved') throw new Error('Only a reservation for this lot can be cancelled')
  const remainingAmount = addOutput(lot.remainingAmount, allocation.amount)
  if (remainingAmount.amount > lot.initialAmount.amount + EPSILON) throw new Error('Cancelling this reservation would exceed the lot initial amount')
  return {
    lot: preparedFoodLotSchema.parse({ ...lot, remainingAmount, state: 'available', version: lot.version + 1 }),
    allocation: mealAllocationSchema.parse({ ...allocation, state: 'cancelled' }),
  }
}

export function adjustPreparedFoodRemaining(lot: PreparedFoodLot, remainingAmount: OutputAmount, expectedVersion: number): PreparedFoodLot {
  requireLotVersion(lot, expectedVersion)
  if (lot.state === 'discarded') throw new Error('Discarded inventory cannot be adjusted')
  if (!sameOutputUnit(lot.initialAmount, remainingAmount) || remainingAmount.amount > lot.remainingAmount.amount + EPSILON) throw new Error('Manual adjustment must use the lot unit and cannot restore already consumed or reserved inventory')
  return preparedFoodLotSchema.parse({ ...lot, remainingAmount, state: remainingAmount.amount > 0 ? 'available' : 'depleted', version: lot.version + 1 })
}

export function discardPreparedFood(lot: PreparedFoodLot, expectedVersion: number, allocations: MealAllocation[]): PreparedFoodLot {
  requireLotVersion(lot, expectedVersion)
  if (allocations.some((allocation) => allocation.source.kind === 'prepared-lot' && allocation.source.preparedFoodLotId === lot.preparedFoodLotId && allocation.state === 'reserved')) throw new Error('Cancel active reservations before discarding prepared food')
  return preparedFoodLotSchema.parse({ ...lot, remainingAmount: outputLike(lot.remainingAmount, 0), state: 'discarded', version: lot.version + 1 })
}

const activeAllocation = (allocation: MealAllocation) => allocation.state !== 'cancelled'

export function validatePlanningSnapshot(input: unknown): PlanningValidationResult {
  const parsed = planningSnapshotSchema.safeParse(input)
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: 'schema-invalid', message: issue.message })) }
  const plan = parsed.data
  const issues: PlanningIssue[] = []
  const unique = <T>(items: T[], value: (item: T) => string, path: string) => {
    const seen = new Set<string>()
    items.forEach((item, index) => { const key = value(item); if (seen.has(key)) issues.push({ path: `${path}.${index}`, code: 'duplicate-id', message: `Duplicate ${key}` }); seen.add(key) })
  }
  unique(plan.mealRequirements, ({ mealRequirementId }) => mealRequirementId, 'mealRequirements')
  unique(plan.cookEvents, ({ cookEventId }) => cookEventId, 'cookEvents')
  unique(plan.batches, ({ batchId }) => batchId, 'batches')
  unique(plan.allocations, ({ allocationId }) => allocationId, 'allocations')
  unique(plan.preparedFoodLots, ({ preparedFoodLotId }) => preparedFoodLotId, 'preparedFoodLots')
  const requirements = new Map(plan.mealRequirements.map((item) => [item.mealRequirementId, item]))
  const batches = new Map(plan.batches.map((item) => [item.batchId, item]))
  const lots = new Map(plan.preparedFoodLots.map((item) => [item.preparedFoodLotId, item]))
  const eventBatchIds = new Set<string>()
  plan.cookEvents.forEach((event, index) => {
    const batch = batches.get(event.batchId)
    if (!batch) issues.push({ path: `cookEvents.${index}.batchId`, code: 'unknown-batch', message: `Unknown batch ${event.batchId}` })
    else if (batch.recipeRevisionId !== event.recipeRevisionId || batch.recipeId !== event.recipeId) issues.push({ path: `cookEvents.${index}.recipeRevisionId`, code: 'revision-mismatch', message: 'Cook event and batch recipe revisions differ' })
    if (eventBatchIds.has(event.batchId)) issues.push({ path: `cookEvents.${index}.batchId`, code: 'duplicate-batch-event', message: 'A batch may have only one cook event' })
    eventBatchIds.add(event.batchId)
  })
  plan.allocations.forEach((allocation, index) => {
    if (!requirements.has(allocation.mealRequirementId)) issues.push({ path: `allocations.${index}.mealRequirementId`, code: 'unknown-meal', message: `Unknown meal requirement ${allocation.mealRequirementId}` })
    if (allocation.source.kind === 'planned-batch' && !batches.has(allocation.source.batchId)) issues.push({ path: `allocations.${index}.source`, code: 'unknown-batch', message: `Unknown batch ${allocation.source.batchId}` })
    else if (allocation.source.kind === 'planned-batch') {
      const batch = batches.get(allocation.source.batchId)!
      if (allocation.state === 'reserved') issues.push({ path: `allocations.${index}.state`, code: 'invalid-allocation-state', message: 'A planned-batch allocation cannot be reserved prepared inventory' })
      if (allocation.state === 'served' && batch.state !== 'prepared') issues.push({ path: `allocations.${index}.state`, code: 'unconfirmed-allocation-served', message: 'A planned allocation cannot be served before its batch is prepared' })
    }
    if (allocation.source.kind === 'prepared-lot' && !lots.has(allocation.source.preparedFoodLotId)) issues.push({ path: `allocations.${index}.source`, code: 'unknown-prepared-lot', message: `Unknown prepared lot ${allocation.source.preparedFoodLotId}` })
  })
  plan.mealRequirements.forEach((requirement, index) => {
    const portions = plan.allocations.filter((allocation) => activeAllocation(allocation) && allocation.mealRequirementId === requirement.mealRequirementId).reduce((sum, allocation) => sum + allocation.mealPortionsSatisfied, 0)
    if (portions > requirement.requestedPortions) issues.push({ path: `mealRequirements.${index}`, code: 'meal-overallocated', message: 'Meal allocations exceed requested portions' })
    if (requirement.status === 'planned' && portions !== requirement.requestedPortions) issues.push({ path: `mealRequirements.${index}.status`, code: 'meal-not-fully-allocated', message: 'A planned meal must be fully allocated' })
    if (requirement.status === 'skipped' && portions > 0) issues.push({ path: `mealRequirements.${index}`, code: 'skipped-meal-allocated', message: 'A skipped meal cannot have active allocations' })
  })
  plan.batches.forEach((batch, index) => {
    const active = plan.allocations.filter((allocation) => activeAllocation(allocation) && allocation.source.kind === 'planned-batch' && allocation.source.batchId === batch.batchId)
    try { summarizeBatchAllocation(batch, active) } catch (error) { issues.push({ path: `batches.${index}`, code: 'batch-overallocated', message: error instanceof Error ? error.message : 'Batch allocation is invalid' }) }
    if (batch.state === 'cancelled' && active.length) issues.push({ path: `batches.${index}.state`, code: 'cancelled-batch-allocated', message: 'A cancelled batch cannot have active allocations' })
  })
  plan.preparedFoodLots.forEach((lot, index) => {
    const batch = batches.get(lot.batchId)
    if (!batch) issues.push({ path: `preparedFoodLots.${index}.batchId`, code: 'unknown-batch', message: `Unknown batch ${lot.batchId}` })
    else {
      if (batch.recipeId !== lot.recipeId || batch.recipeRevisionId !== lot.recipeRevisionId) issues.push({ path: `preparedFoodLots.${index}.recipeRevisionId`, code: 'revision-mismatch', message: 'Prepared lot and batch recipe revisions differ' })
      if (batch.state !== 'prepared') issues.push({ path: `preparedFoodLots.${index}.batchId`, code: 'unprepared-batch-lot', message: 'Prepared inventory requires a prepared batch' })
    }
    const committed = plan.allocations.filter((allocation) => allocation.source.kind === 'prepared-lot' && allocation.source.preparedFoodLotId === lot.preparedFoodLotId && ['reserved', 'served'].includes(allocation.state))
    if (lot.state === 'discarded' && committed.some(({ state }) => state === 'reserved')) issues.push({ path: `preparedFoodLots.${index}.state`, code: 'discarded-lot-reserved', message: 'Discarded inventory cannot retain reservations' })
    try {
      const committedAmount = sumOutputs(lot.initialAmount, committed.map(({ amount }) => amount))
      if (committedAmount.amount + lot.remainingAmount.amount > lot.initialAmount.amount + EPSILON) throw new Error('Prepared inventory is over-reserved or double-consumed')
    } catch (error) { issues.push({ path: `preparedFoodLots.${index}`, code: 'prepared-lot-overallocated', message: error instanceof Error ? error.message : 'Prepared lot allocation is invalid' }) }
  })
  return issues.length ? { success: false, issues } : { success: true, data: plan }
}

function baseDiff(plan: PlanningSnapshot): PlanDiff {
  return {
    changedEntityIds: [],
    invalidatedEntityIds: [],
    preservedLockedMealRequirementIds: plan.mealRequirements.filter(({ lock }) => lock.locked).map(({ mealRequirementId }) => mealRequirementId),
    explanations: [],
  }
}

function assertValidEditResult(plan: PlanningSnapshot): void {
  const result = validatePlanningSnapshot(plan)
  if (!result.success) throw new Error(`Plan edit produced an invalid snapshot: ${result.issues.map(({ code, path }) => `${code}@${path}`).join(', ')}`)
}

export function cancelPlannedBatch(plan: PlanningSnapshot, batchId: string): PlanEditResult {
  const batch = plan.batches.find((item) => item.batchId === batchId)
  if (!batch) throw new Error(`Unknown batch ${batchId}`)
  if (batch.state !== 'planned') throw new Error('Only a planned batch can be cancelled')
  const affected = plan.allocations.filter((allocation) => activeAllocation(allocation) && allocation.source.kind === 'planned-batch' && allocation.source.batchId === batchId)
  const affectedRequirementIds = new Set(affected.map(({ mealRequirementId }) => mealRequirementId))
  const locked = plan.mealRequirements.find((requirement) => affectedRequirementIds.has(requirement.mealRequirementId) && requirement.lock.locked)
  if (locked) throw new Error(`Locked meal ${locked.mealRequirementId} prevents batch cancellation`)
  const diff = baseDiff(plan)
  const events = plan.cookEvents.filter((event) => event.batchId === batchId)
  diff.changedEntityIds.push(batchId, ...events.map(({ cookEventId }) => cookEventId))
  diff.invalidatedEntityIds.push(
    batch.groceryDemandId,
    ...affected.map(({ allocationId }) => allocationId),
    ...events.flatMap(({ derivedTaskIds }) => derivedTaskIds),
  )
  diff.explanations.push({ code: 'batch-cancelled', message: 'Cancelled batch and invalidated only its dependent allocations.', entityIds: [batchId, ...diff.invalidatedEntityIds] })
  const next: PlanningSnapshot = {
    ...plan,
    batches: plan.batches.map((item) => item.batchId === batchId ? { ...item, state: 'cancelled' as const } : item),
    cookEvents: plan.cookEvents.map((event) => event.batchId === batchId ? { ...event, state: 'cancelled' as const, completedAt: null } : event),
    allocations: plan.allocations.map((allocation) => affected.some(({ allocationId }) => allocationId === allocation.allocationId) ? { ...allocation, state: 'cancelled' as const } : allocation),
    mealRequirements: plan.mealRequirements.map((requirement) => affectedRequirementIds.has(requirement.mealRequirementId) ? { ...requirement, status: 'unplanned' as const } : requirement),
  }
  assertValidEditResult(next)
  return { before: plan, after: next, diff }
}

export function cancelCookEvent(plan: PlanningSnapshot, cookEventId: string): PlanEditResult {
  const event = plan.cookEvents.find((candidate) => candidate.cookEventId === cookEventId)
  if (!event) throw new Error(`Unknown cook event ${cookEventId}`)
  if (event.state === 'completed') throw new Error('A completed cook event cannot be cancelled as a plan edit')
  return cancelPlannedBatch(plan, event.batchId)
}

export function changeRequestedPortions(plan: PlanningSnapshot, mealRequirementId: string, requestedPortions: number): PlanEditResult {
  if (!Number.isInteger(requestedPortions) || requestedPortions < 0) throw new Error('Requested portions must be a nonnegative integer')
  const requirement = plan.mealRequirements.find((item) => item.mealRequirementId === mealRequirementId)
  if (!requirement) throw new Error(`Unknown meal requirement ${mealRequirementId}`)
  if (requirement.lock.locked) throw new Error(`Locked meal ${mealRequirementId} cannot change portions`)
  const invalidated = plan.allocations.filter((allocation) => activeAllocation(allocation) && allocation.mealRequirementId === mealRequirementId)
  if (invalidated.some(({ source }) => source.kind === 'prepared-lot')) throw new Error('Cancel the versioned prepared-food reservation before changing this meal')
  const invalidatedIds = new Set(invalidated.map(({ allocationId }) => allocationId))
  const affectedBatchIds = new Set(invalidated.flatMap((allocation) => allocation.source.kind === 'planned-batch' ? [allocation.source.batchId] : []))
  const allocations = plan.allocations.map((allocation) => invalidatedIds.has(allocation.allocationId) ? { ...allocation, state: 'cancelled' as const } : allocation)
  const abandonedBatchIds = new Set([...affectedBatchIds].filter((batchId) => !allocations.some((allocation) => activeAllocation(allocation) && allocation.source.kind === 'planned-batch' && allocation.source.batchId === batchId)))
  const diff = baseDiff(plan)
  const abandonedBatches = plan.batches.filter(({ batchId }) => abandonedBatchIds.has(batchId))
  const abandonedEvents = plan.cookEvents.filter(({ batchId }) => abandonedBatchIds.has(batchId))
  diff.changedEntityIds.push(mealRequirementId, ...abandonedBatchIds, ...abandonedEvents.map(({ cookEventId }) => cookEventId))
  diff.invalidatedEntityIds.push(...invalidatedIds)
  diff.invalidatedEntityIds.push(
    ...abandonedBatches.map(({ groceryDemandId }) => groceryDemandId),
    ...abandonedEvents.flatMap(({ derivedTaskIds }) => derivedTaskIds),
  )
  diff.explanations.push({ code: requestedPortions === 0 ? 'meal-skipped' : 'portions-changed', message: 'Changed requested portions and invalidated only dependent allocations.', entityIds: [mealRequirementId, ...invalidatedIds] })
  const after: PlanningSnapshot = {
    ...plan,
    mealRequirements: plan.mealRequirements.map((item) => item.mealRequirementId === mealRequirementId ? { ...item, requestedPortions, status: requestedPortions === 0 ? 'skipped' as const : 'unplanned' as const } : item),
    allocations,
    batches: plan.batches.map((batch) => abandonedBatchIds.has(batch.batchId) ? { ...batch, state: 'cancelled' as const } : batch),
    cookEvents: plan.cookEvents.map((event) => abandonedBatchIds.has(event.batchId) ? { ...event, state: 'cancelled' as const, completedAt: null } : event),
  }
  assertValidEditResult(after)
  return { before: plan, after, diff }
}

export function replaceMealAllocation(plan: PlanningSnapshot, mealRequirementId: string, replacement: { cookEvent: CookEvent; batch: Batch; allocation: MealAllocation }): PlanEditResult {
  const requirement = plan.mealRequirements.find((item) => item.mealRequirementId === mealRequirementId)
  if (!requirement) throw new Error(`Unknown meal requirement ${mealRequirementId}`)
  if (requirement.lock.locked) throw new Error(`Locked meal ${mealRequirementId} cannot be replaced`)
  const current = plan.allocations.find((allocation) => activeAllocation(allocation) && allocation.mealRequirementId === mealRequirementId)
  if (!current || current.source.kind !== 'planned-batch') throw new Error('Meal replacement needs an existing planned-batch allocation')
  const cancelled = cancelPlannedBatch(plan, current.source.batchId)
  if (replacement.allocation.mealRequirementId !== mealRequirementId || replacement.allocation.source.kind !== 'planned-batch' || replacement.allocation.source.batchId !== replacement.batch.batchId || replacement.cookEvent.batchId !== replacement.batch.batchId) throw new Error('Replacement entities are not linked consistently')
  if (replacement.allocation.mealPortionsSatisfied !== requirement.requestedPortions || replacement.allocation.state === 'cancelled') throw new Error('Replacement allocation must completely satisfy the selected meal')
  if (replacement.batch.recipeId !== replacement.cookEvent.recipeId || replacement.batch.recipeRevisionId !== replacement.cookEvent.recipeRevisionId) throw new Error('Replacement cook event and batch must use the same exact recipe revision')
  summarizeBatchAllocation(replacement.batch, [replacement.allocation])
  const next: PlanningSnapshot = {
    ...cancelled.after,
    batches: [...cancelled.after.batches, batchSchema.parse(replacement.batch)],
    cookEvents: [...cancelled.after.cookEvents, cookEventSchema.parse(replacement.cookEvent)],
    allocations: [...cancelled.after.allocations, mealAllocationSchema.parse(replacement.allocation)],
    mealRequirements: cancelled.after.mealRequirements.map((item) => item.mealRequirementId === mealRequirementId ? { ...item, status: 'planned' as const } : item),
  }
  const diff = cancelled.diff
  diff.changedEntityIds.push(replacement.batch.batchId, replacement.cookEvent.cookEventId, replacement.allocation.allocationId, mealRequirementId)
  diff.explanations.push({ code: 'meal-replaced', message: 'Replaced the selected meal and invalidated allocations that depended on its former batch.', entityIds: [mealRequirementId, replacement.batch.batchId] })
  assertValidEditResult(next)
  return { before: plan, after: next, diff }
}
