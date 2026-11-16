import type { CanonicalIngredient, RecipeRequirement, RecipeV2 } from './catalog'
import { assertRecipeV3Catalog, computeRecipeV3Readiness, recipeV3Schema, type EvidenceRef, type QuantityFact, type RecipeV3 } from './recipeV3'

type V2Quantity = NonNullable<RecipeRequirement['quantity']>

const evidenceIdFor = (recipe: RecipeV2, kind: 'source' | 'migration') => `evidence-${recipe.slug}-${kind}`
const revisionIdFor = (recipe: RecipeV2) => `revision-${recipe.id}-v2`

const quantityFact = (quantity: V2Quantity, originalText: string | null, evidenceIds: string[]): QuantityFact => ({
  amount: quantity.amount,
  range: null,
  unit: quantity.unit,
  approximate: quantity.approximate,
  originalText,
  evidenceIds,
})

const rangeFact = (range: NonNullable<RecipeRequirement['sourceRange']>, originalText: string, evidenceIds: string[]): QuantityFact => ({
  amount: null,
  range: { min: range.min, max: range.max },
  unit: range.unit,
  approximate: true,
  originalText,
  evidenceIds,
})

const unknown = <T>(reason: string): { value: T | null; evidenceIds: string[]; confidence: 'unknown'; unknownReason: string } => ({
  value: null,
  evidenceIds: [],
  confidence: 'unknown',
  unknownReason: reason,
})

const known = <T>(value: T, evidenceIds: string[], confidence: 'reported' | 'reviewed' | 'estimated' | 'uncertain' = 'reviewed') => ({
  value,
  evidenceIds,
  confidence,
  unknownReason: null,
})

const primaryRole = (category: RecipeV2['category']): RecipeV3['mealRoles']['primary'][number] => {
  switch (category) {
    case 'Breakfast': return 'breakfast'
    case 'Lunch': return 'lunch'
    case 'Dinner': return 'dinner'
    case 'Dessert': return 'dessert'
    case 'Snack': return 'snack'
  }
}

function sourceQuantityFor(requirement: RecipeRequirement, sourceEvidenceId: string): QuantityFact | null {
  if (requirement.sourceRange) return rangeFact(requirement.sourceRange, requirement.originalText, [sourceEvidenceId])
  if (requirement.sourceQuantity) return quantityFact(requirement.sourceQuantity, requirement.originalText, [sourceEvidenceId])
  if (requirement.quantity && !requirement.quantity.approximate) return quantityFact(requirement.quantity, requirement.originalText, [sourceEvidenceId])
  return null
}

function migrateRequirement(requirement: RecipeRequirement, sourceEvidenceId: string, migrationEvidenceId: string): RecipeV3['requirements'][number] {
  return {
    requirementId: requirement.id,
    sourceLineId: requirement.sourceLineId,
    componentId: 'component-main',
    originalText: requirement.originalText,
    sourceQuantity: sourceQuantityFor(requirement, sourceEvidenceId),
    nonQuantified: requirement.nonQuantified,
    canonicalIngredientId: requirement.canonicalIngredientId,
    variantId: requirement.variantId,
    selectedPlanningQuantity: requirement.quantity ? quantityFact(requirement.quantity, requirement.originalText, [requirement.quantity.approximate ? migrationEvidenceId : sourceEvidenceId]) : null,
    preparation: requirement.preparation,
    optional: requirement.optional,
    alternatives: requirement.alternatives.map((alternative, index) => ({
      alternativeId: `alternative-${requirement.id.replace(/^requirement-/, '')}-${index + 1}`,
      label: alternative.label,
      canonicalIngredientId: alternative.canonicalIngredientId,
      variantId: alternative.variantId,
      quantity: alternative.quantity ? quantityFact(alternative.quantity, alternative.label, [sourceEvidenceId]) : null,
      relationship: 'either-or',
    })),
    scaling: 'review-required',
    sourcePackage: requirement.sourcePackage ? {
      count: requirement.sourcePackage.count,
      netQuantityEach: quantityFact(requirement.sourcePackage.netQuantityEach, requirement.originalText, [sourceEvidenceId]),
      usableQuantityEach: requirement.sourcePackage.usableQuantityEach
        ? quantityFact(requirement.sourcePackage.usableQuantityEach, requirement.originalText, [migrationEvidenceId])
        : null,
      yieldAssumption: requirement.sourcePackage.yieldAssumption
        ? known(requirement.sourcePackage.yieldAssumption, [migrationEvidenceId], 'estimated')
        : null,
    } : null,
    confidence: requirement.confidence,
    reviewNote: requirement.reviewNote,
    evidenceIds: [sourceEvidenceId],
  }
}

