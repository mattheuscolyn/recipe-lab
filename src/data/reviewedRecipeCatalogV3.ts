import { canonicalIngredients, pilotRecipes } from './pilotCatalog'
import { officeServiceAssessmentSchema, type OfficeServiceAssessment } from '../domain/generatorV3'
import { applyRecipeReviewV3, recipeReviewArtifactSchema, type RecipeReviewArtifact } from '../domain/recipeReviewV3'
import { adaptRecipeCatalogV2ToV3 } from '../domain/recipeV3Migration'
import { computeRecipeV3Readiness, type EvidenceRef, type RecipeV3, type Sourced } from '../domain/recipeV3'

const REVIEW_DATE = '2026-11-19'
const REVIEWED_AT = `${REVIEW_DATE}T20:00:00.000Z`

type Nutrition = { calories: number; protein: number; carbs: number; fat: number; fiber: number }
type Suitability = {
  state: 'unknown' | 'source-reported'
  prepareAhead?: 'yes' | 'no' | 'conditional'
  leftoverQuality?: 'good' | 'acceptable' | 'poor'
  refrigeratedHours?: number | null
  reheatMethod?: string
  notes: string[]
}
type ReviewConfig = {
  slug: string
  nutrition: Nutrition
  nutritionBasis: string
  sourceServingsPerMealPortion: number
  activeMinutes: number
  passiveMinutes: number
  effortLevel: 'low' | 'medium' | 'high'
  attentionPattern: 'mostly-hands-off' | 'periodic' | 'continuous'
  suitability: Suitability
  unresolved: { code: string; field: string; requiredDecision: string }[]
  serviceAssessment?: boolean
}

