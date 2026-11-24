import { z } from 'zod'
import { canonicalIngredientSchema, recipeV2Schema, unitCodeSchema, type CanonicalIngredient } from './catalog'
import { adaptRecipeV2ToDraftV3 } from './recipeV3Migration'
import { computeRecipeV3Readiness, recipeV3Schema, type RecipeV3 } from './recipeV3'

export const PERSONAL_RECIPE_STORAGE_KEY = 'recipe-lab.personal-recipes.v1'
export const PERSONAL_RECIPE_IMPORT_PENDING_KEY = `${PERSONAL_RECIPE_STORAGE_KEY}.import-pending`
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`))

export const personalRecipeInputSchema = z.object({
  personalRecipeId: z.string().uuid(),
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  emoji: z.string().trim().min(1).max(8),
  servings: z.number().int().positive().max(100),
  activeMinutes: z.number().int().nonnegative().max(1440),
  totalMinutes: z.number().int().positive().max(2880),
  mealRoles: z.array(z.enum(['breakfast', 'lunch', 'dinner'])).min(1),
  ingredients: z.array(z.object({
    ingredientId: id('ingredient'),
    variantId: id('variant'),
    amount: z.number().positive().finite(),
    unit: unitCodeSchema,
    optional: z.boolean(),
  })).min(1),
  authorshipConfirmed: z.literal(true),
  authorshipStatement: z.string().trim().min(10).max(300),
  freshUseReviewed: z.literal(true),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).superRefine((input, context) => {
  if (input.totalMinutes < input.activeMinutes) context.addIssue({ code: 'custom', path: ['totalMinutes'], message: 'Total time cannot be shorter than active time' })
  if (new Set(input.mealRoles).size !== input.mealRoles.length) context.addIssue({ code: 'custom', path: ['mealRoles'], message: 'Meal roles must be unique' })
})

export type PersonalRecipeInput = z.infer<typeof personalRecipeInputSchema>

export const personalRecipeLibrarySchema = z.object({
  schemaVersion: z.literal(1),
  recipes: z.array(z.object({
    personalRecipeId: z.string().uuid(),
    activeRevisionId: id('revision'),
    revisions: z.array(z.object({ input: personalRecipeInputSchema, recipe: recipeV3Schema })).min(1),
  })),
}).superRefine((library, context) => {
  if (new Set(library.recipes.map(({ personalRecipeId }) => personalRecipeId)).size !== library.recipes.length) context.addIssue({ code: 'custom', path: ['recipes'], message: 'Personal recipe ids must be unique' })
  library.recipes.forEach((record, index) => {
    if (!record.revisions.some(({ recipe }) => recipe.identity.revisionId === record.activeRevisionId)) context.addIssue({ code: 'custom', path: ['recipes', index, 'activeRevisionId'], message: 'Active revision must exist in immutable history' })
    if (new Set(record.revisions.map(({ recipe }) => recipe.identity.revisionId)).size !== record.revisions.length) context.addIssue({ code: 'custom', path: ['recipes', index, 'revisions'], message: 'Revision ids must be unique within immutable history' })
    if (new Set(record.revisions.map(({ input }) => input.revision)).size !== record.revisions.length) context.addIssue({ code: 'custom', path: ['recipes', index, 'revisions'], message: 'Revision numbers must be unique within immutable history' })
    record.revisions.forEach((revision, revisionIndex) => {
      if (revision.input.personalRecipeId !== record.personalRecipeId || revision.recipe.identity.recipeId !== record.personalRecipeId) context.addIssue({ code: 'custom', path: ['recipes', index, 'revisions', revisionIndex], message: 'Every revision must retain the record recipe id' })
      if (revision.recipe.identity.revisionId !== `revision-personal-${record.personalRecipeId.slice(0, 8)}-r${revision.input.revision}`) context.addIssue({ code: 'custom', path: ['recipes', index, 'revisions', revisionIndex, 'recipe', 'identity', 'revisionId'], message: 'Revision identity must match its immutable input revision number' })
      if (Date.parse(revision.input.updatedAt) < Date.parse(revision.input.createdAt)) context.addIssue({ code: 'custom', path: ['recipes', index, 'revisions', revisionIndex, 'input', 'updatedAt'], message: 'Revision update cannot predate recipe creation' })
    })
  })
})

export type PersonalRecipeLibrary = z.infer<typeof personalRecipeLibrarySchema>
export const emptyPersonalRecipeLibrary = (): PersonalRecipeLibrary => ({ schemaVersion: 1, recipes: [] })
export type PersonalRecipeLoadResult = { library: PersonalRecipeLibrary | null; rawRecovery: string | null; error: string | null }
export type PersonalRecipeImportConflict = { personalRecipeId: string; code: 'revision-collision' | 'active-revision-choice'; message: string }
export type PersonalRecipeImportPreview = { merged: PersonalRecipeLibrary | null; conflicts: PersonalRecipeImportConflict[]; addedRecipes: number; addedRevisions: number }
const slug = (title: string, recipeId: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'personal-recipe'}-${recipeId.slice(0, 8)}`
const roleCategory = (role: PersonalRecipeInput['mealRoles'][number]) => role === 'breakfast' ? 'Breakfast' as const : role === 'lunch' ? 'Lunch' as const : 'Dinner' as const

