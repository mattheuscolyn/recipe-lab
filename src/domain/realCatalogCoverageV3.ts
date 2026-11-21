import { z } from 'zod'
import { canonicalIngredients } from '../data/pilotCatalog'
import type { OfficeServiceAssessment, PlanningRequest, GeneratorCandidate, RejectedReason } from './generatorV3'
import { evaluateCandidateFeasibility, generatorCandidateSchema, planningRequestSchema } from './generatorV3'
import { applyRecipeApprovalManifest, type RecipeApprovalManifest } from './recipeApprovalV3'
import { buildBatchGroceryDemand } from './planningGroceryV3'
import { planCookingBatch } from './planningV3'
import type { RecipeReviewArtifact } from './recipeReviewV3'
import type { RecipeV3 } from './recipeV3'

const blockerSummarySchema = z.object({
  code: z.string(),
  count: z.number().int().positive(),
  missingFields: z.array(z.string()),
})

const routeSchema = z.object({
  routeId: z.string().regex(/^route-[a-z0-9-]+$/),
  scenarioId: z.string(),
  recipeId: z.string().uuid(),
  recipeRevisionId: z.string(),
  recipeSlug: z.string(),
  recipeTitle: z.string(),
  sourceReviewed: z.boolean(),
  recommendationReady: z.boolean(),
  servicePattern: z.enum(['fresh', 'dedicated-prep', 'prior-dinner-leftovers']),
  mealRequirementIds: z.array(z.string()).min(1),
  status: z.enum(['eligible', 'review-needed', 'rejected']),
  reasons: z.array(z.object({ code: z.string(), disposition: z.enum(['rejected', 'review-needed']), missingFields: z.array(z.string()) })),
  reasonCodes: z.array(z.string()),
  missingFields: z.array(z.string()),
  groceryDemand: z.object({
    status: z.enum(['quantified', 'review-needed', 'unavailable']),
    knownLineCount: z.number().int().nonnegative(),
    unresolvedLineCount: z.number().int().nonnegative(),
    uncertaintyCount: z.number().int().nonnegative(),
  }),
})

const slotSchema = z.object({
  mealRequirementId: z.string(),
  date: z.iso.date(),
  meal: z.enum(['breakfast', 'lunch', 'dinner']),
  requestedPortions: z.number().int().nonnegative(),
  skipped: z.boolean(),
  locked: z.boolean(),
  coverage: z.enum(['skipped', 'eligible', 'uncovered']),
  eligibleRouteIds: z.array(z.string()),
  reviewNeededRouteCount: z.number().int().nonnegative(),
  rejectedRouteCount: z.number().int().nonnegative(),
  blockers: z.array(blockerSummarySchema),
})

export const realCatalogCoverageReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedFrom: z.literal('g2b2a-real-catalog-g1-coverage'),
  catalog: z.object({
    recipeCount: z.number().int().nonnegative(),
    sourceReviewedRecipeCount: z.number().int().nonnegative(),
    productionApprovalBundleCount: z.number().int().nonnegative(),
    productionRecommendationReadyCount: z.number().int().nonnegative(),
    recipesWithEligibleRoutes: z.number().int().nonnegative(),
  }),
  roleTargets: z.object({
    breakfast: z.object({ target: z.literal(3), sourceReviewed: z.number().int().nonnegative(), minimumAdditionalSourceReviews: z.number().int().nonnegative() }),
    lunch: z.object({ target: z.literal(3), sourceReviewed: z.number().int().nonnegative(), minimumAdditionalSourceReviews: z.number().int().nonnegative() }),
    dinner: z.object({ target: z.literal(6), sourceReviewed: z.number().int().nonnegative(), utilityCredible: z.number().int().nonnegative(), minimumAdditionalSourceReviews: z.number().int().nonnegative() }),
    utilityCaveats: z.array(z.string()),
  }),
  preferenceHandling: z.literal('unknown-unless-explicitly-provided'),
  scenarios: z.array(z.object({
    scenarioId: z.string(),
    label: z.string(),
    requiredSlotCount: z.number().int().nonnegative(),
    skippedSlotCount: z.number().int().nonnegative(),
    coveredSlotCount: z.number().int().nonnegative(),
    complete: z.boolean(),
    evaluatedRouteCount: z.number().int().nonnegative(),
    eligibleRouteCount: z.number().int().nonnegative(),
    reviewNeededRouteCount: z.number().int().nonnegative(),
    rejectedRouteCount: z.number().int().nonnegative(),
    slots: z.array(slotSchema),
    /** Detailed records are retained for every source-reviewed or eligible route; all 25 recipes still contribute to counts and slot blocker aggregates. */
    routes: z.array(routeSchema),
  })),
})

