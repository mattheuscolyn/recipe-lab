import { z } from 'zod'
import { planningRequestSchema, type PlanningRequest } from './generatorV3'
import { personalDataV3Schema, type PersonalDataV3 } from './personalDataV3'
import { reservePreparedFood } from './planningV3'
import { weekDraftSchema, type WeekDraft } from './weekGeneratorV3'
import type { StorageLike } from './personalData'

type AcceptanceStorage = StorageLike & { removeItem(key: string): void }

export const GENERATED_PLAN_ACCEPTANCE_ENABLED = false
export const ACCEPTED_WEEK_PLAN_KEY = 'recipe-lab.personal.v3.accepted-week'
export const ACCEPTED_WEEK_PLAN_PENDING_KEY = `${ACCEPTED_WEEK_PLAN_KEY}.pending`

const fingerprintSchema = z.string().regex(/^fp-[a-f0-9]{8}$/)
const acceptedWeekPlanSchema = z.object({
  schemaVersion: z.literal(1),
  acceptedAt: z.iso.datetime(),
  sourceMode: z.literal('real'),
  request: planningRequestSchema,
  draft: weekDraftSchema,
  personalData: personalDataV3Schema,
  basePersonalDataFingerprint: fingerprintSchema,
  groceryProvenance: z.object({
    scope: z.literal('outstanding'),
    demand: weekDraftSchema.shape.groceryDemand,
    batchIds: z.array(z.string().regex(/^batch-[a-z0-9-]+$/)),
  }),
})

export type AcceptedWeekPlan = z.infer<typeof acceptedWeekPlanSchema>

export const acceptedWeekPlanEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  fingerprint: fingerprintSchema,
  current: acceptedWeekPlanSchema,
  previous: acceptedWeekPlanSchema.nullable(),
})

export type AcceptedWeekPlanEnvelope = z.infer<typeof acceptedWeekPlanEnvelopeSchema>
export type AcceptanceIssue = { code: string; message: string; entityIds: string[] }
export type AcceptanceReview = {
  status: 'ready' | 'blocked'
  blockers: AcceptanceIssue[]
  warnings: AcceptanceIssue[]
  changes: { meals: number; skipped: number; cookEvents: number; batches: number; allocations: number; preparedLotReservations: number; existingMealsReplaced: number; existingLocksPreserved: number; existingMealsUntouched: number }
  baseFingerprint: string
  candidate: AcceptedWeekPlan | null
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]))
  return value
}

function hash(value: unknown): string {
  const text = JSON.stringify(canonicalize(value))
  let result = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return `fp-${(result >>> 0).toString(16).padStart(8, '0')}`
}

export const personalDataV3Fingerprint = (data: PersonalDataV3): string => hash(personalDataV3Schema.parse(data))
export const acceptedWeekPlanFingerprint = (plan: AcceptedWeekPlan): string => hash(acceptedWeekPlanSchema.parse(plan))

function inHorizon(date: string, request: PlanningRequest): boolean {
  return date >= request.horizon.start && date <= request.horizon.end
}

