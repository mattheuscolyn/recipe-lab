import { z } from 'zod'

export const preferenceStatusSchema = z.enum(['interested', 'passed', 'saved'])
export type PreferenceStatus = z.infer<typeof preferenceStatusSchema>

export const recipePreferenceSchema = z.object({
  status: preferenceStatusSchema.nullable(),
  cooked: z.boolean(),
  personalRating: z.number().int().min(1).max(5).nullable(),
  note: z.string().max(2000),
})

export const mealSlotSchema = z.object({
  id: z.string().min(1),
  date: z.iso.date(),
  meal: z.enum(['Breakfast', 'Lunch', 'Dinner']),
  recipeId: z.string().uuid(),
  servings: z.number().positive().finite(),
  locked: z.boolean(),
})

export const personalDataSchema = z.object({
  schemaVersion: z.literal(1),
  preferences: z.record(z.string(), recipePreferenceSchema),
  plan: z.array(mealSlotSchema),
  checkedGroceries: z.record(z.string(), z.boolean()),
})

export type RecipePreference = z.infer<typeof recipePreferenceSchema>
export type MealSlot = z.infer<typeof mealSlotSchema>
export type PersonalData = z.infer<typeof personalDataSchema>
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
export type PlanValidationIssue = { code: 'unknown-recipe' | 'duplicate-slot'; slot: MealSlot; message: string }
export type LoadPersonalDataResult = { data: PersonalData; persistent: boolean; error: string | null; recoveryBackup: string | null }

export const PERSONAL_DATA_KEY = 'recipe-lab.personal.v1'
export const emptyPreference = (): RecipePreference => ({ status: null, cooked: false, personalRating: null, note: '' })
export const emptyPersonalData = (): PersonalData => ({ schemaVersion: 1, preferences: {}, plan: [], checkedGroceries: {} })

export function migratePersonalData(input: unknown): PersonalData {
  const current = personalDataSchema.safeParse(input)
  if (current.success) return current.data
  if (input && typeof input === 'object' && !('schemaVersion' in input)) {
    const legacy = input as { preferences?: unknown; plan?: unknown; checkedGroceries?: unknown }
    return personalDataSchema.parse({ schemaVersion: 1, preferences: legacy.preferences ?? {}, plan: legacy.plan ?? [], checkedGroceries: legacy.checkedGroceries ?? {} })
  }
  throw new Error('Backup is not a supported Recipe Lab personal-data file')
}

export function validatePlanForCatalog(data: PersonalData, knownRecipeIds: ReadonlySet<string>): { data: PersonalData; issues: PlanValidationIssue[] } {
  const issues: PlanValidationIssue[] = []
  const seenSlots = new Set<string>()
  const plan = data.plan.filter((slot) => {
    if (!knownRecipeIds.has(slot.recipeId)) {
      issues.push({ code: 'unknown-recipe', slot, message: `${slot.date} ${slot.meal} references a recipe that is not in this catalog.` })
      return false
    }
    const slotKey = `${slot.date}:${slot.meal}`
    if (seenSlots.has(slotKey)) {
      issues.push({ code: 'duplicate-slot', slot, message: `${slot.date} ${slot.meal} appears more than once.` })
      return false
    }
    seenSlots.add(slotKey)
    return true
  })
  return { data: issues.length ? { ...data, plan } : data, issues }
}

export function loadPersonalData(storage: StorageLike | null, knownRecipeIds?: ReadonlySet<string>): LoadPersonalDataResult {
  if (!storage) return { data: emptyPersonalData(), persistent: false, error: 'Browser storage is unavailable; changes last only until this tab closes.', recoveryBackup: null }
  let raw: string | null
  try {
    raw = storage.getItem(PERSONAL_DATA_KEY)
  } catch {
    return { data: emptyPersonalData(), persistent: false, error: 'Saved personal data could not be read; this tab is using temporary memory only.', recoveryBackup: null }
  }
  if (!raw) return { data: emptyPersonalData(), persistent: true, error: null, recoveryBackup: null }
  try {
    const migrated = migratePersonalData(JSON.parse(raw))
    if (!knownRecipeIds) return { data: migrated, persistent: true, error: null, recoveryBackup: null }
    const validated = validatePlanForCatalog(migrated, knownRecipeIds)
    if (!validated.issues.length) return { data: validated.data, persistent: true, error: null, recoveryBackup: null }
    return { data: validated.data, persistent: true, error: `${validated.issues.length} invalid saved meal ${validated.issues.length === 1 ? 'slot was' : 'slots were'} quarantined. Export the recovery backup before replacing it.`, recoveryBackup: raw }
  } catch {
    return { data: emptyPersonalData(), persistent: true, error: 'Saved personal data is invalid and was not loaded. Export the recovery backup before replacing it.', recoveryBackup: raw }
  }
}

export function savePersonalData(storage: StorageLike | null, data: PersonalData): string | null {
  if (!storage) return 'Browser storage is unavailable; changes last only until this tab closes.'
  try {
    storage.setItem(PERSONAL_DATA_KEY, JSON.stringify(personalDataSchema.parse(data)))
    return null
  } catch {
    return 'Personal data could not be saved; current changes remain available only in this tab.'
  }
}

export const exportPersonalData = (data: PersonalData): string => JSON.stringify(personalDataSchema.parse(data), null, 2)
export function importPersonalData(raw: string, knownRecipeIds?: ReadonlySet<string>): PersonalData {
  const data = migratePersonalData(JSON.parse(raw))
  if (!knownRecipeIds) return data
  const validated = validatePlanForCatalog(data, knownRecipeIds)
  if (validated.issues.length) throw new Error(`Backup was not imported: ${validated.issues.map(({ message }) => message).join(' ')}`)
  return data
}
