import { z } from 'zod'
import { unitCodeSchema } from './catalog'

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

export const pantryLotSchema = z.object({
  id: z.string().min(1).max(120),
  canonicalIngredientId: z.string().regex(/^ingredient-[a-z0-9-]+$/),
  variantId: z.string().regex(/^variant-[a-z0-9-]+$/),
  quantity: z.number().positive().finite(),
  unit: unitCodeSchema,
  bestBy: z.iso.date().nullable(),
  note: z.string().max(500),
})

const personalDataV1Schema = z.object({
  schemaVersion: z.literal(1),
  preferences: z.record(z.string(), recipePreferenceSchema),
  plan: z.array(mealSlotSchema),
  checkedGroceries: z.record(z.string(), z.boolean()),
})

export const personalDataSchema = z.object({
  schemaVersion: z.literal(2),
  preferences: z.record(z.string(), recipePreferenceSchema),
  plan: z.array(mealSlotSchema),
  checkedGroceries: z.record(z.string(), z.boolean()),
  pantry: z.array(pantryLotSchema),
}).superRefine(({ pantry }, context) => {
  if (new Set(pantry.map(({ id }) => id)).size !== pantry.length) context.addIssue({ code: 'custom', path: ['pantry'], message: 'Pantry lot ids must be unique' })
})

export type RecipePreference = z.infer<typeof recipePreferenceSchema>
export type MealSlot = z.infer<typeof mealSlotSchema>
export type PantryLot = z.infer<typeof pantryLotSchema>
export type PersonalData = z.infer<typeof personalDataSchema>
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
export type PlanValidationIssue = { code: 'unknown-recipe' | 'duplicate-slot'; slot: MealSlot; message: string }
export type PantryValidationIssue = { code: 'unknown-ingredient' | 'unknown-variant'; lot: PantryLot; message: string }
export type LoadPersonalDataResult = { data: PersonalData; persistent: boolean; error: string | null; recoveryBackup: string | null }
export type IngredientVariantCatalog = ReadonlyMap<string, ReadonlySet<string>>

export const PERSONAL_DATA_KEY = 'recipe-lab.personal.v1'
export const emptyPreference = (): RecipePreference => ({ status: null, cooked: false, personalRating: null, note: '' })
export const emptyPersonalData = (): PersonalData => ({ schemaVersion: 2, preferences: {}, plan: [], checkedGroceries: {}, pantry: [] })

export function migratePersonalData(input: unknown): PersonalData {
  const current = personalDataSchema.safeParse(input)
  if (current.success) return current.data
  const versionOne = personalDataV1Schema.safeParse(input)
  if (versionOne.success) return personalDataSchema.parse({ ...versionOne.data, schemaVersion: 2, pantry: [] })
  if (input && typeof input === 'object' && !('schemaVersion' in input)) {
    const legacy = input as { preferences?: unknown; plan?: unknown; checkedGroceries?: unknown }
    const migrated = personalDataV1Schema.parse({ schemaVersion: 1, preferences: legacy.preferences ?? {}, plan: legacy.plan ?? [], checkedGroceries: legacy.checkedGroceries ?? {} })
    return personalDataSchema.parse({ ...migrated, schemaVersion: 2, pantry: [] })
  }
  throw new Error('Backup is not a supported Recipe Lab personal-data file')
}

export function validatePantryForCatalog(data: PersonalData, catalog: IngredientVariantCatalog): { data: PersonalData; issues: PantryValidationIssue[] } {
  const issues: PantryValidationIssue[] = []
  const pantry = data.pantry.filter((lot) => {
    const variants = catalog.get(lot.canonicalIngredientId)
    if (!variants) {
      issues.push({ code: 'unknown-ingredient', lot, message: `Pantry lot ${lot.id} references an ingredient that is not in this catalog.` })
      return false
    }
    if (!variants.has(lot.variantId)) {
      issues.push({ code: 'unknown-variant', lot, message: `Pantry lot ${lot.id} references a variant that is not valid for its ingredient.` })
      return false
    }
    return true
  })
  return { data: issues.length ? { ...data, pantry } : data, issues }
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

export function loadPersonalData(storage: StorageLike | null, knownRecipeIds?: ReadonlySet<string>, ingredientCatalog?: IngredientVariantCatalog): LoadPersonalDataResult {
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
    const pantryValidated = ingredientCatalog ? validatePantryForCatalog(validated.data, ingredientCatalog) : { data: validated.data, issues: [] }
    if (!validated.issues.length && !pantryValidated.issues.length) return { data: pantryValidated.data, persistent: true, error: null, recoveryBackup: null }
    const issueCount = validated.issues.length + pantryValidated.issues.length
    const planMessage = validated.issues.length ? `${validated.issues.length} invalid saved meal ${validated.issues.length === 1 ? 'slot was' : 'slots were'} quarantined.` : ''
    const pantryMessage = pantryValidated.issues.length ? `${pantryValidated.issues.length} invalid pantry ${pantryValidated.issues.length === 1 ? 'lot was' : 'lots were'} quarantined.` : ''
    return { data: pantryValidated.data, persistent: true, error: `${issueCount} invalid saved ${issueCount === 1 ? 'entry was' : 'entries were'} quarantined. ${planMessage} ${pantryMessage} Export the recovery backup before replacing it.`.replace(/\s+/g, ' ').trim(), recoveryBackup: raw }
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
export function importPersonalData(raw: string, knownRecipeIds?: ReadonlySet<string>, ingredientCatalog?: IngredientVariantCatalog): PersonalData {
  const data = migratePersonalData(JSON.parse(raw))
  const validated = knownRecipeIds ? validatePlanForCatalog(data, knownRecipeIds) : { data, issues: [] }
  if (validated.issues.length) throw new Error(`Backup was not imported: ${validated.issues.map(({ message }) => message).join(' ')}`)
  const pantryValidated = ingredientCatalog ? validatePantryForCatalog(validated.data, ingredientCatalog) : { data: validated.data, issues: [] }
  if (pantryValidated.issues.length) throw new Error(`Backup was not imported: ${pantryValidated.issues.map(({ message }) => message).join(' ')}`)
  return pantryValidated.data
}