export type RealCatalogCoverageReport = z.infer<typeof realCatalogCoverageReportSchema>

type Scenario = { scenarioId: string; label: string; request: PlanningRequest }
type RouteProbe = { routeId: string; servicePattern: z.infer<typeof routeSchema>['servicePattern']; candidate: GeneratorCandidate }

const WEEK_DATES = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'] as const
const pad = (value: number) => String(value).padStart(2, '0')
const utcDay = (date: string, offset: number) => {
  const instant = new Date(`${date}T00:00:00.000Z`)
  instant.setUTCDate(instant.getUTCDate() + offset)
  return `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`
}
const intendedAt = (date: string, meal: 'breakfast' | 'lunch' | 'dinner') => meal === 'breakfast'
  ? `${date}T16:00:00.000Z`
  : meal === 'lunch' ? `${date}T20:00:00.000Z` : `${utcDay(date, 1)}T03:00:00.000Z`

function mealRequirement(date: string, meal: 'breakfast' | 'lunch' | 'dinner', portions: number, skipped = false, locked = false) {
  return {
    mealRequirementId: `meal-requirement-${date}-${meal}`,
    date,
    intendedAt: intendedAt(date, meal),
    timeZone: 'America/Los_Angeles',
    meal,
    requestedPortions: skipped ? 0 : portions,
    status: skipped ? 'skipped' as const : 'unplanned' as const,
    constraints: {
      maxActiveMinutes: meal === 'breakfast' ? 30 : meal === 'lunch' ? 10 : 45,
      maxElapsedMinutes: meal === 'breakfast' ? 600 : meal === 'lunch' ? 15 : 90,
      mustUseIngredientIds: [],
      avoidRecipeIds: [],
      allowLunchCooking: false,
    },
    lock: { locked, reason: locked ? 'Existing owner-selected meal retained by the coverage probe.' : null },
  }
}

function cookingWindows(constrained: boolean) {
  return [
    { cookingWindowId: 'cooking-window-sunday-prep', start: '2026-11-22T18:00:00.000Z', end: '2026-11-22T23:00:00.000Z', maxActiveMinutes: constrained ? 60 : 90 },
    ...WEEK_DATES.flatMap((date) => [
      { cookingWindowId: `cooking-window-${date}-breakfast`, start: `${date}T07:30:00.000Z`, end: `${date}T16:00:00.000Z`, maxActiveMinutes: 30 },
      { cookingWindowId: `cooking-window-${date}-dinner`, start: `${utcDay(date, 1)}T01:00:00.000Z`, end: `${utcDay(date, 1)}T03:00:00.000Z`, maxActiveMinutes: constrained ? 25 : 45 },
    ]),
  ]
}

