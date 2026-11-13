import { z } from 'zod'

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[a-z0-9-]+$`), `Expected a ${prefix}- identifier`)
const text = (label: string, max = 240) => z.string().trim().min(1, `${label} is required`).max(max)

export const unitCodeSchema = z.enum(['g', 'kg', 'oz_mass', 'lb', 'ml', 'l', 'fl_oz', 'tsp', 'tbsp', 'cup', 'item', 'clove', 'head', 'can', 'pinch'])
export const dimensionSchema = z.enum(['mass', 'volume', 'count'])
export type UnitCode = z.infer<typeof unitCodeSchema>
export type Dimension = z.infer<typeof dimensionSchema>

export const quantitySchema = z.object({
  amount: z.number().positive().finite(),
  unit: unitCodeSchema,
  approximate: z.boolean().default(false),
})

export const canonicalIngredientSchema = z.object({
  id: id('ingredient'),
  displayName: text('Display name', 100),
  aliases: z.array(text('Alias', 100)).default([]),
  baseUnit: unitCodeSchema,
  variants: z.array(z.object({ id: id('variant'), label: text('Variant label', 100), form: text('Variant form', 80) })).min(1),
}).superRefine((ingredient, context) => {
  const normalized = [ingredient.displayName, ...ingredient.aliases].map((value) => value.toLowerCase())
  if (new Set(normalized).size !== normalized.length) context.addIssue({ code: 'custom', path: ['aliases'], message: 'Aliases must be unique and may not repeat the display name' })
  if (new Set(ingredient.variants.map(({ id: variantId }) => variantId)).size !== ingredient.variants.length) context.addIssue({ code: 'custom', path: ['variants'], message: 'Variant ids must be unique' })
})

export const recipeRequirementSchema = z.object({
  id: id('requirement'),
  originalText: text('Original source line', 300),
  quantity: quantitySchema.nullable(),
  nonQuantified: z.enum(['to-taste', 'as-needed', 'for-serving']).nullable().default(null),
  canonicalIngredientId: id('ingredient'),
  variantId: id('variant'),
  preparation: text('Preparation', 160).nullable().default(null),
  optional: z.boolean().default(false),
  confidence: z.enum(['reviewed', 'needs-review']),
  reviewNote: text('Review note', 240).nullable().default(null),
}).superRefine((line, context) => {
  if ((line.quantity === null) === (line.nonQuantified === null)) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Provide exactly one of quantity or nonQuantified' })
  if (line.confidence === 'needs-review' && !line.reviewNote) context.addIssue({ code: 'custom', path: ['reviewNote'], message: 'Ambiguous requirements need a review note' })
})

export const sourceSchema = z.object({
  publisher: text('Publisher', 120), author: text('Author', 120).nullable(), url: z.url(), checkedAt: z.iso.date(), selectionRationale: text('Selection rationale', 300),
  rating: z.number().min(0).max(5).nullable(), reviewCount: z.number().int().nonnegative().nullable(),
})

export const recipeV2Schema = z.object({
  schemaVersion: z.literal(2), id: z.string().uuid(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: text('Title', 120), description: text('Description', 280), emoji: text('Emoji', 8),
  category: z.enum(['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack']), cuisine: text('Cuisine', 80), tags: z.array(text('Tag', 30)).min(1),
  yield: z.object({ servings: z.number().positive(), label: text('Yield label', 100) }),
  times: z.object({ prepMinutes: z.number().int().nonnegative(), cookMinutes: z.number().int().nonnegative(), totalMinutes: z.number().int().positive() }),
  requirements: z.array(recipeRequirementSchema).min(1), methodSummary: z.array(text('Method step', 420)).min(1).max(12), source: sourceSchema,
  review: z.object({ status: z.enum(['source-reviewed', 'kitchen-tested']), reviewedAt: z.iso.date(), ingredientCompletenessReviewed: z.literal(true), methodIndependentlyWritten: z.literal(true) }),
}).superRefine((recipe, context) => {
  if (recipe.times.totalMinutes < recipe.times.prepMinutes + recipe.times.cookMinutes) context.addIssue({ code: 'custom', path: ['times', 'totalMinutes'], message: 'Total time cannot be shorter than prep plus cook time' })
  if (new Set(recipe.requirements.map(({ id: requirementId }) => requirementId)).size !== recipe.requirements.length) context.addIssue({ code: 'custom', path: ['requirements'], message: 'Requirement ids must be unique' })
})

export const packageOfferSchema = z.object({
  id: id('offer'), canonicalIngredientId: id('ingredient'), variantId: id('variant'), packageQuantity: quantitySchema,
  usableYield: quantitySchema.nullable().default(null), totalPrice: z.number().nonnegative(), currency: z.literal('USD'), retailer: text('Retailer', 120), sourceUrl: z.url().nullable(), observedAt: z.iso.date(), estimate: z.literal(true),
})

export type CanonicalIngredient = z.infer<typeof canonicalIngredientSchema>
export type RecipeRequirement = z.infer<typeof recipeRequirementSchema>
export type RecipeV2 = z.infer<typeof recipeV2Schema>
export type PackageOffer = z.infer<typeof packageOfferSchema>
