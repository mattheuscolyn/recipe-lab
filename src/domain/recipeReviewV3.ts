import { z } from 'zod'
import { officeServiceAssessmentSchema, type OfficeServiceAssessment } from './generatorV3'
import { computeRecipeV3Readiness, evidenceRefSchema, recipeV3Schema, type RecipeV3 } from './recipeV3'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`), `Expected a ${prefix}- identifier`)

export const recipeReviewArtifactSchema = z.object({
  reviewId: id('recipe-review'),
  recipeId: z.string().uuid(),
  baseRevisionId: id('revision'),
  revisionId: id('revision'),
  reviewedAt: z.iso.datetime(),
  reviewer: z.string().trim().min(1).max(120),
  sourceAccess: z.enum(['publisher-page-reviewed', 'publisher-page-index-reviewed', 'source-unavailable']),
  checklist: z.object({
    identityAndAttribution: z.boolean(),
    yieldAndServingBasis: z.boolean(),
    times: z.boolean(),
    ingredientsAndAmbiguities: z.boolean(),
    preparationAndStorageClaims: z.boolean(),
    publisherNutrition: z.boolean(),
    rightsDecision: z.boolean(),
  }),
  evidence: z.array(evidenceRefSchema).min(1),
  editorialDecisions: z.array(z.object({
    decisionId: id('decision'),
    subject: z.enum(['ingredient-normalization', 'meal-portions', 'scaling', 'effort', 'storage', 'make-ahead', 'reheating', 'lunch-service', 'rights']),
    status: z.enum(['approved', 'provisional', 'blocked']),
    rationale: z.string().trim().min(1).max(500),
    evidenceIds: z.array(id('evidence')),
  })),
  unresolvedIssues: z.array(z.object({
    code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    field: z.string().trim().min(1),
    requiredDecision: z.string().trim().min(1).max(500),
  })),
  reviewedRecipe: recipeV3Schema,
  serviceAssessments: z.array(officeServiceAssessmentSchema),
}).superRefine((artifact, context) => {
  if (artifact.baseRevisionId === artifact.revisionId) context.addIssue({ code: 'custom', path: ['revisionId'], message: 'A review must create a new immutable revision' })
  if (artifact.reviewedRecipe.identity.recipeId !== artifact.recipeId || artifact.reviewedRecipe.identity.revisionId !== artifact.revisionId) context.addIssue({ code: 'custom', path: ['reviewedRecipe', 'identity'], message: 'Reviewed recipe must use the artifact recipe and revision ids' })
  const evidenceIds = new Set(artifact.evidence.map(({ evidenceId }) => evidenceId))
  artifact.editorialDecisions.forEach((decision, index) => decision.evidenceIds.forEach((evidenceId) => {
    if (!evidenceIds.has(evidenceId)) context.addIssue({ code: 'custom', path: ['editorialDecisions', index, 'evidenceIds'], message: `Unknown review evidence ${evidenceId}` })
  }))
  const requiredDecisions = {
    'ingredient-normalization': 'ingredientNormalization',
    scaling: 'outputScaling',
    'meal-portions': 'mealPortions',
    effort: 'effort',
  } as const
  for (const [subject, recipeField] of Object.entries(requiredDecisions) as [keyof typeof requiredDecisions, (typeof requiredDecisions)[keyof typeof requiredDecisions]][]) {
    const decisions = artifact.editorialDecisions.filter((decision) => decision.subject === subject)
    if (decisions.length !== 1) {
      context.addIssue({ code: 'custom', path: ['editorialDecisions'], message: `Review requires exactly one ${subject} recommendation decision` })
      continue
    }
    if (decisions[0].status !== artifact.reviewedRecipe.review.recommendationDecisions[recipeField]) context.addIssue({ code: 'custom', path: ['editorialDecisions'], message: `${subject} decision must match the reviewed recipe readiness state` })
  }
  artifact.serviceAssessments.forEach((assessment, index) => {
    if (assessment.recipeId !== artifact.recipeId || assessment.recipeRevisionId !== artifact.revisionId) context.addIssue({ code: 'custom', path: ['serviceAssessments', index], message: 'Service assessment must reference the reviewed recipe revision' })
  })
})

export type RecipeReviewArtifact = z.infer<typeof recipeReviewArtifactSchema>

function assertUnchangedIdentity(base: RecipeV3, reviewed: RecipeV3) {
  const immutable = ['recipeId', 'slug', 'title'] as const
  for (const field of immutable) if (base.identity[field] !== reviewed.identity[field]) throw new Error(`Review cannot change stable identity field ${field}`)
  if (base.source.canonicalUrl !== reviewed.source.canonicalUrl) throw new Error('Review cannot replace the canonical source URL')
  const baseRequirements = base.requirements.map(({ requirementId }) => requirementId)
  const reviewedRequirements = reviewed.requirements.map(({ requirementId }) => requirementId)
  if (JSON.stringify(baseRequirements) !== JSON.stringify(reviewedRequirements)) throw new Error('Review must preserve stable ingredient requirement ids and order')
}

export function applyRecipeReviewV3(base: RecipeV3, input: unknown): { recipe: RecipeV3; serviceAssessments: OfficeServiceAssessment[]; artifact: RecipeReviewArtifact } {
  const artifact = recipeReviewArtifactSchema.parse(input)
  if (artifact.recipeId !== base.identity.recipeId || artifact.baseRevisionId !== base.identity.revisionId) throw new Error('Review artifact does not target this exact base revision')
  assertUnchangedIdentity(base, artifact.reviewedRecipe)
  const originalEvidence = new Set(base.source.evidence.map(({ evidenceId }) => evidenceId))
  const reviewedEvidence = new Set(artifact.reviewedRecipe.source.evidence.map(({ evidenceId }) => evidenceId))
  for (const evidenceId of originalEvidence) if (!reviewedEvidence.has(evidenceId)) throw new Error(`Review cannot discard prior evidence ${evidenceId}`)
  for (const evidence of artifact.evidence) if (!reviewedEvidence.has(evidence.evidenceId)) throw new Error(`Reviewed revision does not retain review evidence ${evidence.evidenceId}`)
  const recipe = structuredClone(artifact.reviewedRecipe)
  recipe.review.readiness = computeRecipeV3Readiness(recipe)
  return {
    recipe: recipeV3Schema.parse(recipe),
    serviceAssessments: artifact.serviceAssessments.map((assessment) => officeServiceAssessmentSchema.parse(assessment)),
    artifact,
  }
}

export function overlayReviewedRecipes(baseCatalog: RecipeV3[], reviews: RecipeReviewArtifact[]): RecipeV3[] {
  const byRecipeId = new Map(reviews.map((review) => [review.recipeId, review]))
  return baseCatalog.map((base) => {
    const review = byRecipeId.get(base.identity.recipeId)
    return review ? applyRecipeReviewV3(base, review).recipe : base
  })
}