function buildScenario(activeRecipes: RecipeV3[], assessments: OfficeServiceAssessment[], constrained: boolean): Scenario {
  const scenarioId = constrained ? 'scenario-constrained-week' : 'scenario-ordinary-week'
  const lockedRecipe = activeRecipes.find(({ identity }) => identity.slug === 'sheet-pan-chicken-fajitas')
  if (!lockedRecipe) throw new Error('Coverage scenario needs Sheet Pan Chicken Fajitas')
  const mealRequirements = WEEK_DATES.flatMap((date, day) => [
    mealRequirement(date, 'breakfast', 2),
    mealRequirement(date, 'lunch', day % 2 === 0 ? 1 : 2, day >= 5),
    mealRequirement(date, 'dinner', 2, constrained && day === 4, constrained && day === 2),
  ])
  if (constrained) {
    mealRequirements.forEach((requirement) => {
      if (requirement.meal === 'dinner') {
        requirement.constraints.maxActiveMinutes = 25
        requirement.constraints.maxElapsedMinutes = 45
      }
    })
  }
  return {
    scenarioId,
    label: constrained ? 'Constrained week with a lock, one skipped dinner, and shorter cooking windows' : 'Ordinary week with two-person breakfasts and dinners plus weekday office lunches',
    request: planningRequestSchema.parse({
      requestId: `planning-request-${constrained ? 'constrained' : 'ordinary'}-real-catalog`,
      horizon: { start: WEEK_DATES[0], end: WEEK_DATES[6] },
      mealRequirements,
      recipeSnapshot: activeRecipes,
      pantry: [],
      preparedLots: [],
      recentMeals: [],
      cookingWindows: cookingWindows(constrained),
      serviceAssessments: assessments.filter((assessment) => activeRecipes.some(({ identity }) => identity.recipeId === assessment.recipeId && identity.revisionId === assessment.recipeRevisionId)),
      hardConstraints: { avoidedRecipeIds: [], avoidedIngredientIds: constrained ? ['ingredient-ground-beef'] : [] },
      preferences: { preferredRecipeIds: [], householdRecipePreferences: [] },
      lockedChoices: constrained ? [{ mealRequirementId: 'meal-requirement-2026-11-25-dinner', recipeId: lockedRecipe.identity.recipeId, recipeRevisionId: lockedRecipe.identity.revisionId }] : [],
      officeLunchPolicy: { enabled: true, maxAssembly: 'none', requireReheatingSuitable: true, allowIntrusiveOdors: false, allowRiceBased: false },
    }),
  }
}

function sourceYieldSelection(recipe: RecipeV3) {
  if (!recipe.output.sourceYield.range) return null
  return { amount: recipe.output.sourceYield.range.min, evidenceIds: recipe.output.sourceYield.evidenceIds, confidence: 'reported' as const }
}

function ingredientSelections(recipe: RecipeV3): GeneratorCandidate['ingredientSelections'] {
  const selections: GeneratorCandidate['ingredientSelections'] = []
  for (const requirement of recipe.requirements) {
    if (requirement.optional) selections.push({ requirementId: requirement.requirementId, selection: 'excluded-optional', alternativeId: null })
    else if (requirement.alternatives.length) selections.push({ requirementId: requirement.requirementId, selection: 'primary', alternativeId: null })
  }
  return selections
}

function cookingStart(recipe: RecipeV3, mealTime: string, fallbackMinutes: number) {
  const duration = typeof recipe.effort.totalMinutes.value === 'number' ? recipe.effort.totalMinutes.value : fallbackMinutes
  return new Date(Date.parse(mealTime) - duration * 60_000).toISOString()
}

function assessmentFor(request: PlanningRequest, recipe: RecipeV3, service: 'fresh' | 'refrigerated-leftover') {
  return request.serviceAssessments.find((assessment) => assessment.recipeId === recipe.identity.recipeId
    && assessment.recipeRevisionId === recipe.identity.revisionId
    && assessment.applicableServices.includes(service)) ?? null
}

function candidate(recipe: RecipeV3, input: Omit<GeneratorCandidate, 'recipeId' | 'recipeRevisionId' | 'batchMultiplier' | 'sourceYieldSelection' | 'ingredientSelections'>): GeneratorCandidate {
  return generatorCandidateSchema.parse({
    ...input,
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    batchMultiplier: 1,
    sourceYieldSelection: sourceYieldSelection(recipe),
    ingredientSelections: ingredientSelections(recipe),
  })
}

