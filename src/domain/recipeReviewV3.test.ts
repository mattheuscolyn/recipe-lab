import { describe, expect, it } from 'vitest'
import committedReadinessReport from '../../docs/data/G2A_RECIPE_READINESS.json'
import { canonicalIngredients, pilotRecipes } from '../data/pilotCatalog'
import { realRecipeReviewArtifacts, reviewedRealRecipes, reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments } from '../data/reviewedRecipeCatalogV3'
import { evaluateCandidateFeasibility, generatorCandidateSchema, planningRequestSchema } from './generatorV3'
import { planCookingBatch } from './planningV3'
import { applyRecipeReviewV3, recipeReviewArtifactSchema } from './recipeReviewV3'
import { buildRecipeReviewReadinessReport, recipeReviewReadinessReportSchema } from './recipeReviewReportV3'
import { adaptRecipeCatalogV2ToV3, adaptRecipeV2ToDraftV3 } from './recipeV3Migration'

const bySlug = (slug: string) => {
  const recipe = reviewedRealRecipes.find(({ identity }) => identity.slug === slug)
  if (!recipe) throw new Error(`Missing reviewed recipe ${slug}`)
  return recipe
}

describe('G2A real recipe review workflow', () => {
  it('creates seven immutable, provenance-aware revisions without mutating v2 records', () => {
    expect(realRecipeReviewArtifacts).toHaveLength(7)
    expect(reviewedRealRecipes).toHaveLength(7)
    expect(reviewedRecipeCatalogV3).toHaveLength(25)
    expect(new Set(realRecipeReviewArtifacts.map(({ revisionId }) => revisionId)).size).toBe(7)

    for (const artifact of realRecipeReviewArtifacts) {
      expect(recipeReviewArtifactSchema.parse(artifact)).toEqual(artifact)
      expect(artifact.baseRevisionId).not.toBe(artifact.revisionId)
      expect(artifact.evidence.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['manual-source-review', 'editorial-judgment']))
      expect(artifact.reviewedRecipe.source.rights.factualMetadataUse).toBe('review-needed')
      expect(artifact.reviewedRecipe.source.rights.imageUse).toBe('none')
      expect(artifact.reviewedRecipe.steps).toHaveLength(0)
    }

    expect(pilotRecipes.every(({ schemaVersion }) => schemaVersion === 2)).toBe(true)
  })

  it('rejects stale-base application and destructive identity or requirement changes', () => {
    const artifact = structuredClone(realRecipeReviewArtifacts[0])
    const baseV2 = pilotRecipes.find(({ id }) => id === artifact.recipeId)
    if (!baseV2) throw new Error('Missing base v2 recipe')
    const base = adaptRecipeV2ToDraftV3(baseV2)
    expect(() => applyRecipeReviewV3({ ...base, identity: { ...base.identity, revisionId: 'revision-stale-base' } }, artifact)).toThrow('exact base revision')

    artifact.reviewedRecipe.requirements = artifact.reviewedRecipe.requirements.slice(1)
    expect(() => applyRecipeReviewV3(base, artifact)).toThrow()
  })

  it('keeps publisher facts distinct from conservative editorial planning decisions', () => {
    const oats = bySlug('overnight-oats-base-recipe')
    expect(oats.nutrition).toMatchObject({ status: 'publisher-reported', caloriesKcal: { value: 302, confidence: 'reported' } })
    expect(oats.effort).toMatchObject({ activeMinutes: { value: 5, confidence: 'reviewed' }, passiveMinutes: { value: 480, confidence: 'reviewed' } })
    expect(oats.nutrition.caloriesKcal.evidenceIds[0]).toContain('g2a-source')
    expect(oats.effort.activeMinutes.evidenceIds[0]).toContain('g2a-editorial')
  })

  it('preserves whole-item output and only approves the unchanged batch multiplier', () => {
    const muffins = bySlug('banana-flax-muffins')
    expect(muffins.output).toMatchObject({ kind: 'discrete-items', scaling: { policy: 'fixed-batch', allowedMultipliers: [1] } })
    expect(muffins.output.planningGuidance.sourceServingsPerMealPortion?.value).toBe(2)
    expect(planCookingBatch(muffins, { batchId: 'batch-g2a-muffins', groceryDemandId: 'grocery-demand-g2a-muffins', multiplier: 1 }).plannedOutput).toEqual({ kind: 'discrete-item', amount: 6, itemName: 'muffins' })
    expect(() => planCookingBatch(muffins, { batchId: 'batch-g2a-muffins-scaled', groceryDemandId: 'grocery-demand-g2a-muffins-scaled', multiplier: 1.5 })).toThrow('not approved')
  })

  it('records only the claim-supported conservative storage window', () => {
    const greek = bySlug('greek-chicken-pasta-salad')
    expect(greek.suitability.storageModes).toEqual([expect.objectContaining({ mode: 'refrigerated', maxDurationHours: 72, confidence: 'reported' })])
    expect(bySlug('sheet-pan-chicken-fajitas').suitability.storageModes[0].maxDurationHours).toBeNull()
    expect(bySlug('southwest-tofu-scramble').suitability.reviewState).toBe('unknown')
    expect(greek.review.safetyReviewed).toBe(false)
  })

  it('keeps office lunch suitability review-needed when odor evidence is absent', () => {
    const greek = bySlug('greek-chicken-pasta-salad')
    const service = reviewedRecipeServiceAssessments[0]
    const request = planningRequestSchema.parse({
      requestId: 'planning-request-g2a-office',
      horizon: { start: '2026-11-23', end: '2026-11-23' },
      mealRequirements: [{ mealRequirementId: 'meal-requirement-g2a-office', date: '2026-11-23', intendedAt: '2026-11-23T20:00:00.000Z', timeZone: 'America/Los_Angeles', meal: 'lunch', requestedPortions: 1, status: 'unplanned', constraints: { maxActiveMinutes: 5, maxElapsedMinutes: 10, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: false }, lock: { locked: false, reason: null } }],
      recipeSnapshot: [greek], pantry: [], preparedLots: [], recentMeals: [],
      cookingWindows: [{ cookingWindowId: 'cooking-window-g2a-office', start: '2026-11-22T18:00:00.000Z', end: '2026-11-22T21:00:00.000Z', maxActiveMinutes: 60 }],
      serviceAssessments: [service], hardConstraints: { avoidedRecipeIds: [], avoidedIngredientIds: [] },
      preferences: { preferredRecipeIds: [], householdRecipePreferences: [] }, lockedChoices: [],
      officeLunchPolicy: { enabled: true, maxAssembly: 'none', requireReheatingSuitable: true, allowIntrusiveOdors: false, allowRiceBased: false },
    })
    const candidate = generatorCandidateSchema.parse({
      candidateId: 'candidate-g2a-office', recipeId: greek.identity.recipeId, recipeRevisionId: greek.identity.revisionId,
      strategy: 'dedicated-prep', cookingStartsAt: '2026-11-22T18:00:00.000Z', batchMultiplier: 1,
      sourceYieldSelection: { amount: 4, evidenceIds: greek.output.sourceYield.evidenceIds, confidence: 'reported' },
      allocations: [{ mealRequirementId: 'meal-requirement-g2a-office', mealPortions: 1, service: 'refrigerated-leftover' }],
      originMealRequirementId: null,
      ingredientSelections: greek.requirements.filter(({ optional }) => optional).map(({ requirementId }) => ({ requirementId, selection: 'excluded-optional', alternativeId: null })),
      serviceAssessmentId: service.assessmentId, serviceAssessmentRevisionId: service.assessmentRevisionId,
    })
    const result = evaluateCandidateFeasibility(request, candidate)
    expect(result.status).toBe('review-needed')
    expect(result.reasons.map(({ code }) => code)).toEqual(expect.arrayContaining(['recommendation-readiness-required', 'office-suitability-review-required']))
  })

  it('runs a real dinner revision through G1 and isolates its remaining readiness gate', () => {
    const recipe = bySlug('sheet-pan-chicken-fajitas')
    const request = planningRequestSchema.parse({
      requestId: 'planning-request-g2a-fajitas', horizon: { start: '2026-11-23', end: '2026-11-23' },
      mealRequirements: [{ mealRequirementId: 'meal-requirement-g2a-fajitas', date: '2026-11-23', intendedAt: '2026-11-24T03:00:00.000Z', timeZone: 'America/Los_Angeles', meal: 'dinner', requestedPortions: 2, status: 'unplanned', constraints: { maxActiveMinutes: 30, maxElapsedMinutes: 60, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: false }, lock: { locked: false, reason: null } }],
      recipeSnapshot: [recipe], pantry: [], preparedLots: [], recentMeals: [],
      cookingWindows: [{ cookingWindowId: 'cooking-window-g2a-fajitas', start: '2026-11-24T02:00:00.000Z', end: '2026-11-24T03:00:00.000Z', maxActiveMinutes: 30 }],
      serviceAssessments: [], hardConstraints: { avoidedRecipeIds: [], avoidedIngredientIds: [] }, preferences: { preferredRecipeIds: [], householdRecipePreferences: [] }, lockedChoices: [],
      officeLunchPolicy: { enabled: false, maxAssembly: 'any', requireReheatingSuitable: false, allowIntrusiveOdors: true, allowRiceBased: true },
    })
    const result = evaluateCandidateFeasibility(request, generatorCandidateSchema.parse({
      candidateId: 'candidate-g2a-fajitas', recipeId: recipe.identity.recipeId, recipeRevisionId: recipe.identity.revisionId,
      strategy: 'meal-time-cook', cookingStartsAt: '2026-11-24T02:05:00.000Z', batchMultiplier: 1, sourceYieldSelection: null,
      allocations: [{ mealRequirementId: 'meal-requirement-g2a-fajitas', mealPortions: 2, service: 'fresh' }], originMealRequirementId: null,
      ingredientSelections: [], serviceAssessmentId: null, serviceAssessmentRevisionId: null,
    }))
    expect(result.status).toBe('review-needed')
    expect(result.projection).toMatchObject({ batchOutput: { amount: 4 }, allocatedOutput: { amount: 2 }, remainder: { amount: 2 } })
    expect(result.reasons).toEqual([expect.objectContaining({ code: 'recommendation-readiness-required', missingFields: ['source.rights.factualMetadataUse'] })])
  })

  it('reports exact unresolved owner decisions instead of self-approving readiness', () => {
    expect(reviewedRealRecipes.filter(({ review }) => review.readiness.recommendationReady)).toHaveLength(0)
    expect(realRecipeReviewArtifacts.every(({ unresolvedIssues }) => unresolvedIssues.some(({ code }) => code === 'rights-approval-required'))).toBe(true)
    expect(realRecipeReviewArtifacts.find(({ reviewedRecipe }) => reviewedRecipe.identity.slug === 'greek-chicken-pasta-salad')?.unresolvedIssues.map(({ code }) => code)).toContain('office-odor-unreviewed')
  })

  it('reproduces the committed 25-recipe readiness report', () => {
    const { recipes: baseRecipes } = adaptRecipeCatalogV2ToV3(pilotRecipes, canonicalIngredients)
    const report = buildRecipeReviewReadinessReport(baseRecipes, reviewedRecipeCatalogV3, realRecipeReviewArtifacts)
    expect(recipeReviewReadinessReportSchema.parse(committedReadinessReport)).toEqual(report)
    expect(report.coverage).toMatchObject({ sourceFactsReviewed: 7, publisherNutritionCaptured: 7, originalBatchScalingReviewed: 7, explicitStorageWindowCaptured: 1, metadataRightsApproved: 0 })
  })
})
