import { computeRecipeV3Readiness, recipeV3Schema, type RecipeV3 } from './recipeV3'
import { planningRequestSchema, type OfficeServiceAssessment, type PlanningRequest } from './generatorV3'
import { reviewedFixture, reviewedServiceAssessment } from './generatorV3Fixtures'

type FixtureDefinition = { source: string; id: string; slug: string; title: string; role: 'breakfast' | 'lunch' | 'dinner'; output: number; active: number; total: number }

const definitions: FixtureDefinition[] = [
  { source: 'banana-flax-muffins', id: '30000000-0000-4000-8000-000000000001', slug: 'synthetic-banana-muffins', title: 'Synthetic Banana Muffins', role: 'breakfast', output: 4, active: 15, total: 35 },
  { source: 'southwest-tofu-scramble', id: '30000000-0000-4000-8000-000000000002', slug: 'synthetic-tofu-scramble', title: 'Synthetic Tofu Scramble', role: 'breakfast', output: 4, active: 10, total: 20 },
  { source: 'greek-chicken-pasta-salad', id: '30000000-0000-4000-8000-000000000003', slug: 'synthetic-office-pasta-salad', title: 'Synthetic Office Pasta Salad', role: 'lunch', output: 6, active: 25, total: 45 },
  { source: 'sheet-pan-chicken-fajitas', id: '30000000-0000-4000-8000-000000000004', slug: 'synthetic-sheet-pan-chicken', title: 'Synthetic Sheet-Pan Chicken', role: 'dinner', output: 4, active: 15, total: 55 },
  { source: 'creamy-pesto-chicken', id: '30000000-0000-4000-8000-000000000005', slug: 'synthetic-pesto-chicken', title: 'Synthetic Pesto Chicken', role: 'dinner', output: 4, active: 20, total: 35 },
  { source: 'beef-and-cabbage-stir-fry', id: '30000000-0000-4000-8000-000000000006', slug: 'synthetic-beef-cabbage', title: 'Synthetic Beef and Cabbage', role: 'dinner', output: 4, active: 25, total: 30 },
  { source: 'one-pot-cheeseburger-pasta', id: '30000000-0000-4000-8000-000000000007', slug: 'synthetic-cheeseburger-pasta', title: 'Synthetic Cheeseburger Pasta', role: 'dinner', output: 4, active: 20, total: 30 },
  { source: 'easy-sesame-chicken', id: '30000000-0000-4000-8000-000000000008', slug: 'synthetic-sesame-chicken', title: 'Synthetic Sesame Chicken', role: 'dinner', output: 4, active: 20, total: 30 },
  { source: 'smothered-pork-chops', id: '30000000-0000-4000-8000-000000000009', slug: 'synthetic-pork-chops', title: 'Synthetic Pork Chops', role: 'dinner', output: 4, active: 25, total: 35 },
]

function fixtureRecipe(definition: FixtureDefinition): RecipeV3 {
  const recipe = structuredClone(reviewedFixture(definition.source, definition.id, definition.role, definition.output))
  const evidenceIds = recipe.effort.totalMinutes.evidenceIds
  recipe.identity = { ...recipe.identity, revisionId: `revision-g3a-${definition.slug}-v1`, slug: definition.slug, title: definition.title }
  recipe.source = { ...recipe.source, canonicalUrl: `https://example.invalid/recipe-lab/g3a/${definition.slug}`, publisher: 'Recipe Lab synthetic G3a fixture' }
  recipe.effort.activeMinutes = { value: definition.active, evidenceIds, confidence: 'reviewed', unknownReason: null }
  recipe.effort.totalMinutes = { value: definition.total, evidenceIds, confidence: 'reviewed', unknownReason: null }
  recipe.effort.passiveMinutes = { value: Math.max(0, definition.total - definition.active), evidenceIds, confidence: 'reviewed', unknownReason: null }
  recipe.review.readiness = computeRecipeV3Readiness(recipe)
  return recipeV3Schema.parse(recipe)
}

export const g3aSyntheticRecipes = definitions.map(fixtureRecipe)
export const g3aSyntheticServiceAssessments: OfficeServiceAssessment[] = g3aSyntheticRecipes.map((recipe) => reviewedServiceAssessment(recipe, `g3a-${recipe.identity.slug}`))

const dates = ['2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05', '2027-02-06', '2027-02-07']
const lunchPortions = [1, 2, 1, 2, 1, 0, 0]

function nextDate(date: string): string {
  const instant = new Date(`${date}T12:00:00.000Z`)
  instant.setUTCDate(instant.getUTCDate() + 1)
  return instant.toISOString().slice(0, 10)
}