function routeProbes(scenario: Scenario): RouteProbe[] {
  const probes: RouteProbe[] = []
  const request = scenario.request
  for (const requirement of request.mealRequirements) {
    if (requirement.status === 'skipped') continue
    if (requirement.meal === 'breakfast' || requirement.meal === 'dinner') {
      for (const recipe of request.recipeSnapshot.filter(({ mealRoles }) => mealRoles.primary.includes(requirement.meal))) {
        const assessment = assessmentFor(request, recipe, 'fresh')
        const suffix = `${scenario.scenarioId.replace(/^scenario-/, '')}-${requirement.date}-${requirement.meal}-${recipe.identity.slug}`
        probes.push({
          routeId: `route-${suffix}`,
          servicePattern: 'fresh',
          candidate: candidate(recipe, {
            candidateId: `candidate-${suffix}`,
            strategy: 'meal-time-cook',
            cookingStartsAt: cookingStart(recipe, requirement.intendedAt!, 60),
            allocations: [{ mealRequirementId: requirement.mealRequirementId, mealPortions: requirement.requestedPortions, service: 'fresh' }],
            originMealRequirementId: null,
            serviceAssessmentId: assessment?.assessmentId ?? null,
            serviceAssessmentRevisionId: assessment?.assessmentRevisionId ?? null,
          }),
        })
      }
    }
    if (requirement.meal !== 'lunch') continue
    for (const recipe of request.recipeSnapshot.filter(({ mealRoles }) => mealRoles.primary.some((role) => role === 'lunch' || role === 'dinner'))) {
      const assessment = assessmentFor(request, recipe, 'refrigerated-leftover')
      const suffix = `${scenario.scenarioId.replace(/^scenario-/, '')}-${requirement.date}-prep-${recipe.identity.slug}`
      probes.push({
        routeId: `route-${suffix}`,
        servicePattern: 'dedicated-prep',
        candidate: candidate(recipe, {
          candidateId: `candidate-${suffix}`,
          strategy: 'dedicated-prep',
          cookingStartsAt: '2026-11-22T18:00:00.000Z',
          allocations: [{ mealRequirementId: requirement.mealRequirementId, mealPortions: requirement.requestedPortions, service: 'refrigerated-leftover' }],
          originMealRequirementId: null,
          serviceAssessmentId: assessment?.assessmentId ?? null,
          serviceAssessmentRevisionId: assessment?.assessmentRevisionId ?? null,
        }),
      })
    }
    const day = WEEK_DATES.indexOf(requirement.date as typeof WEEK_DATES[number])
    if (day <= 0) continue
    const origin = request.mealRequirements.find((item) => item.date === WEEK_DATES[day - 1] && item.meal === 'dinner' && item.status !== 'skipped')
    if (!origin) continue
    for (const recipe of request.recipeSnapshot.filter(({ mealRoles }) => mealRoles.primary.includes('dinner'))) {
      const assessment = assessmentFor(request, recipe, 'refrigerated-leftover')
      const suffix = `${scenario.scenarioId.replace(/^scenario-/, '')}-${requirement.date}-leftover-${recipe.identity.slug}`
      probes.push({
        routeId: `route-${suffix}`,
        servicePattern: 'prior-dinner-leftovers',
        candidate: candidate(recipe, {
          candidateId: `candidate-${suffix}`,
          strategy: 'prior-meal-batch',
          cookingStartsAt: cookingStart(recipe, origin.intendedAt!, 60),
          allocations: [
            { mealRequirementId: origin.mealRequirementId, mealPortions: origin.requestedPortions, service: 'fresh' },
            { mealRequirementId: requirement.mealRequirementId, mealPortions: requirement.requestedPortions, service: 'refrigerated-leftover' },
          ],
          originMealRequirementId: origin.mealRequirementId,
          serviceAssessmentId: assessment?.assessmentId ?? null,
          serviceAssessmentRevisionId: assessment?.assessmentRevisionId ?? null,
        }),
      })
    }
  }
  return probes
}

