import { recipeSchema, type Recipe } from './recipe'

export type ValidationIssue = { path: string; message: string }
export type ValidationResult<T> = { success: true; data: T } | { success: false; issues: ValidationIssue[] }

export function validateRecipe(input: unknown): ValidationResult<Recipe> {
  const result = recipeSchema.safeParse(input)
  return result.success ? { success: true, data: result.data } : { success: false, issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }
}

export function validateRecipeCollection(input: unknown): ValidationResult<Recipe[]> {
  if (!Array.isArray(input)) return { success: false, issues: [{ path: '$', message: 'Recipe collection must be an array' }] }
  const recipes: Recipe[] = []
  const issues: ValidationIssue[] = []
  input.forEach((candidate, index) => {
    const result = validateRecipe(candidate)
    if (result.success) recipes.push(result.data)
    else if (result.success === false) result.issues.forEach((issue) => issues.push({ path: `[${index}].${issue.path}`, message: issue.message }))
  })
  const findDuplicates = (field: 'id' | 'slug') => {
    const seen = new Set<string>()
    recipes.forEach((recipe, index) => { if (seen.has(recipe[field])) issues.push({ path: `[${index}].${field}`, message: `Duplicate recipe ${field}: ${recipe[field]}` }); seen.add(recipe[field]) })
  }
  findDuplicates('id'); findDuplicates('slug')
  return issues.length ? { success: false, issues } : { success: true, data: recipes }
}

export function assertRecipeCollection(input: unknown): Recipe[] {
  const result = validateRecipeCollection(input)
  if (result.success === false) throw new Error(`Recipe validation failed:\n${result.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`)
  return result.data
}