function intendedAt(date: string, meal: 'breakfast' | 'lunch' | 'dinner') {
  if (meal === 'breakfast') return `${date}T16:00:00.000Z`
  if (meal === 'lunch') return `${date}T20:00:00.000Z`
  return `${nextDate(date)}T03:00:00.000Z`
}

const lockedDinner = g3aSyntheticRecipes.find(({ identity }) => identity.slug === 'synthetic-beef-cabbage')!
const dislikedDinner = g3aSyntheticRecipes.find(({ identity }) => identity.slug === 'synthetic-pork-chops')!
const pantryRequirement = g3aSyntheticRecipes[0].requirements.find(({ selectedPlanningQuantity }) => selectedPlanningQuantity !== null)!

export const g3aCompleteWeekRequest: PlanningRequest = planningRequestSchema.parse({
  requestId: 'planning-request-g3a-complete-week',
  horizon: { start: dates[0], end: dates[6] },
  mealRequirements: dates.flatMap((date, day) => (['breakfast', 'lunch', 'dinner'] as const).map((meal) => {
    const skipped = meal === 'lunch' && lunchPortions[day] === 0
    const locked = meal === 'dinner' && day === 2
    return {
      mealRequirementId: `meal-requirement-${date}-${meal}`,
      date,
      intendedAt: intendedAt(date, meal),
      timeZone: 'America/Los_Angeles',
      meal,
      requestedPortions: skipped ? 0 : meal === 'lunch' ? lunchPortions[day] : 2,
      status: skipped ? 'skipped' as const : 'unplanned' as const,
      constraints: { maxActiveMinutes: meal === 'breakfast' ? 20 : meal === 'lunch' ? 10 : 45, maxElapsedMinutes: meal === 'breakfast' ? 60 : meal === 'lunch' ? 15 : 90, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: false },
      lock: { locked, reason: locked ? 'Synthetic owner lock retained by G3a.' : null },
    }
  })),
  recipeSnapshot: g3aSyntheticRecipes,
  pantry: [{ availabilityId: 'availability-g3a-breakfast-staple', canonicalIngredientId: pantryRequirement.canonicalIngredientId, variantId: pantryRequirement.variantId, confidence: 'confirmed-measured', quantity: { amount: 1, unit: pantryRequirement.selectedPlanningQuantity!.unit } }],
  preparedLots: [],
  recentMeals: [],
  cookingWindows: [
    { cookingWindowId: 'cooking-window-g3a-sunday-prep', start: '2027-01-31T17:00:00.000Z', end: '2027-01-31T23:00:00.000Z', maxActiveMinutes: 90 },
    ...dates.flatMap((date) => [
      { cookingWindowId: `cooking-window-${date}-breakfast`, start: `${date}T14:30:00.000Z`, end: `${date}T16:00:00.000Z`, maxActiveMinutes: 25 },
      { cookingWindowId: `cooking-window-${date}-prep`, start: `${date}T21:00:00.000Z`, end: `${date}T23:30:00.000Z`, maxActiveMinutes: 60 },
      { cookingWindowId: `cooking-window-${date}-dinner`, start: `${nextDate(date)}T01:00:00.000Z`, end: `${nextDate(date)}T03:00:00.000Z`, maxActiveMinutes: 45 },
    ]),
  ],
  serviceAssessments: g3aSyntheticServiceAssessments,
  hardConstraints: { avoidedRecipeIds: [], avoidedIngredientIds: [] },
  preferences: {
    preferredRecipeIds: [],
    householdRecipePreferences: [{ recipeId: dislikedDinner.identity.recipeId, likedVotes: 0, dislikedVotes: 2, unknownVotes: 0 }],
  },
  lockedChoices: [{ mealRequirementId: 'meal-requirement-2027-02-03-dinner', recipeId: lockedDinner.identity.recipeId, recipeRevisionId: lockedDinner.identity.revisionId }],
  officeLunchPolicy: { enabled: true, maxAssembly: 'none', requireReheatingSuitable: true, allowIntrusiveOdors: false, allowRiceBased: false },
})

export const g3aImpossibleWeekRequest: PlanningRequest = planningRequestSchema.parse({
  ...structuredClone(g3aCompleteWeekRequest),
  requestId: 'planning-request-g3a-impossible-week',
  hardConstraints: { ...g3aCompleteWeekRequest.hardConstraints, avoidedRecipeIds: g3aSyntheticRecipes.map(({ identity }) => identity.recipeId) },
  mealRequirements: g3aCompleteWeekRequest.mealRequirements.map((requirement) => ({ ...requirement, lock: { locked: false, reason: null } })),
  lockedChoices: [],
})