const configs: ReviewConfig[] = [
  {
    slug: 'overnight-oats-base-recipe',
    nutrition: { calories: 302, protein: 10, carbs: 48, fat: 8, fiber: 6 },
    nutritionBasis: '1 8 oz jar (base recipe only); publisher calculator includes all listed ingredients',
    sourceServingsPerMealPortion: 1,
    activeMinutes: 5,
    passiveMinutes: 480,
    effortLevel: 'low',
    attentionPattern: 'mostly-hands-off',
    suitability: { state: 'source-reported', prepareAhead: 'yes', refrigeratedHours: null, notes: ['Publisher describes overnight refrigeration and meal-prep use but gives no maximum storage duration for this base recipe.'] },
    unresolved: [
      { code: 'storage-window-unreported', field: 'suitability.storageModes[refrigerated].maxDurationHours', requiredDecision: 'Obtain a recipe-specific reviewed maximum before allocating multiple later meals.' },
      { code: 'rights-approval-required', field: 'source.rights.factualMetadataUse', requiredDecision: 'Owner or legal reviewer must approve factual metadata use.' },
    ],
  },
  {
    slug: 'banana-flax-muffins',
    nutrition: { calories: 225.55, protein: 4.82, carbs: 28.47, fat: 10.2, fiber: 2.97 },
    nutritionBasis: '1 publisher serving; publisher calculator includes the optional walnuts',
    sourceServingsPerMealPortion: 2,
    activeMinutes: 15,
    passiveMinutes: 20,
    effortLevel: 'medium',
    attentionPattern: 'periodic',
    suitability: { state: 'source-reported', prepareAhead: 'yes', leftoverQuality: 'acceptable', refrigeratedHours: null, notes: ['Publisher instructs cooling completely before refrigerated airtight storage but states no maximum duration.'] },
    unresolved: [
      { code: 'flour-conversion-provisional', field: 'requirements[flour].selectedPlanningQuantity', requiredDecision: 'Approve or replace the v2 120 g-per-cup planning approximation.' },
      { code: 'storage-window-unreported', field: 'suitability.storageModes[refrigerated].maxDurationHours', requiredDecision: 'Obtain a recipe-specific reviewed maximum before later-meal allocation.' },
      { code: 'rights-approval-required', field: 'source.rights.factualMetadataUse', requiredDecision: 'Owner or legal reviewer must approve factual metadata use.' },
    ],
  },
  {
    slug: 'southwest-tofu-scramble',
    nutrition: { calories: 176, protein: 13, carbs: 8, fat: 11, fiber: 3 },
    nutritionBasis: '1 cup; publisher calculator includes optional turmeric',
    sourceServingsPerMealPortion: 1,
    activeMinutes: 15,
    passiveMinutes: 0,
    effortLevel: 'low',
    attentionPattern: 'continuous',
    suitability: { state: 'unknown', notes: ['No recipe-specific storage, make-ahead, or reheating claim was captured.'] },
    unresolved: [
      { code: 'suitability-review-required', field: 'suitability', requiredDecision: 'A human food-safety/editorial review needs recipe-specific storage and service evidence.' },
      { code: 'rights-approval-required', field: 'source.rights.factualMetadataUse', requiredDecision: 'Owner or legal reviewer must approve factual metadata use.' },
    ],
  },
  {
    slug: 'greek-chicken-pasta-salad',
    nutrition: { calories: 471, protein: 21, carbs: 48, fat: 21, fiber: 3 },
    nutritionBasis: '1 publisher serving; source yield is 4 meal-sized or 6 side portions',
    sourceServingsPerMealPortion: 1,
    activeMinutes: 60,
    passiveMinutes: 0,
    effortLevel: 'high',
    attentionPattern: 'periodic',
    suitability: { state: 'source-reported', prepareAhead: 'yes', leftoverQuality: 'good', refrigeratedHours: 72, reheatMethod: 'Serve cold from refrigeration; no reheating required.', notes: ['Publisher states up to 3–4 refrigerated days; Recipe Lab records the conservative lower bound of 72 hours.'] },
    serviceAssessment: true,
    unresolved: [
      { code: 'source-yield-selection-required', field: 'output.sourceYield', requiredDecision: 'Choose 4 meal-sized or 6 smaller side portions for each planned batch.' },
      { code: 'chicken-weight-provisional', field: 'requirements[chicken].selectedPlanningQuantity', requiredDecision: 'Approve or replace the v2 planning weight for two chicken thighs.' },
      { code: 'office-odor-unreviewed', field: 'serviceAssessment.odor', requiredDecision: 'Human reviewer must assess office odor acceptability; the recipe cannot self-certify it.' },
      { code: 'rights-approval-required', field: 'source.rights.factualMetadataUse', requiredDecision: 'Owner or legal reviewer must approve factual metadata use.' },
    ],
  },
  {
    slug: 'sheet-pan-chicken-fajitas',
    nutrition: { calories: 483, protein: 31, carbs: 43, fat: 21, fiber: 4 },
    nutritionBasis: '1 publisher serving (2 fajitas); publisher calculator includes optional toppings',
    sourceServingsPerMealPortion: 1,
    activeMinutes: 20,
    passiveMinutes: 35,
    effortLevel: 'medium',
    attentionPattern: 'mostly-hands-off',
    suitability: { state: 'source-reported', leftoverQuality: 'acceptable', refrigeratedHours: null, reheatMethod: 'Microwave, stovetop, or covered oven until fully heated through.', notes: ['Publisher gives reheating methods but the captured recipe page does not state a maximum storage duration.'] },
    unresolved: [
      { code: 'storage-window-unreported', field: 'suitability.storageModes[refrigerated].maxDurationHours', requiredDecision: 'Obtain a recipe-specific reviewed maximum before leftover allocation.' },
      { code: 'rights-approval-required', field: 'source.rights.factualMetadataUse', requiredDecision: 'Owner or legal reviewer must approve factual metadata use.' },
    ],
  },
  {
    slug: 'beef-and-cabbage-stir-fry',
    nutrition: { calories: 195, protein: 16, carbs: 14, fat: 9, fiber: 4 },
    nutritionBasis: '1 publisher serving; publisher calculator includes optional garnishes',
    sourceServingsPerMealPortion: 1,
    activeMinutes: 30,
    passiveMinutes: 0,
    effortLevel: 'medium',
    attentionPattern: 'continuous',
    suitability: { state: 'unknown', notes: ['No recipe-specific storage duration or reheating claim was captured.'] },
    unresolved: [
      { code: 'suitability-review-required', field: 'suitability', requiredDecision: 'A human food-safety/editorial review needs recipe-specific storage and service evidence.' },
      { code: 'rights-approval-required', field: 'source.rights.factualMetadataUse', requiredDecision: 'Owner or legal reviewer must approve factual metadata use.' },
    ],
  },
  {
    slug: 'easy-vegetable-stir-fry',
    nutrition: { calories: 209, protein: 8, carbs: 27, fat: 9, fiber: 6 },
    nutritionBasis: '1.5 cups; publisher calculator covers the listed ingredient set',
    sourceServingsPerMealPortion: 1,
    activeMinutes: 25,
    passiveMinutes: 0,
    effortLevel: 'medium',
    attentionPattern: 'continuous',
    suitability: { state: 'unknown', notes: ['The source has a storage heading, but no specific duration or reheating claim was captured in this review.'] },
    unresolved: [
      { code: 'vegetable-branching-unmodeled', field: 'requirements', requiredDecision: 'The publisher permits broad vegetable substitutions; keep the captured ingredient set fixed until alternatives are normalized.' },
      { code: 'suitability-review-required', field: 'suitability', requiredDecision: 'A human food-safety/editorial review needs recipe-specific storage and service evidence.' },
      { code: 'rights-approval-required', field: 'source.rights.factualMetadataUse', requiredDecision: 'Owner or legal reviewer must approve factual metadata use.' },
    ],
  },
]

