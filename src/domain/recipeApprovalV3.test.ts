import { describe, expect, it } from 'vitest'
import committedApprovalReadiness from '../../docs/data/G2B1_APPROVAL_READINESS.json'
import { pilotRecipes } from '../data/pilotCatalog'
import { recipeApprovalManifestV3 } from '../data/recipeApprovalManifestV3'
import { realRecipeReviewArtifacts, reviewedRealRecipes, reviewedRecipeCatalogV3 } from '../data/reviewedRecipeCatalogV3'
import { evaluateCandidateFeasibility, generatorCandidateSchema, planningRequestSchema } from './generatorV3'
import {
  applyRecipeApprovalBundle,
  applyRecipeApprovalManifest,
  approvalSubjectFingerprint,
  recipeApprovalBundleSchema,
  recipeApprovalRecordSchema,
  type ApprovalAuthority,
  type ApprovalDecision,
  type RecipeApprovalBundle,
} from './recipeApprovalV3'
import { buildRecipeApprovalReadinessReport, recipeApprovalReadinessReportSchema } from './recipeApprovalReadinessV3'

const baseRecipe = () => {
  const recipe = reviewedRealRecipes.find(({ identity }) => identity.slug === 'easy-vegetable-stir-fry')
  if (!recipe) throw new Error('Missing reviewed Easy Vegetable Stir Fry')
  return structuredClone(recipe)
}

type DecisionInput<T = ApprovalDecision> = T extends ApprovalDecision ? Omit<T, 'decisionId' | 'subjectFingerprint' | 'rationale' | 'evidenceIds'> : never

function record(recipe: ReturnType<typeof baseRecipe>, suffix: string, authority: ApprovalAuthority, decisions: DecisionInput[]) {
  const evidenceId = `evidence-approval-${suffix}`
  return recipeApprovalRecordSchema.parse({
    schemaVersion: 1,
    approvalId: `approval-${suffix}`,
    recordRevisionId: `approval-record-revision-${suffix}-v1`,
    supersedesRecordRevisionId: null,
    context: 'synthetic-test',
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    recordedAt: '2026-11-20T19:00:00.000Z',
    reviewer: {
      reviewerId: `reviewer-synthetic-${suffix}`,
      displayName: `Synthetic ${suffix} authority fixture`,
      authority,
      authorityBasis: 'Explicit synthetic authority used only by this regression fixture.',
      authorizationReference: `synthetic-fixture-${suffix}`,
    },
    evidence: [{
      evidenceId,
      kind: 'approval-record',
      sourceUrl: null,
      capturedAt: '2026-11-20T18:59:00.000Z',
      sourceLabel: `Synthetic ${suffix} authorization`,
      confidence: 'reviewed',
      reviewerNote: 'Synthetic-only evidence; not a production or human approval.',
    }],
    decisions: decisions.map((decision, index) => ({
      ...decision,
      decisionId: `approval-decision-${suffix}-${index + 1}`,
      subjectFingerprint: approvalSubjectFingerprint(recipe, decision.subject),
      rationale: 'Synthetic authorization exercises the immutable approval path without asserting a real decision.',
      evidenceIds: [evidenceId],
    })),
  })
}

function fullyAuthorizedBundle(recipe: ReturnType<typeof baseRecipe>): RecipeApprovalBundle {
  return recipeApprovalBundleSchema.parse({
    schemaVersion: 1,
    bundleId: 'approval-bundle-vegetable-stir-fry-synthetic',
    recipeId: recipe.identity.recipeId,
    baseRevisionId: recipe.identity.revisionId,
    resultRevisionId: 'revision-10000000-0000-4000-8000-000000000016-g2b1-synthetic-1',
    records: [
      record(recipe, 'vegetable-stir-fry-source', 'source-facts', [{ kind: 'recommendation-decision', subject: 'ingredient-normalization', outcome: 'approved' }]),
      record(recipe, 'vegetable-stir-fry-owner', 'owner-editorial', [
        { kind: 'recommendation-decision', subject: 'meal-portions', outcome: 'approved' },
        { kind: 'recommendation-decision', subject: 'effort', outcome: 'approved' },
      ]),
      record(recipe, 'vegetable-stir-fry-rights', 'factual-metadata-rights', [{ kind: 'metadata-rights', subject: 'factual-metadata-use', outcome: 'approved', scope: 'factual-metadata-only' }]),
    ],
  })
}