/** Pure review/conversion. It never writes storage or marks food cooked. */
export function reviewWeekDraftAcceptance(input: {
  mode: 'demo' | 'real'
  request: PlanningRequest
  draft: WeekDraft
  current: PersonalDataV3
  acceptedAt: string
  confirmReplaceProspective?: boolean
}): AcceptanceReview {
  const request = planningRequestSchema.parse(input.request)
  const draft = weekDraftSchema.parse(input.draft)
  const current = personalDataV3Schema.parse(input.current)
  const baseFingerprint = personalDataV3Fingerprint(current)
  const blockers: AcceptanceIssue[] = []
  const warnings: AcceptanceIssue[] = []
  if (input.mode !== 'real') blockers.push({ code: 'synthetic-demo-not-acceptable', message: 'Synthetic demo plans can be reviewed but never accepted into personal planning data.', entityIds: [draft.proposalId] })
  if (draft.status !== 'complete') blockers.push({ code: 'incomplete-week', message: 'Every required meal must be covered or explicitly skipped before acceptance.', entityIds: draft.unmetRequirements.map(({ mealRequirementId }) => mealRequirementId) })
  if (draft.shoppingReadiness.status !== 'ready') blockers.push({ code: 'shopping-review-required', message: 'Resolve grocery quantities and ingredient selections before acceptance.', entityIds: draft.groceryDemand.lines.filter(({ unresolved }) => unresolved).flatMap(({ contributions }) => contributions.map(({ requirementId }) => requirementId)) })
  if (draft.requestId !== request.requestId) blockers.push({ code: 'request-mismatch', message: 'The proposal does not belong to this generation request.', entityIds: [request.requestId, draft.requestId] })
  const exactRecipes = new Set(request.recipeSnapshot.map(({ identity }) => `${identity.recipeId}:${identity.revisionId}`))
  const missingRevisions = draft.selectedRoutes.filter((route) => !exactRecipes.has(`${route.recipeId}:${route.recipeRevisionId}`))
  if (missingRevisions.length) blockers.push({ code: 'recipe-revision-missing', message: 'One or more selected exact recipe revisions are absent from the request snapshot.', entityIds: missingRevisions.map(({ routeId }) => routeId) })
  const selectedKeys = new Set(draft.selectedRoutes.map(({ recipeId, recipeRevisionId }) => `${recipeId}:${recipeRevisionId}`))
  const syntheticRecipes = request.recipeSnapshot.filter((recipe) => selectedKeys.has(`${recipe.identity.recipeId}:${recipe.identity.revisionId}`) && (recipe.source.publisher.toLowerCase().includes('synthetic') || recipe.source.canonicalUrl.includes('example.invalid')))
  if (syntheticRecipes.length) blockers.push({ code: 'synthetic-recipe-not-acceptable', message: 'A selected recipe is a synthetic test fixture and cannot enter personal planning data.', entityIds: syntheticRecipes.map(({ identity }) => identity.revisionId) })

  const historicalRequirementIds = new Set(current.allocations.filter(({ state }) => state === 'served').map(({ mealRequirementId }) => mealRequirementId))
  const historicalInHorizon = current.mealRequirements.filter((item) => inHorizon(item.date, request) && historicalRequirementIds.has(item.mealRequirementId))
  if (historicalInHorizon.length) blockers.push({ code: 'served-history-protected', message: 'Served meals are immutable history and cannot be replaced by a generated plan.', entityIds: historicalInHorizon.map(({ mealRequirementId }) => mealRequirementId) })

  const existingProspective = current.mealRequirements.filter((item) => inHorizon(item.date, request) && !historicalRequirementIds.has(item.mealRequirementId))
  if (existingProspective.length && !input.confirmReplaceProspective) warnings.push({ code: 'existing-prospective-plan', message: 'This week already contains prospective or manual planning data. Explicit replacement confirmation is required.', entityIds: existingProspective.map(({ mealRequirementId }) => mealRequirementId) })
  const lockedConflicts = existingProspective.filter(({ lock }) => lock.locked).filter((existing) => {
    const proposed = request.mealRequirements.find((item) => item.date === existing.date && item.meal === existing.meal)
    const proposedMeal = draft.meals.find((item) => item.date === existing.date && item.meal === existing.meal)
    if (!proposed || !proposed.lock.locked || proposed.requestedPortions !== existing.requestedPortions || !proposedMeal || proposedMeal.status !== 'planned') return true
    // Existing locks must retain their actual recipe, not merely the portion count.
    const allocation = current.allocations.find((item) => item.mealRequirementId === existing.mealRequirementId && item.state !== 'cancelled')
    const sourceBatchId = allocation?.source.kind === 'planned-batch' ? allocation.source.batchId : null
    const sourceLotId = allocation?.source.kind === 'prepared-lot' ? allocation.source.preparedFoodLotId : null
    const batch = sourceBatchId ? current.batches.find(({ batchId }) => batchId === sourceBatchId) : null
    const lot = sourceLotId ? current.preparedFoodLots.find(({ preparedFoodLotId }) => preparedFoodLotId === sourceLotId) : null
    const legacy = current.legacyRecipeChoices.find(({ mealRequirementId }) => mealRequirementId === existing.mealRequirementId)
    const previousRecipeId = batch?.recipeId ?? lot?.recipeId ?? legacy?.recipeId
    const previousRevisionId = batch?.recipeRevisionId ?? lot?.recipeRevisionId ?? null
    return !previousRecipeId || proposedMeal.recipeId !== previousRecipeId || (previousRevisionId !== null && proposedMeal.recipeRevisionId !== previousRevisionId)
  })
  if (lockedConflicts.length) blockers.push({ code: 'locked-meal-conflict', message: 'A generated proposal cannot replace an incompatible locked meal.', entityIds: lockedConflicts.map(({ mealRequirementId }) => mealRequirementId) })
  const mutableRequirementIds = new Set(existingProspective.map(({ mealRequirementId }) => mealRequirementId))
  const affectedAllocations = current.allocations.filter((allocation) => mutableRequirementIds.has(allocation.mealRequirementId) && allocation.state !== 'cancelled')
  if (affectedAllocations.some(({ source }) => source.kind === 'prepared-lot')) blockers.push({ code: 'prepared-reservation-must-be-cancelled', message: 'Cancel existing versioned prepared-food reservations before replacing the week.', entityIds: affectedAllocations.filter((allocation) => allocation.source.kind === 'prepared-lot').map((allocation) => allocation.allocationId) })
  const affectedBatchIds = new Set(affectedAllocations.flatMap((allocation) => allocation.source.kind === 'planned-batch' ? [allocation.source.batchId] : []))
  const historicalCooking = current.batches.filter(({ batchId, state }) => affectedBatchIds.has(batchId) && state === 'prepared').map(({ batchId }) => batchId)
  historicalCooking.push(...current.cookEvents.filter(({ batchId, state }) => affectedBatchIds.has(batchId) && ['started', 'completed'].includes(state)).map(({ cookEventId }) => cookEventId))
  if (historicalCooking.length) blockers.push({ code: 'cooking-history-protected', message: 'Started or completed cooking is history and cannot be replaced by regeneration.', entityIds: historicalCooking })
  const affectedTasks = current.tasks.filter((task) => (task.mealRequirementId && mutableRequirementIds.has(task.mealRequirementId)) || (task.cookEventId && current.cookEvents.some(({ cookEventId, batchId }) => cookEventId === task.cookEventId && affectedBatchIds.has(batchId))))
  if (affectedTasks.some(({ state }) => state === 'done')) blockers.push({ code: 'completed-task-history-protected', message: 'Completed preparation tasks are history and cannot be removed by regeneration.', entityIds: affectedTasks.filter(({ state }) => state === 'done').map(({ taskId }) => taskId) })

  const changes = summarize(draft, current, request, existingProspective, lockedConflicts)
  if (warnings.length || blockers.length) return { status: 'blocked', blockers, warnings, changes, baseFingerprint, candidate: null }

  const removableAllocationIds = new Set(affectedAllocations.map(({ allocationId }) => allocationId))
  const removableBatchIds = new Set(affectedAllocations.flatMap((allocation) => allocation.source.kind === 'planned-batch' ? [allocation.source.batchId] : []))
  const removableEventIds = new Set(current.cookEvents.filter(({ batchId }) => removableBatchIds.has(batchId)).map(({ cookEventId }) => cookEventId))
  const lots = structuredClone(current.preparedFoodLots)
  const allocations = draft.allocations.map((allocation) => {
    if (allocation.source.kind !== 'prepared-lot') return allocation
    const preparedFoodLotId = allocation.source.preparedFoodLotId
    const index = lots.findIndex((lot) => lot.preparedFoodLotId === preparedFoodLotId)
    if (index < 0) throw new Error(`Prepared lot ${preparedFoodLotId} changed after generation`)
    const reserved = reservePreparedFood(lots[index], allocation, request.mealRequirements.find(({ mealRequirementId }) => mealRequirementId === allocation.mealRequirementId)!, lots[index].version)
    lots[index] = reserved.lot
    return reserved.allocation
  })
  const statuses = new Map(draft.meals.map((meal) => [meal.mealRequirementId, meal.status]))
  const generatedRequirements = request.mealRequirements.map((requirement) => ({ ...requirement, status: statuses.get(requirement.mealRequirementId) === 'planned' ? 'planned' as const : requirement.status }))
  const next = personalDataV3Schema.parse({
    ...current,
    mealRequirements: [...current.mealRequirements.filter(({ mealRequirementId }) => !mutableRequirementIds.has(mealRequirementId)), ...generatedRequirements],
    cookEvents: [...current.cookEvents.filter(({ cookEventId }) => !removableEventIds.has(cookEventId)), ...draft.cookEvents],
    batches: [...current.batches.filter(({ batchId }) => !removableBatchIds.has(batchId)), ...draft.batches],
    allocations: [...current.allocations.filter(({ allocationId }) => !removableAllocationIds.has(allocationId)), ...allocations],
    preparedFoodLots: lots,
    tasks: current.tasks.filter(({ taskId }) => !affectedTasks.some((task) => task.taskId === taskId)),
    legacyRecipeChoices: current.legacyRecipeChoices.filter(({ mealRequirementId }) => !mutableRequirementIds.has(mealRequirementId)),
  })
  const candidate = acceptedWeekPlanSchema.parse({
    schemaVersion: 1,
    acceptedAt: input.acceptedAt,
    sourceMode: 'real',
    request,
    draft,
    personalData: next,
    basePersonalDataFingerprint: baseFingerprint,
    groceryProvenance: { scope: 'outstanding', demand: draft.groceryDemand, batchIds: draft.batches.map(({ batchId }) => batchId) },
  })
  return { status: 'ready', blockers, warnings, changes, baseFingerprint, candidate }
}