function migrationEvidence(recipe: RecipeV2): EvidenceRef[] {
  const capturedAt = `${recipe.review.reviewedAt}T00:00:00.000Z`
  return [
    {
      evidenceId: evidenceIdFor(recipe, 'source'),
      kind: 'manual-source-review',
      sourceUrl: recipe.source.url,
      capturedAt,
      sourceLabel: 'Recipe v2 source review',
      confidence: 'reviewed',
      reviewerNote: 'Publisher facts and normalized v2 fields preserved by the compatibility adapter.',
    },
    {
      evidenceId: evidenceIdFor(recipe, 'migration'),
      kind: 'rule-derived',
      sourceUrl: null,
      capturedAt,
      sourceLabel: 'Deterministic v2 compatibility adapter',
      confidence: 'estimated',
      reviewerNote: 'Interpretation retained from v2 or initialized conservatively; not a new publisher fact.',
    },
  ]
}

export function adaptRecipeV2ToDraftV3(recipe: RecipeV2): RecipeV3 {
  const sourceEvidenceId = evidenceIdFor(recipe, 'source')
  const migrationEvidenceId = evidenceIdFor(recipe, 'migration')
  const sourceYield = recipe.yield.source
  if (sourceYield.kind === 'countable-output' && (sourceYield.amount === null || !Number.isInteger(sourceYield.amount))) throw new Error(`${recipe.slug}: countable v2 output must have a whole-number amount`)

  const sourceYieldValue = {
    amount: sourceYield.amount,
    range: sourceYield.range ? { ...sourceYield.range } : null,
    unit: sourceYield.unit,
    label: sourceYield.label,
    evidenceIds: [sourceEvidenceId],
  }
  const unknownNutritionReason = 'Recipe v2 did not capture publisher nutrition or its serving basis.'
  const draft: RecipeV3 = {
    schemaVersion: 3,
    identity: {
      recipeId: recipe.id,
      revisionId: revisionIdFor(recipe),
      slug: recipe.slug,
      title: recipe.title,
      description: recipe.description,
      emoji: recipe.emoji,
      lifecycle: recipe.review.status,
    },
    source: {
      publisher: recipe.source.publisher,
      author: recipe.source.author,
      canonicalUrl: recipe.source.url,
      checkedAt: recipe.source.checkedAt,
      rating: recipe.source.rating,
      reviewCount: recipe.source.reviewCount,
      selectionRationale: recipe.source.selectionRationale,
      rights: {
        factualMetadataUse: 'review-needed',
        methodTextUse: 'independent-summary-only',
        imageUse: 'none',
        note: 'Compatibility migration preserves factual metadata and independent summaries only; no publisher method text or imagery is licensed.',
      },
      evidence: migrationEvidence(recipe),
    },
    output: {
      kind: sourceYield.kind === 'countable-output' ? 'discrete-items' : 'flexible-batch',
      sourceYield: sourceYieldValue,
      sourceServing: {
        servingsPerRecipe: sourceYield.kind === 'meal-servings' ? sourceYield.amount : null,
        servingSize: null,
        servingLabel: null,
        evidenceIds: sourceYield.kind === 'meal-servings' ? [sourceEvidenceId] : [],
      },
      discreteItem: sourceYield.kind === 'countable-output' ? {
        itemName: sourceYield.unit,
        itemCount: sourceYield.amount as number,
        itemsPerSourceServing: null,
        evidenceIds: [sourceEvidenceId],
      } : null,
      scaling: {
        policy: 'review-required',
        allowedMultipliers: null,
        note: 'The original publisher batch remains usable; scaling beyond it needs recipe-specific review.',
      },
      planningGuidance: {
        defaultMealPortions: recipe.yield.planningServings.default,
        sourceServingsPerMealPortion: null,
        adequacyNote: recipe.yield.planningServings.assumption,
        sideSuggestionRefs: [],
      },
    },
    components: [{
      componentId: 'component-main',
      label: 'Main recipe',
      order: 0,
      optional: false,
      evidenceIds: [migrationEvidenceId],
    }],
    requirements: recipe.requirements.map((requirement) => migrateRequirement(requirement, sourceEvidenceId, migrationEvidenceId)),
    subrecipes: [],
    nutrition: {
      status: 'unknown',
      basis: null,
      servingsInBasis: null,
      caloriesKcal: unknown<number>(unknownNutritionReason),
      macros: {
        proteinG: unknown<number>(unknownNutritionReason),
        carbohydrateG: unknown<number>(unknownNutritionReason),
        fatG: unknown<number>(unknownNutritionReason),
        fiberG: unknown<number>(unknownNutritionReason),
      },
      includes: [],
      excludes: [],
      computationMethod: null,
    },
    effort: {
      prepMinutes: known(recipe.times.prepMinutes, [sourceEvidenceId]),
      cookMinutes: known(recipe.times.cookMinutes, [sourceEvidenceId]),
      passiveMinutes: unknown<number>('Recipe v2 does not separate passive time.'),
      totalMinutes: known(recipe.times.totalMinutes, [sourceEvidenceId]),
      activeMinutes: unknown<number>('Recipe v2 does not provide a reviewed active-time total.'),
      effortLevel: unknown<'low' | 'medium' | 'high'>('Recipe v2 does not contain a reviewed effort level.'),
      attentionPattern: unknown<'mostly-hands-off' | 'periodic' | 'continuous'>('Recipe v2 does not contain a reviewed attention pattern.'),
    },
    equipment: [],
    equipmentReviewState: 'unknown',
    mealRoles: {
      primary: [primaryRole(recipe.category)],
      tags: [...recipe.tags],
    },
    steps: [],
    legacyMethodSummary: [...recipe.methodSummary],
    suitability: {
      reviewState: 'unknown',
      prepareAhead: unknown<'yes' | 'no' | 'conditional'>('Recipe v2 tags do not establish reviewed prepare-ahead suitability.'),
      leftoverQuality: unknown<'good' | 'acceptable' | 'poor' | 'unknown'>('Recipe v2 does not contain reviewed leftover quality.'),
      storageModes: [],
      thawRequired: unknown<boolean>('Recipe v2 does not contain reviewed thaw requirements.'),
      reheatMethod: unknown<string>('Recipe v2 does not contain a reviewed reheat method.'),
      notes: [],
    },
    review: {
      sourceFactsReviewedAt: recipe.review.reviewedAt,
      ingredientCompletenessReviewed: recipe.review.ingredientCompletenessReviewed,
      methodIndependentlyWritten: recipe.review.methodIndependentlyWritten,
      structuredStepsReviewed: false,
      safetyReviewed: false,
      kitchenTestedAt: null,
      readiness: { minimumSafeImport: false, recommendationReady: false, cookingModeReady: false, blockers: [] },
    },
  }
  draft.review.readiness = computeRecipeV3Readiness(draft)
  return recipeV3Schema.parse(draft)
}