export function buildPersonalRecipeRevision(inputValue: PersonalRecipeInput, ingredientCatalog: CanonicalIngredient[]): RecipeV3 {
  const input = personalRecipeInputSchema.parse(inputValue)
  const catalog = new Map(ingredientCatalog.map((ingredient) => [ingredient.id, canonicalIngredientSchema.parse(ingredient)]))
  const recipeSlug = slug(input.title, input.personalRecipeId)
  const evidenceId = `evidence-personal-${input.personalRecipeId.slice(0, 8)}-r${input.revision}`
  const revisionId = `revision-personal-${input.personalRecipeId.slice(0, 8)}-r${input.revision}`
  const checkedAt = input.updatedAt.slice(0, 10)
  const requirements = input.ingredients.map((item, index) => {
    const ingredient = catalog.get(item.ingredientId)
    const variant = ingredient?.variants.find(({ id: variantId }) => variantId === item.variantId)
    if (!ingredient || !variant) throw new Error(`Personal ingredient ${item.ingredientId}/${item.variantId} is not in the local catalog`)
    return {
      id: `requirement-personal-${input.personalRecipeId.slice(0, 8)}-${index + 1}`,
      sourceLineId: `source-line-personal-${input.personalRecipeId.slice(0, 8)}-${index + 1}`,
      originalText: `${item.amount} ${item.unit} ${variant.label} ${ingredient.displayName}${item.optional ? ' (optional)' : ''}`,
      quantity: { amount: item.amount, unit: item.unit, approximate: false },
      sourceQuantity: { amount: item.amount, unit: item.unit, approximate: false },
      nonQuantified: null,
      canonicalIngredientId: item.ingredientId,
      variantId: item.variantId,
      preparation: null,
      optional: item.optional,
      confidence: 'reviewed' as const,
      reviewNote: null,
      sourceRange: null,
      alternatives: [],
      sourcePackage: null,
    }
  })
  const base = adaptRecipeV2ToDraftV3(recipeV2Schema.parse({
    schemaVersion: 2,
    id: input.personalRecipeId,
    slug: recipeSlug,
    title: input.title,
    description: input.description,
    emoji: input.emoji,
    category: roleCategory(input.mealRoles[0]),
    cuisine: 'Personal',
    tags: ['Personal recipe'],
    yield: { source: { kind: 'meal-servings', amount: input.servings, range: null, unit: 'servings', label: `${input.servings} personal servings` }, planningServings: { default: input.servings, range: null, assumption: 'User-confirmed one serving per meal portion.' } },
    times: { prepMinutes: input.activeMinutes, cookMinutes: 0, totalMinutes: input.totalMinutes },
    requirements,
    methodSummary: ['Follow your own private recipe method. Recipe Lab stores planning facts, not an invented method.'],
    source: { publisher: 'Personal recipe', author: null, url: `https://local.recipe-lab.invalid/${recipeSlug}`, checkedAt, selectionRationale: 'Added privately by the household for local meal planning.', rating: null, reviewCount: null },
    review: { status: 'source-reviewed', reviewedAt: checkedAt, ingredientCompletenessReviewed: true, methodIndependentlyWritten: true },
  }))
  base.identity = { ...base.identity, revisionId, lifecycle: 'source-reviewed' }
  base.source.publisher = 'Household-provided personal recipe'
  base.source.author = null
  base.source.rights = { factualMetadataUse: 'approved', methodTextUse: 'independent-summary-only', imageUse: 'none', note: `The user confirmed authorship or permission: ${input.authorshipStatement}` }
  base.source.evidence = [{ evidenceId, kind: 'user-entered', sourceUrl: null, capturedAt: input.updatedAt, sourceLabel: 'Private household recipe entry', confidence: 'reviewed', reviewerNote: 'Household-provided facts; not independently verified by Recipe Lab.' }]
  base.output.sourceYield.evidenceIds = [evidenceId]
  base.output.sourceServing = { servingsPerRecipe: input.servings, servingSize: null, servingLabel: 'one household meal portion', evidenceIds: [evidenceId] }
  base.output.scaling = { policy: 'linear-reviewed', allowedMultipliers: [0.5, 1, 1.5, 2].filter((multiplier) => input.ingredients.filter(({ unit }) => ['item', 'head', 'can', 'clove'].includes(unit)).every(({ amount }) => Number.isInteger(amount * multiplier))), note: 'Household-reviewed linear scaling; whole-item quantities must remain integral.' }
  base.output.planningGuidance = { defaultMealPortions: input.servings, sourceServingsPerMealPortion: { value: 1, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }, adequacyNote: 'Household confirmed one source serving as one meal portion.', sideSuggestionRefs: [] }
  base.components.forEach((component) => { component.evidenceIds = [evidenceId] })
  base.requirements.forEach((requirement, index) => {
    requirement.evidenceIds = [evidenceId]
    if (requirement.sourceQuantity) requirement.sourceQuantity.evidenceIds = [evidenceId]
    if (requirement.selectedPlanningQuantity) requirement.selectedPlanningQuantity.evidenceIds = [evidenceId]
    requirement.scaling = ['item', 'head', 'can', 'clove'].includes(input.ingredients[index].unit) ? 'whole-item' : 'linear'
    requirement.confidence = 'reviewed'
    requirement.reviewNote = null
  })
  const known = <T>(value: T) => ({ value, evidenceIds: [evidenceId], confidence: 'reviewed' as const, unknownReason: null })
  base.effort.prepMinutes = known(input.activeMinutes)
  base.effort.cookMinutes = known(0)
  base.effort.passiveMinutes = known(input.totalMinutes - input.activeMinutes)
  base.effort.totalMinutes = known(input.totalMinutes)
  base.effort.activeMinutes = known(input.activeMinutes)
  base.effort.effortLevel = known(input.activeMinutes <= 20 ? 'low' as const : input.activeMinutes <= 45 ? 'medium' as const : 'high' as const)
  base.effort.attentionPattern = known(input.activeMinutes === input.totalMinutes ? 'continuous' as const : 'periodic' as const)
  base.mealRoles.primary = [...input.mealRoles]
  base.suitability = {
    reviewState: 'unknown',
    prepareAhead: { value: null, evidenceIds: [], confidence: 'unknown', unknownReason: 'Fresh-use review does not establish advance preparation.' },
    leftoverQuality: { value: null, evidenceIds: [], confidence: 'unknown', unknownReason: 'Fresh-use review does not establish leftover quality.' },
    storageModes: [],
    thawRequired: { value: null, evidenceIds: [], confidence: 'unknown', unknownReason: 'No frozen use was reviewed.' },
    reheatMethod: { value: null, evidenceIds: [], confidence: 'unknown', unknownReason: 'No reheating use was reviewed.' },
    notes: ['Fresh use only. Household-entered planning facts are not independently verified.'],
  }
  base.review.sourceFactsReviewedAt = checkedAt
  base.review.ingredientCompletenessReviewed = true
  base.review.methodIndependentlyWritten = true
  base.review.structuredStepsReviewed = false
  base.review.safetyReviewed = false
  base.review.recommendationDecisions = { ingredientNormalization: 'approved', outputScaling: 'approved', mealPortions: 'approved', effort: 'approved' }
  base.review.readiness = computeRecipeV3Readiness(base)
  return recipeV3Schema.parse(base)
}

