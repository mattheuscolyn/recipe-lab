import { pilotRecipes } from '../data/pilotCatalog'
import { computeRecipeV3Readiness, recipeV3Schema, type RecipeV3 } from './recipeV3'
import { adaptRecipeV2ToDraftV3 } from './recipeV3Migration'
import { generatorCandidateSchema, planningRequestSchema, type GeneratorCandidate, type OfficeServiceAssessment, type PlanningRequest } from './generatorV3'

const fixtureIds = {
  breakfast: '10000000-0000-4000-8000-000000000001',
  prepLunch: '10000000-0000-4000-8000-000000000002',
  dinner: '10000000-0000-4000-8000-000000000003',
} as const

export function reviewedFixture(sourceSlug: string, recipeId: string, role: 'breakfast' | 'lunch' | 'dinner', output: number): RecipeV3 {
  const source = pilotRecipes.find(({ slug }) => slug === sourceSlug)
  if (!source) throw new Error(`Missing fixture source ${sourceSlug}`)
  const recipe = structuredClone(adaptRecipeV2ToDraftV3(source))
  const evidenceId = recipe.source.evidence[0].evidenceId
  recipe.identity = { ...recipe.identity, recipeId, revisionId: `revision-fixture-${role}-v1`, slug: `synthetic-${role}-fixture`, title: `Synthetic reviewed ${role}`, lifecycle: 'source-reviewed' }
  recipe.source = {
    ...recipe.source,
    publisher: 'Recipe Lab synthetic acceptance fixture',
    author: null,
    canonicalUrl: `https://example.invalid/recipe-lab/${role}-fixture`,
    rating: null,
    reviewCount: null,
    selectionRationale: 'Synthetic reviewed data used only to execute generator acceptance scenarios.',
    rights: { factualMetadataUse: 'approved', methodTextUse: 'independent-summary-only', imageUse: 'none', note: 'Synthetic test fixture; not a claim about the migrated source recipe.' },
  }
  recipe.output.kind = 'fixed-portions'
  recipe.output.sourceYield = { amount: output, range: null, unit: 'portions', label: `${output} fixture portions`, evidenceIds: [evidenceId] }
  recipe.output.sourceServing = { servingsPerRecipe: output, servingSize: null, servingLabel: 'one meal portion', evidenceIds: [evidenceId] }
  recipe.output.discreteItem = null
  recipe.output.scaling = { policy: 'linear-reviewed', allowedMultipliers: [0.5, 1, 1.5, 2], note: 'Synthetic fixture scaling is reviewed.' }
  recipe.output.planningGuidance = { defaultMealPortions: output, sourceServingsPerMealPortion: { value: 1, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }, adequacyNote: 'One source serving is one fixture meal portion.', sideSuggestionRefs: [] }
  recipe.requirements = recipe.requirements.map((requirement) => ({ ...requirement, scaling: 'linear' as const }))
  recipe.effort.activeMinutes = { value: 20, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }
  recipe.effort.totalMinutes = { value: 40, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }
  recipe.mealRoles.primary = [role]
  recipe.suitability = {
    reviewState: 'editor-reviewed',
    prepareAhead: { value: 'yes', evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null },
    leftoverQuality: { value: 'good', evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null },
    storageModes: [
      { mode: 'refrigerated', maxDurationHours: 120, evidenceIds: [evidenceId], confidence: 'reviewed' },
      { mode: 'frozen', maxDurationHours: 720, evidenceIds: [evidenceId], confidence: 'reviewed' },
    ],
    thawRequired: { value: false, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null },
    reheatMethod: { value: 'Reheat until safely hot.', evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null },
    notes: ['Synthetic storage facts exist only for acceptance testing.'],
  }
  recipe.review.recommendationDecisions = {
    ingredientNormalization: 'approved',
    outputScaling: 'approved',
    mealPortions: 'approved',
    effort: 'approved',
  }
  recipe.review.readiness = computeRecipeV3Readiness(recipe)
  return recipeV3Schema.parse(recipe)
}

export const generatorFixtureRecipes = {
  breakfast: reviewedFixture('overnight-oats-base-recipe', fixtureIds.breakfast, 'breakfast', 4),
  prepLunch: reviewedFixture('greek-chicken-pasta-salad', fixtureIds.prepLunch, 'lunch', 6),
  dinner: reviewedFixture('sheet-pan-chicken-fajitas', fixtureIds.dinner, 'dinner', 4),
}

