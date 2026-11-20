import { z } from 'zod'
import type { RecipeReviewArtifact } from './recipeReviewV3'
import type { RecipeV3 } from './recipeV3'

export const recipeReviewReadinessReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedFrom: z.literal('g2a-reviewed-v3-overlay'),
  recipeCount: z.number().int().nonnegative(),
  reviewedRecipeCount: z.number().int().nonnegative(),
  recommendationReadyBefore: z.number().int().nonnegative(),
  recommendationReadyAfter: z.number().int().nonnegative(),
  blockedReviewedRecipeCount: z.number().int().nonnegative(),
  coverage: z.object({
    sourceFactsReviewed: z.number().int().nonnegative(),
    publisherNutritionCaptured: z.number().int().nonnegative(),
    originalBatchScalingReviewed: z.number().int().nonnegative(),
    mealPortionGuidanceReviewed: z.number().int().nonnegative(),
    activeTimeReviewed: z.number().int().nonnegative(),
    suitabilitySourceClaimsCaptured: z.number().int().nonnegative(),
    explicitStorageWindowCaptured: z.number().int().nonnegative(),
    metadataRightsApproved: z.number().int().nonnegative(),
  }),
  entries: z.array(z.object({
    recipeId: z.string().uuid(),
    revisionId: z.string(),
    slug: z.string(),
    title: z.string(),
    reviewStage: z.enum(['g2a-source-reviewed', 'not-selected']),
    recommendationReady: z.boolean(),
    recommendationBlockers: z.array(z.string()),
    unresolvedReviewIssues: z.array(z.object({ code: z.string(), field: z.string(), requiredDecision: z.string() })),
  })),
})

export type RecipeReviewReadinessReport = z.infer<typeof recipeReviewReadinessReportSchema>

const recommendationBlockers = new Set([
  'ingredient-completeness-unreviewed',
  'output-scaling-review-required',
  'meal-portion-guidance-missing',
  'active-time-unknown',
  'suitability-unknown',
  'essential-subrecipe-unresolved',
  'rights-review-required',
  'rights-restricted',
])

export function buildRecipeReviewReadinessReport(baseRecipes: RecipeV3[], reviewedRecipes: RecipeV3[], artifacts: RecipeReviewArtifact[]): RecipeReviewReadinessReport {
  const artifactByRecipe = new Map(artifacts.map((artifact) => [artifact.recipeId, artifact]))
  const entries = reviewedRecipes.map((recipe) => {
    const artifact = artifactByRecipe.get(recipe.identity.recipeId)
    return {
      recipeId: recipe.identity.recipeId,
      revisionId: recipe.identity.revisionId,
      slug: recipe.identity.slug,
      title: recipe.identity.title,
      reviewStage: artifact ? 'g2a-source-reviewed' as const : 'not-selected' as const,
      recommendationReady: recipe.review.readiness.recommendationReady,
      recommendationBlockers: recipe.review.readiness.blockers.filter((blocker) => recommendationBlockers.has(blocker)),
      unresolvedReviewIssues: artifact?.unresolvedIssues ?? [],
    }
  })
  const reviewed = entries.filter(({ reviewStage }) => reviewStage === 'g2a-source-reviewed')
  return recipeReviewReadinessReportSchema.parse({
    schemaVersion: 1,
    generatedFrom: 'g2a-reviewed-v3-overlay',
    recipeCount: entries.length,
    reviewedRecipeCount: reviewed.length,
    recommendationReadyBefore: baseRecipes.filter(({ review }) => review.readiness.recommendationReady).length,
    recommendationReadyAfter: entries.filter(({ recommendationReady }) => recommendationReady).length,
    blockedReviewedRecipeCount: reviewed.filter(({ recommendationReady }) => !recommendationReady).length,
    coverage: {
      sourceFactsReviewed: artifacts.length,
      publisherNutritionCaptured: artifacts.filter(({ reviewedRecipe }) => reviewedRecipe.nutrition.status === 'publisher-reported').length,
      originalBatchScalingReviewed: artifacts.filter(({ reviewedRecipe }) => reviewedRecipe.output.scaling.policy !== 'review-required').length,
      mealPortionGuidanceReviewed: artifacts.filter(({ reviewedRecipe }) => reviewedRecipe.output.planningGuidance.sourceServingsPerMealPortion?.value != null).length,
      activeTimeReviewed: artifacts.filter(({ reviewedRecipe }) => reviewedRecipe.effort.activeMinutes.value != null).length,
      suitabilitySourceClaimsCaptured: artifacts.filter(({ reviewedRecipe }) => reviewedRecipe.suitability.reviewState !== 'unknown').length,
      explicitStorageWindowCaptured: artifacts.filter(({ reviewedRecipe }) => reviewedRecipe.suitability.storageModes.some(({ maxDurationHours }) => maxDurationHours != null)).length,
      metadataRightsApproved: artifacts.filter(({ reviewedRecipe }) => reviewedRecipe.source.rights.factualMetadataUse === 'approved').length,
    },
    entries,
  })
}