export function loadPersonalRecipeLibrary(storage: Storage | null): PersonalRecipeLibrary {
  if (!storage) return emptyPersonalRecipeLibrary()
  const raw = storage.getItem(PERSONAL_RECIPE_STORAGE_KEY)
  if (!raw) return emptyPersonalRecipeLibrary()
  try { return personalRecipeLibrarySchema.parse(JSON.parse(raw)) } catch { return emptyPersonalRecipeLibrary() }
}

export function inspectPersonalRecipeLibrary(storage: Storage | null): PersonalRecipeLoadResult {
  if (!storage) return { library: emptyPersonalRecipeLibrary(), rawRecovery: null, error: null }
  let raw: string | null
  let pendingRaw: string | null
  try { raw = storage.getItem(PERSONAL_RECIPE_STORAGE_KEY); pendingRaw = storage.getItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY) } catch { return { library: null, rawRecovery: null, error: 'Personal recipes cannot be read from browser storage.' } }
  if (!raw && !pendingRaw) return { library: emptyPersonalRecipeLibrary(), rawRecovery: null, error: null }
  let library: PersonalRecipeLibrary | null = null
  try { if (raw) library = personalRecipeLibrarySchema.parse(JSON.parse(raw)) } catch { /* surfaced below with raw recovery */ }
  if (pendingRaw && pendingRaw !== raw) {
    const recovery = JSON.stringify({ authoritative: raw, interruptedImport: pendingRaw }, null, 2)
    return { library, rawRecovery: recovery, error: 'An interrupted personal-recipe import was detected. The prior library remains authoritative; download the recovery bundle before deciding what to restore.' }
  }
  if (!library) return { library: null, rawRecovery: raw, error: 'Personal recipes are corrupted or from an unsupported version. They were not replaced with an empty library.' }
  return { library, rawRecovery: null, error: null }
}