const serviceClaims = ['assembly', 'reheating', 'odor', 'rice-based', 'active-minutes', 'elapsed-minutes'] as const
export function reviewedServiceAssessment(recipe: RecipeV3, suffix: string, assembly: 'none' | 'simple' | 'intensive' = 'none'): OfficeServiceAssessment {
  const evidence = serviceClaims.map((claim) => ({
    evidenceId: `evidence-service-${suffix}-${claim}`,
    kind: 'editorial-judgment' as const,
    capturedAt: '2026-11-15T18:00:00.000Z',
    reviewerNote: `Synthetic fixture review specifically establishes ${claim}.`,
    claims: [claim],
  }))
  const fact = <T>(claim: typeof serviceClaims[number], value: T) => ({ value, confidence: 'reviewed' as const, evidenceIds: [`evidence-service-${suffix}-${claim}`], unknownReason: null })
  return {
    assessmentId: `service-assessment-${suffix}`,
    assessmentRevisionId: `service-assessment-revision-${suffix}`,
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    reviewedAt: '2026-11-15T18:00:00.000Z',
    applicableServices: ['refrigerated-leftover', 'frozen-leftover'],
    evidence,
    assembly: fact('assembly', assembly),
    reheating: fact('reheating', 'suitable' as const),
    odor: fact('odor', 'low' as const),
    riceBased: fact('rice-based', false),
    activeMinutes: fact('active-minutes', 5),
    elapsedMinutes: fact('elapsed-minutes', 10),
  }
}

export const generatorFixtureServiceAssessments = {
  prepLunch: reviewedServiceAssessment(generatorFixtureRecipes.prepLunch, 'prep-lunch-v1'),
  prepLunchIntensive: reviewedServiceAssessment(generatorFixtureRecipes.prepLunch, 'prep-lunch-intensive-v1', 'intensive'),
  dinner: reviewedServiceAssessment(generatorFixtureRecipes.dinner, 'dinner-v1'),
}

const ingredientSelectionsFor = (recipe: RecipeV3): GeneratorCandidate['ingredientSelections'] => recipe.requirements
  .filter((requirement) => !requirement.optional && requirement.alternatives.length)
  .map(({ requirementId }) => ({ requirementId, selection: 'primary', alternativeId: null }))

