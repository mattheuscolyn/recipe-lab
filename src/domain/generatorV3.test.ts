import { describe, expect, it } from 'vitest'
import committedReadinessReport from '../../docs/data/G1_RECIPE_READINESS.json'
import { canonicalIngredients, pilotRecipes } from '../data/pilotCatalog'
import { computeRecipeV3Readiness, recipeV3Schema } from './recipeV3'
import { adaptRecipeCatalogV2ToV3 } from './recipeV3Migration'
import { buildGeneratorReadinessReport, generatorReadinessReportSchema } from './generatorReadinessV3'
import { candidateFeasibilitySchema, evaluateCandidateFeasibility, generatorCandidateSchema, planningRequestSchema } from './generatorV3'
import { generatorFixtureRecipes, generatorFixtureServiceAssessments, infeasibleWeekScenario, wholeWeekCandidateFixtures, wholeWeekGeneratorScenario, wholeWeekPlanningRequest } from './generatorV3Fixtures'

const codes = (candidate: Parameters<typeof evaluateCandidateFeasibility>[1]) => evaluateCandidateFeasibility(wholeWeekPlanningRequest, candidate).reasons.map(({ code }) => code)

function selectedAlternativeFixture() {
  const request = structuredClone(wholeWeekPlanningRequest)
  const recipe = structuredClone(generatorFixtureRecipes.prepLunch)
  const alternativeRequirement = recipe.requirements[0]
  const alternative = {
    alternativeId: 'alternative-must-use-fixture',
    label: 'Synthetic alternate ingredient',
    canonicalIngredientId: 'ingredient-must-use-alternate',
    variantId: 'variant-must-use-alternate',
    quantity: alternativeRequirement.selectedPlanningQuantity,
    relationship: 'substitution' as const,
  }
  alternativeRequirement.alternatives.push(alternative)
  request.recipeSnapshot = request.recipeSnapshot.map((item) => item.identity.recipeId === recipe.identity.recipeId ? recipeV3Schema.parse(recipe) : item)
  const candidate = structuredClone(wholeWeekCandidateFixtures.sundayPrepLunches)
  candidate.candidateId = 'candidate-selected-alternative'
  candidate.ingredientSelections.push({ requirementId: alternativeRequirement.requirementId, selection: 'alternative', alternativeId: alternative.alternativeId })
  return { request, candidate, alternativeRequirement, alternative }
}

describe('G1 planning contracts', () => {
  it('validates a complete week with differing portions, a skip, a lock, preferences, and constraints', () => {
    const request = planningRequestSchema.parse(wholeWeekPlanningRequest)
    expect(request.mealRequirements).toHaveLength(21)
    expect(request.mealRequirements.find(({ status }) => status === 'skipped')?.requestedPortions).toBe(0)
    expect(request.lockedChoices).toHaveLength(1)
    expect(request.preferences.householdRecipePreferences[0]).toMatchObject({ likedVotes: 1, dislikedVotes: 1 })
    expect(request.pantry).toHaveLength(1)
    expect(request.officeLunchPolicy.maxAssembly).toBe('none')
    expect(request.cookingWindows[0].maxActiveMinutes).toBe(45)
  })

  it('rejects malformed horizons and invalid prior-meal origins', () => {
    const invalidRequest = structuredClone(wholeWeekPlanningRequest)
    invalidRequest.horizon.end = '2026-11-15'
    expect(planningRequestSchema.safeParse(invalidRequest).success).toBe(false)
    const invalidCandidate = { ...wholeWeekCandidateFixtures.dinnerWithLeftoverLunch, originMealRequirementId: null }
    expect(generatorCandidateSchema.safeParse(invalidCandidate).success).toBe(false)
  })

  it('round-trips request and feasibility JSON deterministically', () => {
    const requestJson = JSON.stringify(planningRequestSchema.parse(wholeWeekPlanningRequest))
    expect(JSON.stringify(planningRequestSchema.parse(JSON.parse(requestJson)))).toBe(requestJson)
    const result = evaluateCandidateFeasibility(wholeWeekPlanningRequest, wholeWeekCandidateFixtures.sundayPrepLunches)
    const resultJson = JSON.stringify(result)
    expect(candidateFeasibilitySchema.parse(JSON.parse(resultJson))).toEqual(result)
  })
})