const known = <T>(value: T, evidenceIds: string[], confidence: 'reported' | 'reviewed' = 'reviewed'): Sourced<T> => ({ value, evidenceIds, confidence, unknownReason: null })
const unknown = <T>(reason: string): Sourced<T> => ({ value: null, evidenceIds: [], confidence: 'unknown', unknownReason: reason })

function sourceEvidence(recipe: RecipeV3): EvidenceRef {
  return {
    evidenceId: `evidence-${recipe.identity.slug}-g2a-source`,
    kind: 'manual-source-review',
    sourceUrl: recipe.source.canonicalUrl,
    capturedAt: REVIEWED_AT,
    sourceLabel: 'G2A original publisher source review',
    confidence: 'reported',
    reviewerNote: 'Captured yield, serving basis, times, ingredient ambiguities, explicit suitability claims, and publisher-displayed nutrition. No method prose or images retained.',
  }
}

function editorialEvidence(recipe: RecipeV3): EvidenceRef {
  return {
    evidenceId: `evidence-${recipe.identity.slug}-g2a-editorial`,
    kind: 'editorial-judgment',
    sourceUrl: null,
    capturedAt: REVIEWED_AT,
    sourceLabel: 'G2A conservative planning review',
    confidence: 'reviewed',
    reviewerNote: 'Planning interpretation is separate from publisher facts and does not establish legal or food-safety approval.',
  }
}

