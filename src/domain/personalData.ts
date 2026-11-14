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

export function loadPersonalData(storage: StorageLike | null): { data: PersonalData; persistent: boolean; error: string | null } {
  if (!storage) return { data: emptyPersonalData(), persistent: false, error: 'Browser storage is unavailable; changes last only until this tab closes.' }
  try {
    const raw = storage.getItem(PERSONAL_DATA_KEY)
    return { data: raw ? migratePersonalData(JSON.parse(raw)) : emptyPersonalData(), persistent: true, error: null }
  } catch {
    return { data: emptyPersonalData(), persistent: false, error: 'Saved personal data could not be read; this tab is using temporary memory only.' }
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
export const importPersonalData = (raw: string): PersonalData => migratePersonalData(JSON.parse(raw))
