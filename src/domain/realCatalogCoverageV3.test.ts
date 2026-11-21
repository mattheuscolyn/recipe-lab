import { beforeAll, describe, expect, it } from 'vitest'
import committedCoverageReport from '../../docs/data/G2B2A_REAL_CATALOG_COVERAGE.json'
import { recipeApprovalManifestV3 } from '../data/recipeApprovalManifestV3'
import { realRecipeReviewArtifacts, reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments } from '../data/reviewedRecipeCatalogV3'
import { generatorFixtureRecipes } from './generatorV3Fixtures'
import { buildRealCatalogCoverageReport, buildRealCatalogCoverageScenarios, realCatalogCoverageReportSchema } from './realCatalogCoverageV3'
import { recipeReviewArtifactSchema } from './recipeReviewV3'
import { computeRecipeV3Readiness, recipeV3Schema } from './recipeV3'

const build = () => buildRealCatalogCoverageReport({
  baseRecipes: reviewedRecipeCatalogV3,
  reviewArtifacts: realRecipeReviewArtifacts,
  serviceAssessments: reviewedRecipeServiceAssessments,
  productionManifest: recipeApprovalManifestV3,
})

let report: ReturnType<typeof build>
beforeAll(() => { report = build() }, 15_000)

function syntheticReviewedFixture(kind: 'dinner' | 'quick-breakfast' | 'overnight-breakfast') {
  const role = kind === 'dinner' ? 'dinner' : 'breakfast'
  const suffix = kind === 'dinner' ? 'positive-coverage-dinner' : kind
  const recipe = structuredClone(kind === 'dinner' ? generatorFixtureRecipes.dinner : generatorFixtureRecipes.breakfast)
  recipe.identity = {
    ...recipe.identity,
    recipeId: kind === 'dinner' ? '20000000-0000-4000-8000-000000000003' : kind === 'quick-breakfast' ? '20000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
    revisionId: `revision-synthetic-${suffix}-v1`,
    slug: `synthetic-${suffix}`,
    title: `Synthetic ${kind.replace('-', ' ')}`,
  }
  recipe.requirements = recipe.requirements.filter(({ optional }) => !optional).map((requirement) => ({
    ...requirement,
    alternatives: [],
    confidence: 'reviewed' as const,
    reviewNote: null,
  }))
  if (kind === 'overnight-breakfast') {
    const evidenceIds = recipe.effort.totalMinutes.evidenceIds
    recipe.effort.totalMinutes = { value: 485, evidenceIds, confidence: 'reviewed', unknownReason: null }
    recipe.effort.activeMinutes = { value: 5, evidenceIds, confidence: 'reviewed', unknownReason: null }
    recipe.effort.passiveMinutes = { value: 480, evidenceIds, confidence: 'reviewed', unknownReason: null }
    recipe.suitability.storageModes = [{ mode: 'refrigerated', maxDurationHours: 4, evidenceIds, confidence: 'reviewed' }]
  }
  recipe.review.readiness = computeRecipeV3Readiness(recipe)
  const parsedRecipe = recipeV3Schema.parse(recipe)
  const evidenceId = parsedRecipe.source.evidence[0].evidenceId
  const artifact = recipeReviewArtifactSchema.parse({
    reviewId: `recipe-review-synthetic-${suffix}`,
    recipeId: parsedRecipe.identity.recipeId,
    baseRevisionId: `revision-synthetic-${suffix}-v0`,
    revisionId: parsedRecipe.identity.revisionId,
    reviewedAt: '2026-11-20T20:00:00.000Z',
    reviewer: 'Synthetic coverage regression fixture',
    sourceAccess: 'source-unavailable',
    checklist: {
      identityAndAttribution: true,
      yieldAndServingBasis: true,
      times: true,
      ingredientsAndAmbiguities: true,
      preparationAndStorageClaims: true,
      publisherNutrition: true,
      rightsDecision: true,
    },
    evidence: [parsedRecipe.source.evidence[0]],
    editorialDecisions: [
      { decisionId: `decision-${suffix}-ingredients`, subject: 'ingredient-normalization', status: 'approved', rationale: 'Synthetic-only ingredient approval for coverage regression.', evidenceIds: [evidenceId] },
      { decisionId: `decision-${suffix}-scaling`, subject: 'scaling', status: 'approved', rationale: 'Synthetic-only scaling approval for coverage regression.', evidenceIds: [evidenceId] },
      { decisionId: `decision-${suffix}-portions`, subject: 'meal-portions', status: 'approved', rationale: 'Synthetic-only portion approval for coverage regression.', evidenceIds: [evidenceId] },
      { decisionId: `decision-${suffix}-effort`, subject: 'effort', status: 'approved', rationale: 'Synthetic-only effort approval for coverage regression.', evidenceIds: [evidenceId] },
    ],
    unresolvedIssues: [],
    reviewedRecipe: parsedRecipe,
    serviceAssessments: [],
  })
  return { recipe: parsedRecipe, artifact, role }
}