export const exportPersonalRecipeLibrary = (library: PersonalRecipeLibrary): string => JSON.stringify(personalRecipeLibrarySchema.parse(library), null, 2)

export function previewPersonalRecipeImport(currentValue: PersonalRecipeLibrary, raw: string, activeRevisionSelections: Record<string, string> = {}): PersonalRecipeImportPreview {
  const current = personalRecipeLibrarySchema.parse(currentValue)
  const incoming = personalRecipeLibrarySchema.parse(JSON.parse(raw))
  const conflicts: PersonalRecipeImportConflict[] = []
  let addedRecipes = 0
  let addedRevisions = 0
  const recipes = structuredClone(current.recipes)
  incoming.recipes.forEach((incomingRecord) => {
    const existing = recipes.find(({ personalRecipeId }) => personalRecipeId === incomingRecord.personalRecipeId)
    if (!existing) { recipes.push(structuredClone(incomingRecord)); addedRecipes += 1; addedRevisions += incomingRecord.revisions.length; return }
    const existingById = new Map(existing.revisions.map((revision) => [revision.recipe.identity.revisionId, revision]))
    incomingRecord.revisions.forEach((revision) => {
      const prior = existingById.get(revision.recipe.identity.revisionId)
      if (prior && JSON.stringify(prior) !== JSON.stringify(revision)) conflicts.push({ personalRecipeId: incomingRecord.personalRecipeId, code: 'revision-collision', message: `${revision.recipe.identity.revisionId} has different immutable content.` })
      else if (!prior) { existing.revisions.push(structuredClone(revision)); addedRevisions += 1 }
    })
    if (incomingRecord.activeRevisionId !== existing.activeRevisionId) {
      const selected = activeRevisionSelections[incomingRecord.personalRecipeId]
      if (!selected) conflicts.push({ personalRecipeId: incomingRecord.personalRecipeId, code: 'active-revision-choice', message: 'Current and imported libraries select different active revisions; choose explicitly.' })
      else if (!existing.revisions.some(({ recipe }) => recipe.identity.revisionId === selected)) conflicts.push({ personalRecipeId: incomingRecord.personalRecipeId, code: 'active-revision-choice', message: 'The selected active revision does not exist in the merged history.' })
      else existing.activeRevisionId = selected
    }
  })
  if (conflicts.length) return { merged: null, conflicts, addedRecipes, addedRevisions }
  return { merged: personalRecipeLibrarySchema.parse({ schemaVersion: 1, recipes }), conflicts, addedRecipes, addedRevisions }
}

