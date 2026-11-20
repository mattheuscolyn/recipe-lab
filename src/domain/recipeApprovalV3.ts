import { z } from 'zod'
import { computeRecipeV3Readiness, evidenceRefSchema, recipeV3Schema, type EvidenceRef, type RecipeV3 } from './recipeV3'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`), `Expected a ${prefix}- identifier`)
const text = (label: string, min: number, max: number) => z.string().trim().min(min, `${label} is required`).max(max)

export const approvalAuthoritySchema = z.enum(['owner-editorial', 'source-facts', 'food-safety', 'factual-metadata-rights'])
export const approvalContextSchema = z.enum(['production', 'synthetic-test'])
export const recommendationApprovalSubjectSchema = z.enum(['ingredient-normalization', 'output-scaling', 'meal-portions', 'effort'])

const reviewerSchema = z.object({
  reviewerId: id('reviewer'),
  displayName: text('Reviewer display name', 3, 120),
  authority: approvalAuthoritySchema,
  authorityBasis: text('Authority basis', 20, 500),
  authorizationReference: text('Authorization reference', 8, 300),
}).superRefine((reviewer, context) => {
  const generic = new Set(['ai', 'codex', 'system', 'reviewer', 'unknown', 'test', 'admin', 'owner'])
  if (generic.has(reviewer.displayName.toLowerCase())) context.addIssue({ code: 'custom', path: ['displayName'], message: 'Generic reviewer names do not establish authority' })
})

const decisionBase = {
  decisionId: id('approval-decision'),
  subjectFingerprint: z.string().min(2),
  rationale: text('Decision rationale', 20, 1000),
  evidenceIds: z.array(id('evidence')).min(1),
}

const claimEvidenceSchema = z.object({
  evidenceId: id('evidence'),
  assertionFingerprint: z.string().min(2),
  supportType: z.enum(['source-claim', 'safety-policy', 'editorial-assessment']),
  supportReference: text('Claim support reference', 8, 300),
})

const recommendationDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal('recommendation-decision'),
  subject: recommendationApprovalSubjectSchema,
  outcome: z.enum(['approved', 'blocked']),
})

const rightsDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal('metadata-rights'),
  subject: z.literal('factual-metadata-use'),
  outcome: z.enum(['approved', 'restricted']),
  scope: z.literal('factual-metadata-only'),
})

const prepareAheadDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal('suitability-decision'),
  subject: z.literal('prepare-ahead'),
  value: z.enum(['yes', 'no', 'conditional']),
  claimEvidence: z.array(claimEvidenceSchema).min(1),
})
const leftoverQualityDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal('suitability-decision'),
  subject: z.literal('leftover-quality'),
  value: z.enum(['good', 'acceptable', 'poor']),
  claimEvidence: z.array(claimEvidenceSchema).min(1),
})
const storageWindowDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal('suitability-decision'),
  subject: z.literal('storage-window'),
  mode: z.enum(['refrigerated', 'frozen', 'room-temperature']),
  maxDurationHours: z.number().int().nonnegative(),
  claimEvidence: z.array(claimEvidenceSchema).min(1),
})
const reheatMethodDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal('suitability-decision'),
  subject: z.literal('reheat-method'),
  value: text('Reheat method', 10, 300),
  claimEvidence: z.array(claimEvidenceSchema).min(1),
})

export const approvalDecisionSchema = z.union([
  recommendationDecisionSchema,
  rightsDecisionSchema,
  prepareAheadDecisionSchema,
  leftoverQualityDecisionSchema,
  storageWindowDecisionSchema,
  reheatMethodDecisionSchema,
])

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>
export type ApprovalAuthority = z.infer<typeof approvalAuthoritySchema>

function requiredAuthority(decision: ApprovalDecision): ApprovalAuthority {
  if (decision.kind === 'metadata-rights') return 'factual-metadata-rights'
  if (decision.kind === 'suitability-decision') return decision.subject === 'leftover-quality' ? 'owner-editorial' : 'food-safety'
  if (['ingredient-normalization', 'output-scaling'].includes(decision.subject)) return 'source-facts'
  return 'owner-editorial'
}

export const recipeApprovalRecordSchema = z.object({
  schemaVersion: z.literal(1),
  approvalId: id('approval'),
  recordRevisionId: id('approval-record-revision'),
  supersedesRecordRevisionId: id('approval-record-revision').nullable(),
  context: approvalContextSchema,
  recipeId: z.string().uuid(),
  recipeRevisionId: id('revision'),
  recordedAt: z.iso.datetime(),
  reviewer: reviewerSchema,
  evidence: z.array(evidenceRefSchema).min(1),
  decisions: z.array(approvalDecisionSchema).min(1),
}).superRefine((record, context) => {
  if (record.context === 'production' && /\b(synthetic|fixture|test)\b/i.test(record.reviewer.displayName)) context.addIssue({ code: 'custom', path: ['reviewer', 'displayName'], message: 'Production approval cannot use a synthetic reviewer identity' })
  if (record.context === 'synthetic-test' && !record.reviewer.reviewerId.startsWith('reviewer-synthetic-')) context.addIssue({ code: 'custom', path: ['reviewer', 'reviewerId'], message: 'Synthetic approval reviewers must be explicitly labeled' })
  if (new Set(record.evidence.map(({ evidenceId }) => evidenceId)).size !== record.evidence.length) context.addIssue({ code: 'custom', path: ['evidence'], message: 'Approval evidence ids must be unique' })
  if (new Set(record.decisions.map(({ decisionId }) => decisionId)).size !== record.decisions.length) context.addIssue({ code: 'custom', path: ['decisions'], message: 'Approval decision ids must be unique' })
  if (!record.evidence.some(({ kind }) => kind === 'approval-record')) context.addIssue({ code: 'custom', path: ['evidence'], message: 'Approval record needs durable approval-record evidence' })
  if (record.evidence.some(({ capturedAt }) => capturedAt && Date.parse(capturedAt) > Date.parse(record.recordedAt))) context.addIssue({ code: 'custom', path: ['recordedAt'], message: 'Approval cannot predate its evidence' })
  record.decisions.forEach((decision, index) => {
    if (requiredAuthority(decision) !== record.reviewer.authority) context.addIssue({ code: 'custom', path: ['decisions', index], message: `${decision.kind}:${decision.subject} requires ${requiredAuthority(decision)} authority` })
  })
})

export const recipeApprovalBundleSchema = z.object({
  schemaVersion: z.literal(1),
  bundleId: id('approval-bundle'),
  recipeId: z.string().uuid(),
  baseRevisionId: id('revision'),
  resultRevisionId: id('revision'),
  records: z.array(recipeApprovalRecordSchema).min(1),
}).superRefine((bundle, context) => {
  if (bundle.baseRevisionId === bundle.resultRevisionId) context.addIssue({ code: 'custom', path: ['resultRevisionId'], message: 'Approval must create a new immutable recipe revision' })
  const decisionKeys = bundle.records.flatMap(({ decisions }) => decisions.map(decisionKey))
  if (new Set(decisionKeys).size !== decisionKeys.length) context.addIssue({ code: 'custom', path: ['records'], message: 'Approval bundle cannot contain conflicting decisions for one subject' })
  if (new Set(bundle.records.map(({ recordRevisionId }) => recordRevisionId)).size !== bundle.records.length) context.addIssue({ code: 'custom', path: ['records'], message: 'Approval record revision ids must be unique' })
  if (new Set(bundle.records.map(({ approvalId }) => approvalId)).size !== bundle.records.length) context.addIssue({ code: 'custom', path: ['records'], message: 'A bundle may contain only one revision of each approval record' })
  bundle.records.forEach((record, index) => {
    if (record.recipeId !== bundle.recipeId || record.recipeRevisionId !== bundle.baseRevisionId) context.addIssue({ code: 'custom', path: ['records', index], message: 'Every approval record must target the bundle exact base revision' })
  })
})

export const recipeApprovalManifestSchema = z.object({
  schemaVersion: z.literal(1),
  bundles: z.array(recipeApprovalBundleSchema),
})

export type RecipeApprovalRecord = z.infer<typeof recipeApprovalRecordSchema>
export type RecipeApprovalBundle = z.infer<typeof recipeApprovalBundleSchema>
export type RecipeApprovalManifest = z.infer<typeof recipeApprovalManifestSchema>

function decisionKey(decision: ApprovalDecision): string {
  if (decision.kind === 'suitability-decision' && decision.subject === 'storage-window') return `${decision.kind}:${decision.subject}:${decision.mode}`
  return `${decision.kind}:${decision.subject}`
}

type ApprovalSubject = ApprovalDecision['subject'] | 'ingredient-normalization' | 'output-scaling' | 'meal-portions' | 'effort'

export function approvalSubjectFingerprint(recipe: RecipeV3, subject: ApprovalSubject): string {
  switch (subject) {
    case 'ingredient-normalization': return JSON.stringify(recipe.requirements.map(({ requirementId, originalText, selectedPlanningQuantity, nonQuantified, canonicalIngredientId, variantId, optional, alternatives, confidence, reviewNote }) => ({ requirementId, originalText, selectedPlanningQuantity, nonQuantified, canonicalIngredientId, variantId, optional, alternatives, confidence, reviewNote })))
    case 'output-scaling': return JSON.stringify({ kind: recipe.output.kind, sourceYield: recipe.output.sourceYield, scaling: recipe.output.scaling, requirementScaling: recipe.requirements.map(({ requirementId, scaling }) => ({ requirementId, scaling })) })
    case 'meal-portions': return JSON.stringify({ sourceYield: recipe.output.sourceYield, sourceServing: recipe.output.sourceServing, discreteItem: recipe.output.discreteItem, planningGuidance: recipe.output.planningGuidance })
    case 'effort': return JSON.stringify(recipe.effort)
    case 'factual-metadata-use': return JSON.stringify({ publisher: recipe.source.publisher, canonicalUrl: recipe.source.canonicalUrl, rights: recipe.source.rights })
    case 'prepare-ahead':
    case 'leftover-quality':
    case 'storage-window':
    case 'reheat-method': return JSON.stringify(recipe.suitability)
  }
}

function recommendationField(subject: z.infer<typeof recommendationApprovalSubjectSchema>): keyof RecipeV3['review']['recommendationDecisions'] {
  switch (subject) {
    case 'ingredient-normalization': return 'ingredientNormalization'
    case 'output-scaling': return 'outputScaling'
    case 'meal-portions': return 'mealPortions'
    case 'effort': return 'effort'
  }
}

function reviewedFact<T>(value: T, evidenceIds: string[]) {
  return { value, evidenceIds, confidence: 'reviewed' as const, unknownReason: null }
}

function validateDecisionEvidence(base: RecipeV3, record: RecipeApprovalRecord, decision: ApprovalDecision) {
  const baseEvidence = new Map(base.source.evidence.map((evidence) => [evidence.evidenceId, evidence]))
  const recordEvidence = new Map(record.evidence.map((evidence) => [evidence.evidenceId, evidence]))
  for (const evidenceId of decision.evidenceIds) if (!baseEvidence.has(evidenceId) && !recordEvidence.has(evidenceId)) throw new Error(`Approval decision cites unknown evidence ${evidenceId}`)
  if (!decision.evidenceIds.some((evidenceId) => recordEvidence.get(evidenceId)?.kind === 'approval-record')) throw new Error(`Approval decision ${decision.decisionId} must cite its durable approval record`)
  if (decision.kind !== 'suitability-decision') return

  const assertionFingerprint = suitabilityAssertionFingerprint(decision)
  for (const claim of decision.claimEvidence) {
    if (!decision.evidenceIds.includes(claim.evidenceId)) throw new Error(`Claim evidence ${claim.evidenceId} must be cited by decision ${decision.decisionId}`)
    if (claim.assertionFingerprint !== assertionFingerprint) throw new Error(`Claim evidence ${claim.evidenceId} does not support the exact approved suitability assertion`)
    const evidence = recordEvidence.get(claim.evidenceId) ?? baseEvidence.get(claim.evidenceId)
    if (!evidence) throw new Error(`Suitability decision cites unknown claim evidence ${claim.evidenceId}`)
    const validKind = claim.supportType === 'source-claim'
      ? ['publisher-jsonld', 'publisher-page', 'manual-source-review'].includes(evidence.kind)
      : claim.supportType === 'safety-policy'
        ? evidence.kind === 'food-safety-policy'
        : evidence.kind === 'editorial-judgment'
    if (!validKind || evidence.kind === 'approval-record') throw new Error(`Claim evidence ${claim.evidenceId} is not valid ${claim.supportType} evidence`)
    if (decision.subject !== 'leftover-quality' && claim.supportType === 'editorial-assessment') throw new Error(`${decision.subject} requires a specific source claim or versioned safety policy`)
  }
}

type ApprovalApplicationContext = z.infer<typeof approvalContextSchema>

type SuitabilityAssertionInput =
  | { subject: 'prepare-ahead'; value: 'yes' | 'no' | 'conditional' }
  | { subject: 'leftover-quality'; value: 'good' | 'acceptable' | 'poor' }
  | { subject: 'storage-window'; mode: 'refrigerated' | 'frozen' | 'room-temperature'; maxDurationHours: number }
  | { subject: 'reheat-method'; value: string }

export function suitabilityAssertionFingerprint(decision: SuitabilityAssertionInput): string {
  if (decision.subject === 'storage-window') return JSON.stringify({ subject: decision.subject, mode: decision.mode, maxDurationHours: decision.maxDurationHours })
  return JSON.stringify({ subject: decision.subject, value: decision.value })
}

function applyRecipeApprovalBundleInContext(baseInput: RecipeV3, bundleInput: unknown, expectedContext: ApprovalApplicationContext): { recipe: RecipeV3; history: RecipeV3[]; records: RecipeApprovalRecord[] } {
  const base = recipeV3Schema.parse(baseInput)
  const bundle = recipeApprovalBundleSchema.parse(bundleInput)
  if (bundle.records.some(({ context }) => context !== expectedContext)) throw new Error(`${expectedContext} approval application cannot accept records from another context`)
  if (bundle.recipeId !== base.identity.recipeId || bundle.baseRevisionId !== base.identity.revisionId) throw new Error('Approval bundle is stale or targets a different recipe revision')
  const existingEvidence = new Set(base.source.evidence.map(({ evidenceId }) => evidenceId))
  const next = structuredClone(base)
  next.identity.revisionId = bundle.resultRevisionId

  for (const record of bundle.records) {
    for (const evidence of record.evidence) {
      if (existingEvidence.has(evidence.evidenceId)) throw new Error(`Approval evidence id ${evidence.evidenceId} already exists`)
      existingEvidence.add(evidence.evidenceId)
      next.source.evidence.push(evidence)
    }
    for (const decision of record.decisions) {
      validateDecisionEvidence(base, record, decision)
      if (decision.subjectFingerprint !== approvalSubjectFingerprint(base, decision.subject)) throw new Error(`Approval decision ${decision.decisionId} is stale or does not match the reviewed value`)
      if (decision.kind === 'recommendation-decision') {
        const field = recommendationField(decision.subject)
        if (base.review.recommendationDecisions[field] === 'approved' && decision.outcome === 'approved') throw new Error(`${decision.subject} is already approved on the base revision`)
        if (decision.subject === 'ingredient-normalization' && decision.outcome === 'approved') {
          const unresolved = base.requirements.filter(({ optional, alternatives, confidence }) => optional || alternatives.length > 0 || confidence !== 'reviewed')
          if (unresolved.length) throw new Error(`Ingredient normalization cannot be approved while grocery branches or requirement reviews remain unresolved: ${unresolved.map(({ requirementId }) => requirementId).join(', ')}`)
        }
        next.review.recommendationDecisions[field] = decision.outcome
      } else if (decision.kind === 'metadata-rights') {
        if (base.source.rights.factualMetadataUse !== 'review-needed') throw new Error('Metadata rights decision is already closed on the base revision')
        next.source.rights.factualMetadataUse = decision.outcome
        next.source.rights.note = `Factual-metadata ${decision.outcome} by ${record.reviewer.reviewerId} in ${record.recordRevisionId}; method and image limits are unchanged.`
      } else {
        next.suitability.reviewState = 'editor-reviewed'
        if (decision.subject === 'prepare-ahead') next.suitability.prepareAhead = reviewedFact(decision.value, decision.evidenceIds)
        else if (decision.subject === 'leftover-quality') next.suitability.leftoverQuality = reviewedFact(decision.value, decision.evidenceIds)
        else if (decision.subject === 'reheat-method') next.suitability.reheatMethod = reviewedFact(decision.value, decision.evidenceIds)
        else {
          const storage = { mode: decision.mode, maxDurationHours: decision.maxDurationHours, evidenceIds: decision.evidenceIds, confidence: 'reviewed' as const }
          next.suitability.storageModes = [...next.suitability.storageModes.filter(({ mode }) => mode !== decision.mode), storage]
        }
      }
    }
  }
  next.review.readiness = computeRecipeV3Readiness(next)
  const recipe = recipeV3Schema.parse(next)
  return { recipe, history: [structuredClone(base), structuredClone(recipe)], records: bundle.records }
}

export function applyRecipeApprovalBundle(baseInput: RecipeV3, bundleInput: unknown) {
  return applyRecipeApprovalBundleInContext(baseInput, bundleInput, 'production')
}

export function applySyntheticRecipeApprovalBundleForTest(baseInput: RecipeV3, bundleInput: unknown) {
  return applyRecipeApprovalBundleInContext(baseInput, bundleInput, 'synthetic-test')
}

function applyRecipeApprovalManifestInContext(baseRecipes: RecipeV3[], input: unknown, expectedContext: ApprovalApplicationContext): { activeRecipes: RecipeV3[]; revisionHistory: Map<string, RecipeV3[]> } {
  const manifest = recipeApprovalManifestSchema.parse(input)
  const active = new Map(baseRecipes.map((recipe) => [recipe.identity.recipeId, recipeV3Schema.parse(recipe)]))
  const history = new Map(baseRecipes.map((recipe) => [recipe.identity.recipeId, [structuredClone(recipe)]]))
  const activeRecordRevision = new Map<string, string>()
  const recordRevisionIds = new Set<string>()
  const recipeRevisionIds = new Set(baseRecipes.map(({ identity }) => identity.revisionId))
  for (const bundle of manifest.bundles) {
    const base = active.get(bundle.recipeId)
    if (!base || base.identity.revisionId !== bundle.baseRevisionId) throw new Error(`Approval bundle ${bundle.bundleId} is stale or branches from a non-active revision`)
    if (recipeRevisionIds.has(bundle.resultRevisionId)) throw new Error(`Approval bundle ${bundle.bundleId} reuses recipe revision ${bundle.resultRevisionId}`)
    for (const record of bundle.records) {
      const previous = activeRecordRevision.get(record.approvalId)
      if (previous ? record.supersedesRecordRevisionId !== previous : record.supersedesRecordRevisionId !== null) throw new Error(`Approval record ${record.recordRevisionId} has an invalid version chain`)
      if (recordRevisionIds.has(record.recordRevisionId)) throw new Error(`Approval record revision ${record.recordRevisionId} is duplicated`)
      activeRecordRevision.set(record.approvalId, record.recordRevisionId)
      recordRevisionIds.add(record.recordRevisionId)
    }
    const applied = applyRecipeApprovalBundleInContext(base, bundle, expectedContext)
    active.set(bundle.recipeId, applied.recipe)
    history.get(bundle.recipeId)!.push(applied.recipe)
    recipeRevisionIds.add(bundle.resultRevisionId)
  }
  return { activeRecipes: baseRecipes.map(({ identity }) => active.get(identity.recipeId)!), revisionHistory: history }
}

export function applyRecipeApprovalManifest(baseRecipes: RecipeV3[], input: unknown) {
  return applyRecipeApprovalManifestInContext(baseRecipes, input, 'production')
}

export function applySyntheticRecipeApprovalManifestForTest(baseRecipes: RecipeV3[], input: unknown) {
  return applyRecipeApprovalManifestInContext(baseRecipes, input, 'synthetic-test')
}

export function approvalRecordEvidence(record: RecipeApprovalRecord): EvidenceRef[] {
  return record.evidence.map((evidence) => structuredClone(evidence))
}