function requestFor(recipe: ReturnType<typeof baseRecipe>) {
  return planningRequestSchema.parse({
    requestId: 'planning-request-g2b1-synthetic', horizon: { start: '2026-11-23', end: '2026-11-24' },
    mealRequirements: [
      { mealRequirementId: 'meal-requirement-g2b1-dinner', date: '2026-11-23', intendedAt: '2026-11-24T03:00:00.000Z', timeZone: 'America/Los_Angeles', meal: 'dinner', requestedPortions: 2, status: 'unplanned', constraints: { maxActiveMinutes: 30, maxElapsedMinutes: 60, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: false }, lock: { locked: false, reason: null } },
      { mealRequirementId: 'meal-requirement-g2b1-lunch', date: '2026-11-24', intendedAt: '2026-11-24T20:00:00.000Z', timeZone: 'America/Los_Angeles', meal: 'lunch', requestedPortions: 2, status: 'unplanned', constraints: { maxActiveMinutes: null, maxElapsedMinutes: null, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: false }, lock: { locked: false, reason: null } },
    ],
    recipeSnapshot: [recipe], pantry: [], preparedLots: [], recentMeals: [],
    cookingWindows: [{ cookingWindowId: 'cooking-window-g2b1', start: '2026-11-24T02:00:00.000Z', end: '2026-11-24T03:00:00.000Z', maxActiveMinutes: 30 }],
    serviceAssessments: [], hardConstraints: { avoidedRecipeIds: [], avoidedIngredientIds: [] }, preferences: { preferredRecipeIds: [], householdRecipePreferences: [] }, lockedChoices: [],
    officeLunchPolicy: { enabled: false, maxAssembly: 'any', requireReheatingSuitable: false, allowIntrusiveOdors: true, allowRiceBased: true },
  })
}

