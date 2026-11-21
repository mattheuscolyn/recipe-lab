import type { CandidateFeasibility, GeneratorCandidate, PlanningRequest } from './generatorV3'
import { evaluateCandidateFeasibility, generatorCandidateSchema } from './generatorV3'
import type { RecipeV3 } from './recipeV3'

export type CandidateRoutePattern = 'fresh' | 'dedicated-prep' | 'prior-meal-leftovers'

export type EnumeratedCandidateRoute = {
  routeId: string
  pattern: CandidateRoutePattern
  candidate: GeneratorCandidate
  feasibility: CandidateFeasibility
}

export type CandidateEnumerationOptions = {
  maxStoredMealsPerBatch?: number
  maxPrepWindowsPerRoute?: number
  maxRoutes?: number
}

const DEFAULTS = {
  maxStoredMealsPerBatch: 4,
  maxPrepWindowsPerRoute: 3,
  maxRoutes: 2_000,
}

const sanitize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function reviewedMinutes(recipe: RecipeV3): number | null {
  const fact = recipe.effort.totalMinutes
  return typeof fact.value === 'number' && ['reported', 'reviewed'].includes(fact.confidence) && fact.evidenceIds.length ? fact.value : null
}

function sourceYieldSelection(): GeneratorCandidate['sourceYieldSelection'] {
  // A publisher range does not authorize the generator to invent one exact batch yield.
  // Exact reviewed selections can be added to the request contract in a later milestone.
  return null
}

function ingredientSelections(recipe: RecipeV3): GeneratorCandidate['ingredientSelections'] {
  const selections: GeneratorCandidate['ingredientSelections'] = []
  for (const requirement of recipe.requirements) {
    if (!requirement.optional && requirement.alternatives.length) selections.push({ requirementId: requirement.requirementId, selection: 'primary', alternativeId: null })
  }
  return selections
}

function multipliers(recipe: RecipeV3): number[] {
  return [...new Set([1, ...(recipe.output.scaling.allowedMultipliers ?? [])])].filter((value) => value > 0).sort((left, right) => left - right)
}

function viableMultipliers(recipe: RecipeV3, allocations: GeneratorCandidate['allocations']): number[] {
  const sourceOutput = recipe.output.sourceYield.amount ?? recipe.output.sourceYield.range?.min ?? null
  const perPortion = recipe.output.planningGuidance.sourceServingsPerMealPortion?.value ?? null
  if (sourceOutput === null || perPortion === null) return multipliers(recipe).slice(0, 2)
  const requiredOutput = allocations.reduce((sum, allocation) => sum + allocation.mealPortions * perPortion, 0)
  return multipliers(recipe).filter((multiplier) => sourceOutput * multiplier >= requiredOutput - 1e-9).slice(0, 2)
}

function assessmentFor(request: PlanningRequest, recipe: RecipeV3, service: 'refrigerated-leftover' | 'frozen-leftover') {
  return request.serviceAssessments.find((assessment) => assessment.recipeId === recipe.identity.recipeId
    && assessment.recipeRevisionId === recipe.identity.revisionId
    && assessment.applicableServices.includes(service)) ?? null
}

function candidate(recipe: RecipeV3, input: Omit<GeneratorCandidate, 'recipeId' | 'recipeRevisionId' | 'sourceYieldSelection' | 'ingredientSelections'>): GeneratorCandidate {
  return generatorCandidateSchema.parse({
    ...input,
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    sourceYieldSelection: sourceYieldSelection(),
    ingredientSelections: ingredientSelections(recipe),
  })
}

function freshStart(recipe: RecipeV3, intendedAt: string): string {
  const minutes = reviewedMinutes(recipe) ?? 60
  return new Date(Date.parse(intendedAt) - minutes * 60_000).toISOString()
}

function prepStarts(request: PlanningRequest, recipe: RecipeV3, before: string, options: Required<CandidateEnumerationOptions>): string[] {
  const minutes = reviewedMinutes(recipe) ?? 60
  const duration = minutes * 60_000
  const starts: string[] = []
  const windows = request.cookingWindows
    .filter(({ start, end }) => Date.parse(start) + duration <= Math.min(Date.parse(end), Date.parse(before)))
    .sort((left, right) => Date.parse(right.end) - Date.parse(left.end))
    .slice(0, options.maxPrepWindowsPerRoute)
  for (const window of windows) {
    const latest = Math.min(Date.parse(window.end), Date.parse(before)) - duration
    const first = Date.parse(window.start)
    if (latest < first) continue
    starts.push(new Date(first).toISOString())
    if (latest > first) starts.push(new Date(latest).toISOString())
  }
  return [...new Set(starts)].sort()
}

function storedGroups<T>(values: T[], maximum: number): T[][] {
  const groups: T[][] = []
  for (let start = 0; start < values.length; start += 1) {
    for (let length = 1; length <= maximum && start + length <= values.length; length += 1) groups.push(values.slice(start, start + length))
  }
  return groups
}

function matchingRole(recipe: RecipeV3, meal: 'breakfast' | 'lunch' | 'dinner', stored: boolean): boolean {
  return recipe.mealRoles.primary.includes(meal) || (stored && meal === 'lunch' && recipe.mealRoles.primary.includes('dinner'))
}

