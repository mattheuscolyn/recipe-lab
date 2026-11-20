import { z } from 'zod'
import type { RecipeV3 } from './recipeV3'

const recommendationBlockerFields: Record<string, string[]> = {
  'ingredient-completeness-unreviewed': ['review.ingredientCompletenessReviewed'],
  'output-scaling-review-required': ['output.scaling'],
  'meal-portion-guidance-missing': ['output.planningGuidance.sourceServingsPerMealPortion'],
  'active-time-unknown': ['effort.activeMinutes'],
  'suitability-unknown': ['suitability.prepareAhead', 'suitability.leftoverQuality', 'suitability.storageModes', 'suitability.reheatMethod'],
  'essential-subrecipe-unresolved': ['subrecipes'],
  'rights-review-required': ['source.rights.factualMetadataUse'],
  'rights-restricted': ['source.rights.factualMetadataUse'],
}

const firstReviewSlugs = [
  'overnight-oats-base-recipe',
  'banana-flax-muffins',
  'southwest-tofu-scramble',
  'greek-chicken-pasta-salad',
  'hearty-black-bean-quesadillas',
  'sheet-pan-chicken-fajitas',
  'beef-and-cabbage-stir-fry',
  'easy-vegetable-stir-fry',
  'salmon-patties',
]

const missingRequirementSchema = z.object({ code: z.string(), fields: z.array(z.string()).min(1) })
export const generatorReadinessReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedFrom: z.literal('deterministic-v3-catalog-audit'),
  recipeCount: z.number().int().nonnegative(),
  recommendationReadyCount: z.number().int().nonnegative(),
  recommendedFirstReviewGroup: z.array(z.string()),
  entries: z.array(z.object({
    rank: z.number().int().positive(),
    recipeId: z.string().uuid(),
    revisionId: z.string(),
    slug: z.string(),
    title: z.string(),
    primaryMealRoles: z.array(z.string()),
    minimumSafeImport: z.boolean(),
    recommendationReady: z.boolean(),
    missingForRecommendation: z.array(missingRequirementSchema),
    coverage: z.object({
      reviewedIngredientCompleteness: z.boolean(),
      reviewedScaling: z.boolean(),
      reviewedMealPortionGuidance: z.boolean(),
      reviewedActiveTime: z.boolean(),
      reviewedElapsedTime: z.boolean(),
      reviewedSuitability: z.boolean(),
      reviewedRefrigeratedStorageHours: z.number().int().nonnegative().nullable(),
      reviewedFrozenStorageHours: z.number().int().nonnegative().nullable(),
      reviewedPrepareAhead: z.boolean(),
      reviewedLeftoverQuality: z.boolean(),
      reviewedReheatMethod: z.boolean(),
      reviewedLunchService: z.boolean(),
      approvedMetadataRights: z.boolean(),
    }),
  })),
})

export type GeneratorReadinessReport = z.infer<typeof generatorReadinessReportSchema>

const hasReviewedValue = (fact: { value: unknown; evidenceIds: string[]; confidence: string } | null | undefined) => Boolean(
  fact?.value !== null && fact?.value !== undefined && fact.evidenceIds.length && ['reported', 'reviewed'].includes(fact.confidence),
)

const reviewedStorageHours = (recipe: RecipeV3, mode: 'refrigerated' | 'frozen') => {
  const storage = recipe.suitability.storageModes.find((candidate) => candidate.mode === mode)
  return storage?.maxDurationHours !== null && storage?.maxDurationHours !== undefined && storage.evidenceIds.length && ['reported', 'reviewed'].includes(storage.confidence)
    ? storage.maxDurationHours
    : null
}

export function buildGeneratorReadinessReport(recipes: RecipeV3[]): GeneratorReadinessReport {
  const priority = new Map(firstReviewSlugs.map((slug, index) => [slug, index]))
  const ranked = recipes.map((recipe, catalogIndex) => ({ recipe, catalogIndex })).sort((left, right) => {
    const leftPriority = priority.get(left.recipe.identity.slug)
    const rightPriority = priority.get(right.recipe.identity.slug)
    if (leftPriority !== undefined || rightPriority !== undefined) return (leftPriority ?? Number.MAX_SAFE_INTEGER) - (rightPriority ?? Number.MAX_SAFE_INTEGER)
    return left.catalogIndex - right.catalogIndex
  })
  const entries = ranked.map(({ recipe }, index) => ({
    rank: index + 1,
    recipeId: recipe.identity.recipeId,
    revisionId: recipe.identity.revisionId,
    slug: recipe.identity.slug,
    title: recipe.identity.title,
    primaryMealRoles: recipe.mealRoles.primary,
    minimumSafeImport: recipe.review.readiness.minimumSafeImport,
    recommendationReady: recipe.review.readiness.recommendationReady,
    missingForRecommendation: recipe.review.readiness.blockers
      .filter((blocker) => blocker in recommendationBlockerFields)
      .map((code) => ({ code, fields: recommendationBlockerFields[code] })),
    coverage: {
      reviewedIngredientCompleteness: recipe.review.ingredientCompletenessReviewed,
      reviewedScaling: recipe.output.scaling.policy !== 'review-required',
      reviewedMealPortionGuidance: hasReviewedValue(recipe.output.planningGuidance.sourceServingsPerMealPortion),
      reviewedActiveTime: hasReviewedValue(recipe.effort.activeMinutes),
      reviewedElapsedTime: hasReviewedValue(recipe.effort.totalMinutes),
      reviewedSuitability: recipe.suitability.reviewState !== 'unknown',
      reviewedRefrigeratedStorageHours: reviewedStorageHours(recipe, 'refrigerated'),
      reviewedFrozenStorageHours: reviewedStorageHours(recipe, 'frozen'),
      reviewedPrepareAhead: hasReviewedValue(recipe.suitability.prepareAhead),
      reviewedLeftoverQuality: hasReviewedValue(recipe.suitability.leftoverQuality),
      reviewedReheatMethod: hasReviewedValue(recipe.suitability.reheatMethod),
      reviewedLunchService: recipe.mealRoles.primary.includes('lunch')
        && recipe.suitability.reviewState !== 'unknown'
        && reviewedStorageHours(recipe, 'refrigerated') !== null
        && hasReviewedValue(recipe.suitability.reheatMethod),
      approvedMetadataRights: recipe.source.rights.factualMetadataUse === 'approved',
    },
  }))
  return generatorReadinessReportSchema.parse({
    schemaVersion: 1,
    generatedFrom: 'deterministic-v3-catalog-audit',
    recipeCount: recipes.length,
    recommendationReadyCount: entries.filter(({ recommendationReady }) => recommendationReady).length,
    recommendedFirstReviewGroup: entries.filter(({ slug }) => priority.has(slug)).map(({ recipeId }) => recipeId),
    entries,
  })
}
