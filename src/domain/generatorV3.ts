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

export const planningRequestSchema = z.object({
  requestId: id('planning-request'),
  horizon: z.object({ start: z.iso.date(), end: z.iso.date() }),
  mealRequirements: z.array(mealRequirementSchema),
  recipeSnapshot: z.array(recipeV3Schema),
  pantry: z.array(pantryAvailabilitySchema),
  preparedLots: z.array(preparedFoodLotSchema),
  recentMeals: z.array(z.object({ recipeId, servedAt: z.iso.datetime() })),
  cookingWindows: z.array(cookingWindowSchema),
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
})

export const candidateServiceProfileSchema = z.object({
  reviewState: z.enum(['unknown', 'reviewed']),
  assembly: z.enum(['none', 'simple', 'intensive', 'unknown']),
  reheating: z.enum(['not-needed', 'suitable', 'unsuitable', 'unknown']),
  odor: z.enum(['low', 'intrusive', 'unknown']),
  riceBased: z.boolean().nullable(),
  evidenceIds: z.array(id('evidence')),
}).superRefine((profile, context) => {
  if (profile.reviewState === 'reviewed' && !profile.evidenceIds.length) context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'Reviewed service profile needs evidence' })
  if (profile.reviewState === 'unknown' && profile.evidenceIds.length) context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'Unknown service profile cannot claim evidence' })
})

const candidateAllocationSchema = z.object({
  mealRequirementId: id('meal-requirement'),
  mealPortions: z.number().int().positive(),
  service: z.enum(['fresh', 'refrigerated-leftover', 'frozen-leftover']),
})

export const generatorCandidateSchema = z.object({
  candidateId: id('candidate'),
  recipeId,
  recipeRevisionId: id('revision'),
  strategy: z.enum(['meal-time-cook', 'prior-meal-batch', 'dedicated-prep']),
  cookAt: z.iso.datetime(),
  batchMultiplier: z.number().positive().finite(),
  sourceYieldSelection: z.object({ amount: z.number().positive().finite(), evidenceIds: z.array(id('evidence')).min(1), confidence: z.enum(['reported', 'reviewed']) }).nullable(),
  allocations: z.array(candidateAllocationSchema).min(1),
  originMealRequirementId: id('meal-requirement').nullable(),
  serviceProfile: candidateServiceProfileSchema,
}).superRefine((candidate, context) => {
  if (new Set(candidate.allocations.map(({ mealRequirementId }) => mealRequirementId)).size !== candidate.allocations.length) context.addIssue({ code: 'custom', path: ['allocations'], message: 'A candidate may allocate to each meal requirement only once' })
  if (candidate.strategy === 'prior-meal-batch' && !candidate.originMealRequirementId) context.addIssue({ code: 'custom', path: ['originMealRequirementId'], message: 'Prior-meal batch needs an origin meal requirement' })
  if (candidate.strategy !== 'prior-meal-batch' && candidate.originMealRequirementId) context.addIssue({ code: 'custom', path: ['originMealRequirementId'], message: 'Only a prior-meal batch may identify an origin meal' })
  if (candidate.originMealRequirementId && !candidate.allocations.some(({ mealRequirementId, service }) => mealRequirementId === candidate.originMealRequirementId && service === 'fresh')) context.addIssue({ code: 'custom', path: ['originMealRequirementId'], message: 'The origin meal must receive a fresh allocation from its batch' })
  if (candidate.strategy === 'dedicated-prep' && candidate.allocations.some(({ service }) => service === 'fresh')) context.addIssue({ code: 'custom', path: ['allocations'], message: 'Dedicated prep allocations must use reviewed storage' })
})

