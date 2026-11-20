import { z } from 'zod'
import { applyRecipeApprovalManifest, recipeApprovalManifestSchema, type RecipeApprovalManifest } from './recipeApprovalV3'
import type { RecipeReviewArtifact } from './recipeReviewV3'
import type { RecipeV3 } from './recipeV3'

export const recipeApprovalReadinessReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedFrom: z.literal('g2b1-production-approval-manifest'),
  reviewedRecipeCount: z.number().int().nonnegative(),
  productionApprovalRecordCount: z.number().int().nonnegative(),
  recommendationReadyCount: z.number().int().nonnegative(),
  awaitingDecisionCount: z.number().int().nonnegative(),
  entries: z.array(z.object({
    recipeId: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    activeRevisionId: z.string(),
    approvalState: z.enum(['awaiting-decisions', 'passed-all-fresh-recommendation-gates']),
    recommendationReadyForFreshUse: z.boolean(),
    storedUseReadiness: z.object({
      refrigeratedLeftovers: z.boolean(),
      refrigeratedPrepAhead: z.boolean(),
      frozenUse: z.boolean(),
    }),
    recommendationDecisionStates: z.object({
      ingredientNormalization: z.string(),
      outputScaling: z.string(),
      mealPortions: z.string(),
      effort: z.string(),
      factualMetadataRights: z.string(),
    }),
    recommendationBlockers: z.array(z.string()),
    unresolvedReviewIssues: z.array(z.string()),
    productionApprovalRecordRevisionIds: z.array(z.string()),
  })),
})

export type RecipeApprovalReadinessReport = z.infer<typeof recipeApprovalReadinessReportSchema>

const recommendationBlocker = (code: string) => [
  'ingredient-completeness-unreviewed',
  'output-scaling-review-required',
  'meal-portion-guidance-missing',
  'active-time-unknown',
  'essential-subrecipe-unresolved',
  'rights-review-required',
  'rights-restricted',
  'ingredient-normalization-approval-required',
  'output-scaling-approval-required',
  'meal-portion-approval-required',
  'effort-approval-required',
].includes(code)

const reviewedValue = (fact: { value: unknown; confidence: string; evidenceIds: string[] }) => fact.value !== null && fact.evidenceIds.length > 0 && ['reported', 'reviewed'].includes(fact.confidence)
const storageReady = (recipe: RecipeV3, mode: 'refrigerated' | 'frozen') => recipe.suitability.storageModes.some((storage) => storage.mode === mode && storage.maxDurationHours !== null && storage.evidenceIds.length > 0 && ['reported', 'reviewed'].includes(storage.confidence))

export function buildRecipeApprovalReadinessReport(baseRecipes: RecipeV3[], artifacts: RecipeReviewArtifact[], manifestInput: RecipeApprovalManifest): RecipeApprovalReadinessReport {
  const manifest = recipeApprovalManifestSchema.parse(manifestInput)
  if (manifest.bundles.some(({ records }) => records.some(({ context }) => context !== 'production'))) throw new Error('Production readiness reports cannot count synthetic approval records')
  const applied = applyRecipeApprovalManifest(baseRecipes, manifest)
  const artifactsByRecipe = new Map(artifacts.map((artifact) => [artifact.recipeId, artifact]))
  const recordsByRecipe = new Map<string, string[]>()
  manifest.bundles.forEach(({ recipeId, records }) => recordsByRecipe.set(recipeId, [...(recordsByRecipe.get(recipeId) ?? []), ...records.map(({ recordRevisionId }) => recordRevisionId)]))
  const entries = applied.activeRecipes.filter(({ identity }) => artifactsByRecipe.has(identity.recipeId)).map((recipe) => {
    const artifact = artifactsByRecipe.get(recipe.identity.recipeId)!
    const recommendationReady = recipe.review.readiness.recommendationReady
    const refrigerated = storageReady(recipe, 'refrigerated')
    const unresolvedReviewIssues = artifact.unresolvedIssues.filter(({ code }) => {
      if (code === 'rights-approval-required') return recipe.source.rights.factualMetadataUse === 'review-needed'
      if (['flour-conversion-provisional', 'chicken-weight-provisional', 'vegetable-branching-unmodeled'].includes(code)) return recipe.review.recommendationDecisions.ingredientNormalization !== 'approved'
      return true
    }).map(({ code }) => code)
    return {
      recipeId: recipe.identity.recipeId,
      slug: recipe.identity.slug,
      title: recipe.identity.title,
      activeRevisionId: recipe.identity.revisionId,
      approvalState: recommendationReady ? 'passed-all-fresh-recommendation-gates' as const : 'awaiting-decisions' as const,
      recommendationReadyForFreshUse: recommendationReady,
      storedUseReadiness: {
        refrigeratedLeftovers: recommendationReady && refrigerated && reviewedValue(recipe.suitability.leftoverQuality) && ['good', 'acceptable'].includes(String(recipe.suitability.leftoverQuality.value)),
        refrigeratedPrepAhead: recommendationReady && refrigerated && reviewedValue(recipe.suitability.prepareAhead) && ['yes', 'conditional'].includes(String(recipe.suitability.prepareAhead.value)),
        frozenUse: recommendationReady && storageReady(recipe, 'frozen'),
      },
      recommendationDecisionStates: {
        ...recipe.review.recommendationDecisions,
        factualMetadataRights: recipe.source.rights.factualMetadataUse,
      },
      recommendationBlockers: recipe.review.readiness.blockers.filter(recommendationBlocker),
      unresolvedReviewIssues,
      productionApprovalRecordRevisionIds: recordsByRecipe.get(recipe.identity.recipeId) ?? [],
    }
  })
  return recipeApprovalReadinessReportSchema.parse({
    schemaVersion: 1,
    generatedFrom: 'g2b1-production-approval-manifest',
    reviewedRecipeCount: entries.length,
    productionApprovalRecordCount: manifest.bundles.reduce((sum, { records }) => sum + records.length, 0),
    recommendationReadyCount: entries.filter(({ recommendationReadyForFreshUse }) => recommendationReadyForFreshUse).length,
    awaitingDecisionCount: entries.filter(({ approvalState }) => approvalState === 'awaiting-decisions').length,
    entries,
  })
}