describe('G2B1 recipe approval records', () => {
  it('creates a new immutable recommendation-ready revision only from complete synthetic authorizations', () => {
    const base = baseRecipe()
    const before = JSON.stringify(base)
    const result = applyRecipeApprovalBundle(base, fullyAuthorizedBundle(base))

    expect(JSON.stringify(base)).toBe(before)
    expect(result.history.map(({ identity }) => identity.revisionId)).toEqual([base.identity.revisionId, result.recipe.identity.revisionId])
    expect(result.recipe.identity.revisionId).not.toBe(base.identity.revisionId)
    expect(result.recipe.source.evidence).toEqual(expect.arrayContaining(base.source.evidence))
    expect(result.recipe.review.readiness.recommendationReady).toBe(true)
    expect(result.recipe.review.recommendationDecisions).toEqual({ ingredientNormalization: 'approved', outputScaling: 'approved', mealPortions: 'approved', effort: 'approved' })
    expect(result.records.every(({ context }) => context === 'synthetic-test')).toBe(true)
  })

  it('keeps a rights-only revision blocked by incomplete editorial approvals', () => {
    const base = baseRecipe()
    const rightsOnly = structuredClone(fullyAuthorizedBundle(base))
    rightsOnly.bundleId = 'approval-bundle-rights-only'
    rightsOnly.resultRevisionId = 'revision-10000000-0000-4000-8000-000000000016-g2b1-rights-only'
    rightsOnly.records = rightsOnly.records.filter(({ reviewer }) => reviewer.authority === 'factual-metadata-rights')
    const { recipe } = applyRecipeApprovalBundle(base, rightsOnly)
    expect(recipe.source.rights.factualMetadataUse).toBe('approved')
    expect(recipe.review.readiness.recommendationReady).toBe(false)
    expect(recipe.review.readiness.blockers).toEqual(expect.arrayContaining(['ingredient-normalization-approval-required', 'meal-portion-approval-required', 'effort-approval-required']))
  })

  it('rejects generic authority, stale revisions, mismatched fingerprints, and conflicting decisions', () => {
    const base = baseRecipe()
    const bundle = fullyAuthorizedBundle(base)
    const generic = structuredClone(bundle.records[0])
    generic.context = 'production'
    generic.reviewer.reviewerId = 'reviewer-production-owner'
    generic.reviewer.displayName = 'Reviewer'
    expect(recipeApprovalRecordSchema.safeParse(generic).success).toBe(false)

    const wrongAuthority = structuredClone(bundle.records.find(({ reviewer }) => reviewer.authority === 'owner-editorial')!)
    wrongAuthority.reviewer.authority = 'factual-metadata-rights'
    expect(recipeApprovalRecordSchema.safeParse(wrongAuthority).success).toBe(false)

    const stale = structuredClone(bundle)
    stale.baseRevisionId = 'revision-stale-review'
    stale.records.forEach((item) => { item.recipeRevisionId = stale.baseRevisionId })
    expect(() => applyRecipeApprovalBundle(base, stale)).toThrow('stale')

    const mismatched = structuredClone(bundle)
    mismatched.records[0].decisions[0].subjectFingerprint = '{"different":true}'
    expect(() => applyRecipeApprovalBundle(base, mismatched)).toThrow('does not match')

    const conflicting = structuredClone(bundle)
    conflicting.records.push(structuredClone(conflicting.records[0]))
    conflicting.records[3].approvalId = 'approval-conflicting'
    conflicting.records[3].recordRevisionId = 'approval-record-revision-conflicting-v1'
    expect(recipeApprovalBundleSchema.safeParse(conflicting).success).toBe(false)

    const invalidChain = structuredClone(bundle)
    invalidChain.records[0].supersedesRecordRevisionId = 'approval-record-revision-missing-v0'
    expect(() => applyRecipeApprovalManifest([base], { schemaVersion: 1, bundles: [invalidChain] })).toThrow('invalid version chain')
  })

  it('does not approve shopping completeness while ingredient branches remain unresolved', () => {
    const recipe = reviewedRealRecipes.find(({ identity }) => identity.slug === 'sheet-pan-chicken-fajitas')
    if (!recipe) throw new Error('Missing reviewed Sheet Pan Chicken Fajitas')
    const sourceRecord = record(recipe, 'branched-ingredient-source', 'source-facts', [{ kind: 'recommendation-decision', subject: 'ingredient-normalization', outcome: 'approved' }])
    const bundle = recipeApprovalBundleSchema.parse({
      schemaVersion: 1,
      bundleId: 'approval-bundle-branched-ingredients',
      recipeId: recipe.identity.recipeId,
      baseRevisionId: recipe.identity.revisionId,
      resultRevisionId: 'revision-10000000-0000-4000-8000-000000000001-g2b1-branch-check',
      records: [sourceRecord],
    })
    expect(() => applyRecipeApprovalBundle(recipe, bundle)).toThrow('grocery branches')
  })

  it('allows fresh G1 eligibility but keeps unsupported stored service blocked', () => {
    const base = baseRecipe()
    const approved = applyRecipeApprovalBundle(base, fullyAuthorizedBundle(base)).recipe
    const request = requestFor(approved)
    const fresh = generatorCandidateSchema.parse({
      candidateId: 'candidate-g2b1-fresh', recipeId: approved.identity.recipeId, recipeRevisionId: approved.identity.revisionId,
      strategy: 'meal-time-cook', cookingStartsAt: '2026-11-24T02:05:00.000Z', batchMultiplier: 1, sourceYieldSelection: null,
      allocations: [{ mealRequirementId: 'meal-requirement-g2b1-dinner', mealPortions: 2, service: 'fresh' }], originMealRequirementId: null,
      ingredientSelections: [], serviceAssessmentId: null, serviceAssessmentRevisionId: null,
    })
    expect(evaluateCandidateFeasibility(request, fresh).status).toBe('eligible')

    const stored = generatorCandidateSchema.parse({
      ...fresh,
      candidateId: 'candidate-g2b1-stored',
      strategy: 'prior-meal-batch',
      originMealRequirementId: 'meal-requirement-g2b1-dinner',
      allocations: [
        { mealRequirementId: 'meal-requirement-g2b1-dinner', mealPortions: 2, service: 'fresh' },
        { mealRequirementId: 'meal-requirement-g2b1-lunch', mealPortions: 2, service: 'refrigerated-leftover' },
      ],
    })
    const result = evaluateCandidateFeasibility(request, stored)
    expect(result.status).toBe('review-needed')
    expect(result.reasons.map(({ code }) => code)).toEqual(expect.arrayContaining(['leftover-quality-not-approved', 'storage-evidence-missing']))
  })

  it('keeps production manifest empty and v2 catalog untouched', () => {
    const beforeV2 = JSON.stringify(pilotRecipes)
    const result = applyRecipeApprovalManifest(reviewedRealRecipes, recipeApprovalManifestV3)
    expect(result.activeRecipes).toEqual(reviewedRealRecipes)
    expect(result.activeRecipes.filter(({ review }) => review.readiness.recommendationReady)).toHaveLength(0)
    expect(JSON.stringify(pilotRecipes)).toBe(beforeV2)
    expect(recipeApprovalManifestV3.bundles).toEqual([])
  })

  it('reproduces a production-only report that distinguishes pending decisions from passed gates', () => {
    const report = buildRecipeApprovalReadinessReport(reviewedRecipeCatalogV3, realRecipeReviewArtifacts, recipeApprovalManifestV3)
    expect(recipeApprovalReadinessReportSchema.parse(committedApprovalReadiness)).toEqual(report)
    expect(report).toMatchObject({ reviewedRecipeCount: 7, productionApprovalRecordCount: 0, recommendationReadyCount: 0, awaitingDecisionCount: 7 })
    expect(report.entries.every(({ approvalState, recommendationReadyForFreshUse }) => approvalState === 'awaiting-decisions' && !recommendationReadyForFreshUse)).toBe(true)
    expect(report.entries.every(({ storedUseReadiness }) => !storedUseReadiness.refrigeratedLeftovers && !storedUseReadiness.refrigeratedPrepAhead && !storedUseReadiness.frozenUse)).toBe(true)

    const base = baseRecipe()
    expect(() => buildRecipeApprovalReadinessReport(reviewedRecipeCatalogV3, realRecipeReviewArtifacts, { schemaVersion: 1, bundles: [fullyAuthorizedBundle(base)] })).toThrow('cannot count synthetic')
  })
})