function grocerySummary(recipe: RecipeV3, probe: RouteProbe, reasons: RejectedReason[]) {
  try {
    const batch = planCookingBatch(recipe, {
      batchId: `batch-${probe.routeId.replace(/^route-/, '')}`,
      groceryDemandId: `grocery-demand-${probe.routeId.replace(/^route-/, '')}`,
      multiplier: probe.candidate.batchMultiplier,
      sourceYieldSelection: probe.candidate.sourceYieldSelection ?? undefined,
    })
    const demand = buildBatchGroceryDemand({ recipes: [recipe], ingredients: canonicalIngredients, batches: [batch], scope: 'outstanding', includeOptional: false })
    const reviewNeeded = reasons.some(({ code }) => ['ingredient-selection-grocery-review-required', 'recommendation-readiness-required'].includes(code))
    return {
      status: reviewNeeded || demand.uncertainties.length ? 'review-needed' as const : 'quantified' as const,
      knownLineCount: demand.lines.filter(({ unresolved }) => !unresolved).length,
      unresolvedLineCount: demand.lines.filter(({ unresolved }) => unresolved).length,
      uncertaintyCount: demand.uncertainties.length,
    }
  } catch {
    return { status: 'unavailable' as const, knownLineCount: 0, unresolvedLineCount: 0, uncertaintyCount: 0 }
  }
}

function summarizeBlockers(routes: z.infer<typeof routeSchema>[]) {
  const byCode = new Map<string, { count: number; missingFields: Set<string> }>()
  routes.forEach((route) => route.reasons.forEach((reason) => {
    const entry = byCode.get(reason.code) ?? { count: 0, missingFields: new Set<string>() }
    entry.count += 1
    reason.missingFields.forEach((field) => entry.missingFields.add(field))
    byCode.set(reason.code, entry)
  }))
  return [...byCode.entries()].map(([code, value]) => ({ code, count: value.count, missingFields: [...value.missingFields].sort() })).sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
}