describe('G2B2a real-catalog weekly coverage', () => {
  it('keeps source review, production readiness, and meal-route eligibility distinct', () => {
    expect(recipeApprovalManifestV3.bundles).toEqual([])
    expect(report.catalog).toEqual({
      recipeCount: 25,
      sourceReviewedRecipeCount: 7,
      productionApprovalBundleCount: 0,
      productionRecommendationReadyCount: 0,
      recipesWithEligibleRoutes: 0,
    })
    expect(report.scenarios.every(({ complete, coveredSlotCount }) => !complete && coveredSlotCount === 0)).toBe(true)
    expect(report.scenarios.flatMap(({ routes }) => routes).some(({ sourceReviewed, recommendationReady }) => sourceReviewed && !recommendationReady)).toBe(true)
    expect(report.scenarios.every(({ evaluatedRouteCount, routes }) => evaluatedRouteCount > routes.length)).toBe(true)
  })

  it('reports every required slot as a gap and never mistakes skipped meals for coverage', () => {
    for (const scenario of report.scenarios) {
      expect(scenario.slots.filter(({ skipped }) => !skipped).every(({ coverage }) => coverage === 'uncovered')).toBe(true)
      expect(scenario.slots.filter(({ skipped }) => skipped).every(({ coverage, requestedPortions }) => coverage === 'skipped' && requestedPortions === 0)).toBe(true)
      expect(scenario.requiredSlotCount + scenario.skippedSlotCount).toBe(21)
    }
  })

  it('runs real G1 feasibility and exposes incomplete review and stored-office blockers', () => {
    const routes = report.scenarios.flatMap(({ routes }) => routes)
    expect(routes.some(({ reasonCodes }) => reasonCodes.includes('recommendation-readiness-required'))).toBe(true)
    expect(routes.filter(({ servicePattern }) => servicePattern !== 'fresh').some(({ reasonCodes }) => reasonCodes.includes('storage-evidence-missing') || reasonCodes.includes('office-suitability-review-required'))).toBe(true)
    expect(routes.every(({ status }) => status !== 'eligible')).toBe(true)
    expect(routes.some(({ groceryDemand }) => groceryDemand.knownLineCount > 0 && groceryDemand.status === 'review-needed')).toBe(true)
  })

  it('uses Pacific morning windows for fresh breakfast and separate evidence-gated advance prep', () => {
    const ordinary = buildRealCatalogCoverageScenarios(reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments)[0]
    const freshWindow = ordinary.request.cookingWindows.find(({ cookingWindowId }) => cookingWindowId === 'cooking-window-2026-11-23-breakfast')!
    const advanceWindow = ordinary.request.cookingWindows.find(({ cookingWindowId }) => cookingWindowId === 'cooking-window-2026-11-23-advance-breakfast')!
    expect(freshWindow).toMatchObject({ start: '2026-11-23T14:30:00.000Z', end: '2026-11-23T16:00:00.000Z' })
    expect(advanceWindow).toMatchObject({ start: '2026-11-23T05:00:00.000Z', end: '2026-11-23T14:00:00.000Z' })
    const localTime = (instant: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
    expect([localTime(freshWindow.start), localTime(freshWindow.end)]).toEqual(['06:30', '08:00'])
    expect([localTime(advanceWindow.start), localTime(advanceWindow.end)]).toEqual(['21:00', '06:00'])

    const routes = report.scenarios[0].routes.filter(({ mealRequirementIds }) => mealRequirementIds.includes('meal-requirement-2026-11-23-breakfast'))
    const oats = routes.filter(({ recipeSlug }) => recipeSlug === 'overnight-oats-base-recipe')
    expect(oats).toHaveLength(1)
    expect(oats[0]).toMatchObject({ servicePattern: 'advance-breakfast-prep', cookingStartsAt: '2026-11-23T05:00:00.000Z', cookingWindowId: 'cooking-window-2026-11-23-advance-breakfast', status: 'review-needed' })
    expect(oats[0].reasonCodes).toContain('storage-evidence-missing')
    expect(routes).toContainEqual(expect.objectContaining({ recipeSlug: 'southwest-tofu-scramble', servicePattern: 'fresh', cookingStartsAt: '2026-11-23T15:45:00.000Z', cookingWindowId: 'cooking-window-2026-11-23-breakfast' }))
  })

  it('counts isolated synthetic eligible routes and uses conservative overnight storage timing', () => {
    const synthetic = syntheticReviewedFixture('dinner')
    const quickBreakfast = syntheticReviewedFixture('quick-breakfast')
    const overnightBreakfast = syntheticReviewedFixture('overnight-breakfast')
    const positive = buildRealCatalogCoverageReport({
      baseRecipes: [...reviewedRecipeCatalogV3, synthetic.recipe, quickBreakfast.recipe, overnightBreakfast.recipe],
      reviewArtifacts: [...realRecipeReviewArtifacts, synthetic.artifact, quickBreakfast.artifact, overnightBreakfast.artifact],
      serviceAssessments: reviewedRecipeServiceAssessments,
      productionManifest: recipeApprovalManifestV3,
    })
    const ordinary = positive.scenarios.find(({ scenarioId }) => scenarioId === 'scenario-ordinary-week')!
    const constrained = positive.scenarios.find(({ scenarioId }) => scenarioId === 'scenario-constrained-week')!
    const mondayDinner = ordinary.slots.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2026-11-23-dinner')!
    const mondayBreakfast = ordinary.slots.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2026-11-23-breakfast')!
    const lockedDinner = constrained.slots.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2026-11-25-dinner')!
    const syntheticRoutes = positive.scenarios.flatMap(({ routes }) => routes.filter(({ recipeId }) => recipeId === synthetic.recipe.identity.recipeId))
    const quickRoute = ordinary.routes.find(({ recipeId, servicePattern }) => recipeId === quickBreakfast.recipe.identity.recipeId && servicePattern === 'fresh')!
    const overnightRoute = ordinary.routes.find(({ recipeId, servicePattern }) => recipeId === overnightBreakfast.recipe.identity.recipeId && servicePattern === 'advance-breakfast-prep')!

    expect(recipeApprovalManifestV3.bundles).toEqual([])
    expect(positive.catalog).toMatchObject({ productionApprovalBundleCount: 0, productionRecommendationReadyCount: 3, recipesWithEligibleRoutes: 2 })
    expect(ordinary.eligibleRouteCount).toBeGreaterThan(0)
    expect(ordinary.coveredSlotCount).toBe(14)
    expect(mondayDinner.coverage).toBe('eligible')
    expect(mondayBreakfast.coverage).toBe('eligible')
    expect(mondayDinner.eligibleRouteIds).toContain('route-ordinary-week-2026-11-23-dinner-synthetic-positive-coverage-dinner')
    expect(quickRoute).toMatchObject({ status: 'eligible', cookingStartsAt: '2026-11-23T15:20:00.000Z', storageStartsAt: null })
    expect(overnightRoute).toMatchObject({
      cookingStartsAt: '2026-11-23T05:00:00.000Z',
      storageStartsAt: '2026-11-23T05:00:00.000Z',
      expectedReadyAt: '2026-11-23T13:05:00.000Z',
      status: 'rejected',
    })
    expect(overnightRoute.reasonCodes).toContain('storage-window-exceeded')
    expect(lockedDinner.coverage).toBe('uncovered')
    expect(syntheticRoutes.filter(({ servicePattern }) => servicePattern !== 'fresh').every(({ status }) => status !== 'eligible')).toBe(true)
  }, 20_000)

  it('preserves unknown household preference state and real lock constraints', () => {
    expect(report.preferenceHandling).toBe('unknown-unless-explicitly-provided')
    const constrained = report.scenarios.find(({ scenarioId }) => scenarioId === 'scenario-constrained-week')!
    const locked = constrained.slots.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2026-11-25-dinner')!
    expect(locked.locked).toBe(true)
    expect(locked.blockerScope).toBe('whole-routes-touching-slot')
    expect(locked.blockers.some(({ code }) => code === 'locked-choice-mismatch')).toBe(true)
  })

  it('quantifies the minimum role-review gap without counting vegetable stir fry as an adequate dinner', () => {
    expect(report.roleTargets).toMatchObject({
      breakfast: { target: 3, sourceReviewed: 3, minimumAdditionalSourceReviews: 0 },
      lunch: { target: 3, sourceReviewed: 1, minimumAdditionalSourceReviews: 2 },
      dinner: { target: 6, sourceReviewed: 3, utilityCredible: 2, minimumAdditionalSourceReviews: 4 },
    })
  })

  it('is deterministic and reproduces the committed machine-readable report', () => {
    const second = build()
    expect(JSON.stringify(second)).toBe(JSON.stringify(report))
    expect(realCatalogCoverageReportSchema.parse(committedCoverageReport)).toEqual(report)
  }, 15_000)
})