export const rejectedReasonCodeSchema = z.enum([
  'recipe-revision-not-found',
  'meal-requirement-not-found',
  'meal-skipped',
  'locked-choice-missing',
  'locked-choice-mismatch',
  'hard-recipe-avoid',
  'hard-ingredient-avoid',
  'recommendation-readiness-required',
  'meal-role-mismatch',
  'lunch-cooking-not-allowed',
  'prepare-ahead-not-approved',
  'leftover-quality-not-approved',
  'storage-evidence-missing',
  'storage-window-exceeded',
  'meal-before-cooking',
  'cooking-window-unavailable',
  'active-time-exceeded',
  'elapsed-time-exceeded',
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
  projection: z.object({ batchOutput: outputAmountSchema, allocatedOutput: outputAmountSchema, remainder: outputAmountSchema }).nullable(),
})

export type PlanningRequest = z.infer<typeof planningRequestSchema>
export type GeneratorCandidate = z.infer<typeof generatorCandidateSchema>
export type RejectedReason = z.infer<typeof rejectedReasonSchema>
export type CandidateFeasibility = z.infer<typeof candidateFeasibilitySchema>

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

const reason = (code: RejectedReason['code'], disposition: RejectedReason['disposition'], message: string, entityIds: string[], missingFields: string[] = []): RejectedReason => ({ code, disposition, message, entityIds, missingFields })

function reviewedSourced(value: { value: unknown; confidence: string; evidenceIds: string[] } | null | undefined): boolean {
  return Boolean(value && value.value !== null && ['reported', 'reviewed'].includes(value.confidence) && value.evidenceIds.length)
}

function addOfficeLunchReasons(request: PlanningRequest, candidate: GeneratorCandidate, requirement: MealRequirement, reasons: RejectedReason[]) {
  const policy = request.officeLunchPolicy
  if (!policy.enabled || requirement.meal !== 'lunch') return
  const profile = candidate.serviceProfile
  const entityIds = [candidate.candidateId, requirement.mealRequirementId]
  const unknown = profile.reviewState === 'unknown'
  if (unknown) {
    reasons.push(reason('office-suitability-review-required', 'review-needed', 'Office-lunch service details have not been reviewed.', entityIds, ['serviceProfile']))
    return
  }
  if (policy.maxAssembly === 'none' && profile.assembly !== 'none') reasons.push(reason('office-assembly-not-allowed', profile.assembly === 'unknown' ? 'review-needed' : 'rejected', 'This office lunch exceeds the allowed assembly level.', entityIds, profile.assembly === 'unknown' ? ['serviceProfile.assembly'] : []))
  if (policy.maxAssembly === 'simple' && profile.assembly === 'intensive') reasons.push(reason('office-assembly-not-allowed', 'rejected', 'This office lunch requires intensive assembly.', entityIds))
  if (policy.requireReheatingSuitable && !['not-needed', 'suitable'].includes(profile.reheating)) reasons.push(reason(profile.reheating === 'unknown' ? 'office-suitability-review-required' : 'office-reheating-unsuitable', profile.reheating === 'unknown' ? 'review-needed' : 'rejected', 'This lunch does not have reviewed office-suitable reheating.', entityIds, profile.reheating === 'unknown' ? ['serviceProfile.reheating'] : []))
  if (!policy.allowIntrusiveOdors && profile.odor !== 'low') reasons.push(reason(profile.odor === 'unknown' ? 'office-suitability-review-required' : 'office-odor-not-allowed', profile.odor === 'unknown' ? 'review-needed' : 'rejected', 'This lunch does not satisfy the configured office odor policy.', entityIds, profile.odor === 'unknown' ? ['serviceProfile.odor'] : []))
  if (!policy.allowRiceBased && profile.riceBased !== false) reasons.push(reason(profile.riceBased === null ? 'office-suitability-review-required' : 'office-rice-not-allowed', profile.riceBased === null ? 'review-needed' : 'rejected', 'This lunch does not satisfy the configured rice policy.', entityIds, profile.riceBased === null ? ['serviceProfile.riceBased'] : []))
}

