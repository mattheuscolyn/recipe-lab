import { z } from 'zod'
import { canonicalIngredientSchema, unitCodeSchema, type CanonicalIngredient } from './catalog'
import { dimensionOf } from './units'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`), `Expected a ${prefix}- identifier`)
const text = (label: string, max = 300) => z.string().trim().min(1, `${label} is required`).max(max)
const nullableText = (label: string, max = 300) => text(label, max).nullable()
const positiveFinite = z.number().positive().finite()
const nonnegativeInteger = z.number().int().nonnegative()

export const confidenceSchema = z.enum(['reported', 'reviewed', 'estimated', 'uncertain', 'unknown'])
export const provenanceKindSchema = z.enum([
  'publisher-jsonld',
  'publisher-page',
  'publisher-nutrition-panel',
  'manual-source-review',
  'rule-derived',
  'editorial-judgment',
  'user-entered',
])

export const evidenceRefSchema = z.object({
  evidenceId: id('evidence'),
  kind: provenanceKindSchema,
  sourceUrl: z.url().nullable(),
  capturedAt: z.iso.datetime().nullable(),
  sourceLabel: nullableText('Evidence source label', 160),
  confidence: confidenceSchema,
  reviewerNote: nullableText('Evidence reviewer note', 500),
})

const sourcedSchema = <T>(valueSchema: z.ZodType<T>) => z.object({
  value: valueSchema.nullable(),
  evidenceIds: z.array(id('evidence')),
  confidence: confidenceSchema,
  unknownReason: nullableText('Unknown reason', 300),
}).superRefine((value, context) => {
  if (value.value === null) {
    if (value.confidence !== 'unknown') context.addIssue({ code: 'custom', path: ['confidence'], message: 'A missing value must have unknown confidence' })
    if (!value.unknownReason) context.addIssue({ code: 'custom', path: ['unknownReason'], message: 'A missing value needs an explicit unknown reason' })
  } else {
    if (value.confidence === 'unknown') context.addIssue({ code: 'custom', path: ['confidence'], message: 'A known value cannot have unknown confidence' })
    if (value.unknownReason !== null) context.addIssue({ code: 'custom', path: ['unknownReason'], message: 'A known value cannot have an unknown reason' })
    if (!value.evidenceIds.length) context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'A known value needs provenance evidence' })
  }
})

const rangeSchema = z.object({ min: positiveFinite, max: positiveFinite }).refine(({ min, max }) => max >= min, {
  message: 'Range maximum must be at least its minimum',
  path: ['max'],
})

export const quantityFactSchema = z.object({
  amount: positiveFinite.nullable(),
  range: rangeSchema.nullable(),
  unit: unitCodeSchema,
  approximate: z.boolean(),
  originalText: nullableText('Original quantity text', 500),
  evidenceIds: z.array(id('evidence')),
}).superRefine((quantity, context) => {
  if ((quantity.amount === null) === (quantity.range === null)) context.addIssue({ code: 'custom', path: ['amount'], message: 'Provide exactly one amount or range' })
  if (!quantity.evidenceIds.length) context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'A quantity fact needs provenance evidence' })
})

export const ingredientAlternativeSchema = z.object({
  alternativeId: id('alternative'),
  label: text('Alternative label', 200),
  canonicalIngredientId: id('ingredient'),
  variantId: id('variant'),
  quantity: quantityFactSchema.nullable(),
  relationship: z.enum(['either-or', 'optional-addition', 'substitution']),
})

export const recipeComponentSchema = z.object({
  componentId: id('component'),
  label: text('Component label', 120),
  order: nonnegativeInteger,
  optional: z.boolean(),
  evidenceIds: z.array(id('evidence')).min(1),
})

export const recipeRequirementV3Schema = z.object({
  requirementId: id('requirement'),
  sourceLineId: id('source-line'),
  componentId: id('component'),
  originalText: text('Original source line', 500),
  sourceQuantity: quantityFactSchema.nullable(),
  nonQuantified: z.enum(['to-taste', 'as-needed', 'for-serving']).nullable(),
  canonicalIngredientId: id('ingredient'),
  variantId: id('variant'),
  selectedPlanningQuantity: quantityFactSchema.nullable(),
  preparation: nullableText('Preparation', 200),
  optional: z.boolean(),
  alternatives: z.array(ingredientAlternativeSchema),
  scaling: z.enum(['linear', 'whole-item', 'fixed', 'review-required']),
  sourcePackage: z.object({
    count: z.number().int().positive(),
    netQuantityEach: quantityFactSchema,
    usableQuantityEach: quantityFactSchema.nullable(),
    yieldAssumption: sourcedSchema(text('Yield assumption', 500)).nullable(),
  }).nullable(),
  confidence: z.enum(['reviewed', 'needs-review']),
  reviewNote: nullableText('Requirement review note', 500),
  evidenceIds: z.array(id('evidence')).min(1),
}).superRefine((requirement, context) => {
  if (requirement.selectedPlanningQuantity === null && requirement.nonQuantified === null) context.addIssue({ code: 'custom', path: ['selectedPlanningQuantity'], message: 'A requirement needs a planning quantity or a non-quantified state' })
  if (requirement.selectedPlanningQuantity !== null && requirement.nonQuantified !== null) context.addIssue({ code: 'custom', path: ['nonQuantified'], message: 'A quantified requirement cannot also be non-quantified' })
  if (requirement.confidence === 'needs-review' && !requirement.reviewNote) context.addIssue({ code: 'custom', path: ['reviewNote'], message: 'A needs-review requirement needs a review note' })
  if (requirement.sourcePackage?.usableQuantityEach && !requirement.sourcePackage.yieldAssumption) context.addIssue({ code: 'custom', path: ['sourcePackage', 'yieldAssumption'], message: 'A usable package quantity needs an explicit yield assumption' })
})

export const subrecipeDependencySchema = z.object({
  dependencyId: id('dependency'),
  recipeId: z.string().uuid().nullable(),
  revisionId: id('revision').nullable(),
  sourceUrl: z.url().nullable(),
  label: text('Subrecipe label', 160),
  quantity: quantityFactSchema.nullable(),
  required: z.boolean(),
  resolution: z.enum(['linked-version', 'source-fact-only', 'unresolved']),
}).superRefine((dependency, context) => {
  if (dependency.resolution === 'linked-version' && dependency.recipeId === null) context.addIssue({ code: 'custom', path: ['recipeId'], message: 'A linked subrecipe needs a recipe id' })
  if (dependency.resolution === 'linked-version' && dependency.revisionId === null) context.addIssue({ code: 'custom', path: ['revisionId'], message: 'A linked subrecipe needs an exact revision id' })
  if (dependency.resolution !== 'linked-version' && dependency.recipeId !== null) context.addIssue({ code: 'custom', path: ['recipeId'], message: 'Only a linked-version dependency may name an internal recipe id' })
  if (dependency.resolution !== 'linked-version' && dependency.revisionId !== null) context.addIssue({ code: 'custom', path: ['revisionId'], message: 'Only a linked-version dependency may name a revision id' })
  if (dependency.recipeId === null && dependency.sourceUrl === null && dependency.resolution !== 'unresolved') context.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'A source-only dependency needs a source URL or linked recipe' })
})

const unknownableNumber = sourcedSchema(z.number().nonnegative().finite())
export const nutritionRecordSchema = z.object({
  status: z.enum(['unknown', 'publisher-reported', 'computed-estimate']),
  basis: z.enum(['source-serving', 'full-recipe', 'discrete-item']).nullable(),
  servingsInBasis: positiveFinite.nullable(),
  caloriesKcal: unknownableNumber,
  macros: z.object({
    proteinG: unknownableNumber,
    carbohydrateG: unknownableNumber,
    fatG: unknownableNumber,
    fiberG: unknownableNumber,
  }),
  includes: z.array(text('Nutrition inclusion', 160)),
  excludes: z.array(text('Nutrition exclusion', 160)),
  computationMethod: nullableText('Nutrition computation method', 500),
}).superRefine((nutrition, context) => {
  const metrics = [nutrition.caloriesKcal, nutrition.macros.proteinG, nutrition.macros.carbohydrateG, nutrition.macros.fatG, nutrition.macros.fiberG]
  if (nutrition.status === 'unknown') {
    if (nutrition.basis !== null || nutrition.servingsInBasis !== null || nutrition.computationMethod !== null) context.addIssue({ code: 'custom', message: 'Unknown nutrition cannot claim a basis, serving count, or computation method' })
    if (metrics.some(({ value }) => value !== null)) context.addIssue({ code: 'custom', message: 'Unknown nutrition cannot contain numeric values' })
  } else {
    if (nutrition.basis === null) context.addIssue({ code: 'custom', path: ['basis'], message: 'Known nutrition needs an explicit basis' })
    if (metrics.every(({ value }) => value === null)) context.addIssue({ code: 'custom', message: 'Known nutrition needs at least one reported or estimated value' })
  }
  if (nutrition.status === 'computed-estimate' && !nutrition.computationMethod) context.addIssue({ code: 'custom', path: ['computationMethod'], message: 'Computed nutrition needs a documented method' })
  if (nutrition.status === 'publisher-reported' && nutrition.computationMethod !== null) context.addIssue({ code: 'custom', path: ['computationMethod'], message: 'Publisher-reported nutrition cannot claim a computation method' })
})

export const equipmentRequirementSchema = z.object({
  equipmentId: id('equipment'),
  kind: text('Equipment kind', 120),
  quantity: z.number().int().positive(),
  sizeOrCapacity: nullableText('Equipment size or capacity', 120),
  required: z.boolean(),
  evidenceIds: z.array(id('evidence')).min(1),
})

export const structuredStepSchema = z.object({
  stepId: id('step'),
  stage: z.enum(['advance-prep', 'prep', 'cook', 'rest', 'assemble', 'store', 'serve']),
  order: z.number().int().positive(),
  instruction: text('Independent step instruction', 1000),
  ingredientUses: z.array(z.object({
    requirementId: id('requirement'),
    use: z.enum(['all', 'remaining', 'divided', 'quantity']),
    quantity: quantityFactSchema.nullable(),
  })),
  equipmentIds: z.array(id('equipment')),
  duration: z.object({ kind: z.enum(['active', 'passive']), minutes: nonnegativeInteger.nullable() }),
  timer: z.object({ label: text('Timer label', 120), seconds: z.number().int().positive() }).nullable(),
  canPrepareAhead: z.boolean().nullable(),
  blockingStepIds: z.array(id('step')),
  techniqueTipIds: z.array(id('technique-tip')),
  evidenceIds: z.array(id('evidence')).min(1),
})

export const suitabilityRecordSchema = z.object({
  reviewState: z.enum(['unknown', 'source-reported', 'editor-reviewed']),
  prepareAhead: sourcedSchema(z.enum(['yes', 'no', 'conditional'])),
  leftoverQuality: sourcedSchema(z.enum(['good', 'acceptable', 'poor', 'unknown'])),
  storageModes: z.array(z.object({
    mode: z.enum(['refrigerated', 'frozen', 'room-temperature']),
    maxDurationHours: nonnegativeInteger.nullable(),
    evidenceIds: z.array(id('evidence')).min(1),
    confidence: confidenceSchema,
  })),
  thawRequired: sourcedSchema(z.boolean()),
  reheatMethod: sourcedSchema(text('Reheat method', 300)),
  notes: z.array(text('Suitability note', 500)),
}).superRefine((suitability, context) => {
  if (suitability.reviewState === 'unknown' && suitability.storageModes.length) context.addIssue({ code: 'custom', path: ['storageModes'], message: 'Unknown suitability cannot claim storage modes' })
})

export const readinessSchema = z.object({
  minimumSafeImport: z.boolean(),
  recommendationReady: z.boolean(),
  cookingModeReady: z.boolean(),
  blockers: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
})

export const recommendationDecisionStatusSchema = z.enum(['unreviewed', 'provisional', 'approved', 'blocked'])
export const recommendationDecisionsSchema = z.object({
  ingredientNormalization: recommendationDecisionStatusSchema,
  outputScaling: recommendationDecisionStatusSchema,
  mealPortions: recommendationDecisionStatusSchema,
  effort: recommendationDecisionStatusSchema,
})

const recipeV3StructureSchema = z.object({
  schemaVersion: z.literal(3),
  identity: z.object({
    recipeId: z.string().uuid(),
    revisionId: id('revision'),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: text('Title', 120),
    description: text('Description', 500),
    emoji: text('Emoji', 8).nullable(),
    lifecycle: z.enum(['draft', 'source-reviewed', 'kitchen-tested', 'retired']),
  }),
  source: z.object({
    publisher: text('Publisher', 120),
    author: nullableText('Author', 120),
    canonicalUrl: z.url(),
    checkedAt: z.iso.date(),
    rating: z.number().min(0).max(5).nullable(),
    reviewCount: z.number().int().nonnegative().nullable(),
    selectionRationale: text('Selection rationale', 500),
    rights: z.object({
      factualMetadataUse: z.enum(['review-needed', 'approved', 'restricted']),
      methodTextUse: z.enum(['independent-summary-only', 'licensed']),
      imageUse: z.enum(['none', 'licensed']),
      note: nullableText('Rights note', 500),
    }),
    evidence: z.array(evidenceRefSchema).min(1),
  }),
  output: z.object({
    kind: z.enum(['flexible-batch', 'fixed-portions', 'discrete-items']),
    sourceYield: z.object({
      amount: positiveFinite.nullable(),
      range: rangeSchema.nullable(),
      unit: text('Yield unit', 60),
      label: text('Yield label', 160),
      evidenceIds: z.array(id('evidence')).min(1),
    }).superRefine((sourceYield, context) => {
      if ((sourceYield.amount === null) === (sourceYield.range === null)) context.addIssue({ code: 'custom', path: ['amount'], message: 'Provide exactly one source yield amount or range' })
    }),
    sourceServing: z.object({
      servingsPerRecipe: positiveFinite.nullable(),
      servingSize: quantityFactSchema.nullable(),
      servingLabel: nullableText('Serving label', 160),
      evidenceIds: z.array(id('evidence')),
    }),
    discreteItem: z.object({
      itemName: text('Discrete item name', 80),
      itemCount: z.number().int().positive(),
      itemsPerSourceServing: positiveFinite.nullable(),
      evidenceIds: z.array(id('evidence')).min(1),
    }).nullable(),
    scaling: z.object({
      policy: z.enum(['linear-reviewed', 'whole-items-only', 'fixed-batch', 'review-required']),
      allowedMultipliers: z.array(positiveFinite).min(1).nullable(),
      note: nullableText('Scaling note', 500),
    }),
    planningGuidance: z.object({
      defaultMealPortions: positiveFinite.nullable(),
      sourceServingsPerMealPortion: sourcedSchema(positiveFinite).nullable(),
      adequacyNote: nullableText('Adequacy note', 500),
      sideSuggestionRefs: z.array(z.string().min(1).max(160)),
    }),
  }),
  components: z.array(recipeComponentSchema).min(1),
  requirements: z.array(recipeRequirementV3Schema).min(1),
  subrecipes: z.array(subrecipeDependencySchema),
  nutrition: nutritionRecordSchema,
  effort: z.object({
    prepMinutes: unknownableNumber,
    cookMinutes: unknownableNumber,
    passiveMinutes: unknownableNumber,
    totalMinutes: unknownableNumber,
    activeMinutes: unknownableNumber,
    effortLevel: sourcedSchema(z.enum(['low', 'medium', 'high'])),
    attentionPattern: sourcedSchema(z.enum(['mostly-hands-off', 'periodic', 'continuous'])),
  }),
  equipment: z.array(equipmentRequirementSchema),
  equipmentReviewState: z.enum(['unknown', 'source-reported', 'editor-reviewed']),
  mealRoles: z.object({
    primary: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'dessert', 'snack', 'side'])).min(1),
    tags: z.array(text('Meal role tag', 60)),
  }),
  steps: z.array(structuredStepSchema),
  legacyMethodSummary: z.array(text('Legacy method summary', 500)),
  suitability: suitabilityRecordSchema,
  review: z.object({
    sourceFactsReviewedAt: z.iso.date(),
    ingredientCompletenessReviewed: z.boolean(),
    methodIndependentlyWritten: z.boolean(),
    structuredStepsReviewed: z.boolean(),
    safetyReviewed: z.boolean(),
    kitchenTestedAt: z.iso.date().nullable(),
    recommendationDecisions: recommendationDecisionsSchema,
    readiness: readinessSchema,
  }),
})

export type RecipeV3 = z.infer<typeof recipeV3StructureSchema>
export type RecipeV3Readiness = z.infer<typeof readinessSchema>
export type EvidenceRef = z.infer<typeof evidenceRefSchema>
export type QuantityFact = z.infer<typeof quantityFactSchema>
export type Confidence = z.infer<typeof confidenceSchema>
export type ProvenanceKind = z.infer<typeof provenanceKindSchema>
export type Sourced<T> = { value: T | null; evidenceIds: string[]; confidence: Confidence; unknownReason: string | null }
export type IngredientAlternative = z.infer<typeof ingredientAlternativeSchema>
export type RecipeComponent = z.infer<typeof recipeComponentSchema>
export type RecipeRequirementV3 = z.infer<typeof recipeRequirementV3Schema>
export type SubrecipeDependency = z.infer<typeof subrecipeDependencySchema>
export type NutritionRecord = z.infer<typeof nutritionRecordSchema>
export type EquipmentRequirement = z.infer<typeof equipmentRequirementSchema>
export type StructuredStep = z.infer<typeof structuredStepSchema>
export type SuitabilityRecord = z.infer<typeof suitabilityRecordSchema>

export function computeRecipeV3Readiness(recipe: RecipeV3): RecipeV3Readiness {
  const blockers: string[] = []
  const minimumSafeImport = recipe.review.ingredientCompletenessReviewed
  if (!minimumSafeImport) blockers.push('ingredient-completeness-unreviewed')
  if (recipe.output.scaling.policy === 'review-required') blockers.push('output-scaling-review-required')
  if (recipe.output.planningGuidance.sourceServingsPerMealPortion?.value == null) blockers.push('meal-portion-guidance-missing')
  if (recipe.effort.activeMinutes.value === null) blockers.push('active-time-unknown')
  if (recipe.suitability.reviewState === 'unknown') blockers.push('suitability-unknown')
  if (recipe.subrecipes.some(({ required, resolution }) => required && resolution !== 'linked-version')) blockers.push('essential-subrecipe-unresolved')
  if (recipe.source.rights.factualMetadataUse === 'review-needed') blockers.push('rights-review-required')
  if (recipe.source.rights.factualMetadataUse === 'restricted') blockers.push('rights-restricted')
  if (recipe.review.recommendationDecisions.ingredientNormalization !== 'approved') blockers.push('ingredient-normalization-approval-required')
  if (recipe.review.recommendationDecisions.outputScaling !== 'approved') blockers.push('output-scaling-approval-required')
  if (recipe.review.recommendationDecisions.mealPortions !== 'approved') blockers.push('meal-portion-approval-required')
  if (recipe.review.recommendationDecisions.effort !== 'approved') blockers.push('effort-approval-required')
  const recommendationReady = minimumSafeImport && blockers.length === 0
  if (!recipe.steps.length) blockers.push('structured-steps-missing')
  if (!recipe.review.structuredStepsReviewed) blockers.push('structured-steps-unreviewed')
  if (!recipe.review.safetyReviewed) blockers.push('safety-review-missing')
  if (recipe.equipmentReviewState === 'unknown') blockers.push('equipment-unreviewed')
  if (recipe.identity.lifecycle === 'kitchen-tested' && recipe.review.kitchenTestedAt === null) blockers.push('kitchen-test-date-unknown')
  const cookingModeReady = recommendationReady
    && recipe.steps.length > 0
    && recipe.review.structuredStepsReviewed
    && recipe.review.safetyReviewed
    && recipe.equipmentReviewState !== 'unknown'
    && recipe.source.rights.factualMetadataUse === 'approved'
    && (recipe.identity.lifecycle !== 'kitchen-tested' || recipe.review.kitchenTestedAt !== null)
  return { minimumSafeImport, recommendationReady, cookingModeReady, blockers }
}

const allEvidenceIds = (recipe: RecipeV3): string[] => {
  const ids = [
    ...recipe.output.sourceYield.evidenceIds,
    ...recipe.output.sourceServing.evidenceIds,
    ...(recipe.output.sourceServing.servingSize?.evidenceIds ?? []),
    ...(recipe.output.discreteItem?.evidenceIds ?? []),
    ...(recipe.output.planningGuidance.sourceServingsPerMealPortion?.evidenceIds ?? []),
    ...recipe.components.flatMap(({ evidenceIds }) => evidenceIds),
    ...recipe.requirements.flatMap((requirement) => [
      ...requirement.evidenceIds,
      ...(requirement.sourceQuantity?.evidenceIds ?? []),
      ...(requirement.selectedPlanningQuantity?.evidenceIds ?? []),
      ...requirement.alternatives.flatMap(({ quantity }) => quantity?.evidenceIds ?? []),
      ...(requirement.sourcePackage?.netQuantityEach.evidenceIds ?? []),
      ...(requirement.sourcePackage?.usableQuantityEach?.evidenceIds ?? []),
      ...(requirement.sourcePackage?.yieldAssumption?.evidenceIds ?? []),
    ]),
    ...recipe.subrecipes.flatMap(({ quantity }) => quantity?.evidenceIds ?? []),
    ...[
      recipe.nutrition.caloriesKcal,
      recipe.nutrition.macros.proteinG,
      recipe.nutrition.macros.carbohydrateG,
      recipe.nutrition.macros.fatG,
      recipe.nutrition.macros.fiberG,
      recipe.effort.prepMinutes,
      recipe.effort.cookMinutes,
      recipe.effort.passiveMinutes,
      recipe.effort.totalMinutes,
      recipe.effort.activeMinutes,
      recipe.effort.effortLevel,
      recipe.effort.attentionPattern,
      recipe.suitability.prepareAhead,
      recipe.suitability.leftoverQuality,
      recipe.suitability.thawRequired,
      recipe.suitability.reheatMethod,
    ].flatMap(({ evidenceIds }) => evidenceIds),
    ...recipe.equipment.flatMap(({ evidenceIds }) => evidenceIds),
    ...recipe.steps.flatMap((step) => [
      ...step.evidenceIds,
      ...step.ingredientUses.flatMap(({ quantity }) => quantity?.evidenceIds ?? []),
    ]),
    ...recipe.suitability.storageModes.flatMap(({ evidenceIds }) => evidenceIds),
  ]
  return ids
}

export const recipeV3Schema = recipeV3StructureSchema.superRefine((recipe, context) => {
  const unique = <T>(values: T[], path: (string | number)[], label: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path, message: `${label} must be unique` })
  }
  unique(recipe.source.evidence.map(({ evidenceId }) => evidenceId), ['source', 'evidence'], 'Evidence ids')
  unique(recipe.components.map(({ componentId }) => componentId), ['components'], 'Component ids')
  unique(recipe.requirements.map(({ requirementId }) => requirementId), ['requirements'], 'Requirement ids')
  unique(recipe.requirements.flatMap(({ alternatives }) => alternatives.map(({ alternativeId }) => alternativeId)), ['requirements'], 'Alternative ids')
  unique(recipe.subrecipes.map(({ dependencyId }) => dependencyId), ['subrecipes'], 'Subrecipe dependency ids')
  unique(recipe.equipment.map(({ equipmentId }) => equipmentId), ['equipment'], 'Equipment ids')
  unique(recipe.steps.map(({ stepId }) => stepId), ['steps'], 'Step ids')
  unique(recipe.steps.map(({ order }) => order), ['steps'], 'Step order values')

  const evidenceIds = new Set(recipe.source.evidence.map(({ evidenceId }) => evidenceId))
  allEvidenceIds(recipe).forEach((evidenceId) => {
    if (!evidenceIds.has(evidenceId)) context.addIssue({ code: 'custom', path: ['source', 'evidence'], message: `Unknown evidence reference ${evidenceId}` })
  })
  const componentIds = new Set(recipe.components.map(({ componentId }) => componentId))
  recipe.requirements.forEach((requirement, index) => {
    if (!componentIds.has(requirement.componentId)) context.addIssue({ code: 'custom', path: ['requirements', index, 'componentId'], message: `Unknown component ${requirement.componentId}` })
  })
  const requirementIds = new Set(recipe.requirements.map(({ requirementId }) => requirementId))
  const equipmentIds = new Set(recipe.equipment.map(({ equipmentId }) => equipmentId))
  const stepIds = new Set(recipe.steps.map(({ stepId }) => stepId))
  recipe.steps.forEach((step, stepIndex) => {
    step.ingredientUses.forEach(({ requirementId }, useIndex) => {
      if (!requirementIds.has(requirementId)) context.addIssue({ code: 'custom', path: ['steps', stepIndex, 'ingredientUses', useIndex, 'requirementId'], message: `Unknown requirement ${requirementId}` })
    })
    step.equipmentIds.forEach((equipmentId, equipmentIndex) => {
      if (!equipmentIds.has(equipmentId)) context.addIssue({ code: 'custom', path: ['steps', stepIndex, 'equipmentIds', equipmentIndex], message: `Unknown equipment ${equipmentId}` })
    })
    step.blockingStepIds.forEach((stepId, blockingIndex) => {
      if (stepId === step.stepId || !stepIds.has(stepId)) context.addIssue({ code: 'custom', path: ['steps', stepIndex, 'blockingStepIds', blockingIndex], message: `Invalid blocking step ${stepId}` })
    })
  })

  if (recipe.output.kind === 'discrete-items') {
    if (!recipe.output.discreteItem) context.addIssue({ code: 'custom', path: ['output', 'discreteItem'], message: 'Discrete output needs an item definition' })
    if (recipe.output.sourceYield.range !== null || !Number.isInteger(recipe.output.sourceYield.amount)) context.addIssue({ code: 'custom', path: ['output', 'sourceYield'], message: 'Discrete output needs a whole-number source yield' })
    if (recipe.output.discreteItem && recipe.output.sourceYield.amount !== recipe.output.discreteItem.itemCount) context.addIssue({ code: 'custom', path: ['output', 'discreteItem', 'itemCount'], message: 'Discrete item count must match source yield' })
  } else if (recipe.output.discreteItem !== null) context.addIssue({ code: 'custom', path: ['output', 'discreteItem'], message: 'Only discrete output may define discrete items' })

  const multipliers = recipe.output.scaling.allowedMultipliers
  if (recipe.output.scaling.policy === 'review-required' && multipliers !== null) context.addIssue({ code: 'custom', path: ['output', 'scaling', 'allowedMultipliers'], message: 'Review-required scaling cannot claim approved multipliers' })
  if (multipliers && !multipliers.includes(1)) context.addIssue({ code: 'custom', path: ['output', 'scaling', 'allowedMultipliers'], message: 'Approved multipliers must include the original batch' })
  if (multipliers && recipe.output.discreteItem && multipliers.some((multiplier) => !Number.isInteger(multiplier * recipe.output.discreteItem!.itemCount))) context.addIssue({ code: 'custom', path: ['output', 'scaling', 'allowedMultipliers'], message: 'Approved multipliers cannot produce fractional items' })

  if (recipe.review.kitchenTestedAt !== null && recipe.identity.lifecycle !== 'kitchen-tested') context.addIssue({ code: 'custom', path: ['review', 'kitchenTestedAt'], message: 'Only a kitchen-tested lifecycle may declare a kitchen-test date' })

  const expected = computeRecipeV3Readiness(recipe)
  if (JSON.stringify(recipe.review.readiness) !== JSON.stringify(expected)) context.addIssue({ code: 'custom', path: ['review', 'readiness'], message: 'Readiness must be derived from the v3 completeness gates' })
})

export type RecipeV3Catalog = { ingredients: CanonicalIngredient[]; recipes: RecipeV3[] }
export type RecipeV3CatalogIssue = { path: string; message: string }
export type RecipeV3CatalogResult = { success: true; data: RecipeV3Catalog } | { success: false; issues: RecipeV3CatalogIssue[] }

export function validateRecipeV3Catalog(input: unknown): RecipeV3CatalogResult {
  if (!input || typeof input !== 'object') return { success: false, issues: [{ path: '$', message: 'V3 catalog must be an object' }] }
  const raw = input as Record<string, unknown>
  const ingredientsResult = canonicalIngredientSchema.array().safeParse(raw.ingredients)
  const recipesResult = recipeV3Schema.array().safeParse(raw.recipes)
  const issues: RecipeV3CatalogIssue[] = []
  if (!ingredientsResult.success) ingredientsResult.error.issues.forEach((issue) => issues.push({ path: `ingredients.${issue.path.join('.')}`, message: issue.message }))
  if (!recipesResult.success) recipesResult.error.issues.forEach((issue) => issues.push({ path: `recipes.${issue.path.join('.')}`, message: issue.message }))
  if (!ingredientsResult.success || !recipesResult.success) return { success: false, issues }

  const ingredients = ingredientsResult.data
  const recipes = recipesResult.data
  const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const duplicate = <T>(items: T[], value: (item: T) => string, path: string) => {
    const seen = new Set<string>()
    items.forEach((item, index) => {
      const key = value(item)
      if (seen.has(key)) issues.push({ path: `${path}.${index}`, message: `Duplicate ${key}` })
      seen.add(key)
    })
  }
  duplicate(ingredients, ({ id: ingredientId }) => ingredientId, 'ingredients')
  duplicate(recipes, ({ identity }) => identity.recipeId, 'recipes')
  duplicate(recipes, ({ identity }) => identity.revisionId, 'recipes')
  duplicate(recipes, ({ identity }) => identity.slug, 'recipes')
  const recipeIds = new Set(recipes.map(({ identity }) => identity.recipeId))
  const revisionKeys = new Set(recipes.map(({ identity }) => `${identity.recipeId}:${identity.revisionId}`))

  recipes.forEach((recipe, recipeIndex) => {
    recipe.requirements.forEach((requirement, requirementIndex) => {
      const path = `recipes.${recipeIndex}.requirements.${requirementIndex}`
      const ingredient = ingredientMap.get(requirement.canonicalIngredientId)
      if (!ingredient) issues.push({ path: `${path}.canonicalIngredientId`, message: `Unknown canonical ingredient ${requirement.canonicalIngredientId}` })
      else {
        if (!ingredient.variants.some(({ id: variantId }) => variantId === requirement.variantId)) issues.push({ path: `${path}.variantId`, message: `Variant ${requirement.variantId} does not belong to ${ingredient.id}` })
        if (requirement.selectedPlanningQuantity && dimensionOf(requirement.selectedPlanningQuantity.unit) !== dimensionOf(ingredient.baseUnit)) issues.push({ path: `${path}.selectedPlanningQuantity.unit`, message: `Planning unit ${requirement.selectedPlanningQuantity.unit} is incompatible with base unit ${ingredient.baseUnit}` })
        const usable = requirement.sourcePackage?.usableQuantityEach
        if (usable && dimensionOf(usable.unit) !== dimensionOf(ingredient.baseUnit)) issues.push({ path: `${path}.sourcePackage.usableQuantityEach.unit`, message: 'Usable package quantity must match the ingredient base dimension' })
      }
      requirement.alternatives.forEach((alternative, alternativeIndex) => {
        const alternativePath = `${path}.alternatives.${alternativeIndex}`
        const alternativeIngredient = ingredientMap.get(alternative.canonicalIngredientId)
        if (!alternativeIngredient) issues.push({ path: `${alternativePath}.canonicalIngredientId`, message: `Unknown canonical ingredient ${alternative.canonicalIngredientId}` })
        else {
          if (!alternativeIngredient.variants.some(({ id: variantId }) => variantId === alternative.variantId)) issues.push({ path: `${alternativePath}.variantId`, message: `Variant ${alternative.variantId} does not belong to ${alternativeIngredient.id}` })
          if (alternative.quantity && dimensionOf(alternative.quantity.unit) !== dimensionOf(alternativeIngredient.baseUnit)) issues.push({ path: `${alternativePath}.quantity.unit`, message: 'Alternative quantity must match its ingredient base dimension' })
        }
      })
    })
    recipe.subrecipes.forEach((dependency, dependencyIndex) => {
      if (dependency.recipeId && !recipeIds.has(dependency.recipeId)) issues.push({ path: `recipes.${recipeIndex}.subrecipes.${dependencyIndex}.recipeId`, message: `Unknown subrecipe ${dependency.recipeId}` })
      if (dependency.resolution === 'linked-version' && dependency.recipeId && dependency.revisionId && !revisionKeys.has(`${dependency.recipeId}:${dependency.revisionId}`)) issues.push({ path: `recipes.${recipeIndex}.subrecipes.${dependencyIndex}.revisionId`, message: `Unknown subrecipe revision ${dependency.recipeId}:${dependency.revisionId}` })
    })
  })
  return issues.length ? { success: false, issues } : { success: true, data: { ingredients, recipes } }
}

export function assertRecipeV3Catalog(input: unknown): RecipeV3Catalog {
  const result = validateRecipeV3Catalog(input)
  if (!result.success) throw new Error(`V3 catalog validation failed:\n${result.issues.map(({ path, message }) => `- ${path}: ${message}`).join('\n')}`)
  return result.data
}