function summarize(draft: WeekDraft, current: PersonalDataV3, request: PlanningRequest, existingProspective: PersonalDataV3['mealRequirements'], lockedConflicts: PersonalDataV3['mealRequirements']): AcceptanceReview['changes'] {
  return {
    meals: draft.meals.filter(({ status }) => status === 'planned').length,
    skipped: draft.meals.filter(({ status }) => status === 'skipped').length,
    cookEvents: draft.cookEvents.length,
    batches: draft.batches.length,
    allocations: draft.allocations.length,
    preparedLotReservations: draft.allocations.filter(({ source }) => source.kind === 'prepared-lot').length,
    existingMealsReplaced: existingProspective.length,
    existingLocksPreserved: existingProspective.filter(({ lock }) => lock.locked).length - lockedConflicts.length,
    existingMealsUntouched: current.mealRequirements.filter(({ date }) => !inHorizon(date, request)).length,
  }
}

export type LoadAcceptedWeekPlanResult = { envelope: AcceptedWeekPlanEnvelope | null; recovery: AcceptedWeekPlanEnvelope | null; error: string | null }

export function loadAcceptedWeekPlan(storage: AcceptanceStorage | null): LoadAcceptedWeekPlanResult {
  if (!storage) return { envelope: null, recovery: null, error: 'Browser storage is unavailable.' }
  try {
    const raw = storage.getItem(ACCEPTED_WEEK_PLAN_KEY)
    const pendingRaw = storage.getItem(ACCEPTED_WEEK_PLAN_PENDING_KEY)
    const envelope = raw ? acceptedWeekPlanEnvelopeSchema.safeParse(JSON.parse(raw)) : null
    const pending = pendingRaw ? acceptedWeekPlanEnvelopeSchema.safeParse(JSON.parse(pendingRaw)) : null
    if (envelope?.success && acceptedWeekPlanFingerprint(envelope.data.current) !== envelope.data.fingerprint) return { envelope: null, recovery: pending?.success ? pending.data : null, error: 'The saved accepted plan failed its integrity check.' }
    if (pending?.success && (!envelope?.success || pending.data.revision > envelope.data.revision)) return { envelope: envelope?.success ? envelope.data : null, recovery: pending.data, error: 'An interrupted accepted-plan write was recovered for explicit review.' }
    return { envelope: envelope?.success ? envelope.data : null, recovery: null, error: raw && !envelope?.success ? 'The saved accepted plan is malformed; no empty replacement was created.' : null }
  } catch { return { envelope: null, recovery: null, error: 'Accepted planning data could not be read safely.' } }
}

