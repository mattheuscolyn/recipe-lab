import { recipeApprovalManifestV3 } from '../data/recipeApprovalManifestV3'
import { reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments } from '../data/reviewedRecipeCatalogV3'
import { g3aSyntheticRecipes, g3aSyntheticServiceAssessments } from './g3aWeekFixtures'
import { planningRequestSchema, type PlanningRequest } from './generatorV3'
import { applyRecipeApprovalManifest } from './recipeApprovalV3'
import type { PantryAvailability } from './planningGroceryV3'
import type { RecipeV3 } from './recipeV3'

export type GenerateWeekMode = 'demo' | 'real'
export type MealKind = 'breakfast' | 'lunch' | 'dinner'
export type MealOverride = { skipped?: boolean; portions?: number; lockedRecipeId?: string | null; avoidRecipeIds?: string[] }

export type GenerateWeekPreviewConfiguration = {
  weekStart: string
  timeZone: string
  mode: GenerateWeekMode
  includedMeals: Record<MealKind, boolean>
  portions: Record<MealKind, number>
  sundayPrep: boolean
  maxDinnerActiveMinutes: number
  officeLunches: boolean
  avoidedRecipeIds: string[]
  preferredRecipeIds: string[]
  overrides?: Record<string, MealOverride>
  pantry?: PantryAvailability[]
  personalRecipes?: RecipeV3[]
}

const pad = (value: number) => String(value).padStart(2, '0')

export function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
}

/** Converts a wall-clock date/time to an instant without assuming the browser or server zone. */
export function localDateTimeToIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const target = Date.UTC(year, month - 1, day, hour, minute)
  let instant = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant))
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value)
    const represented = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'))
    instant += target - represented
  }
  return new Date(instant).toISOString()
}

const mealTime: Record<MealKind, string> = { breakfast: '08:00', lunch: '12:00', dinner: '19:00' }
const keyFor = (date: string, meal: MealKind) => `${date}-${meal}`

export function previewCatalog(mode: GenerateWeekMode, personalRecipes: RecipeV3[] = []) {
  if (mode === 'demo') return { recipes: g3aSyntheticRecipes, assessments: g3aSyntheticServiceAssessments, label: 'Synthetic demo recipes', productionEligibleCount: 0, personalEligibleCount: 0 }
  const applied = applyRecipeApprovalManifest(reviewedRecipeCatalogV3, recipeApprovalManifestV3)
  const productionRecipes = applied.activeRecipes.filter(({ review }) => review.readiness.recommendationReady)
  const eligiblePersonalRecipes = personalRecipes.filter(({ review }) => review.readiness.recommendationReady)
  const recipes = [...productionRecipes, ...eligiblePersonalRecipes]
  const revisionKeys = new Set(recipes.map(({ identity }) => `${identity.recipeId}:${identity.revisionId}`))
  return {
    recipes,
    assessments: reviewedRecipeServiceAssessments.filter((assessment) => revisionKeys.has(`${assessment.recipeId}:${assessment.recipeRevisionId}`)),
    label: 'Authorized real catalog',
    productionEligibleCount: productionRecipes.length,
    personalEligibleCount: eligiblePersonalRecipes.length,
  }
}

export function buildGenerateWeekPreviewRequest(configuration: GenerateWeekPreviewConfiguration): PlanningRequest {
  const catalog = previewCatalog(configuration.mode, configuration.personalRecipes)
  const dates = Array.from({ length: 7 }, (_, index) => shiftIsoDate(configuration.weekStart, index))
  const meals: MealKind[] = ['breakfast', 'lunch', 'dinner']
  const recipeById = new Map(catalog.recipes.map((recipe) => [recipe.identity.recipeId, recipe]))
  const mealRequirements = dates.flatMap((date) => meals.map((meal) => {
    const override = configuration.overrides?.[keyFor(date, meal)] ?? {}
    const portions = override.portions ?? configuration.portions[meal]
    const skipped = override.skipped ?? !configuration.includedMeals[meal]
    const locked = Boolean(override.lockedRecipeId && recipeById.has(override.lockedRecipeId))
    return {
      mealRequirementId: `meal-requirement-${date}-${meal}`,
      date,
      intendedAt: localDateTimeToIso(date, mealTime[meal], configuration.timeZone),
      timeZone: configuration.timeZone,
      meal,
      requestedPortions: skipped ? 0 : portions,
      status: skipped ? 'skipped' as const : 'unplanned' as const,
      constraints: {
        maxActiveMinutes: meal === 'breakfast' ? 25 : meal === 'lunch' ? 10 : configuration.maxDinnerActiveMinutes,
        maxElapsedMinutes: meal === 'breakfast' ? 90 : meal === 'lunch' ? 15 : 120,
        mustUseIngredientIds: [],
        avoidRecipeIds: override.avoidRecipeIds ?? [],
        allowLunchCooking: false,
      },
      lock: { locked, reason: locked ? 'Locked in the interactive draft preview.' : null },
    }
  }))
  const cookingWindows = [
    ...(configuration.sundayPrep ? [{ cookingWindowId: 'cooking-window-sunday-prep', start: localDateTimeToIso(shiftIsoDate(configuration.weekStart, -1), '09:00', configuration.timeZone), end: localDateTimeToIso(shiftIsoDate(configuration.weekStart, -1), '15:00', configuration.timeZone), maxActiveMinutes: 90 }] : []),
    ...dates.flatMap((date) => [
      { cookingWindowId: `cooking-window-${date}-breakfast`, start: localDateTimeToIso(date, '06:30', configuration.timeZone), end: localDateTimeToIso(date, '08:00', configuration.timeZone), maxActiveMinutes: 25 },
      { cookingWindowId: `cooking-window-${date}-prep`, start: localDateTimeToIso(date, '14:00', configuration.timeZone), end: localDateTimeToIso(date, '17:00', configuration.timeZone), maxActiveMinutes: 60 },
      { cookingWindowId: `cooking-window-${date}-dinner`, start: localDateTimeToIso(date, '17:00', configuration.timeZone), end: localDateTimeToIso(date, '19:00', configuration.timeZone), maxActiveMinutes: configuration.maxDinnerActiveMinutes },
    ]),
  ]
  const lockedChoices = mealRequirements.flatMap((requirement) => {
    const lockedRecipeId = configuration.overrides?.[keyFor(requirement.date, requirement.meal)]?.lockedRecipeId
    const recipe = lockedRecipeId ? recipeById.get(lockedRecipeId) : null
    return recipe ? [{ mealRequirementId: requirement.mealRequirementId, recipeId: recipe.identity.recipeId, recipeRevisionId: recipe.identity.revisionId }] : []
  })
  return planningRequestSchema.parse({
    requestId: `planning-request-${configuration.mode}-${configuration.weekStart}`,
    horizon: { start: dates[0], end: dates[6] },
    mealRequirements,
    recipeSnapshot: catalog.recipes,
    pantry: configuration.pantry ?? [],
    preparedLots: [],
    recentMeals: [],
    cookingWindows,
    serviceAssessments: catalog.assessments,
    hardConstraints: { avoidedRecipeIds: configuration.avoidedRecipeIds, avoidedIngredientIds: [] },
    preferences: { preferredRecipeIds: configuration.preferredRecipeIds, householdRecipePreferences: [] },
    lockedChoices,
    officeLunchPolicy: { enabled: configuration.officeLunches, maxAssembly: 'none', requireReheatingSuitable: true, allowIntrusiveOdors: false, allowRiceBased: false },
  })
}