const dateByDay = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const utcForMeal = (date: string, meal: 'breakfast' | 'lunch' | 'dinner') => {
  const hour = meal === 'breakfast' ? '16' : meal === 'lunch' ? '20' : '03'
  if (meal !== 'dinner') return `${date}T${hour}:00:00.000Z`
  const next = new Date(`${date}T12:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return `${next.toISOString().slice(0, 10)}T03:00:00.000Z`
}

const lunchPortions = [1, 2, 1, 2, 0, 2, 2]
const mealRequirements = dateByDay.flatMap((date, day) => (['breakfast', 'lunch', 'dinner'] as const).map((meal) => {
  const skipped = meal === 'lunch' && lunchPortions[day] === 0
  const locked = meal === 'dinner' && day === 2
  return {
    mealRequirementId: `meal-requirement-${date}-${meal}`,
    date,
    intendedAt: utcForMeal(date, meal),
    timeZone: 'America/Los_Angeles',
    meal,
    requestedPortions: skipped ? 0 : meal === 'lunch' ? lunchPortions[day] : 2,
    status: skipped ? 'skipped' as const : 'unplanned' as const,
    constraints: { maxActiveMinutes: meal === 'dinner' ? 45 : 25, maxElapsedMinutes: 60, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: false },
    lock: { locked, reason: locked ? 'Existing household commitment' : null },
  }
}))

export const wholeWeekPlanningRequest: PlanningRequest = planningRequestSchema.parse({
  requestId: 'planning-request-g1-acceptance-week',
  horizon: { start: dateByDay[0], end: dateByDay[6] },
  mealRequirements,
  recipeSnapshot: Object.values(generatorFixtureRecipes),
  pantry: [{
    availabilityId: 'availability-fixture-oats',
    canonicalIngredientId: generatorFixtureRecipes.breakfast.requirements[0].canonicalIngredientId,
    variantId: generatorFixtureRecipes.breakfast.requirements[0].variantId,
    confidence: 'likely-owned',
    quantity: null,
  }],
  preparedLots: [],
  recentMeals: [{ recipeId: fixtureIds.dinner, servedAt: '2026-11-12T03:00:00.000Z' }],
  cookingWindows: [{ cookingWindowId: 'cooking-window-week-capacity', start: '2026-11-15T00:00:00.000Z', end: '2026-11-23T08:00:00.000Z', maxActiveMinutes: 45 }],
  serviceAssessments: Object.values(generatorFixtureServiceAssessments),
  hardConstraints: { avoidedRecipeIds: [], avoidedIngredientIds: [] },
  preferences: {
    preferredRecipeIds: [fixtureIds.breakfast],
    householdRecipePreferences: [{ recipeId: fixtureIds.dinner, likedVotes: 1, dislikedVotes: 1, unknownVotes: 0 }],
  },
  lockedChoices: [{ mealRequirementId: 'meal-requirement-2026-11-18-dinner', recipeId: fixtureIds.dinner, recipeRevisionId: generatorFixtureRecipes.dinner.identity.revisionId }],
  officeLunchPolicy: { enabled: true, maxAssembly: 'none', requireReheatingSuitable: true, allowIntrusiveOdors: false, allowRiceBased: false },
})

const candidate = (value: GeneratorCandidate) => generatorCandidateSchema.parse(value)

export const wholeWeekCandidateFixtures = {
  sundayPrepLunches: candidate({
    candidateId: 'candidate-sunday-prep-lunches', recipeId: fixtureIds.prepLunch, recipeRevisionId: generatorFixtureRecipes.prepLunch.identity.revisionId,
    strategy: 'dedicated-prep', cookingStartsAt: '2026-11-15T19:20:00.000Z', storageStartsAt: '2026-11-15T20:00:00.000Z', batchMultiplier: 1, sourceYieldSelection: null, originMealRequirementId: null,
    allocations: [0, 1, 2, 3].map((day) => ({ mealRequirementId: `meal-requirement-${dateByDay[day]}-lunch`, mealPortions: lunchPortions[day], service: 'refrigerated-leftover' as const })),
    ingredientSelections: ingredientSelectionsFor(generatorFixtureRecipes.prepLunch), serviceAssessmentId: generatorFixtureServiceAssessments.prepLunch.assessmentId, serviceAssessmentRevisionId: generatorFixtureServiceAssessments.prepLunch.assessmentRevisionId,
  }),
  dinnerWithLeftoverLunch: candidate({
    candidateId: 'candidate-dinner-leftovers', recipeId: fixtureIds.dinner, recipeRevisionId: generatorFixtureRecipes.dinner.identity.revisionId,
    strategy: 'prior-meal-batch', cookingStartsAt: '2026-11-17T02:20:00.000Z', batchMultiplier: 1, sourceYieldSelection: null, originMealRequirementId: 'meal-requirement-2026-11-16-dinner',
    allocations: [
      { mealRequirementId: 'meal-requirement-2026-11-16-dinner', mealPortions: 2, service: 'fresh' },
      { mealRequirementId: 'meal-requirement-2026-11-17-lunch', mealPortions: 2, service: 'refrigerated-leftover' },
    ],
    ingredientSelections: ingredientSelectionsFor(generatorFixtureRecipes.dinner), serviceAssessmentId: generatorFixtureServiceAssessments.dinner.assessmentId, serviceAssessmentRevisionId: generatorFixtureServiceAssessments.dinner.assessmentRevisionId,
  }),
  lunchtimeCooking: candidate({
    candidateId: 'candidate-lunchtime-cooking', recipeId: fixtureIds.prepLunch, recipeRevisionId: generatorFixtureRecipes.prepLunch.identity.revisionId,
    strategy: 'meal-time-cook', cookingStartsAt: '2026-11-16T19:00:00.000Z', batchMultiplier: 1, sourceYieldSelection: null, originMealRequirementId: null,
    allocations: [{ mealRequirementId: 'meal-requirement-2026-11-16-lunch', mealPortions: 1, service: 'fresh' }],
    ingredientSelections: ingredientSelectionsFor(generatorFixtureRecipes.prepLunch), serviceAssessmentId: null, serviceAssessmentRevisionId: null,
  }),
  lockedMismatch: candidate({
    candidateId: 'candidate-locked-mismatch', recipeId: fixtureIds.prepLunch, recipeRevisionId: generatorFixtureRecipes.prepLunch.identity.revisionId,
    strategy: 'meal-time-cook', cookingStartsAt: '2026-11-19T02:20:00.000Z', batchMultiplier: 1, sourceYieldSelection: null, originMealRequirementId: null,
    allocations: [{ mealRequirementId: 'meal-requirement-2026-11-18-dinner', mealPortions: 2, service: 'fresh' }],
    ingredientSelections: ingredientSelectionsFor(generatorFixtureRecipes.prepLunch), serviceAssessmentId: null, serviceAssessmentRevisionId: null,
  }),
  officeAssembly: candidate({
    candidateId: 'candidate-office-assembly', recipeId: fixtureIds.prepLunch, recipeRevisionId: generatorFixtureRecipes.prepLunch.identity.revisionId,
    strategy: 'dedicated-prep', cookingStartsAt: '2026-11-15T19:20:00.000Z', storageStartsAt: '2026-11-15T20:00:00.000Z', batchMultiplier: 1, sourceYieldSelection: null, originMealRequirementId: null,
    allocations: [{ mealRequirementId: 'meal-requirement-2026-11-16-lunch', mealPortions: 1, service: 'refrigerated-leftover' }],
    ingredientSelections: ingredientSelectionsFor(generatorFixtureRecipes.prepLunch), serviceAssessmentId: generatorFixtureServiceAssessments.prepLunchIntensive.assessmentId, serviceAssessmentRevisionId: generatorFixtureServiceAssessments.prepLunchIntensive.assessmentRevisionId,
  }),
  unknownOfficeSuitability: candidate({
    candidateId: 'candidate-unknown-office', recipeId: fixtureIds.prepLunch, recipeRevisionId: generatorFixtureRecipes.prepLunch.identity.revisionId,
    strategy: 'dedicated-prep', cookingStartsAt: '2026-11-15T19:20:00.000Z', storageStartsAt: '2026-11-15T20:00:00.000Z', batchMultiplier: 1, sourceYieldSelection: null, originMealRequirementId: null,
    allocations: [{ mealRequirementId: 'meal-requirement-2026-11-16-lunch', mealPortions: 1, service: 'refrigerated-leftover' }],
    ingredientSelections: ingredientSelectionsFor(generatorFixtureRecipes.prepLunch), serviceAssessmentId: null, serviceAssessmentRevisionId: null,
  }),
}

/** Permanent G1 acceptance inputs. This is deliberately not an optimizer result. */
export const wholeWeekGeneratorScenario = {
  request: wholeWeekPlanningRequest,
  coverage: [
    'two-person-dinners',
    'differing-lunch-portions',
    'sunday-batch-prep',
    'dinner-leftovers',
    'repeated-easy-breakfasts',
    'varied-dinners',
    'skipped-meal',
    'locked-meal',
    'office-no-cook-no-assembly',
    'conflicting-household-preferences',
    'unknown-recipe-data',
    'insufficient-eligible-options',
  ],
  candidateExpectations: [
    { candidate: wholeWeekCandidateFixtures.sundayPrepLunches, status: 'eligible' as const },
    { candidate: wholeWeekCandidateFixtures.dinnerWithLeftoverLunch, status: 'eligible' as const },
    { candidate: wholeWeekCandidateFixtures.lunchtimeCooking, status: 'rejected' as const },
    { candidate: wholeWeekCandidateFixtures.lockedMismatch, status: 'rejected' as const },
    { candidate: wholeWeekCandidateFixtures.officeAssembly, status: 'rejected' as const },
    { candidate: wholeWeekCandidateFixtures.unknownOfficeSuitability, status: 'review-needed' as const },
  ],
}

const unreviewedRecipe = adaptRecipeV2ToDraftV3(pilotRecipes.find(({ slug }) => slug === 'sheet-pan-chicken-fajitas')!)
export const infeasibleWeekScenario = (() => {
  const request = planningRequestSchema.parse({
    ...structuredClone(wholeWeekPlanningRequest),
    requestId: 'planning-request-insufficient-options',
    recipeSnapshot: [unreviewedRecipe],
    serviceAssessments: [],
    preferences: { preferredRecipeIds: [], householdRecipePreferences: [] },
    lockedChoices: [],
    mealRequirements: wholeWeekPlanningRequest.mealRequirements.map((requirement) => ({ ...requirement, lock: { locked: false, reason: null } })),
  })
  const candidateProbe = candidate({
    candidateId: 'candidate-insufficient-options-probe',
    recipeId: unreviewedRecipe.identity.recipeId,
    recipeRevisionId: unreviewedRecipe.identity.revisionId,
    strategy: 'meal-time-cook',
    cookingStartsAt: '2026-11-17T02:20:00.000Z',
    batchMultiplier: 1,
    sourceYieldSelection: null,
    originMealRequirementId: null,
    allocations: [{ mealRequirementId: 'meal-requirement-2026-11-16-dinner', mealPortions: 2, service: 'fresh' }],
    ingredientSelections: ingredientSelectionsFor(unreviewedRecipe),
    serviceAssessmentId: null,
    serviceAssessmentRevisionId: null,
  })
  return { request, candidateProbes: [candidateProbe], expectedUnfillableMealRequirementIds: request.mealRequirements.filter(({ status }) => status !== 'skipped').map(({ mealRequirementId }) => mealRequirementId) }
})()