function buildServiceAssessment(recipe: RecipeV3, sourceEvidenceId: string, editorialEvidenceId: string): OfficeServiceAssessment {
  const evidenceId = `evidence-${recipe.identity.slug}-office-service`
  return officeServiceAssessmentSchema.parse({
    assessmentId: `service-assessment-${recipe.identity.slug}`,
    assessmentRevisionId: `service-assessment-revision-${recipe.identity.slug}-g2a-1`,
    recipeId: recipe.identity.recipeId,
    recipeRevisionId: recipe.identity.revisionId,
    reviewedAt: REVIEWED_AT,
    applicableServices: ['refrigerated-leftover'],
    evidence: [{ evidenceId, kind: 'manual-source-review', capturedAt: REVIEWED_AT, reviewerNote: `Publisher supports refrigerated make-ahead service; recipe evidence ${sourceEvidenceId} and editorial evidence ${editorialEvidenceId} remain in the recipe revision. Odor is intentionally unresolved.`, claims: ['assembly', 'reheating', 'rice-based', 'active-minutes', 'elapsed-minutes'] }],
    assembly: { value: 'none', confidence: 'reviewed', evidenceIds: [evidenceId], unknownReason: null },
    reheating: { value: 'not-needed', confidence: 'reported', evidenceIds: [evidenceId], unknownReason: null },
    odor: { value: null, confidence: 'unknown', evidenceIds: [], unknownReason: 'The publisher source does not assess office odor acceptability.' },
    riceBased: { value: false, confidence: 'reviewed', evidenceIds: [evidenceId], unknownReason: null },
    activeMinutes: { value: 0, confidence: 'reviewed', evidenceIds: [evidenceId], unknownReason: null },
    elapsedMinutes: { value: 0, confidence: 'reviewed', evidenceIds: [evidenceId], unknownReason: null },
  })
}