describe('G1 candidate feasibility and S12', () => {
  it('accepts Sunday prep that supplies varying weekday lunch portions', () => {
    const result = evaluateCandidateFeasibility(wholeWeekPlanningRequest, wholeWeekCandidateFixtures.sundayPrepLunches)
    expect(result.status).toBe('eligible')
    expect(result.projection).toMatchObject({ batchOutput: { amount: 6 }, allocatedOutput: { amount: 6 }, remainder: { amount: 0 } })
    expect(result.explanations.map(({ code }) => code)).toContain('lunch-from-dedicated-prep')
    expect(result.timing).toMatchObject({ cookingStartsAt: '2026-11-15T19:20:00.000Z', expectedReadyAt: '2026-11-15T20:00:00.000Z' })
  })

  it('accepts a dinner batch that safely supplies a later lunch and explains taste conflict', () => {
    const result = evaluateCandidateFeasibility(wholeWeekPlanningRequest, wholeWeekCandidateFixtures.dinnerWithLeftoverLunch)
    expect(result.status).toBe('eligible')
    expect(result.explanations.map(({ code }) => code)).toEqual(expect.arrayContaining(['lunch-from-reviewed-leftovers', 'household-preference-conflict']))
  })

  it('rejects lunchtime cooking by default and office assembly', () => {
    expect(codes(wholeWeekCandidateFixtures.lunchtimeCooking)).toContain('lunch-cooking-not-allowed')
    expect(codes(wholeWeekCandidateFixtures.officeAssembly)).toContain('office-assembly-not-allowed')
  })

  it('returns review-needed instead of eligibility when office facts are unknown', () => {
    const result = evaluateCandidateFeasibility(wholeWeekPlanningRequest, wholeWeekCandidateFixtures.unknownOfficeSuitability)
    expect(result.status).toBe('review-needed')
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'office-suitability-review-required', disposition: 'review-needed' })]))
  })

  it('protects skipped and locked meals with structured explanations', () => {
    expect(codes(wholeWeekCandidateFixtures.lockedMismatch)).toContain('locked-choice-mismatch')
    const skipped = structuredClone(wholeWeekCandidateFixtures.sundayPrepLunches)
    skipped.candidateId = 'candidate-skipped-meal'
    skipped.allocations = [{ mealRequirementId: 'meal-requirement-2026-11-20-lunch', mealPortions: 1, service: 'refrigerated-leftover' }]
    expect(codes(skipped)).toContain('meal-skipped')
  })

  it('enforces hard recipe and ingredient avoids', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    request.hardConstraints.avoidedRecipeIds = [generatorFixtureRecipes.prepLunch.identity.recipeId]
    request.hardConstraints.avoidedIngredientIds = [generatorFixtureRecipes.prepLunch.requirements[0].canonicalIngredientId]
    const result = evaluateCandidateFeasibility(request, wholeWeekCandidateFixtures.sundayPrepLunches)
    expect(result.reasons.map(({ code }) => code)).toEqual(expect.arrayContaining(['hard-recipe-avoid', 'hard-ingredient-avoid']))
  })

  it('rejects unsafe whole-item scaling', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    const recipe = structuredClone(generatorFixtureRecipes.prepLunch)
    recipe.requirements[0].scaling = 'whole-item'
    if (!recipe.requirements[0].selectedPlanningQuantity) throw new Error('Fixture needs a planning quantity')
    recipe.requirements[0].selectedPlanningQuantity.amount = 1
    recipe.output.scaling.allowedMultipliers = [1, 1.5]
    recipe.review.readiness = computeRecipeV3Readiness(recipe)
    request.recipeSnapshot = request.recipeSnapshot.map((item) => item.identity.recipeId === recipe.identity.recipeId ? recipeV3Schema.parse(recipe) : item)
    const candidate = { ...wholeWeekCandidateFixtures.sundayPrepLunches, candidateId: 'candidate-whole-item', batchMultiplier: 1.5 }
    expect(evaluateCandidateFeasibility(request, candidate).reasons.map(({ code }) => code)).toContain('whole-item-constraint')
  })

  it('rejects a candidate that does not satisfy the requested meal portions', () => {
    const candidate = structuredClone(wholeWeekCandidateFixtures.dinnerWithLeftoverLunch)
    candidate.candidateId = 'candidate-incomplete-portions'
    candidate.allocations[0].mealPortions = 1
    expect(codes(candidate)).toContain('meal-portions-incomplete')
  })

  it('rejects storage beyond the reviewed window', () => {
    const candidate = structuredClone(wholeWeekCandidateFixtures.sundayPrepLunches)
    candidate.candidateId = 'candidate-storage-window'
    candidate.cookingStartsAt = '2026-11-14T00:00:00.000Z'
    expect(codes(candidate)).toContain('storage-window-exceeded')
  })

  it('rejects cooking outside active windows', () => {
    const candidate = structuredClone(wholeWeekCandidateFixtures.sundayPrepLunches)
    candidate.candidateId = 'candidate-no-cooking-window'
    candidate.cookingStartsAt = '2026-11-14T20:00:00.000Z'
    expect(codes(candidate)).toContain('cooking-window-unavailable')
  })

  it('requires the full reviewed cooking interval to fit the selected window', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    request.cookingWindows = [{ cookingWindowId: 'cooking-window-short', start: '2026-11-15T19:20:00.000Z', end: '2026-11-15T20:00:00.000Z', maxActiveMinutes: 20 }]
    expect(evaluateCandidateFeasibility(request, wholeWeekCandidateFixtures.sundayPrepLunches).status).toBe('eligible')
    const candidate = structuredClone(wholeWeekCandidateFixtures.sundayPrepLunches)
    candidate.candidateId = 'candidate-short-window'
    candidate.cookingStartsAt = '2026-11-15T19:21:00.000Z'
    expect(evaluateCandidateFeasibility(request, candidate).reasons.map(({ code }) => code)).toContain('cooking-window-duration-exceeded')
  })

  it('rejects meal service before expected cooking completion', () => {
    const candidate = structuredClone(wholeWeekCandidateFixtures.dinnerWithLeftoverLunch)
    candidate.candidateId = 'candidate-food-not-ready'
    candidate.cookingStartsAt = '2026-11-17T02:50:00.000Z'
    expect(codes(candidate)).toContain('meal-before-food-ready')
  })

  it('measures reviewed storage from expected completion and preserves Pacific local dates', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    const recipe = structuredClone(generatorFixtureRecipes.prepLunch)
    const refrigerated = recipe.suitability.storageModes.find(({ mode }) => mode === 'refrigerated')
    if (!refrigerated) throw new Error('Fixture needs refrigerated storage')
    refrigerated.maxDurationHours = 24
    request.recipeSnapshot = request.recipeSnapshot.map((item) => item.identity.recipeId === recipe.identity.recipeId ? recipeV3Schema.parse(recipe) : item)
    const candidate = structuredClone(wholeWeekCandidateFixtures.sundayPrepLunches)
    candidate.candidateId = 'candidate-completion-based-storage'
    candidate.allocations = [candidate.allocations[0]]
    const result = evaluateCandidateFeasibility(request, candidate)
    expect(result.status).toBe('eligible')
    expect(result.timing?.expectedReadyAt).toBe('2026-11-15T20:00:00.000Z')
    expect(evaluateCandidateFeasibility(wholeWeekPlanningRequest, wholeWeekCandidateFixtures.dinnerWithLeftoverLunch).status).toBe('eligible')
  })

  it('requires review when elapsed cooking duration is not trustworthy', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    const recipe = structuredClone(generatorFixtureRecipes.prepLunch)
    recipe.effort.totalMinutes = { value: null, confidence: 'unknown', evidenceIds: [], unknownReason: 'Not reviewed.' }
    recipe.review.readiness = computeRecipeV3Readiness(recipe)
    request.recipeSnapshot = request.recipeSnapshot.map((item) => item.identity.recipeId === recipe.identity.recipeId ? recipeV3Schema.parse(recipe) : item)
    const result = evaluateCandidateFeasibility(request, wholeWeekCandidateFixtures.sundayPrepLunches)
    expect(result.status).toBe('review-needed')
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'cooking-duration-review-required', disposition: 'review-needed' })]))
    expect(result.projection).toBeNull()
  })

  it('uses reviewed leftover service effort instead of the original batch cooking effort', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    const recipe = structuredClone(generatorFixtureRecipes.dinner)
    const evidenceIds = recipe.effort.activeMinutes.evidenceIds
    recipe.effort.activeMinutes = { value: 45, confidence: 'reviewed', evidenceIds, unknownReason: null }
    recipe.effort.totalMinutes = { value: 50, confidence: 'reviewed', evidenceIds, unknownReason: null }
    recipe.review.readiness = computeRecipeV3Readiness(recipe)
    request.recipeSnapshot = request.recipeSnapshot.map((item) => item.identity.recipeId === recipe.identity.recipeId ? recipeV3Schema.parse(recipe) : item)
    request.mealRequirements = request.mealRequirements.map((requirement) => requirement.mealRequirementId === 'meal-requirement-2026-11-17-lunch'
      ? { ...requirement, constraints: { ...requirement.constraints, maxActiveMinutes: 10, maxElapsedMinutes: 15 } }
      : requirement)
    const candidate = structuredClone(wholeWeekCandidateFixtures.dinnerWithLeftoverLunch)
    candidate.candidateId = 'candidate-quick-leftover-service'
    candidate.cookingStartsAt = '2026-11-17T02:10:00.000Z'
    const result = evaluateCandidateFeasibility(request, candidate)
    expect(result.status).toBe('eligible')
    expect(result.reasons.map(({ code }) => code)).not.toEqual(expect.arrayContaining(['active-time-exceeded', 'elapsed-time-exceeded']))
  })

  it('enforces must-use ingredients with explicit alternative selection', () => {
    const { request, candidate: selected, alternativeRequirement, alternative } = selectedAlternativeFixture()
    request.mealRequirements = request.mealRequirements.map((requirement) => requirement.mealRequirementId === 'meal-requirement-2026-11-16-lunch'
      ? { ...requirement, constraints: { ...requirement.constraints, mustUseIngredientIds: [alternative.canonicalIngredientId] } }
      : requirement)
    const selectedResult = evaluateCandidateFeasibility(request, selected)
    expect(selectedResult.status).toBe('review-needed')
    expect(selectedResult.reasons.map(({ code }) => code)).toContain('ingredient-selection-grocery-review-required')
    expect(selectedResult.reasons.map(({ code }) => code)).not.toContain('must-use-ingredient-missing')
    const unresolved = structuredClone(selected)
    unresolved.candidateId = 'candidate-unresolved-alternative'
    unresolved.ingredientSelections = unresolved.ingredientSelections.filter(({ requirementId }) => requirementId !== alternativeRequirement.requirementId)
    const unresolvedResult = evaluateCandidateFeasibility(request, unresolved)
    expect(unresolvedResult.status).toBe('review-needed')
    expect(unresolvedResult.reasons.map(({ code }) => code)).toContain('must-use-ingredient-unresolved')
  })

  it('does not reject an avoided primary ingredient when a substitute is selected', () => {
    const { request, candidate, alternativeRequirement } = selectedAlternativeFixture()
    request.hardConstraints.avoidedIngredientIds = [alternativeRequirement.canonicalIngredientId]
    const result = evaluateCandidateFeasibility(request, candidate)
    expect(result.status).toBe('review-needed')
    expect(result.reasons.map(({ code }) => code)).not.toContain('hard-ingredient-avoid')
    expect(result.reasons.map(({ code }) => code)).toContain('ingredient-selection-grocery-review-required')
  })

  it('rejects a selected substitute when that substitute is avoided', () => {
    const { request, candidate, alternative } = selectedAlternativeFixture()
    request.hardConstraints.avoidedIngredientIds = [alternative.canonicalIngredientId]
    const result = evaluateCandidateFeasibility(request, candidate)
    expect(result.status).toBe('rejected')
    expect(result.reasons.map(({ code }) => code)).toContain('hard-ingredient-avoid')
  })

  it('requires review when an unresolved branch could contain an avoided ingredient', () => {
    const { request, candidate, alternativeRequirement, alternative } = selectedAlternativeFixture()
    candidate.candidateId = 'candidate-unresolved-avoid'
    candidate.ingredientSelections = candidate.ingredientSelections.filter(({ requirementId }) => requirementId !== alternativeRequirement.requirementId)
    request.hardConstraints.avoidedIngredientIds = [alternative.canonicalIngredientId]
    const result = evaluateCandidateFeasibility(request, candidate)
    expect(result.status).toBe('review-needed')
    expect(result.reasons.map(({ code }) => code)).toContain('hard-ingredient-avoid-unresolved')
    expect(result.reasons.map(({ code }) => code)).not.toContain('hard-ingredient-avoid')
  })

  it('handles optional ingredient avoids from the explicit selection state', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    const recipe = generatorFixtureRecipes.dinner
    const optionalRequirement = recipe.requirements.find(({ optional }) => optional)
    if (!optionalRequirement) throw new Error('Fixture needs an optional ingredient')
    request.hardConstraints.avoidedIngredientIds = [optionalRequirement.canonicalIngredientId]
    const unresolved = evaluateCandidateFeasibility(request, wholeWeekCandidateFixtures.dinnerWithLeftoverLunch)
    expect(unresolved.status).toBe('review-needed')
    expect(unresolved.reasons.map(({ code }) => code)).toContain('hard-ingredient-avoid-unresolved')
    const selected = structuredClone(wholeWeekCandidateFixtures.dinnerWithLeftoverLunch)
    selected.candidateId = 'candidate-selected-optional-avoid'
    selected.ingredientSelections.push({ requirementId: optionalRequirement.requirementId, selection: 'primary', alternativeId: null })
    const selectedResult = evaluateCandidateFeasibility(request, selected)
    expect(selectedResult.status).toBe('rejected')
    expect(selectedResult.reasons.map(({ code }) => code)).toContain('hard-ingredient-avoid')
    expect(selectedResult.reasons.map(({ code }) => code)).toContain('ingredient-selection-grocery-review-required')
  })

  it('rejects a must-use ingredient absent from the selected recipe', () => {
    const request = structuredClone(wholeWeekPlanningRequest)
    request.mealRequirements = request.mealRequirements.map((requirement) => requirement.mealRequirementId === 'meal-requirement-2026-11-16-lunch'
      ? { ...requirement, constraints: { ...requirement.constraints, mustUseIngredientIds: ['ingredient-not-in-recipe'] } }
      : requirement)
    expect(evaluateCandidateFeasibility(request, wholeWeekCandidateFixtures.sundayPrepLunches).reasons.map(({ code }) => code)).toContain('must-use-ingredient-missing')
  })

  it('requires claim-specific reviewed office evidence and ignores candidate self-certification', () => {
    const falsifiedRequest = structuredClone(wholeWeekPlanningRequest)
    const assessment = falsifiedRequest.serviceAssessments.find(({ assessmentId }) => assessmentId === generatorFixtureServiceAssessments.prepLunch.assessmentId)
    if (!assessment) throw new Error('Fixture needs a service assessment')
    assessment.assembly.evidenceIds = [assessment.odor.evidenceIds[0]]
    expect(planningRequestSchema.safeParse(falsifiedRequest).success).toBe(false)

    const selfCertifiedInput = {
      ...wholeWeekCandidateFixtures.sundayPrepLunches,
      candidateId: 'candidate-self-certified-office',
      serviceAssessmentId: null,
      serviceAssessmentRevisionId: null,
      serviceProfile: { reviewState: 'reviewed', assembly: 'none', reheating: 'suitable', odor: 'low', riceBased: false },
    }
    expect(generatorCandidateSchema.safeParse(selfCertifiedInput).success).toBe(false)
    const selfCertified = { ...wholeWeekCandidateFixtures.sundayPrepLunches, candidateId: 'candidate-unreviewed-office', serviceAssessmentId: null, serviceAssessmentRevisionId: null }
    expect(evaluateCandidateFeasibility(wholeWeekPlanningRequest, selfCertified).reasons.map(({ code }) => code)).toContain('office-suitability-review-required')
  })

  it('never treats an unreviewed migrated recipe as automatically eligible', () => {
    const migrated = adaptRecipeCatalogV2ToV3(pilotRecipes, canonicalIngredients).recipes[0]
    const request = structuredClone(wholeWeekPlanningRequest)
    request.recipeSnapshot.push(migrated)
    const candidate = {
      ...wholeWeekCandidateFixtures.lunchtimeCooking,
      candidateId: 'candidate-unreviewed-recipe',
      recipeId: migrated.identity.recipeId,
      recipeRevisionId: migrated.identity.revisionId,
      serviceAssessmentId: null,
      serviceAssessmentRevisionId: null,
    }
    const result = evaluateCandidateFeasibility(request, candidate)
    expect(result.status).not.toBe('eligible')
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'recommendation-readiness-required', disposition: 'review-needed' })]))
  })

  it('keeps executable whole-week expectations for the future optimizer', () => {
    expect(wholeWeekGeneratorScenario.coverage).toEqual(expect.arrayContaining(['repeated-easy-breakfasts', 'varied-dinners', 'insufficient-eligible-options']))
    for (const expectation of wholeWeekGeneratorScenario.candidateExpectations) {
      expect(evaluateCandidateFeasibility(wholeWeekPlanningRequest, expectation.candidate).status).toBe(expectation.status)
    }
  })

  it('exposes an honest insufficient-options week instead of treating unknown recipes as eligible', () => {
    const results = infeasibleWeekScenario.candidateProbes.map((candidate) => evaluateCandidateFeasibility(infeasibleWeekScenario.request, candidate))
    expect(results.every(({ status }) => status !== 'eligible')).toBe(true)
    expect(results[0].reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'recommendation-readiness-required' })]))
    expect(infeasibleWeekScenario.expectedUnfillableMealRequirementIds).toHaveLength(20)
  })
})