export function persistPersonalRecipeLibrary(storage: Storage, expectedCurrent: PersonalRecipeLibrary, nextValue: PersonalRecipeLibrary): PersonalRecipeLibrary {
  const expected = personalRecipeLibrarySchema.parse(expectedCurrent)
  const next = personalRecipeLibrarySchema.parse(nextValue)
  const raw = storage.getItem(PERSONAL_RECIPE_STORAGE_KEY)
  // A pending write with different contents may be the only recoverable copy of an interrupted import.
  // Never replace that journal with a new create/edit/import/delete transaction.
  const pendingRaw = storage.getItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY)
  if (pendingRaw !== null && pendingRaw !== raw) throw new Error('An interrupted personal-recipe write needs recovery. Download the recovery bundle before making further changes.')
  if (raw !== null) {
    let current: PersonalRecipeLibrary
    try { current = personalRecipeLibrarySchema.parse(JSON.parse(raw)) } catch { throw new Error('Existing personal recipes are unreadable. Nothing was overwritten; export the recovery data first.') }
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Personal recipes changed in another tab. Reload before importing or editing.')
  } else if (expected.recipes.length) throw new Error('Personal recipes were removed in another tab. Reload before importing or editing.')
  const serialized = JSON.stringify(next)
  storage.setItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY, serialized)
  try {
    storage.setItem(PERSONAL_RECIPE_STORAGE_KEY, serialized)
    if (JSON.stringify(personalRecipeLibrarySchema.parse(JSON.parse(storage.getItem(PERSONAL_RECIPE_STORAGE_KEY) ?? 'null'))) !== JSON.stringify(next)) throw new Error('verification failed')
    storage.removeItem(PERSONAL_RECIPE_IMPORT_PENDING_KEY)
    return next
  } catch (error) {
    throw new Error(`Personal recipe save did not complete; the prior library remains the recovery baseline. ${error instanceof Error ? error.message : ''}`.trim(), { cause: error })
  }
}

export function importPersonalRecipeLibrary(storage: Storage, current: PersonalRecipeLibrary, raw: string, activeRevisionSelections: Record<string, string> = {}): PersonalRecipeLibrary {
  const preview = previewPersonalRecipeImport(current, raw, activeRevisionSelections)
  if (!preview.merged) throw new Error(`Import needs review: ${preview.conflicts.map(({ message }) => message).join(' ')}`)
  return persistPersonalRecipeLibrary(storage, current, preview.merged)
}

export function removePersonalRecipe(storage: Storage, currentValue: PersonalRecipeLibrary, personalRecipeId: string): PersonalRecipeLibrary {
  const current = personalRecipeLibrarySchema.parse(currentValue)
  if (!current.recipes.some((record) => record.personalRecipeId === personalRecipeId)) throw new Error('Unknown personal recipe')
  return persistPersonalRecipeLibrary(storage, current, { ...current, recipes: current.recipes.filter((record) => record.personalRecipeId !== personalRecipeId) })
}

export function savePersonalRecipeRevision(storage: Storage, libraryValue: PersonalRecipeLibrary, input: PersonalRecipeInput, ingredientCatalog: CanonicalIngredient[]): PersonalRecipeLibrary {
  const library = personalRecipeLibrarySchema.parse(libraryValue)
  // Never replace an unreadable or concurrently updated private library with an empty/stale snapshot.
  const storedRaw = storage.getItem(PERSONAL_RECIPE_STORAGE_KEY)
  if (storedRaw !== null) {
    let stored: PersonalRecipeLibrary
    try { stored = personalRecipeLibrarySchema.parse(JSON.parse(storedRaw)) }
    catch { throw new Error('Existing personal recipes are unreadable. Nothing was overwritten; recover or export the original browser data before saving.') }
    if (JSON.stringify(stored) !== JSON.stringify(library)) throw new Error('Personal recipes changed since this view loaded. Reload or back up the newer library before saving.')
  }
  const recipe = buildPersonalRecipeRevision(input, ingredientCatalog)
  const existing = library.recipes.find(({ personalRecipeId }) => personalRecipeId === input.personalRecipeId)
  if (existing?.revisions.some(({ recipe: prior }) => prior.identity.revisionId === recipe.identity.revisionId)) throw new Error('A personal recipe revision is immutable and cannot be overwritten')
  const next: PersonalRecipeLibrary = existing
    ? { ...library, recipes: library.recipes.map((record) => record.personalRecipeId === input.personalRecipeId ? { ...record, activeRevisionId: recipe.identity.revisionId, revisions: [...record.revisions, { input, recipe }] } : record) }
    : { ...library, recipes: [...library.recipes, { personalRecipeId: input.personalRecipeId, activeRevisionId: recipe.identity.revisionId, revisions: [{ input, recipe }] }] }
  const parsed = personalRecipeLibrarySchema.parse(next)
  return persistPersonalRecipeLibrary(storage, library, parsed)
}

export function activePersonalRecipes(library: PersonalRecipeLibrary): RecipeV3[] {
  return personalRecipeLibrarySchema.parse(library).recipes.map((record) => record.revisions.find(({ recipe }) => recipe.identity.revisionId === record.activeRevisionId)!.recipe)
}