export function commitAcceptedWeekPlan(storage: AcceptanceStorage | null, candidate: AcceptedWeekPlan, options: { expectedFingerprint: string | null; activationEnabled: boolean }): { persisted: boolean; envelope: AcceptedWeekPlanEnvelope | null; error: string | null } {
  if (!options.activationEnabled || !GENERATED_PLAN_ACCEPTANCE_ENABLED) return { persisted: false, envelope: null, error: 'Generated-plan acceptance is disabled pending owner authorization.' }
  return persistAcceptedWeekPlanTransaction(storage, candidate, options.expectedFingerprint)
}

/** Storage primitive for tests and a future owner-authorized activation path. It is intentionally not called by the live UI. */
export function persistAcceptedWeekPlanTransaction(storage: AcceptanceStorage | null, candidate: AcceptedWeekPlan, expectedFingerprint: string | null): { persisted: boolean; envelope: AcceptedWeekPlanEnvelope | null; error: string | null } {
  if (!storage) return { persisted: false, envelope: null, error: 'Browser storage is unavailable.' }
  const parsed = acceptedWeekPlanSchema.safeParse(candidate)
  if (!parsed.success) return { persisted: false, envelope: null, error: 'The accepted-plan candidate is invalid.' }
  const loaded = loadAcceptedWeekPlan(storage)
  if (loaded.error || loaded.recovery) return { persisted: false, envelope: null, error: loaded.error ?? 'Resolve the interrupted write before saving.' }
  const currentFingerprint = loaded.envelope?.fingerprint ?? null
  if (currentFingerprint !== expectedFingerprint) return { persisted: false, envelope: null, error: 'The accepted plan changed in another tab. Reload and review the new version.' }
  try {
    const authoritativePersonalData = loaded.envelope?.current.personalData ?? (() => {
      const raw = storage.getItem('recipe-lab.personal.v3')
      return raw ? personalDataV3Schema.parse(JSON.parse(raw)) : null
    })()
    if (authoritativePersonalData && personalDataV3Fingerprint(authoritativePersonalData) !== parsed.data.basePersonalDataFingerprint) return { persisted: false, envelope: null, error: 'Personal planning data changed after review. Regenerate and review before saving.' }
  } catch { return { persisted: false, envelope: null, error: 'Current personal planning data is unreadable; saving was blocked.' } }
  const envelope = acceptedWeekPlanEnvelopeSchema.parse({ schemaVersion: 1, revision: (loaded.envelope?.revision ?? 0) + 1, fingerprint: acceptedWeekPlanFingerprint(parsed.data), current: parsed.data, previous: loaded.envelope?.current ?? null })
  const raw = JSON.stringify(envelope)
  try {
    storage.setItem(ACCEPTED_WEEK_PLAN_PENDING_KEY, raw)
    storage.setItem(ACCEPTED_WEEK_PLAN_KEY, raw)
    const verified = acceptedWeekPlanEnvelopeSchema.parse(JSON.parse(storage.getItem(ACCEPTED_WEEK_PLAN_KEY) ?? 'null'))
    if (verified.fingerprint !== envelope.fingerprint) throw new Error('verification failed')
    storage.removeItem(ACCEPTED_WEEK_PLAN_PENDING_KEY)
    return { persisted: true, envelope, error: null }
  } catch { return { persisted: false, envelope: null, error: 'The atomic save did not complete. The previous accepted plan remains authoritative; a recovery copy may be available.' } }
}