function reviewedRevision(base: RecipeV3, config: ReviewConfig): RecipeReviewArtifact {
  const source = sourceEvidence(base)
  const editorial = editorialEvidence(base)
  const revision = structuredClone(base)
  revision.identity.revisionId = `revision-${base.identity.recipeId}-g2a-1`
  revision.identity.lifecycle = 'source-reviewed'
  revision.source.checkedAt = REVIEW_DATE
  revision.source.evidence.push(source, editorial)
  revision.source.rights = {
    factualMetadataUse: 'review-needed',
    methodTextUse: 'independent-summary-only',
    imageUse: 'none',
    note: 'Factual evidence is traceable, but owner/legal approval is still required. Publisher method prose and imagery are not stored.',
  }
  revision.output.scaling = { policy: 'fixed-batch', allowedMultipliers: [1], note: 'Only the original publisher batch is approved; other multipliers remain unreviewed.' }
  revision.output.planningGuidance.sourceServingsPerMealPortion = known(config.sourceServingsPerMealPortion, [editorial.evidenceId])
  revision.output.planningGuidance.adequacyNote = config.slug === 'banana-flax-muffins'
    ? 'Provisional planning portion is two muffins; publisher nutrition is per one serving and does not establish meal adequacy.'
    : 'One publisher serving is provisionally treated as one meal portion; household adequacy remains preference-dependent.'
  if (revision.output.kind === 'discrete-items' && revision.output.discreteItem) revision.output.discreteItem.itemsPerSourceServing = 1
  revision.nutrition = {
    status: 'publisher-reported',
    basis: revision.output.kind === 'discrete-items' ? 'discrete-item' : 'source-serving',
    servingsInBasis: 1,
    caloriesKcal: known(config.nutrition.calories, [source.evidenceId], 'reported'),
    macros: {
      proteinG: known(config.nutrition.protein, [source.evidenceId], 'reported'),
      carbohydrateG: known(config.nutrition.carbs, [source.evidenceId], 'reported'),
      fatG: known(config.nutrition.fat, [source.evidenceId], 'reported'),
      fiberG: known(config.nutrition.fiber, [source.evidenceId], 'reported'),
    },
    includes: [config.nutritionBasis],
    excludes: [],
    computationMethod: null,
  }
  revision.effort.activeMinutes = known(config.activeMinutes, [editorial.evidenceId])
  revision.effort.passiveMinutes = known(config.passiveMinutes, [editorial.evidenceId])
  revision.effort.effortLevel = known(config.effortLevel, [editorial.evidenceId])
  revision.effort.attentionPattern = known(config.attentionPattern, [editorial.evidenceId])
  revision.suitability = config.suitability.state === 'unknown' ? {
    ...revision.suitability,
    notes: config.suitability.notes,
  } : {
    reviewState: 'source-reported',
    prepareAhead: config.suitability.prepareAhead ? known(config.suitability.prepareAhead, [source.evidenceId], 'reported') : unknown('Publisher did not make a specific prepare-ahead claim.'),
    leftoverQuality: config.suitability.leftoverQuality ? known(config.suitability.leftoverQuality, [source.evidenceId], 'reported') : unknown('Publisher did not make a specific leftover-quality claim.'),
    storageModes: config.suitability.refrigeratedHours !== undefined ? [{ mode: 'refrigerated', maxDurationHours: config.suitability.refrigeratedHours, evidenceIds: [source.evidenceId], confidence: 'reported' }] : [],
    thawRequired: unknown('No frozen-storage path was reviewed.'),
    reheatMethod: config.suitability.reheatMethod ? known(config.suitability.reheatMethod, [source.evidenceId], 'reported') : unknown('No recipe-specific reheating method was reported.'),
    notes: config.suitability.notes,
  }
  revision.review.sourceFactsReviewedAt = REVIEW_DATE
  revision.review.safetyReviewed = false
  revision.review.readiness = computeRecipeV3Readiness(revision)
  const assessments = config.serviceAssessment ? [buildServiceAssessment(revision, source.evidenceId, editorial.evidenceId)] : []
  return recipeReviewArtifactSchema.parse({
    reviewId: `recipe-review-${base.identity.slug}-g2a-1`,
    recipeId: base.identity.recipeId,
    baseRevisionId: base.identity.revisionId,
    revisionId: revision.identity.revisionId,
    reviewedAt: REVIEWED_AT,
    reviewer: 'Recipe Lab G2A technical editorial review',
    sourceAccess: 'publisher-page-index-reviewed',
    evidence: [source, editorial],
    editorialDecisions: [
      { decisionId: `decision-${base.identity.slug}-meal-portions`, subject: 'meal-portions', status: 'provisional', rationale: revision.output.planningGuidance.adequacyNote, evidenceIds: [editorial.evidenceId] },
      { decisionId: `decision-${base.identity.slug}-scaling`, subject: 'scaling', status: 'approved', rationale: 'The unchanged source batch multiplier of one is safe from scaling invention.', evidenceIds: [editorial.evidenceId] },
      { decisionId: `decision-${base.identity.slug}-effort`, subject: 'effort', status: 'provisional', rationale: 'Active and passive minutes are conservative planning interpretations of publisher-reported prep, cook, and elapsed time.', evidenceIds: [source.evidenceId, editorial.evidenceId] },
      { decisionId: `decision-${base.identity.slug}-rights`, subject: 'rights', status: 'blocked', rationale: 'Technical review cannot grant legal/editorial factual-metadata approval.', evidenceIds: [source.evidenceId] },
    ],
    unresolvedIssues: config.unresolved,
    reviewedRecipe: revision,
    serviceAssessments: assessments,
    checklist: {
      identityAndAttribution: true,
      yieldAndServingBasis: true,
      times: true,
      ingredientsAndAmbiguities: true,
      preparationAndStorageClaims: true,
      publisherNutrition: true,
      rightsDecision: false,
    },
  })
}

const { recipes: migratedRecipes } = adaptRecipeCatalogV2ToV3(pilotRecipes, canonicalIngredients)
const migratedBySlug = new Map(migratedRecipes.map((recipe) => [recipe.identity.slug, recipe]))

export const realRecipeReviewArtifacts = configs.map((config) => {
  const base = migratedBySlug.get(config.slug)
  if (!base) throw new Error(`Missing migrated recipe ${config.slug}`)
  return reviewedRevision(base, config)
})

export const reviewedRecipeCatalogV3 = migratedRecipes.map((base) => {
  const artifact = realRecipeReviewArtifacts.find(({ recipeId }) => recipeId === base.identity.recipeId)
  return artifact ? applyRecipeReviewV3(base, artifact).recipe : base
})

export const reviewedRecipeServiceAssessments = realRecipeReviewArtifacts.flatMap(({ serviceAssessments }) => serviceAssessments)
export const reviewedRealRecipes = reviewedRecipeCatalogV3.filter((recipe) => realRecipeReviewArtifacts.some(({ recipeId }) => recipeId === recipe.identity.recipeId))