export function buildRealCatalogCoverageReport(input: {
  baseRecipes: RecipeV3[]
  reviewArtifacts: RecipeReviewArtifact[]
  serviceAssessments: OfficeServiceAssessment[]
  productionManifest: RecipeApprovalManifest
}): RealCatalogCoverageReport {
  const applied = applyRecipeApprovalManifest(input.baseRecipes, input.productionManifest)
  const activeRecipes = applied.activeRecipes
  const reviewedIds = new Set(input.reviewArtifacts.map(({ recipeId }) => recipeId))
  const scenarios = [buildScenario(activeRecipes, input.serviceAssessments, false), buildScenario(activeRecipes, input.serviceAssessments, true)]
  const scenarioReports = scenarios.map((scenario) => {
    const evaluatedRoutes = routeProbes(scenario).map((probe) => {
      const recipe = activeRecipes.find(({ identity }) => identity.recipeId === probe.candidate.recipeId && identity.revisionId === probe.candidate.recipeRevisionId)!
      const result = evaluateCandidateFeasibility(scenario.request, probe.candidate)
      return routeSchema.parse({
        routeId: probe.routeId,
        scenarioId: scenario.scenarioId,
        recipeId: recipe.identity.recipeId,
        recipeRevisionId: recipe.identity.revisionId,
        recipeSlug: recipe.identity.slug,
        recipeTitle: recipe.identity.title,
        sourceReviewed: reviewedIds.has(recipe.identity.recipeId),
        recommendationReady: recipe.review.readiness.recommendationReady,
        servicePattern: probe.servicePattern,
        mealRequirementIds: probe.candidate.allocations.map(({ mealRequirementId }) => mealRequirementId),
        status: result.status,
        reasons: result.reasons.map(({ code, disposition, missingFields }) => ({ code, disposition, missingFields })),
        reasonCodes: [...new Set(result.reasons.map(({ code }) => code))].sort(),
        missingFields: [...new Set(result.reasons.flatMap(({ missingFields }) => missingFields))].sort(),
        groceryDemand: grocerySummary(recipe, probe, result.reasons),
      })
    })
    const slots = scenario.request.mealRequirements.map((requirement) => {
      const candidates = evaluatedRoutes.filter(({ mealRequirementIds }) => mealRequirementIds.includes(requirement.mealRequirementId))
      const eligible = candidates.filter(({ status }) => status === 'eligible')
      const reviewNeeded = candidates.filter(({ status }) => status === 'review-needed')
      const rejected = candidates.filter(({ status }) => status === 'rejected')
      return slotSchema.parse({
        mealRequirementId: requirement.mealRequirementId,
        date: requirement.date,
        meal: requirement.meal,
        requestedPortions: requirement.requestedPortions,
        skipped: requirement.status === 'skipped',
        locked: requirement.lock.locked,
        coverage: requirement.status === 'skipped' ? 'skipped' : eligible.length ? 'eligible' : 'uncovered',
        eligibleRouteIds: eligible.map(({ routeId }) => routeId),
        reviewNeededRouteCount: reviewNeeded.length,
        rejectedRouteCount: rejected.length,
        blockers: summarizeBlockers(candidates),
      })
    })
    const required = slots.filter(({ skipped }) => !skipped)
    return {
      scenarioId: scenario.scenarioId,
      label: scenario.label,
      requiredSlotCount: required.length,
      skippedSlotCount: slots.length - required.length,
      coveredSlotCount: required.filter(({ coverage }) => coverage === 'eligible').length,
      complete: required.every(({ coverage }) => coverage === 'eligible'),
      evaluatedRouteCount: evaluatedRoutes.length,
      eligibleRouteCount: evaluatedRoutes.filter(({ status }) => status === 'eligible').length,
      reviewNeededRouteCount: evaluatedRoutes.filter(({ status }) => status === 'review-needed').length,
      rejectedRouteCount: evaluatedRoutes.filter(({ status }) => status === 'rejected').length,
      slots,
      routes: evaluatedRoutes.filter(({ sourceReviewed, status }) => sourceReviewed || status === 'eligible'),
    }
  })
  const sourceReviewed = activeRecipes.filter(({ identity }) => reviewedIds.has(identity.recipeId))
  const sourceReviewedRoleCount = (role: 'breakfast' | 'lunch' | 'dinner') => sourceReviewed.filter(({ mealRoles }) => mealRoles.primary.includes(role)).length
  const eligibleRecipeIds = new Set(scenarioReports.flatMap(({ routes }) => routes.filter(({ status }) => status === 'eligible').map(({ recipeId }) => recipeId)))
  return realCatalogCoverageReportSchema.parse({
    schemaVersion: 1,
    generatedFrom: 'g2b2a-real-catalog-g1-coverage',
    catalog: {
      recipeCount: activeRecipes.length,
      sourceReviewedRecipeCount: sourceReviewed.length,
      productionApprovalBundleCount: input.productionManifest.bundles.length,
      productionRecommendationReadyCount: activeRecipes.filter(({ review }) => review.readiness.recommendationReady).length,
      recipesWithEligibleRoutes: eligibleRecipeIds.size,
    },
    roleTargets: {
      breakfast: { target: 3, sourceReviewed: sourceReviewedRoleCount('breakfast'), minimumAdditionalSourceReviews: Math.max(0, 3 - sourceReviewedRoleCount('breakfast')) },
      lunch: { target: 3, sourceReviewed: sourceReviewedRoleCount('lunch'), minimumAdditionalSourceReviews: Math.max(0, 3 - sourceReviewedRoleCount('lunch')) },
      dinner: { target: 6, sourceReviewed: sourceReviewedRoleCount('dinner'), utilityCredible: Math.max(0, sourceReviewedRoleCount('dinner') - 1), minimumAdditionalSourceReviews: Math.max(0, 6 - Math.max(0, sourceReviewedRoleCount('dinner') - 1)) },
      utilityCaveats: ['Easy Vegetable Stir Fry is excluded from credible standalone-dinner coverage until an authorized owner decides that the captured 1.5-cup serving is an adequate meal or a modeled companion is added.'],
    },
    preferenceHandling: 'unknown-unless-explicitly-provided',
    scenarios: scenarioReports,
  })
}
