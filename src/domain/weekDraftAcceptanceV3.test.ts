import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalIngredients } from '../data/pilotCatalog'
import { g3aCompleteWeekRequest } from './g3aWeekFixtures'
import { personalDataV3Schema, type PersonalDataV3 } from './personalDataV3'
import { generateWeekDraft, type WeekDraft } from './weekGeneratorV3'
import {
  ACCEPTED_WEEK_PLAN_KEY,
  ACCEPTED_WEEK_PLAN_PENDING_KEY,
  commitAcceptedWeekPlan,
  loadAcceptedWeekPlan,
  personalDataV3Fingerprint,
  persistAcceptedWeekPlanTransaction,
  reviewWeekDraftAcceptance,
  rollbackAcceptedWeekPlanTransaction,
} from './weekDraftAcceptanceV3'

class MemoryStorage {
  values = new Map<string, string>()
  failKey: string | null = null
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (key === this.failKey) throw new Error('quota'); this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const emptyPersonalData = (): PersonalDataV3 => personalDataV3Schema.parse({
  schemaVersion: 3,
  preferences: {},
  plan: [],
  checkedGroceries: {},
  pantry: [],
  mealRequirements: [],
  cookEvents: [],
  batches: [],
  allocations: [],
  preparedFoodLots: [],
  tasks: [],
  legacyRecipeChoices: [],
  migrationRecovery: null,
})

let draft: WeekDraft
beforeAll(() => {
  draft = generateWeekDraft({ request: g3aCompleteWeekRequest, ingredients: canonicalIngredients, options: { maxSearchNodes: 20_000, maxOptionsPerRequirement: 10, maxRoutes: 2_000, maxStoredMealsPerBatch: 3 } })
}, 30_000)

function resolvedDraft(): WeekDraft {
  const value = structuredClone(draft)
  value.groceryDemand.uncertainties = []
  value.groceryDemand.lines = value.groceryDemand.lines.map((line) => ({ ...line, total: line.knownSubtotal, unresolved: false, uncertainties: [], pantry: { ...line.pantry, toBuy: line.pantry.knownToBuy } }))
  value.shoppingReadiness = { status: 'ready', unresolvedLineCount: 0, uncertaintyCount: 0, pricesAvailable: false }
  return value
}

function authorizedTestRequest() {
  const request = structuredClone(g3aCompleteWeekRequest)
  request.recipeSnapshot = request.recipeSnapshot.map((recipe) => ({ ...recipe, source: { ...recipe.source, publisher: 'Authorized test publisher', canonicalUrl: `https://recipes.test/${recipe.identity.slug}` } }))
  return request
}

describe('generated week acceptance foundation', () => {
  it('rejects demo mode and synthetic recipe snapshots regardless of readiness', () => {
    const demo = reviewWeekDraftAcceptance({ mode: 'demo', request: g3aCompleteWeekRequest, draft, current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' })
    expect(demo.status).toBe('blocked')
    expect(demo.blockers.map(({ code }) => code)).toEqual(expect.arrayContaining(['synthetic-demo-not-acceptable', 'synthetic-recipe-not-acceptable']))
    const mislabeled = reviewWeekDraftAcceptance({ mode: 'real', request: g3aCompleteWeekRequest, draft, current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' })
    expect(mislabeled.blockers.map(({ code }) => code)).toContain('synthetic-recipe-not-acceptable')
  })

  it('builds a deterministic, exact-revision proposal without claiming food was cooked', () => {
    const request = authorizedTestRequest()
    const readyDraft = resolvedDraft()
    const first = reviewWeekDraftAcceptance({ mode: 'real', request, draft: readyDraft, current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' })
    const second = reviewWeekDraftAcceptance({ mode: 'real', request, draft: readyDraft, current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' })
    expect(first.status).toBe('ready')
    expect(first.candidate).toEqual(second.candidate)
    expect(first.candidate?.personalData.cookEvents.every(({ state, completedAt }) => state === 'planned' && completedAt === null)).toBe(true)
    expect(first.candidate?.personalData.batches.every(({ state, actualOutput }) => state === 'planned' && actualOutput === null)).toBe(true)
    expect(first.candidate?.groceryProvenance.batchIds).toEqual(draft.batches.map(({ batchId }) => batchId))
    expect(first.candidate?.request.recipeSnapshot.map(({ identity }) => identity.revisionId)).toEqual(request.recipeSnapshot.map(({ identity }) => identity.revisionId))
  })

  it('protects locked existing meals and served history', () => {
    const request = authorizedTestRequest()
    const locked = emptyPersonalData()
    locked.mealRequirements = [{ ...request.mealRequirements[0], requestedPortions: 7, lock: { locked: true, reason: 'Manual choice' } }]
    const lockedReview = reviewWeekDraftAcceptance({ mode: 'real', request, draft, current: locked, acceptedAt: '2027-01-20T12:00:00.000Z', confirmReplaceProspective: true })
    expect(lockedReview.blockers.map(({ code }) => code)).toContain('locked-meal-conflict')
    const served = emptyPersonalData()
    const allocation = structuredClone(draft.allocations[0])
    allocation.state = 'served'
    served.mealRequirements = [{ ...request.mealRequirements.find(({ mealRequirementId }) => mealRequirementId === allocation.mealRequirementId)!, status: 'planned' }]
    served.batches = draft.batches.filter(({ batchId }) => allocation.source.kind === 'planned-batch' && batchId === allocation.source.batchId).map((batch) => ({ ...batch, state: 'prepared' as const, actualOutput: batch.plannedOutput }))
    served.cookEvents = draft.cookEvents.filter(({ batchId }) => served.batches.some((batch) => batch.batchId === batchId)).map((event) => ({ ...event, state: 'completed' as const, completedAt: event.intendedAt }))
    served.allocations = [allocation]
    const servedReview = reviewWeekDraftAcceptance({ mode: 'real', request, draft, current: personalDataV3Schema.parse(served), acceptedAt: '2027-01-20T12:00:00.000Z', confirmReplaceProspective: true })
    expect(servedReview.blockers.map(({ code }) => code)).toContain('served-history-protected')
  })

  it('requires explicit replacement confirmation for prospective edits', () => {
    const request = authorizedTestRequest()
    const current = emptyPersonalData()
    current.mealRequirements = [request.mealRequirements[0]]
    const review = reviewWeekDraftAcceptance({ mode: 'real', request, draft, current, acceptedAt: '2027-01-20T12:00:00.000Z' })
    expect(review.status).toBe('blocked')
    expect(review.warnings.map(({ code }) => code)).toContain('existing-prospective-plan')
  })

  it('can regenerate a previously accepted prospective week after confirmation', () => {
    const request = authorizedTestRequest()
    const readyDraft = resolvedDraft()
    const first = reviewWeekDraftAcceptance({ mode: 'real', request, draft: readyDraft, current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' }).candidate!
    expect(() => reviewWeekDraftAcceptance({ mode: 'real', request, draft: readyDraft, current: first.personalData, acceptedAt: '2027-01-20T12:01:00.000Z', confirmReplaceProspective: true })).not.toThrow()
  })

  it('uses optimistic concurrency and keeps a previous version for rollback', () => {
    const request = authorizedTestRequest()
    const candidate = reviewWeekDraftAcceptance({ mode: 'real', request, draft: resolvedDraft(), current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' }).candidate!
    const storage = new MemoryStorage()
    const first = persistAcceptedWeekPlanTransaction(storage, candidate, null)
    expect(first.persisted).toBe(true)
    expect(storage.getItem(ACCEPTED_WEEK_PLAN_PENDING_KEY)).toBeNull()
    expect(persistAcceptedWeekPlanTransaction(storage, candidate, null)).toMatchObject({ persisted: false, error: expect.stringContaining('another tab') })
    const secondCandidate = { ...candidate, acceptedAt: '2027-01-20T12:01:00.000Z', basePersonalDataFingerprint: personalDataV3Fingerprint(candidate.personalData) }
    const second = persistAcceptedWeekPlanTransaction(storage, secondCandidate, first.envelope!.fingerprint)
    expect(second.envelope).toMatchObject({ revision: 2, previous: candidate })
    const rollback = rollbackAcceptedWeekPlanTransaction(storage, second.envelope!.fingerprint, '2027-01-20T12:02:00.000Z')
    expect(rollback).toMatchObject({ persisted: true, envelope: { revision: 3, current: { personalData: candidate.personalData }, previous: secondCandidate } })
  })

  it('recovers interrupted writes and never replaces malformed data with empty state', () => {
    const request = authorizedTestRequest()
    const candidate = reviewWeekDraftAcceptance({ mode: 'real', request, draft: resolvedDraft(), current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' }).candidate!
    const storage = new MemoryStorage()
    storage.failKey = ACCEPTED_WEEK_PLAN_KEY
    expect(persistAcceptedWeekPlanTransaction(storage, candidate, null).persisted).toBe(false)
    const interrupted = loadAcceptedWeekPlan(storage)
    expect(interrupted.recovery?.current).toEqual(candidate)
    expect(interrupted.error).toContain('interrupted')
    const malformed = new MemoryStorage()
    malformed.setItem(ACCEPTED_WEEK_PLAN_KEY, '{bad json')
    expect(loadAcceptedWeekPlan(malformed)).toEqual({ envelope: null, recovery: null, error: expect.stringContaining('could not be read safely') })
  })

  it('keeps the owner activation gate disabled even when a caller requests activation', () => {
    const request = authorizedTestRequest()
    const candidate = reviewWeekDraftAcceptance({ mode: 'real', request, draft: resolvedDraft(), current: emptyPersonalData(), acceptedAt: '2027-01-20T12:00:00.000Z' }).candidate!
    const storage = new MemoryStorage()
    expect(commitAcceptedWeekPlan(storage, candidate, { expectedFingerprint: null, activationEnabled: true })).toMatchObject({ persisted: false, error: expect.stringContaining('disabled') })
    expect(storage.values.size).toBe(0)
  })
})