export function rollbackAcceptedWeekPlanTransaction(storage: AcceptanceStorage | null, expectedFingerprint: string, rolledBackAt: string): { persisted: boolean; envelope: AcceptedWeekPlanEnvelope | null; error: string | null } {
  const loaded = loadAcceptedWeekPlan(storage)
  if (loaded.error || loaded.recovery || !loaded.envelope) return { persisted: false, envelope: null, error: loaded.error ?? 'There is no accepted plan to roll back.' }
  if (loaded.envelope.fingerprint !== expectedFingerprint) return { persisted: false, envelope: null, error: 'The accepted plan changed in another tab. Reload before rolling back.' }
  if (!loaded.envelope.previous) return { persisted: false, envelope: null, error: 'No previous accepted plan snapshot is available.' }
  const candidate = acceptedWeekPlanSchema.parse({ ...loaded.envelope.previous, acceptedAt: rolledBackAt, basePersonalDataFingerprint: personalDataV3Fingerprint(loaded.envelope.current.personalData) })
  return persistAcceptedWeekPlanTransaction(storage, candidate, expectedFingerprint)
}

export const exportAcceptedWeekPlanBackup = (value: AcceptedWeekPlanEnvelope | AcceptedWeekPlan): string => JSON.stringify(value, null, 2)