export function enumerateGeneratorCandidates(requestInput: PlanningRequest, inputOptions: CandidateEnumerationOptions = {}): EnumeratedCandidateRoute[] {
  const request = requestInput
  const options = { ...DEFAULTS, ...inputOptions }
  const routes: EnumeratedCandidateRoute[] = []
  const requirements = request.mealRequirements.filter((requirement) => requirement.status !== 'skipped' && requirement.requestedPortions > 0)

  const add = (routeId: string, pattern: CandidateRoutePattern, value: GeneratorCandidate) => {
    if (routes.length >= options.maxRoutes) return
    routes.push({ routeId, pattern, candidate: value, feasibility: evaluateCandidateFeasibility(request, value) })
  }

  for (const requirement of requirements) {
    if (!requirement.intendedAt) continue
    for (const recipe of request.recipeSnapshot.filter((item) => matchingRole(item, requirement.meal, false))) {
      const allocations = [{ mealRequirementId: requirement.mealRequirementId, mealPortions: requirement.requestedPortions, service: 'fresh' as const }]
      for (const multiplier of viableMultipliers(recipe, allocations)) {
        const suffix = sanitize(`${requirement.mealRequirementId}-${recipe.identity.slug}-fresh-x-${multiplier}`)
        const value = candidate(recipe, {
          candidateId: `candidate-${suffix}`,
          strategy: 'meal-time-cook',
          cookingStartsAt: freshStart(recipe, requirement.intendedAt),
          storageStartsAt: null,
          batchMultiplier: multiplier,
          allocations,
          originMealRequirementId: null,
          serviceAssessmentId: null,
          serviceAssessmentRevisionId: null,
        })
        add(`route-${suffix}`, 'fresh', value)
      }
    }
  }

  for (const meal of ['breakfast', 'lunch'] as const) {
    const mealRequirements = requirements.filter((requirement) => requirement.meal === meal && requirement.intendedAt).sort((left, right) => left.intendedAt!.localeCompare(right.intendedAt!))
    for (const recipe of request.recipeSnapshot.filter((item) => matchingRole(item, meal, true))) {
      for (const group of storedGroups(mealRequirements, options.maxStoredMealsPerBatch)) {
        const firstService = group[0].intendedAt!
        const service = 'refrigerated-leftover' as const
        const assessment = assessmentFor(request, recipe, service)
        for (const cookingStartsAt of prepStarts(request, recipe, firstService, options)) {
          // The contract does not yet identify the exact refrigeration-entry step.
          // Use the earliest possible time so passive resting can never shorten storage.
          const storageStartsAt = cookingStartsAt
          const allocations = group.map((requirement) => ({ mealRequirementId: requirement.mealRequirementId, mealPortions: requirement.requestedPortions, service }))
          for (const multiplier of viableMultipliers(recipe, allocations)) {
            const suffix = sanitize(`${group.map(({ mealRequirementId }) => mealRequirementId).join('-')}-${recipe.identity.slug}-prep-${cookingStartsAt}-x-${multiplier}`)
            const value = candidate(recipe, {
              candidateId: `candidate-${suffix}`,
              strategy: 'dedicated-prep',
              cookingStartsAt,
              storageStartsAt,
              batchMultiplier: multiplier,
              allocations,
              originMealRequirementId: null,
              serviceAssessmentId: assessment?.assessmentId ?? null,
              serviceAssessmentRevisionId: assessment?.assessmentRevisionId ?? null,
            })
            add(`route-${suffix}`, 'dedicated-prep', value)
          }
        }
      }
    }
  }

  const dinners = requirements.filter(({ meal, intendedAt }) => meal === 'dinner' && intendedAt).sort((left, right) => left.intendedAt!.localeCompare(right.intendedAt!))
  const lunches = requirements.filter(({ meal, intendedAt }) => meal === 'lunch' && intendedAt).sort((left, right) => left.intendedAt!.localeCompare(right.intendedAt!))
  for (const dinner of dinners) {
    const laterLunches = lunches.filter((lunch) => lunch.intendedAt! > dinner.intendedAt!).slice(0, options.maxStoredMealsPerBatch)
    for (const recipe of request.recipeSnapshot.filter(({ mealRoles }) => mealRoles.primary.includes('dinner'))) {
      const assessment = assessmentFor(request, recipe, 'refrigerated-leftover')
      for (const group of storedGroups(laterLunches, Math.min(2, options.maxStoredMealsPerBatch)).filter((items) => items[0] === laterLunches[0])) {
        const allocations: GeneratorCandidate['allocations'] = [
          { mealRequirementId: dinner.mealRequirementId, mealPortions: dinner.requestedPortions, service: 'fresh' },
          ...group.map((requirement) => ({ mealRequirementId: requirement.mealRequirementId, mealPortions: requirement.requestedPortions, service: 'refrigerated-leftover' as const })),
        ]
        for (const multiplier of viableMultipliers(recipe, allocations)) {
          const suffix = sanitize(`${dinner.mealRequirementId}-${group.map(({ mealRequirementId }) => mealRequirementId).join('-')}-${recipe.identity.slug}-leftovers-x-${multiplier}`)
          const value = candidate(recipe, {
            candidateId: `candidate-${suffix}`,
            strategy: 'prior-meal-batch',
            cookingStartsAt: freshStart(recipe, dinner.intendedAt!),
            storageStartsAt: null,
            batchMultiplier: multiplier,
            allocations,
            originMealRequirementId: dinner.mealRequirementId,
            serviceAssessmentId: assessment?.assessmentId ?? null,
            serviceAssessmentRevisionId: assessment?.assessmentRevisionId ?? null,
          })
          add(`route-${suffix}`, 'prior-meal-leftovers', value)
        }
      }
    }
  }

  return routes.sort((left, right) => left.routeId.localeCompare(right.routeId))
}
