import { z } from 'zod'
import { pantryAvailabilitySchema } from './planningGroceryV3'
import { allocateBatchToMeals, mealRequirementSchema, outputAmountSchema, planCookingBatch, preparedFoodLotSchema, scheduleCookEvent, type MealRequirement } from './planningV3'
import { recipeV3Schema } from './recipeV3'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`), `Expected a ${prefix}- identifier`)
const recipeId = z.string().uuid()

const householdRecipePreferenceSchema = z.object({
  recipeId,
  likedVotes: z.number().int().nonnegative(),
  dislikedVotes: z.number().int().nonnegative(),
  unknownVotes: z.number().int().nonnegative(),
}).refine((preference) => preference.likedVotes + preference.dislikedVotes + preference.unknownVotes > 0, 'Household preference needs at least one vote')

export const officeLunchPolicySchema = z.object({
  enabled: z.boolean(),
  maxAssembly: z.enum(['none', 'simple', 'any']),
  requireReheatingSuitable: z.boolean(),
  allowIntrusiveOdors: z.boolean(),
  allowRiceBased: z.boolean(),
})

const lockedChoiceSchema = z.object({
  mealRequirementId: id('meal-requirement'),
  recipeId,
  recipeRevisionId: id('revision'),
})

const cookingWindowSchema = z.object({
  cookingWindowId: id('cooking-window'),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  maxActiveMinutes: z.number().int().nonnegative(),
}).refine(({ start, end }) => Date.parse(end) >= Date.parse(start), { path: ['end'], message: 'Cooking window cannot end before it starts' })

const serviceClaimSchema = z.enum(['assembly', 'reheating', 'odor', 'rice-based', 'active-minutes', 'elapsed-minutes'])
const serviceEvidenceSchema = z.object({
  evidenceId: id('evidence'),
  kind: z.enum(['manual-source-review', 'editorial-judgment']),
  capturedAt: z.iso.datetime(),
  reviewerNote: z.string().trim().min(1).max(500),
  claims: z.array(serviceClaimSchema).min(1),
})
const reviewedServiceFact = <T>(value: z.ZodType<T>) => z.object({
  value: value.nullable(),
  confidence: z.enum(['reported', 'reviewed', 'unknown']),
  evidenceIds: z.array(id('evidence')),
  unknownReason: z.string().trim().min(1).max(300).nullable(),
}).superRefine((fact, context) => {
  if (fact.value === null) {
    if (fact.confidence !== 'unknown' || fact.evidenceIds.length || !fact.unknownReason) context.addIssue({ code: 'custom', message: 'An unknown service fact needs an explicit reason and cannot claim evidence' })
  } else if (fact.confidence === 'unknown' || !fact.evidenceIds.length || fact.unknownReason !== null) context.addIssue({ code: 'custom', message: 'A known service fact needs reviewed or reported evidence' })
})
export const officeServiceAssessmentSchema = z.object({
  assessmentId: id('service-assessment'),
  assessmentRevisionId: id('service-assessment-revision'),
  recipeId,
  recipeRevisionId: id('revision'),
  reviewedAt: z.iso.datetime(),
  applicableServices: z.array(z.enum(['fresh', 'refrigerated-leftover', 'frozen-leftover'])).min(1),
  evidence: z.array(serviceEvidenceSchema).min(1),
  assembly: reviewedServiceFact(z.enum(['none', 'simple', 'intensive'])),
  reheating: reviewedServiceFact(z.enum(['not-needed', 'suitable', 'unsuitable'])),
  odor: reviewedServiceFact(z.enum(['low', 'intrusive'])),
  riceBased: reviewedServiceFact(z.boolean()),
  activeMinutes: reviewedServiceFact(z.number().int().nonnegative()),
  elapsedMinutes: reviewedServiceFact(z.number().int().nonnegative()),
}).superRefine((assessment, context) => {
  const evidence = new Map(assessment.evidence.map((item) => [item.evidenceId, item]))
  if (evidence.size !== assessment.evidence.length) context.addIssue({ code: 'custom', path: ['evidence'], message: 'Service evidence ids must be unique within an assessment revision' })
  if (assessment.evidence.some(({ capturedAt }) => Date.parse(capturedAt) > Date.parse(assessment.reviewedAt))) context.addIssue({ code: 'custom', path: ['reviewedAt'], message: 'A service assessment cannot predate its supporting evidence' })
  const facts = [
    ['assembly', assessment.assembly],
    ['reheating', assessment.reheating],
    ['odor', assessment.odor],
    ['rice-based', assessment.riceBased],
    ['active-minutes', assessment.activeMinutes],
    ['elapsed-minutes', assessment.elapsedMinutes],
  ] as const
  for (const [claim, fact] of facts) {
    for (const evidenceId of fact.evidenceIds) {
      const item = evidence.get(evidenceId)
      if (!item || !item.claims.includes(claim)) context.addIssue({ code: 'custom', path: [claim, 'evidenceIds'], message: `Service evidence must specifically support ${claim}` })
    }
  }
})

export const planningRequestSchema = z.object({
  requestId: id('planning-request'),
  horizon: z.object({ start: z.iso.date(), end: z.iso.date() }),
  mealRequirements: z.array(mealRequirementSchema),
  recipeSnapshot: z.array(recipeV3Schema),
  pantry: z.array(pantryAvailabilitySchema),
  preparedLots: z.array(preparedFoodLotSchema),
  recentMeals: z.array(z.object({ recipeId, servedAt: z.iso.datetime() })),
  cookingWindows: z.array(cookingWindowSchema),
  serviceAssessments: z.array(officeServiceAssessmentSchema),
  hardConstraints: z.object({
    avoidedRecipeIds: z.array(recipeId),
    avoidedIngredientIds: z.array(id('ingredient')),
  }),
  preferences: z.object({
    preferredRecipeIds: z.array(recipeId),
    householdRecipePreferences: z.array(householdRecipePreferenceSchema),
  }),
  lockedChoices: z.array(lockedChoiceSchema),
  officeLunchPolicy: officeLunchPolicySchema,
}).superRefine((request, context) => {
  if (request.horizon.end < request.horizon.start) context.addIssue({ code: 'custom', path: ['horizon', 'end'], message: 'Planning horizon cannot end before it starts' })
  const unique = (values: string[], path: (string | number)[], message: string) => { if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path, message }) }
  unique(request.mealRequirements.map(({ mealRequirementId }) => mealRequirementId), ['mealRequirements'], 'Meal requirement ids must be unique')
  unique(request.recipeSnapshot.map(({ identity }) => `${identity.recipeId}:${identity.revisionId}`), ['recipeSnapshot'], 'Recipe revisions must be unique')
  unique(request.pantry.map(({ availabilityId }) => availabilityId), ['pantry'], 'Pantry availability ids must be unique')
  unique(request.preparedLots.map(({ preparedFoodLotId }) => preparedFoodLotId), ['preparedLots'], 'Prepared lot ids must be unique')
  unique(request.lockedChoices.map(({ mealRequirementId }) => mealRequirementId), ['lockedChoices'], 'Locked choices must be unique by meal requirement')
  unique(request.cookingWindows.map(({ cookingWindowId }) => cookingWindowId), ['cookingWindows'], 'Cooking window ids must be unique')
  unique(request.serviceAssessments.map(({ assessmentId, assessmentRevisionId }) => `${assessmentId}:${assessmentRevisionId}`), ['serviceAssessments'], 'Service assessment revisions must be unique')
  unique(request.preferences.householdRecipePreferences.map(({ recipeId: preferenceRecipeId }) => preferenceRecipeId), ['preferences', 'householdRecipePreferences'], 'Household recipe preferences must be unique')
  const requirements = new Map(request.mealRequirements.map((requirement) => [requirement.mealRequirementId, requirement]))
  const recipeRevisions = new Set(request.recipeSnapshot.map(({ identity }) => `${identity.recipeId}:${identity.revisionId}`))
  request.mealRequirements.forEach((requirement, index) => {
    if (requirement.date < request.horizon.start || requirement.date > request.horizon.end) context.addIssue({ code: 'custom', path: ['mealRequirements', index, 'date'], message: 'Meal requirement must fall inside the planning horizon' })
  })
  request.lockedChoices.forEach((choice, index) => {
    const requirement = requirements.get(choice.mealRequirementId)
    if (!requirement) context.addIssue({ code: 'custom', path: ['lockedChoices', index, 'mealRequirementId'], message: 'Locked choice must reference a meal requirement' })
    else if (!requirement.lock.locked) context.addIssue({ code: 'custom', path: ['lockedChoices', index], message: 'A locked choice requires a locked meal requirement' })
    if (!recipeRevisions.has(`${choice.recipeId}:${choice.recipeRevisionId}`)) context.addIssue({ code: 'custom', path: ['lockedChoices', index], message: 'Locked choice must reference an exact recipe revision in the request snapshot' })
  })
  request.preparedLots.forEach((lot, index) => {
    if (!recipeRevisions.has(`${lot.recipeId}:${lot.recipeRevisionId}`)) context.addIssue({ code: 'custom', path: ['preparedLots', index], message: 'Prepared food must reference an exact recipe revision in the request snapshot' })
  })
  request.serviceAssessments.forEach((assessment, index) => {
    if (!recipeRevisions.has(`${assessment.recipeId}:${assessment.recipeRevisionId}`)) context.addIssue({ code: 'custom', path: ['serviceAssessments', index], message: 'Service assessment must reference an exact recipe revision in the request snapshot' })
  })
})

const candidateAllocationSchema = z.object({
  mealRequirementId: id('meal-requirement'),
  mealPortions: z.number().int().positive(),
  service: z.enum(['fresh', 'refrigerated-leftover', 'frozen-leftover']),
})

const ingredientSelectionSchema = z.object({
  requirementId: id('requirement'),
  selection: z.enum(['primary', 'alternative', 'excluded-optional']),
  alternativeId: id('alternative').nullable(),
}).superRefine((selection, context) => {
  if ((selection.selection === 'alternative') !== (selection.alternativeId !== null)) context.addIssue({ code: 'custom', path: ['alternativeId'], message: 'Only an alternative selection names an alternative id' })
})

export const generatorCandidateSchema = z.object({
  candidateId: id('candidate'),
  recipeId,
  recipeRevisionId: id('revision'),
  strategy: z.enum(['meal-time-cook', 'prior-meal-batch', 'dedicated-prep']),
  cookingStartsAt: z.iso.datetime(),
  storageStartsAt: z.iso.datetime().nullable().optional(),
  batchMultiplier: z.number().positive().finite(),
  sourceYieldSelection: z.object({ amount: z.number().positive().finite(), evidenceIds: z.array(id('evidence')).min(1), confidence: z.enum(['reported', 'reviewed']) }).nullable(),
  allocations: z.array(candidateAllocationSchema).min(1),
  originMealRequirementId: id('meal-requirement').nullable(),
  ingredientSelections: z.array(ingredientSelectionSchema),
  serviceAssessmentId: id('service-assessment').nullable(),
  serviceAssessmentRevisionId: id('service-assessment-revision').nullable(),
}).strict().superRefine((candidate, context) => {
  if (new Set(candidate.allocations.map(({ mealRequirementId }) => mealRequirementId)).size !== candidate.allocations.length) context.addIssue({ code: 'custom', path: ['allocations'], message: 'A candidate may allocate to each meal requirement only once' })
  if (candidate.strategy === 'prior-meal-batch' && !candidate.originMealRequirementId) context.addIssue({ code: 'custom', path: ['originMealRequirementId'], message: 'Prior-meal batch needs an origin meal requirement' })
  if (candidate.strategy !== 'prior-meal-batch' && candidate.originMealRequirementId) context.addIssue({ code: 'custom', path: ['originMealRequirementId'], message: 'Only a prior-meal batch may identify an origin meal' })
  if (candidate.originMealRequirementId && !candidate.allocations.some(({ mealRequirementId, service }) => mealRequirementId === candidate.originMealRequirementId && service === 'fresh')) context.addIssue({ code: 'custom', path: ['originMealRequirementId'], message: 'The origin meal must receive a fresh allocation from its batch' })
  if (candidate.strategy === 'dedicated-prep' && candidate.allocations.some(({ service }) => service === 'fresh')) context.addIssue({ code: 'custom', path: ['allocations'], message: 'Dedicated prep allocations must use reviewed storage' })
  if (new Set(candidate.ingredientSelections.map(({ requirementId }) => requirementId)).size !== candidate.ingredientSelections.length) context.addIssue({ code: 'custom', path: ['ingredientSelections'], message: 'A candidate may select each ingredient requirement only once' })
  if ((candidate.serviceAssessmentId === null) !== (candidate.serviceAssessmentRevisionId === null)) context.addIssue({ code: 'custom', path: ['serviceAssessmentRevisionId'], message: 'A service assessment reference needs both stable and revision ids' })
  if (candidate.storageStartsAt && !candidate.allocations.some(({ service }) => service !== 'fresh')) context.addIssue({ code: 'custom', path: ['storageStartsAt'], message: 'A storage start applies only to a stored allocation' })
  if (candidate.storageStartsAt && Date.parse(candidate.storageStartsAt) < Date.parse(candidate.cookingStartsAt)) context.addIssue({ code: 'custom', path: ['storageStartsAt'], message: 'Storage cannot start before preparation begins' })
})

export const rejectedReasonCodeSchema = z.enum([
  'recipe-revision-not-found',
  'meal-requirement-not-found',
  'meal-skipped',
  'locked-choice-missing',
  'locked-choice-mismatch',
  'hard-recipe-avoid',
  'hard-ingredient-avoid',
  'hard-ingredient-avoid-unresolved',
  'ingredient-selection-grocery-review-required',
  'recommendation-readiness-required',
  'meal-role-mismatch',
  'lunch-cooking-not-allowed',
  'prepare-ahead-not-approved',
  'leftover-quality-not-approved',
  'storage-evidence-missing',
  'storage-start-time-required',
  'storage-window-exceeded',
  'meal-before-food-ready',
  'meal-service-time-required',
  'cooking-window-unavailable',
  'cooking-window-duration-exceeded',
  'cooking-duration-review-required',
  'active-time-exceeded',
  'elapsed-time-exceeded',
  'service-effort-review-required',
  'service-active-time-exceeded',
  'service-elapsed-time-exceeded',
  'must-use-ingredient-missing',
  'must-use-ingredient-unresolved',
  'office-assembly-not-allowed',
  'office-reheating-unsuitable',
  'office-odor-not-allowed',
  'office-rice-not-allowed',
  'office-suitability-review-required',
  'source-yield-selection-required',
  'batch-scaling-not-approved',
  'whole-item-constraint',
  'meal-portions-incomplete',
  'batch-output-insufficient',
  'candidate-planning-invalid',
])

export const rejectedReasonSchema = z.object({
  code: rejectedReasonCodeSchema,
  disposition: z.enum(['rejected', 'review-needed']),
  message: z.string().trim().min(1).max(500),
  entityIds: z.array(z.string().min(1)),
  missingFields: z.array(z.string().min(1)),
})

export const candidateExplanationSchema = z.object({
  code: z.enum(['lunch-from-dedicated-prep', 'lunch-from-reviewed-leftovers', 'lunch-cooking-explicitly-allowed', 'household-preference-conflict', 'preferred-recipe', 'candidate-valid']),
  message: z.string().trim().min(1).max(500),
  entityIds: z.array(z.string().min(1)),
})

export const candidateFeasibilitySchema = z.object({
  candidateId: id('candidate'),
  status: z.enum(['eligible', 'rejected', 'review-needed']),
  recipeId,
  recipeRevisionId: id('revision'),
  reasons: z.array(rejectedReasonSchema),
  explanations: z.array(candidateExplanationSchema),
  timing: z.object({ cookingStartsAt: z.iso.datetime(), expectedReadyAt: z.iso.datetime(), cookingWindowId: id('cooking-window') }).nullable(),
  projection: z.object({ batchOutput: outputAmountSchema, allocatedOutput: outputAmountSchema, remainder: outputAmountSchema }).nullable(),
})

export type PlanningRequest = z.infer<typeof planningRequestSchema>
export type GeneratorCandidate = z.infer<typeof generatorCandidateSchema>
export type RejectedReason = z.infer<typeof rejectedReasonSchema>
export type CandidateFeasibility = z.infer<typeof candidateFeasibilitySchema>
export type OfficeServiceAssessment = z.infer<typeof officeServiceAssessmentSchema>

const recommendationBlockerFields: Record<string, string[]> = {
  'ingredient-completeness-unreviewed': ['review.ingredientCompletenessReviewed'],
  'output-scaling-review-required': ['output.scaling'],
  'meal-portion-guidance-missing': ['output.planningGuidance.sourceServingsPerMealPortion'],
  'active-time-unknown': ['effort.activeMinutes'],
  'essential-subrecipe-unresolved': ['subrecipes'],
  'rights-review-required': ['source.rights.factualMetadataUse'],
  'rights-restricted': ['source.rights.factualMetadataUse'],
  'ingredient-normalization-approval-required': ['review.recommendationDecisions.ingredientNormalization'],
  'output-scaling-approval-required': ['review.recommendationDecisions.outputScaling'],
  'meal-portion-approval-required': ['review.recommendationDecisions.mealPortions'],
  'effort-approval-required': ['review.recommendationDecisions.effort'],
}

const reason = (code: RejectedReason['code'], disposition: RejectedReason['disposition'], message: string, entityIds: string[], missingFields: string[] = []): RejectedReason => ({ code, disposition, message, entityIds, missingFields })

function reviewedSourced(value: { value: unknown; confidence: string; evidenceIds: string[] } | null | undefined): boolean {
  return Boolean(value && value.value !== null && ['reported', 'reviewed'].includes(value.confidence) && value.evidenceIds.length)
}

function addOfficeLunchReasons(request: PlanningRequest, candidate: GeneratorCandidate, requirement: MealRequirement, assessment: OfficeServiceAssessment | null, reasons: RejectedReason[]) {
  const policy = request.officeLunchPolicy
  if (!policy.enabled || requirement.meal !== 'lunch') return
  const entityIds = [candidate.candidateId, requirement.mealRequirementId]
  if (!assessment) {
    reasons.push(reason('office-suitability-review-required', 'review-needed', 'Office-lunch service details need a specific reviewed assessment revision for this recipe revision and service mode.', entityIds, ['serviceAssessmentId', 'serviceAssessmentRevisionId']))
    return
  }
  const missing = (field: keyof Pick<OfficeServiceAssessment, 'assembly' | 'reheating' | 'odor' | 'riceBased'>) => reasons.push(reason('office-suitability-review-required', 'review-needed', `Office-lunch ${field} suitability is not reviewed.`, entityIds, [`serviceAssessment.${field}`]))
  if (assessment.assembly.value === null) missing('assembly')
  else if (policy.maxAssembly === 'none' && assessment.assembly.value !== 'none') reasons.push(reason('office-assembly-not-allowed', 'rejected', 'This office lunch exceeds the allowed assembly level.', entityIds))
  else if (policy.maxAssembly === 'simple' && assessment.assembly.value === 'intensive') reasons.push(reason('office-assembly-not-allowed', 'rejected', 'This office lunch requires intensive assembly.', entityIds))
  if (policy.requireReheatingSuitable) {
    if (assessment.reheating.value === null) missing('reheating')
    else if (!['not-needed', 'suitable'].includes(assessment.reheating.value)) reasons.push(reason('office-reheating-unsuitable', 'rejected', 'This lunch does not have reviewed office-suitable reheating.', entityIds))
  }
  if (!policy.allowIntrusiveOdors) {
    if (assessment.odor.value === null) missing('odor')
    else if (assessment.odor.value !== 'low') reasons.push(reason('office-odor-not-allowed', 'rejected', 'This lunch does not satisfy the configured office odor policy.', entityIds))
  }
  if (!policy.allowRiceBased) {
    if (assessment.riceBased.value === null) missing('riceBased')
    else if (assessment.riceBased.value) reasons.push(reason('office-rice-not-allowed', 'rejected', 'This lunch does not satisfy the configured rice policy.', entityIds))
  }
}

function selectedIngredientState(recipe: PlanningRequest['recipeSnapshot'][number], candidate: GeneratorCandidate, reasons: RejectedReason[]) {
  const selections = new Map(candidate.ingredientSelections.map((selection) => [selection.requirementId, selection]))
  const selected = new Set<string>()
  const unresolved = new Map<string, string[]>()
  const downstreamUnrepresentedRequirementIds: string[] = []
  for (const requirement of recipe.requirements) {
    const selection = selections.get(requirement.requirementId)
    const possible = [requirement.canonicalIngredientId, ...requirement.alternatives.map(({ canonicalIngredientId }) => canonicalIngredientId)]
    if (!selection) {
      if (!requirement.optional && !requirement.alternatives.length) selected.add(requirement.canonicalIngredientId)
      else for (const ingredientId of possible) unresolved.set(ingredientId, [...(unresolved.get(ingredientId) ?? []), requirement.requirementId])
      continue
    }
    if (selection.selection === 'excluded-optional') {
      if (!requirement.optional) reasons.push(reason('candidate-planning-invalid', 'rejected', 'A required ingredient cannot be excluded.', [candidate.candidateId, requirement.requirementId]))
      else downstreamUnrepresentedRequirementIds.push(requirement.requirementId)
      continue
    }
    if (selection.selection === 'primary') {
      selected.add(requirement.canonicalIngredientId)
      if (requirement.optional) downstreamUnrepresentedRequirementIds.push(requirement.requirementId)
      continue
    }
    downstreamUnrepresentedRequirementIds.push(requirement.requirementId)
    const alternative = requirement.alternatives.find(({ alternativeId }) => alternativeId === selection.alternativeId)
    if (!alternative) reasons.push(reason('candidate-planning-invalid', 'rejected', 'Ingredient selection references an alternative outside its requirement.', [candidate.candidateId, requirement.requirementId, selection.alternativeId!]))
    else selected.add(alternative.canonicalIngredientId)
  }
  for (const requirementId of selections.keys()) {
    if (!recipe.requirements.some((requirement) => requirement.requirementId === requirementId)) reasons.push(reason('candidate-planning-invalid', 'rejected', 'Ingredient selection references a requirement outside this recipe revision.', [candidate.candidateId, requirementId]))
  }
  return { selected, unresolved, downstreamUnrepresentedRequirementIds }
}

function classifyPlanningError(message: string, candidate: GeneratorCandidate): RejectedReason {
  const ids = [candidate.candidateId, candidate.recipeId]
  if (message.includes('reviewed exact selection')) return reason('source-yield-selection-required', 'review-needed', message, ids, ['sourceYieldSelection'])
  if (message.includes('reviewed source-output guidance')) return reason('recommendation-readiness-required', 'review-needed', message, ids, ['recipe.output.planningGuidance.sourceServingsPerMealPortion'])
  if (message.includes('not approved') || message.includes('does not support multiplier')) return reason(message.includes('whole') || message.includes('Requirement') ? 'whole-item-constraint' : 'batch-scaling-not-approved', 'rejected', message, ids)
  if (message.includes('fractional item')) return reason('whole-item-constraint', 'rejected', message, ids)
  if (message.includes('Storage window')) return reason('storage-window-exceeded', 'rejected', message, ids)
  if (message.includes('reviewed refrigerated') || message.includes('reviewed frozen') || message.includes('reviewed suitability')) return reason('storage-evidence-missing', 'review-needed', message, ids, ['recipe.suitability.storageModes'])
  if (message.includes('before the cook event')) return reason('meal-before-food-ready', 'rejected', 'Meal service occurs before the batch is expected to be ready.', [...ids, ...candidate.allocations.map(({ mealRequirementId }) => mealRequirementId)])
  if (message.includes('exact intended meal time')) return reason('meal-service-time-required', 'review-needed', message, ids, ['mealRequirement.intendedAt'])
  if (message.includes('negative')) return reason('batch-output-insufficient', 'rejected', message, ids)
  return reason('candidate-planning-invalid', 'rejected', message, ids)
}

export function evaluateCandidateFeasibility(requestInput: PlanningRequest, candidateInput: GeneratorCandidate): CandidateFeasibility {
  const request = planningRequestSchema.parse(requestInput)
  const candidate = generatorCandidateSchema.parse(candidateInput)
  const reasons: RejectedReason[] = []
  const explanations: CandidateFeasibility['explanations'] = []
  const recipe = request.recipeSnapshot.find(({ identity }) => identity.recipeId === candidate.recipeId && identity.revisionId === candidate.recipeRevisionId)
  if (!recipe) {
    reasons.push(reason('recipe-revision-not-found', 'rejected', 'The candidate recipe revision is not in this planning snapshot.', [candidate.recipeId, candidate.recipeRevisionId]))
    return candidateFeasibilitySchema.parse({ candidateId: candidate.candidateId, status: 'rejected', recipeId: candidate.recipeId, recipeRevisionId: candidate.recipeRevisionId, reasons, explanations, timing: null, projection: null })
  }

  if (!recipe.review.readiness.recommendationReady) reasons.push(reason('recommendation-readiness-required', 'review-needed', 'Automatic selection requires a recommendation-ready recipe revision.', [recipe.identity.recipeId, recipe.identity.revisionId], recipe.review.readiness.blockers.flatMap((blocker) => recommendationBlockerFields[blocker] ?? [])))
  if (request.hardConstraints.avoidedRecipeIds.includes(recipe.identity.recipeId)) reasons.push(reason('hard-recipe-avoid', 'rejected', 'The recipe is on the request hard-avoid list.', [recipe.identity.recipeId]))
  if (request.preferences.preferredRecipeIds.includes(recipe.identity.recipeId)) explanations.push({ code: 'preferred-recipe', message: 'The recipe is explicitly preferred.', entityIds: [recipe.identity.recipeId] })
  const votes = request.preferences.householdRecipePreferences.find(({ recipeId: preferenceRecipeId }) => preferenceRecipeId === recipe.identity.recipeId)
  if (votes && votes.likedVotes > 0 && votes.dislikedVotes > 0) explanations.push({ code: 'household-preference-conflict', message: 'Household taste votes conflict; a later optimizer must not treat this as universally liked.', entityIds: [recipe.identity.recipeId] })

  const ingredientState = selectedIngredientState(recipe, candidate, reasons)
  const selectedAvoidedIngredients = request.hardConstraints.avoidedIngredientIds.filter((ingredientId) => ingredientState.selected.has(ingredientId))
  if (selectedAvoidedIngredients.length) reasons.push(reason('hard-ingredient-avoid', 'rejected', 'The candidate explicitly selects an ingredient on the hard-avoid list.', [recipe.identity.recipeId, ...selectedAvoidedIngredients]))
  for (const ingredientId of request.hardConstraints.avoidedIngredientIds) {
    const unresolvedRequirementIds = ingredientState.unresolved.get(ingredientId)
    if (unresolvedRequirementIds?.length) reasons.push(reason('hard-ingredient-avoid-unresolved', 'review-needed', 'An unresolved optional or alternative branch could select an avoided ingredient.', [candidate.candidateId, ingredientId, ...unresolvedRequirementIds], ['ingredientSelections']))
  }
  if (ingredientState.downstreamUnrepresentedRequirementIds.length) reasons.push(reason('ingredient-selection-grocery-review-required', 'review-needed', 'Selected alternative or optional ingredient branches are not yet applied to downstream grocery demand.', [candidate.candidateId, ...ingredientState.downstreamUnrepresentedRequirementIds], ['groceryDemand.ingredientSelections']))
  const referencedServiceAssessment = request.serviceAssessments.find(({ assessmentId, assessmentRevisionId }) => assessmentId === candidate.serviceAssessmentId && assessmentRevisionId === candidate.serviceAssessmentRevisionId)
  const serviceAssessment = referencedServiceAssessment?.recipeId === recipe.identity.recipeId && referencedServiceAssessment.recipeRevisionId === recipe.identity.revisionId ? referencedServiceAssessment : null

  const requirements = new Map(request.mealRequirements.map((requirement) => [requirement.mealRequirementId, requirement]))
  const reviewedTotalMinutes = reviewedSourced(recipe.effort.totalMinutes) ? recipe.effort.totalMinutes.value : null
  const reviewedActiveMinutes = reviewedSourced(recipe.effort.activeMinutes) ? recipe.effort.activeMinutes.value : null
  const expectedReadyAt = typeof reviewedTotalMinutes === 'number' ? new Date(Date.parse(candidate.cookingStartsAt) + reviewedTotalMinutes * 60_000).toISOString() : null
  if (candidate.strategy === 'dedicated-prep' && candidate.allocations.some(({ service }) => service !== 'fresh') && !candidate.storageStartsAt) {
    reasons.push(reason(
      'storage-start-time-required',
      'review-needed',
      'Dedicated advance preparation needs an explicit storage start; preparation completion cannot stand in for passive refrigerated resting.',
      [candidate.candidateId],
      ['candidate.storageStartsAt'],
    ))
  }
  const startingWindows = request.cookingWindows.filter(({ start, end }) => Date.parse(start) <= Date.parse(candidate.cookingStartsAt) && Date.parse(candidate.cookingStartsAt) <= Date.parse(end))
  const durationWindows = expectedReadyAt === null ? startingWindows : startingWindows.filter(({ end }) => Date.parse(expectedReadyAt) <= Date.parse(end))
  const cookingWindow = (typeof reviewedActiveMinutes === 'number' ? durationWindows.find(({ maxActiveMinutes }) => reviewedActiveMinutes <= maxActiveMinutes) : durationWindows[0]) ?? durationWindows[0] ?? startingWindows[0] ?? null
  if (expectedReadyAt === null) reasons.push(reason('cooking-duration-review-required', 'review-needed', 'Expected readiness requires reviewed elapsed cooking or preparation time.', [candidate.candidateId], ['recipe.effort.totalMinutes']))
  if (!cookingWindow) reasons.push(reason('cooking-window-unavailable', 'rejected', 'The proposed cooking start is outside every active cooking window.', [candidate.candidateId]))
  else if (expectedReadyAt !== null && Date.parse(expectedReadyAt) > Date.parse(cookingWindow.end)) reasons.push(reason('cooking-window-duration-exceeded', 'rejected', 'The full cooking interval does not fit inside the selected cooking window.', [candidate.candidateId, cookingWindow.cookingWindowId]))
  if (cookingWindow) {
    if (reviewedActiveMinutes === null) reasons.push(reason('cooking-duration-review-required', 'review-needed', 'Cooking-window capacity requires reviewed active time.', [candidate.candidateId], ['recipe.effort.activeMinutes']))
    else if (reviewedActiveMinutes > cookingWindow.maxActiveMinutes) reasons.push(reason('active-time-exceeded', 'rejected', 'Recipe active time exceeds the selected cooking-window capacity.', [candidate.candidateId, cookingWindow.cookingWindowId]))
  }
  const allocationRequests: { allocationId: string; requirement: MealRequirement; mealPortions: number; service: 'fresh' | 'refrigerated-leftover' | 'frozen-leftover'; storageStartedAt?: string | null }[] = []
  candidate.allocations.forEach((allocation, index) => {
    const requirement = requirements.get(allocation.mealRequirementId)
    if (!requirement) {
      reasons.push(reason('meal-requirement-not-found', 'rejected', 'Candidate allocation references a meal outside this request.', [allocation.mealRequirementId]))
      return
    }
    const entityIds = [candidate.candidateId, requirement.mealRequirementId]
    if (requirement.status === 'skipped') reasons.push(reason('meal-skipped', 'rejected', 'An intentionally skipped meal cannot receive a candidate.', entityIds))
    if (requirement.status !== 'skipped' && allocation.mealPortions !== requirement.requestedPortions) reasons.push(reason('meal-portions-incomplete', 'rejected', 'A meal candidate must satisfy the full requested portion count.', entityIds))
    const lockedChoice = request.lockedChoices.find(({ mealRequirementId }) => mealRequirementId === requirement.mealRequirementId)
    if (requirement.lock.locked && !lockedChoice) reasons.push(reason('locked-choice-missing', 'review-needed', 'The locked meal has no immutable recipe choice in the request.', entityIds, ['lockedChoices']))
    if (lockedChoice && (lockedChoice.recipeId !== recipe.identity.recipeId || lockedChoice.recipeRevisionId !== recipe.identity.revisionId)) reasons.push(reason('locked-choice-mismatch', 'rejected', 'Candidate does not match the locked recipe revision.', [...entityIds, lockedChoice.recipeId]))
    if (requirement.constraints.avoidRecipeIds.includes(recipe.identity.recipeId)) reasons.push(reason('hard-recipe-avoid', 'rejected', 'This meal requirement explicitly avoids the recipe.', entityIds))
    for (const ingredientId of requirement.constraints.mustUseIngredientIds) {
      if (ingredientState.selected.has(ingredientId)) continue
      const unresolvedRequirementIds = ingredientState.unresolved.get(ingredientId)
      if (unresolvedRequirementIds?.length) reasons.push(reason('must-use-ingredient-unresolved', 'review-needed', 'The required ingredient is available only through an unresolved optional or alternative selection.', [...entityIds, ingredientId, ...unresolvedRequirementIds], ['ingredientSelections']))
      else reasons.push(reason('must-use-ingredient-missing', 'rejected', 'The candidate does not use a required ingredient for this meal.', [...entityIds, ingredientId]))
    }
    const roleMatches = recipe.mealRoles.primary.includes(requirement.meal) || (requirement.meal === 'lunch' && allocation.service !== 'fresh' && recipe.mealRoles.primary.includes('dinner'))
    if (!roleMatches) reasons.push(reason('meal-role-mismatch', 'rejected', 'Recipe role does not match the requested meal or a reviewed stored-lunch route.', entityIds))
    if (requirement.meal === 'lunch' && allocation.service === 'fresh' && !requirement.constraints.allowLunchCooking) reasons.push(reason('lunch-cooking-not-allowed', 'rejected', 'This lunch would require cooking at lunchtime, which is disabled for the meal.', entityIds))
    if (requirement.meal === 'lunch' && allocation.service === 'fresh' && requirement.constraints.allowLunchCooking) explanations.push({ code: 'lunch-cooking-explicitly-allowed', message: 'Lunch cooking is feasible only because this meal explicitly allows it.', entityIds })
    if (requirement.meal === 'lunch' && allocation.service !== 'fresh') explanations.push({ code: candidate.strategy === 'dedicated-prep' ? 'lunch-from-dedicated-prep' : 'lunch-from-reviewed-leftovers', message: candidate.strategy === 'dedicated-prep' ? 'Lunch is supplied by a dedicated earlier prep event.' : 'Lunch is supplied from a prior reviewed batch.', entityIds })
    if (allocation.service !== 'fresh') {
      if (candidate.strategy === 'dedicated-prep') {
        const prepareAhead = recipe.suitability.prepareAhead
        if (!reviewedSourced(prepareAhead)) reasons.push(reason('prepare-ahead-not-approved', 'review-needed', 'Dedicated prep requires reviewed prepare-ahead suitability.', entityIds, ['recipe.suitability.prepareAhead']))
        else if (prepareAhead.value === 'no') reasons.push(reason('prepare-ahead-not-approved', 'rejected', 'The recipe is reviewed as unsuitable for advance preparation.', entityIds))
      } else {
        const quality = recipe.suitability.leftoverQuality
        if (!reviewedSourced(quality)) reasons.push(reason('leftover-quality-not-approved', 'review-needed', 'Leftover use requires reviewed quality suitability.', entityIds, ['recipe.suitability.leftoverQuality']))
        else if (!['good', 'acceptable'].includes(quality.value as string)) reasons.push(reason('leftover-quality-not-approved', 'rejected', 'The reviewed leftover quality is not suitable for this allocation.', entityIds))
      }
    }
    const applicableServiceAssessment = serviceAssessment?.applicableServices.includes(allocation.service) ? serviceAssessment : null
    if (allocation.service === 'fresh') {
      if (requirement.intendedAt === null) reasons.push(reason('meal-service-time-required', 'review-needed', 'An exact fresh meal time is required to prove the food will be ready before service.', entityIds, ['mealRequirement.intendedAt']))
      if (requirement.constraints.maxActiveMinutes !== null && reviewedSourced(recipe.effort.activeMinutes) && (recipe.effort.activeMinutes.value as number) > requirement.constraints.maxActiveMinutes) reasons.push(reason('active-time-exceeded', 'rejected', 'Recipe active time exceeds the fresh meal limit.', entityIds))
      if (requirement.constraints.maxElapsedMinutes !== null && reviewedTotalMinutes !== null && reviewedTotalMinutes > requirement.constraints.maxElapsedMinutes) reasons.push(reason('elapsed-time-exceeded', 'rejected', 'Recipe elapsed time exceeds the fresh meal limit.', entityIds))
    } else {
      if (requirement.constraints.maxActiveMinutes !== null) {
        if (!applicableServiceAssessment || !reviewedSourced(applicableServiceAssessment.activeMinutes)) reasons.push(reason('service-effort-review-required', 'review-needed', 'Stored meal service needs reviewed active serving or reheating time.', entityIds, ['serviceAssessment.activeMinutes']))
        else if ((applicableServiceAssessment.activeMinutes.value as number) > requirement.constraints.maxActiveMinutes) reasons.push(reason('service-active-time-exceeded', 'rejected', 'Reviewed serving or reheating active time exceeds the meal limit.', entityIds))
      }
      if (requirement.constraints.maxElapsedMinutes !== null) {
        if (!applicableServiceAssessment || !reviewedSourced(applicableServiceAssessment.elapsedMinutes)) reasons.push(reason('service-effort-review-required', 'review-needed', 'Stored meal service needs reviewed elapsed serving or reheating time.', entityIds, ['serviceAssessment.elapsedMinutes']))
        else if ((applicableServiceAssessment.elapsedMinutes.value as number) > requirement.constraints.maxElapsedMinutes) reasons.push(reason('service-elapsed-time-exceeded', 'rejected', 'Reviewed serving or reheating elapsed time exceeds the meal limit.', entityIds))
      }
    }
    addOfficeLunchReasons(request, candidate, requirement, applicableServiceAssessment, reasons)
    allocationRequests.push({ allocationId: `allocation-${candidate.candidateId.replace(/^candidate-/, '')}-${index + 1}`, requirement, mealPortions: allocation.mealPortions, service: allocation.service, storageStartedAt: allocation.service === 'fresh' ? null : candidate.storageStartsAt })
  })

  let projection: CandidateFeasibility['projection'] = null
  if (expectedReadyAt !== null) try {
    const batch = planCookingBatch(recipe, { batchId: `batch-${candidate.candidateId.replace(/^candidate-/, '')}`, groceryDemandId: `grocery-demand-${candidate.candidateId.replace(/^candidate-/, '')}`, multiplier: candidate.batchMultiplier, sourceYieldSelection: candidate.sourceYieldSelection ?? undefined })
    const event = scheduleCookEvent(recipe, batch, { cookEventId: `cook-event-${candidate.candidateId.replace(/^candidate-/, '')}`, intendedAt: expectedReadyAt })
    const allocated = allocateBatchToMeals(recipe, batch, event, allocationRequests)
    const allocatedAmount = allocated.allocations.reduce((sum, allocation) => sum + allocation.amount.amount, 0)
    projection = { batchOutput: batch.plannedOutput, allocatedOutput: { ...batch.plannedOutput, amount: allocatedAmount }, remainder: allocated.remainder }
  } catch (error) {
    reasons.push(classifyPlanningError(error instanceof Error ? error.message : 'Candidate planning failed.', candidate))
  }

  const deduplicatedReasons = reasons.filter((item, index) => reasons.findIndex((candidateReason) => candidateReason.code === item.code && JSON.stringify(candidateReason.entityIds) === JSON.stringify(item.entityIds)) === index)
  const status: CandidateFeasibility['status'] = deduplicatedReasons.some(({ disposition }) => disposition === 'rejected') ? 'rejected' : deduplicatedReasons.length ? 'review-needed' : 'eligible'
  if (status === 'eligible') explanations.push({ code: 'candidate-valid', message: 'Candidate satisfies the implemented G1 hard constraints.', entityIds: [candidate.candidateId] })
  const timing = expectedReadyAt !== null && cookingWindow ? { cookingStartsAt: candidate.cookingStartsAt, expectedReadyAt, cookingWindowId: cookingWindow.cookingWindowId } : null
  return candidateFeasibilitySchema.parse({ candidateId: candidate.candidateId, status, recipeId: recipe.identity.recipeId, recipeRevisionId: recipe.identity.revisionId, reasons: deduplicatedReasons, explanations, timing, projection })
}
