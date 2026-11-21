import { beforeAll, describe, expect, it } from 'vitest'
import committedCoverageReport from '../../docs/data/G2B2A_REAL_CATALOG_COVERAGE.json'
import { recipeApprovalManifestV3 } from '../data/recipeApprovalManifestV3'
import { realRecipeReviewArtifacts, reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments } from '../data/reviewedRecipeCatalogV3'
import { buildRealCatalogCoverageReport, realCatalogCoverageReportSchema } from './realCatalogCoverageV3'

const build = () => buildRealCatalogCoverageReport({
  baseRecipes: reviewedRecipeCatalogV3,
  reviewArtifacts: realRecipeReviewArtifacts,
  serviceAssessments: reviewedRecipeServiceAssessments,
  productionManifest: recipeApprovalManifestV3,
})

let report: ReturnType<typeof build>
beforeAll(() => { report = build() }, 15_000)

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

  it('preserves unknown household preference state and real lock constraints', () => {
    expect(report.preferenceHandling).toBe('unknown-unless-explicitly-provided')
    const constrained = report.scenarios.find(({ scenarioId }) => scenarioId === 'scenario-constrained-week')!
    const locked = constrained.slots.find(({ mealRequirementId }) => mealRequirementId === 'meal-requirement-2026-11-25-dinner')!
    expect(locked.locked).toBe(true)
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
