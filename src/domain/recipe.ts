import { z } from 'zod'

const text = (label: string, max: number) => z.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max} characters or fewer`)

export const ingredientSchema = z.object({ id: z.string().regex(/^ing-[a-z0-9-]+$/, 'Ingredient id must start with ing-'), amount: z.number().positive().finite(), unit: text('Unit', 24).optional(), item: text('Ingredient', 120), preparation: text('Preparation', 120).optional() })
export const recipeStepSchema = z.object({ position: z.number().int().positive(), instruction: text('Instruction', 500), timerMinutes: z.number().int().positive().max(1440).optional() })

export const recipeSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case'), title: text('Title', 120), description: text('Description', 280), emoji: text('Emoji', 8), category: z.enum(['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack']),
  yield: z.object({ amount: z.number().positive().finite(), unit: text('Yield unit', 40) }),
  times: z.object({ prepMinutes: z.number().int().nonnegative().max(1440), cookMinutes: z.number().int().nonnegative().max(1440), totalMinutes: z.number().int().positive().max(2880) }).superRefine((times, context) => { if (times.totalMinutes < times.prepMinutes + times.cookMinutes) context.addIssue({ code: 'custom', path: ['totalMinutes'], message: 'Total time cannot be shorter than prep plus cook time' }) }),
  ingredients: z.array(ingredientSchema).min(1).max(100), steps: z.array(recipeStepSchema).min(1).max(50), tags: z.array(text('Tag', 30)).min(1).max(12), source: z.object({ name: text('Source name', 160), url: z.url().optional() }), review: z.object({ status: z.enum(['draft', 'source-reviewed', 'kitchen-tested']), reviewedAt: z.iso.datetime().optional() }),
}).superRefine((recipe, context) => {
  if (recipe.steps.some((step, index) => step.position !== index + 1)) context.addIssue({ code: 'custom', path: ['steps'], message: 'Step positions must be sequential starting at 1' })
  const ingredientIds = recipe.ingredients.map(({ id }) => id)
  if (new Set(ingredientIds).size !== ingredientIds.length) context.addIssue({ code: 'custom', path: ['ingredients'], message: 'Ingredient ids must be unique within a recipe' })
  if (new Set(recipe.tags).size !== recipe.tags.length) context.addIssue({ code: 'custom', path: ['tags'], message: 'Tags must be unique within a recipe' })
  if (recipe.review.status !== 'draft' && !recipe.review.reviewedAt) context.addIssue({ code: 'custom', path: ['review', 'reviewedAt'], message: 'Reviewed recipes require a review timestamp' })
})

export type Recipe = z.infer<typeof recipeSchema>