function classifyPlanningError(message: string, candidate: GeneratorCandidate): RejectedReason {
  const ids = [candidate.candidateId, candidate.recipeId]
  if (message.includes('reviewed exact selection')) return reason('source-yield-selection-required', 'review-needed', message, ids, ['sourceYieldSelection'])
  if (message.includes('reviewed source-output guidance')) return reason('recommendation-readiness-required', 'review-needed', message, ids, ['recipe.output.planningGuidance.sourceServingsPerMealPortion'])
  if (message.includes('not approved') || message.includes('does not support multiplier')) return reason(message.includes('whole') || message.includes('Requirement') ? 'whole-item-constraint' : 'batch-scaling-not-approved', 'rejected', message, ids)
  if (message.includes('fractional item')) return reason('whole-item-constraint', 'rejected', message, ids)
  if (message.includes('Storage window')) return reason('storage-window-exceeded', 'rejected', message, ids)
  if (message.includes('reviewed refrigerated') || message.includes('reviewed frozen') || message.includes('reviewed suitability')) return reason('storage-evidence-missing', 'review-needed', message, ids, ['recipe.suitability.storageModes'])
  if (message.includes('before the cook event')) return reason('meal-before-cooking', 'rejected', message, ids)
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
    return candidateFeasibilitySchema.parse({ candidateId: candidate.candidateId, status: 'rejected', recipeId: candidate.recipeId, recipeRevisionId: candidate.recipeRevisionId, reasons, explanations, projection: null })
  }

  const recipeEvidenceIds = new Set(recipe.source.evidence.map(({ evidenceId }) => evidenceId))
  if (candidate.serviceProfile.evidenceIds.some((evidenceId) => !recipeEvidenceIds.has(evidenceId))) reasons.push(reason('office-suitability-review-required', 'review-needed', 'Candidate service evidence does not belong to this recipe revision.', [candidate.candidateId], ['serviceProfile.evidenceIds']))
  if (!recipe.review.readiness.recommendationReady) reasons.push(reason('recommendation-readiness-required', 'review-needed', 'Automatic selection requires a recommendation-ready recipe revision.', [recipe.identity.recipeId, recipe.identity.revisionId], recipe.review.readiness.blockers.flatMap((blocker) => recommendationBlockerFields[blocker] ?? [])))
  if (request.hardConstraints.avoidedRecipeIds.includes(recipe.identity.recipeId)) reasons.push(reason('hard-recipe-avoid', 'rejected', 'The recipe is on the request hard-avoid list.', [recipe.identity.recipeId]))
  const avoidedIngredients = recipe.requirements.filter((requirement) => !requirement.optional && request.hardConstraints.avoidedIngredientIds.includes(requirement.canonicalIngredientId))
  if (avoidedIngredients.length) reasons.push(reason('hard-ingredient-avoid', 'rejected', 'The recipe contains a required ingredient on the hard-avoid list.', [recipe.identity.recipeId, ...avoidedIngredients.map(({ canonicalIngredientId }) => canonicalIngredientId)]))
  if (request.preferences.preferredRecipeIds.includes(recipe.identity.recipeId)) explanations.push({ code: 'preferred-recipe', message: 'The recipe is explicitly preferred.', entityIds: [recipe.identity.recipeId] })
  const votes = request.preferences.householdRecipePreferences.find(({ recipeId: preferenceRecipeId }) => preferenceRecipeId === recipe.identity.recipeId)
  if (votes && votes.likedVotes > 0 && votes.dislikedVotes > 0) explanations.push({ code: 'household-preference-conflict', message: 'Household taste votes conflict; a later optimizer must not treat this as universally liked.', entityIds: [recipe.identity.recipeId] })

  const requirements = new Map(request.mealRequirements.map((requirement) => [requirement.mealRequirementId, requirement]))
  const cookingWindow = request.cookingWindows.find(({ start, end }) => Date.parse(start) <= Date.parse(candidate.cookAt) && Date.parse(candidate.cookAt) <= Date.parse(end))
  if (!cookingWindow) reasons.push(reason('cooking-window-unavailable', 'rejected', 'The proposed cook event is outside every active cooking window.', [candidate.candidateId]))
  else if (recipe.effort.activeMinutes.value === null) reasons.push(reason('recommendation-readiness-required', 'review-needed', 'Active time is unknown for the selected cooking window.', [candidate.candidateId], ['recipe.effort.activeMinutes']))
  else if (recipe.effort.activeMinutes.value > cookingWindow.maxActiveMinutes) reasons.push(reason('active-time-exceeded', 'rejected', 'Recipe active time exceeds the selected cooking-window capacity.', [candidate.candidateId, cookingWindow.cookingWindowId]))
  const allocationRequests: { allocationId: string; requirement: MealRequirement; mealPortions: number; service: 'fresh' | 'refrigerated-leftover' | 'frozen-leftover' }[] = []
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
    if (requirement.constraints.maxActiveMinutes !== null) {
      if (recipe.effort.activeMinutes.value === null) reasons.push(reason('recommendation-readiness-required', 'review-needed', 'Active time is unknown for a constrained meal.', entityIds, ['recipe.effort.activeMinutes']))
      else if (recipe.effort.activeMinutes.value > requirement.constraints.maxActiveMinutes) reasons.push(reason('active-time-exceeded', 'rejected', 'Recipe active time exceeds the meal limit.', entityIds))
    }
    if (requirement.constraints.maxElapsedMinutes !== null) {
      if (recipe.effort.totalMinutes.value === null) reasons.push(reason('recommendation-readiness-required', 'review-needed', 'Elapsed time is unknown for a constrained meal.', entityIds, ['recipe.effort.totalMinutes']))
      else if (recipe.effort.totalMinutes.value > requirement.constraints.maxElapsedMinutes) reasons.push(reason('elapsed-time-exceeded', 'rejected', 'Recipe elapsed time exceeds the meal limit.', entityIds))
    }
    addOfficeLunchReasons(request, candidate, requirement, reasons)
    allocationRequests.push({ allocationId: `allocation-${candidate.candidateId.replace(/^candidate-/, '')}-${index + 1}`, requirement, mealPortions: allocation.mealPortions, service: allocation.service })
  })

  let projection: CandidateFeasibility['projection'] = null
  try {
    const batch = planCookingBatch(recipe, { batchId: `batch-${candidate.candidateId.replace(/^candidate-/, '')}`, groceryDemandId: `grocery-demand-${candidate.candidateId.replace(/^candidate-/, '')}`, multiplier: candidate.batchMultiplier, sourceYieldSelection: candidate.sourceYieldSelection ?? undefined })
    const event = scheduleCookEvent(recipe, batch, { cookEventId: `cook-event-${candidate.candidateId.replace(/^candidate-/, '')}`, intendedAt: candidate.cookAt })
    const allocated = allocateBatchToMeals(recipe, batch, event, allocationRequests)
    const allocatedAmount = allocated.allocations.reduce((sum, allocation) => sum + allocation.amount.amount, 0)
    projection = { batchOutput: batch.plannedOutput, allocatedOutput: { ...batch.plannedOutput, amount: allocatedAmount }, remainder: allocated.remainder }
  } catch (error) {
    reasons.push(classifyPlanningError(error instanceof Error ? error.message : 'Candidate planning failed.', candidate))
  }

  const deduplicatedReasons = reasons.filter((item, index) => reasons.findIndex((candidateReason) => candidateReason.code === item.code && JSON.stringify(candidateReason.entityIds) === JSON.stringify(item.entityIds)) === index)
  const status: CandidateFeasibility['status'] = deduplicatedReasons.some(({ disposition }) => disposition === 'rejected') ? 'rejected' : deduplicatedReasons.length ? 'review-needed' : 'eligible'
  if (status === 'eligible') explanations.push({ code: 'candidate-valid', message: 'Candidate satisfies the implemented G1 hard constraints.', entityIds: [candidate.candidateId] })
  return candidateFeasibilitySchema.parse({ candidateId: candidate.candidateId, status, recipeId: recipe.identity.recipeId, recipeRevisionId: recipe.identity.revisionId, reasons: deduplicatedReasons, explanations, projection })
}