describe('actual catalog recommendation readiness', () => {
  const migrated = adaptRecipeCatalogV2ToV3(pilotRecipes, canonicalIngredients).recipes
  const report = buildGeneratorReadinessReport(migrated)

  it('audits all 25 recipes without asserting unsupported readiness', () => {
    expect(generatorReadinessReportSchema.parse(report)).toEqual(report)
    expect(report.recipeCount).toBe(25)
    expect(report.recommendationReadyCount).toBe(0)
    expect(report.entries).toHaveLength(25)
    expect(report.entries.every(({ missingForRecommendation }) => missingForRecommendation.length > 0)).toBe(true)
  })

  it('prioritizes a diverse first review group and reports exact missing fields', () => {
    expect(report.recommendedFirstReviewGroup).toHaveLength(9)
    expect(report.entries.slice(0, 9).map(({ primaryMealRoles }) => primaryMealRoles[0])).toEqual(expect.arrayContaining(['breakfast', 'lunch', 'dinner']))
    expect(report.entries[0].missingForRecommendation).toEqual(expect.arrayContaining([
      { code: 'output-scaling-review-required', fields: ['output.scaling'] },
      { code: 'meal-portion-guidance-missing', fields: ['output.planningGuidance.sourceServingsPerMealPortion'] },
      { code: 'active-time-unknown', fields: ['effort.activeMinutes'] },
      { code: 'suitability-unknown', fields: ['suitability.prepareAhead', 'suitability.leftoverQuality', 'suitability.storageModes', 'suitability.reheatMethod'] },
    ]))
  })

  it('is deterministic and JSON serializable', () => {
    expect(buildGeneratorReadinessReport(migrated)).toEqual(report)
    expect(generatorReadinessReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report)
    expect(committedReadinessReport).toEqual(report)
  })
})
