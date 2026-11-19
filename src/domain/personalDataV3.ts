import { z } from 'zod'
import { emptyPersonalData, mealSlotSchema, migratePersonalData, pantryLotSchema, personalDataSchema, PERSONAL_DATA_KEY, recipePreferenceSchema, type IngredientVariantCatalog, type PersonalData, type StorageLike } from './personalData'
import { batchSchema, cookEventSchema, mealAllocationSchema, mealRequirementSchema, preparedFoodLotSchema, validatePlanningSnapshot } from './planningV3'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`), `Expected a ${prefix}- identifier`)

export const prepTaskSchema = z.object({
  taskId: id('task'),
  cookEventId: id('cook-event').nullable(),
  mealRequirementId: id('meal-requirement').nullable(),
  kind: z.enum(['prep', 'defrost', 'soak', 'marinate', 'chill', 'reheat']),
  title: z.string().trim().min(1).max(160),
  timingWindow: z.object({ earliest: z.iso.datetime().nullable(), latest: z.iso.datetime().nullable() }),
  durationMinutes: z.number().int().nonnegative().nullable(),
  evidenceIds: z.array(id('evidence')),
  state: z.enum(['proposed', 'scheduled', 'done', 'cancelled']),
  safetyNote: z.string().trim().min(1).max(500).nullable(),
}).superRefine((task, context) => {
  if (task.timingWindow.earliest && task.timingWindow.latest && Date.parse(task.timingWindow.latest) < Date.parse(task.timingWindow.earliest)) context.addIssue({ code: 'custom', path: ['timingWindow', 'latest'], message: 'Task timing window cannot end before it starts' })
})

export const legacyRecipeChoiceSchema = z.object({
  legacySlotId: z.string().min(1),
  mealRequirementId: id('meal-requirement'),
  recipeId: z.string().uuid(),
})

const issueMessage = z.string().trim().min(1).max(500)
export const migrationIssueSchema = z.discriminatedUnion('entity', [
  z.object({
    entity: z.literal('meal-slot'),
    code: z.enum(['fractional-portions', 'unknown-recipe', 'duplicate-slot-id', 'duplicate-meal']),
    legacySlotId: z.string().min(1),
    date: z.iso.date(),
    meal: z.enum(['Breakfast', 'Lunch', 'Dinner']),
    message: issueMessage,
  }),
  z.object({
    entity: z.literal('pantry-lot'),
    code: z.enum(['unknown-ingredient', 'unknown-variant']),
    pantryLotId: z.string().min(1),
    message: issueMessage,
  }),
])

const migrationRecoverySchema = z.object({
  sourceSchemaVersion: z.literal(2),
  sourceStorageKey: z.literal('recipe-lab.personal.v1'),
  sourceFingerprint: z.string().regex(/^v2-[a-f0-9]{8}$/),
  sourceRaw: z.string().min(1),
  originalPayload: personalDataSchema,
  issues: z.array(migrationIssueSchema),
  coexistencePolicy: z.literal('v2-authoritative-v3-snapshot'),
})

export const personalDataV3Schema = z.object({
  schemaVersion: z.literal(3),
  preferences: z.record(z.string(), recipePreferenceSchema),
  plan: z.array(mealSlotSchema),
  checkedGroceries: z.record(z.string(), z.boolean()),
  pantry: z.array(pantryLotSchema),
  mealRequirements: z.array(mealRequirementSchema),
  cookEvents: z.array(cookEventSchema),
  batches: z.array(batchSchema),
  allocations: z.array(mealAllocationSchema),
  preparedFoodLots: z.array(preparedFoodLotSchema),
  tasks: z.array(prepTaskSchema),
  legacyRecipeChoices: z.array(legacyRecipeChoiceSchema),
  migrationRecovery: migrationRecoverySchema.nullable(),
}).superRefine((data, context) => {
  if (new Set(data.pantry.map(({ id }) => id)).size !== data.pantry.length) context.addIssue({ code: 'custom', path: ['pantry'], message: 'Pantry lot ids must be unique' })
  if (new Set(data.tasks.map(({ taskId }) => taskId)).size !== data.tasks.length) context.addIssue({ code: 'custom', path: ['tasks'], message: 'Task ids must be unique' })
  const planning = validatePlanningSnapshot({ mealRequirements: data.mealRequirements, cookEvents: data.cookEvents, batches: data.batches, allocations: data.allocations, preparedFoodLots: data.preparedFoodLots })
  if (!planning.success) planning.issues.forEach((issue) => context.addIssue({ code: 'custom', path: ['planning', issue.path], message: issue.message }))
  const requirements = new Map(data.mealRequirements.map((requirement) => [requirement.mealRequirementId, requirement]))
  const slotIds = new Set<string>()
  const choiceRequirementIds = new Set<string>()
  data.legacyRecipeChoices.forEach((choice, index) => {
    if (slotIds.has(choice.legacySlotId)) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'legacySlotId'], message: 'Legacy slot choices must be unique' })
    if (choiceRequirementIds.has(choice.mealRequirementId)) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'A migrated meal may have only one legacy recipe choice' })
    const requirement = requirements.get(choice.mealRequirementId)
    if (!requirement) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'Legacy choice must reference a migrated meal requirement' })
    const matchingSlots = data.plan.filter(({ id: slotId }) => slotId === choice.legacySlotId)
    const slot = matchingSlots.length === 1 ? matchingSlots[0] : null
    if (!slot) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'legacySlotId'], message: matchingSlots.length ? 'Legacy choice cannot reference an ambiguous duplicate slot identifier' : 'Legacy choice must reference an original plan slot' })
    if (slot && slot.recipeId !== choice.recipeId) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'recipeId'], message: 'Legacy choice recipe must match the preserved plan slot' })
    if (slot && requirement) {
      if (requirement.date !== slot.date) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'Migrated requirement date must match the preserved plan slot' })
      if (requirement.meal !== slot.meal.toLowerCase()) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'Migrated requirement meal must match the preserved plan slot' })
      if (requirement.requestedPortions !== slot.servings) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'Migrated requirement portions must match the preserved plan slot' })
      if (requirement.lock.locked !== slot.locked) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'Migrated requirement lock must match the preserved plan slot' })
    }
    slotIds.add(choice.legacySlotId)
    choiceRequirementIds.add(choice.mealRequirementId)
  })
  if (data.migrationRecovery) {
    const recovery = data.migrationRecovery
    if (personalDataFingerprint(recovery.originalPayload) !== recovery.sourceFingerprint) context.addIssue({ code: 'custom', path: ['migrationRecovery', 'sourceFingerprint'], message: 'Recovery fingerprint does not match the preserved v2 payload' })
    try {
      const rawPayload = migratePersonalData(JSON.parse(recovery.sourceRaw))
      if (canonicalJson(rawPayload) !== canonicalJson(recovery.originalPayload)) context.addIssue({ code: 'custom', path: ['migrationRecovery', 'sourceRaw'], message: 'Raw recovery source does not match the preserved v2 payload' })
    } catch {
      context.addIssue({ code: 'custom', path: ['migrationRecovery', 'sourceRaw'], message: 'Raw recovery source must contain parseable v2 personal data' })
    }
    const preserved = { preferences: data.preferences, plan: data.plan, checkedGroceries: data.checkedGroceries, pantry: data.pantry }
    const original = { preferences: recovery.originalPayload.preferences, plan: recovery.originalPayload.plan, checkedGroceries: recovery.originalPayload.checkedGroceries, pantry: recovery.originalPayload.pantry }
    if (canonicalJson(preserved) !== canonicalJson(original)) context.addIssue({ code: 'custom', path: ['migrationRecovery', 'originalPayload'], message: 'Compatibility snapshot must preserve all original v2 fields unchanged' })
  }
})

export type PrepTask = z.infer<typeof prepTaskSchema>
export type LegacyRecipeChoice = z.infer<typeof legacyRecipeChoiceSchema>
export type PersonalDataV3 = z.infer<typeof personalDataV3Schema>
export type MigrationIssue = z.infer<typeof migrationIssueSchema>
export type PersonalDataV3MigrationPreview = {
  data: PersonalDataV3
  issues: MigrationIssue[]
  summary: { legacySlots: number; convertedMeals: number; preservedChoices: number; needsReview: number }
}

export const PERSONAL_DATA_V3_KEY = 'recipe-lab.personal.v3'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]))
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function personalDataFingerprint(data: PersonalData): string {
  return `v2-${fnv1a(JSON.stringify(canonicalize(personalDataSchema.parse(data))))}`
}

function mealRequirementId(slotId: string): string {
  const readable = slotId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'slot'
  return `meal-requirement-legacy-${readable}-${fnv1a(slotId)}`
}

export function previewPersonalDataV3Migration(input: PersonalData, options: { timeZone: string; knownRecipeIds: ReadonlySet<string>; ingredientCatalog?: IngredientVariantCatalog; sourceRaw?: string }): PersonalDataV3MigrationPreview {
  const source = personalDataSchema.parse(input)
  const issues: MigrationIssue[] = []
  const mealRequirements: PersonalDataV3['mealRequirements'] = []
  const legacyRecipeChoices: LegacyRecipeChoice[] = []
  const slotIdCounts = new Map<string, number>()
  const mealCounts = new Map<string, number>()
  source.plan.forEach((slot) => {
    slotIdCounts.set(slot.id, (slotIdCounts.get(slot.id) ?? 0) + 1)
    const mealKey = `${slot.date}:${slot.meal}`
    mealCounts.set(mealKey, (mealCounts.get(mealKey) ?? 0) + 1)
  })
  source.plan.forEach((slot) => {
    let issue: MigrationIssue | null = null
    const mealKey = `${slot.date}:${slot.meal}`
    if ((slotIdCounts.get(slot.id) ?? 0) > 1) issue = { entity: 'meal-slot', code: 'duplicate-slot-id', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: 'This saved meal shares an identifier with another original slot. Both are preserved unchanged and require review.' }
    else if ((mealCounts.get(mealKey) ?? 0) > 1) issue = { entity: 'meal-slot', code: 'duplicate-meal', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: 'More than one saved recipe occupies this date and meal. Each is preserved unchanged; choose one before conversion.' }
    else if (!options.knownRecipeIds.has(slot.recipeId)) issue = { entity: 'meal-slot', code: 'unknown-recipe', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: 'The selected recipe is not in the current catalog. This slot is preserved unchanged but is not converted.' }
    else if (!Number.isInteger(slot.servings)) issue = { entity: 'meal-slot', code: 'fractional-portions', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: `${slot.servings} legacy servings cannot be reinterpreted as whole meal portions without your review.` }
    if (issue) { issues.push(issue); return }
    const requirementId = mealRequirementId(slot.id)
    const requirement = mealRequirementSchema.parse({
      mealRequirementId: requirementId,
      date: slot.date,
      intendedAt: null,
      timeZone: options.timeZone,
      meal: slot.meal.toLowerCase(),
      requestedPortions: slot.servings,
      status: 'unplanned',
      constraints: { maxActiveMinutes: null, maxElapsedMinutes: null, mustUseIngredientIds: [], avoidRecipeIds: [], allowLunchCooking: false },
      lock: { locked: slot.locked, reason: slot.locked ? 'Preserved from the original weekly plan.' : null },
    })
    mealRequirements.push(requirement)
    legacyRecipeChoices.push({ legacySlotId: slot.id, mealRequirementId: requirementId, recipeId: slot.recipeId })
  })
  source.pantry.forEach((lot) => {
    if (!options.ingredientCatalog) return
    const variants = options.ingredientCatalog.get(lot.canonicalIngredientId)
    if (!variants) issues.push({ entity: 'pantry-lot', code: 'unknown-ingredient', pantryLotId: lot.id, message: `${lot.id} references an ingredient outside the current catalog. The lot is preserved unchanged for recovery and is not interpreted by this preview.` })
    else if (!variants.has(lot.variantId)) issues.push({ entity: 'pantry-lot', code: 'unknown-variant', pantryLotId: lot.id, message: `${lot.id} references a variant outside the current catalog. The lot is preserved unchanged for recovery and is not interpreted by this preview.` })
  })
  const originalPayload = structuredClone(source)
  const sourceRaw = options.sourceRaw ?? JSON.stringify(source)
  const data = personalDataV3Schema.parse({
    schemaVersion: 3,
    preferences: structuredClone(source.preferences),
    plan: structuredClone(source.plan),
    checkedGroceries: structuredClone(source.checkedGroceries),
    pantry: structuredClone(source.pantry),
    mealRequirements,
    cookEvents: [],
    batches: [],
    allocations: [],
    preparedFoodLots: [],
    tasks: [],
    legacyRecipeChoices,
    migrationRecovery: {
      sourceSchemaVersion: 2,
      sourceStorageKey: 'recipe-lab.personal.v1',
      sourceFingerprint: personalDataFingerprint(source),
      sourceRaw,
      originalPayload,
      issues,
      coexistencePolicy: 'v2-authoritative-v3-snapshot',
    },
  })
  return { data, issues, summary: { legacySlots: source.plan.length, convertedMeals: mealRequirements.length, preservedChoices: legacyRecipeChoices.length, needsReview: issues.length } }
}

export type LoadPersonalDataV3Result = { data: PersonalDataV3 | null; stale: boolean; error: string | null; recoveryBackup: string | null }
export type PersonalDataV3MigrationSource = { data: PersonalData | null; raw: string | null; error: string | null }

export function loadPersonalDataV3MigrationSource(storage: StorageLike | null, fallback: PersonalData, preservedRecoveryRaw: string | null = null): PersonalDataV3MigrationSource {
  if (preservedRecoveryRaw !== null) {
    try { return { data: migratePersonalData(JSON.parse(preservedRecoveryRaw)), raw: preservedRecoveryRaw, error: null } } catch { return { data: null, raw: preservedRecoveryRaw, error: 'The original stored planner is not parseable. Download its raw recovery copy; conversion is disabled to prevent data loss.' } }
  }
  if (!storage) return { data: personalDataSchema.parse(fallback), raw: JSON.stringify(personalDataSchema.parse(fallback)), error: null }
  let raw: string | null
  try { raw = storage.getItem(PERSONAL_DATA_KEY) } catch { return { data: null, raw: null, error: 'The original planner cannot be read from browser storage, so conversion is disabled.' } }
  if (raw === null) {
    const data = personalDataSchema.parse(fallback)
    return { data, raw: JSON.stringify(data), error: null }
  }
  try { return { data: migratePersonalData(JSON.parse(raw)), raw, error: null } } catch { return { data: null, raw, error: 'The original stored planner is not parseable. Download its raw recovery copy; conversion is disabled to prevent data loss.' } }
}

export function loadPersonalDataV3(storage: StorageLike | null, currentV2: PersonalData | null): LoadPersonalDataV3Result {
  if (!storage) return { data: null, stale: false, error: 'Browser storage is unavailable; no v3 snapshot can be loaded.', recoveryBackup: null }
  let raw: string | null
  try { raw = storage.getItem(PERSONAL_DATA_V3_KEY) } catch { return { data: null, stale: false, error: 'The saved v3 snapshot could not be read.', recoveryBackup: null } }
  if (!raw) return { data: null, stale: false, error: null, recoveryBackup: null }
  try {
    const data = personalDataV3Schema.parse(JSON.parse(raw))
    const sourceFingerprint = data.migrationRecovery?.sourceFingerprint
    return { data, stale: Boolean(sourceFingerprint && (!currentV2 || sourceFingerprint !== personalDataFingerprint(currentV2))), error: null, recoveryBackup: null }
  } catch {
    return { data: null, stale: false, error: 'The saved v3 snapshot is invalid. The original v2 planner was not changed.', recoveryBackup: raw }
  }
}

function hasMeaningfulV3State(data: PersonalDataV3): boolean {
  if (!data.migrationRecovery) return true
  if (data.cookEvents.length || data.batches.length || data.allocations.length || data.preparedFoodLots.length || data.tasks.length) return true
  if (data.mealRequirements.length !== data.legacyRecipeChoices.length) return true
  return data.mealRequirements.some((requirement) => requirement.intendedAt !== null || requirement.status !== 'unplanned' || requirement.constraints.maxActiveMinutes !== null || requirement.constraints.maxElapsedMinutes !== null || requirement.constraints.mustUseIngredientIds.length > 0 || requirement.constraints.avoidRecipeIds.length > 0 || requirement.constraints.allowLunchCooking)
}

export function commitPersonalDataV3(storage: StorageLike | null, preview: PersonalDataV3, options: { replaceExisting?: boolean } = {}): { persisted: boolean; error: string | null } {
  if (!storage) return { persisted: false, error: 'Browser storage is unavailable; the v3 snapshot was not saved.' }
  const parsed = personalDataV3Schema.safeParse(preview)
  if (!parsed.success) return { persisted: false, error: 'The v3 preview failed validation and was not saved.' }
  const validated = parsed.data
  if (!validated.migrationRecovery) return { persisted: false, error: 'The v3 preview has no recovery payload and was not saved.' }
  try {
    const persistedRaw = storage.getItem(PERSONAL_DATA_KEY)
    const persistedV2 = persistedRaw === null ? emptyPersonalData() : migratePersonalData(JSON.parse(persistedRaw))
    if (validated.migrationRecovery.sourceFingerprint !== personalDataFingerprint(persistedV2)) return { persisted: false, error: 'The persisted original planner changed after this preview was created. Review a fresh preview before saving.' }
    const existingRaw = storage.getItem(PERSONAL_DATA_V3_KEY)
    if (existingRaw) {
      if (!options.replaceExisting) return { persisted: false, error: 'A v3 snapshot already exists. Review and explicitly replace it instead of overwriting it silently.' }
      const existing = personalDataV3Schema.safeParse(JSON.parse(existingRaw))
      if (!existing.success) return { persisted: false, error: 'The existing v3 snapshot is unreadable and cannot be safely replaced. Download its recovery copy first.' }
      if (hasMeaningfulV3State(existing.data)) return { persisted: false, error: 'The existing v3 snapshot contains planning, cooking, inventory, or task state and cannot be replaced by a compatibility preview.' }
    }
    storage.setItem(PERSONAL_DATA_V3_KEY, JSON.stringify(validated))
    return { persisted: true, error: null }
  } catch {
    return { persisted: false, error: 'Persisted personal data could not be safely revalidated, so the v3 snapshot was not saved. The original planner remains unchanged.' }
  }
}

export const exportPersonalDataV3 = (data: PersonalDataV3): string => JSON.stringify(personalDataV3Schema.parse(data), null, 2)
export const importPersonalDataV3 = (raw: string): PersonalDataV3 => personalDataV3Schema.parse(JSON.parse(raw))