export type RecipeV3MigrationReportEntry = {
  recipeId: string
  revisionId: string
  slug: string
  migrated: true
  carriedForward: {
    requirements: number
    sourceLines: number
    alternatives: number
    sourceRanges: number
    sourcePackages: number
    methodSummaryLines: number
  }
  initializedUnknown: string[]
  readiness: RecipeV3['review']['readiness']
}

export type RecipeV3MigrationReport = {
  schemaVersion: 3
  recipeCount: number
  successfulMigrations: number
  failedMigrations: number
  totals: RecipeV3MigrationReportEntry['carriedForward']
  entries: RecipeV3MigrationReportEntry[]
}

export function buildRecipeV3MigrationReport(recipes: RecipeV3[]): RecipeV3MigrationReport {
  const entries = recipes.map((recipe): RecipeV3MigrationReportEntry => ({
    recipeId: recipe.identity.recipeId,
    revisionId: recipe.identity.revisionId,
    slug: recipe.identity.slug,
    migrated: true,
    carriedForward: {
      requirements: recipe.requirements.length,
      sourceLines: new Set(recipe.requirements.map(({ sourceLineId }) => sourceLineId)).size,
      alternatives: recipe.requirements.reduce((sum, { alternatives }) => sum + alternatives.length, 0),
      sourceRanges: recipe.requirements.filter(({ sourceQuantity }) => sourceQuantity?.range !== null && sourceQuantity?.range !== undefined).length,
      sourcePackages: recipe.requirements.filter(({ sourcePackage }) => sourcePackage !== null).length,
      methodSummaryLines: recipe.legacyMethodSummary.length,
    },
    initializedUnknown: ['nutrition', 'serving-size', 'active-effort', 'equipment', 'structured-steps', 'storage-and-leftover-suitability'],
    readiness: structuredClone(recipe.review.readiness),
  }))
  const emptyTotals = { requirements: 0, sourceLines: 0, alternatives: 0, sourceRanges: 0, sourcePackages: 0, methodSummaryLines: 0 }
  const totals = entries.reduce((total, entry) => {
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += entry.carriedForward[key]
    return total
  }, emptyTotals)
  return { schemaVersion: 3, recipeCount: entries.length, successfulMigrations: entries.length, failedMigrations: 0, totals, entries }
}

export function adaptRecipeCatalogV2ToV3(recipes: RecipeV2[], ingredients: CanonicalIngredient[]): { recipes: RecipeV3[]; report: RecipeV3MigrationReport } {
  const migrated = recipes.map(adaptRecipeV2ToDraftV3)
  const catalog = assertRecipeV3Catalog({ ingredients, recipes: migrated })
  return { recipes: catalog.recipes, report: buildRecipeV3MigrationReport(catalog.recipes) }
}
