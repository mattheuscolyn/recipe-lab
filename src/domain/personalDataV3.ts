import { z } from 'zod'
import { mealSlotSchema, pantryLotSchema, personalDataSchema, recipePreferenceSchema, type PersonalData, type StorageLike } from './personalData'
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

export const migrationIssueSchema = z.object({
  code: z.enum(['fractional-portions', 'unknown-recipe', 'duplicate-slot-id', 'duplicate-meal']),
  legacySlotId: z.string().min(1),
  date: z.iso.date(),
  meal: z.enum(['Breakfast', 'Lunch', 'Dinner']),
  message: z.string().trim().min(1).max(500),
})

const migrationRecoverySchema = z.object({
  sourceSchemaVersion: z.literal(2),
  sourceStorageKey: z.literal('recipe-lab.personal.v1'),
  sourceFingerprint: z.string().regex(/^v2-[a-f0-9]{8}$/),
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
  const requirementIds = new Set(data.mealRequirements.map(({ mealRequirementId }) => mealRequirementId))
  const slotIds = new Set<string>()
  const choiceRequirementIds = new Set<string>()
  data.legacyRecipeChoices.forEach((choice, index) => {
    if (slotIds.has(choice.legacySlotId)) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'legacySlotId'], message: 'Legacy slot choices must be unique' })
    if (choiceRequirementIds.has(choice.mealRequirementId)) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'A migrated meal may have only one legacy recipe choice' })
    if (!requirementIds.has(choice.mealRequirementId)) context.addIssue({ code: 'custom', path: ['legacyRecipeChoices', index, 'mealRequirementId'], message: 'Legacy choice must reference a migrated meal requirement' })
    slotIds.add(choice.legacySlotId)
    choiceRequirementIds.add(choice.mealRequirementId)
  })
  if (data.migrationRecovery && personalDataFingerprint(data.migrationRecovery.originalPayload) !== data.migrationRecovery.sourceFingerprint) context.addIssue({ code: 'custom', path: ['migrationRecovery', 'sourceFingerprint'], message: 'Recovery fingerprint does not match the preserved v2 payload' })
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

export function previewPersonalDataV3Migration(input: PersonalData, options: { timeZone: string; knownRecipeIds: ReadonlySet<string> }): PersonalDataV3MigrationPreview {
  const source = personalDataSchema.parse(input)
  const issues: MigrationIssue[] = []
  const mealRequirements: PersonalDataV3['mealRequirements'] = []
  const legacyRecipeChoices: LegacyRecipeChoice[] = []
  const seenSlotIds = new Set<string>()
  const seenMeals = new Set<string>()
  source.plan.forEach((slot) => {
    let issue: MigrationIssue | null = null
    const mealKey = `${slot.date}:${slot.meal}`
    if (seenSlotIds.has(slot.id)) issue = { code: 'duplicate-slot-id', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: 'This saved meal repeats an existing slot identifier and needs review.' }
    else if (seenMeals.has(mealKey)) issue = { code: 'duplicate-meal', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: 'More than one saved recipe occupies this date and meal; choose one before conversion.' }
    else if (!options.knownRecipeIds.has(slot.recipeId)) issue = { code: 'unknown-recipe', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: 'The selected recipe is not in the current catalog, so this meal cannot be converted automatically.' }
    else if (!Number.isInteger(slot.servings)) issue = { code: 'fractional-portions', legacySlotId: slot.id, date: slot.date, meal: slot.meal, message: `${slot.servings} legacy servings cannot be reinterpreted as whole meal portions without your review.` }
    seenSlotIds.add(slot.id)
    seenMeals.add(mealKey)
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
  const originalPayload = structuredClone(source)
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
      originalPayload,
      issues,
      coexistencePolicy: 'v2-authoritative-v3-snapshot',
    },
  })
  return { data, issues, summary: { legacySlots: source.plan.length, convertedMeals: mealRequirements.length, preservedChoices: legacyRecipeChoices.length, needsReview: issues.length } }
}

export type LoadPersonalDataV3Result = { data: PersonalDataV3 | null; stale: boolean; error: string | null; recoveryBackup: string | null }

export function loadPersonalDataV3(storage: StorageLike | null, currentV2: PersonalData): LoadPersonalDataV3Result {
  if (!storage) return { data: null, stale: false, error: 'Browser storage is unavailable; no v3 snapshot can be loaded.', recoveryBackup: null }
  let raw: string | null
  try { raw = storage.getItem(PERSONAL_DATA_V3_KEY) } catch { return { data: null, stale: false, error: 'The saved v3 snapshot could not be read.', recoveryBackup: null } }
  if (!raw) return { data: null, stale: false, error: null, recoveryBackup: null }
  try {
    const data = personalDataV3Schema.parse(JSON.parse(raw))
    const sourceFingerprint = data.migrationRecovery?.sourceFingerprint
    return { data, stale: Boolean(sourceFingerprint && sourceFingerprint !== personalDataFingerprint(currentV2)), error: null, recoveryBackup: null }
  } catch {
    return { data: null, stale: false, error: 'The saved v3 snapshot is invalid. The original v2 planner was not changed.', recoveryBackup: raw }
  }
}

export function commitPersonalDataV3(storage: StorageLike | null, preview: PersonalDataV3, currentV2: PersonalData, options: { replaceExisting?: boolean } = {}): { persisted: boolean; error: string | null } {
  if (!storage) return { persisted: false, error: 'Browser storage is unavailable; the v3 snapshot was not saved.' }
  const validated = personalDataV3Schema.parse(preview)
  if (!validated.migrationRecovery || validated.migrationRecovery.sourceFingerprint !== personalDataFingerprint(currentV2)) return { persisted: false, error: 'The original planner changed after this preview was created. Review a fresh preview before saving.' }
  try {
    if (storage.getItem(PERSONAL_DATA_V3_KEY) && !options.replaceExisting) return { persisted: false, error: 'A v3 snapshot already exists. Review and explicitly replace it instead of overwriting it silently.' }
    storage.setItem(PERSONAL_DATA_V3_KEY, JSON.stringify(validated))
    return { persisted: true, error: null }
  } catch {
    return { persisted: false, error: 'The v3 snapshot could not be saved. The original planner remains unchanged.' }
  }
}

export const exportPersonalDataV3 = (data: PersonalDataV3): string => JSON.stringify(personalDataV3Schema.parse(data), null, 2)
export const importPersonalDataV3 = (raw: string): PersonalDataV3 => personalDataV3Schema.parse(JSON.parse(raw))
