import { canonicalIngredientSchema, packageOfferSchema, recipeV2Schema, type CanonicalIngredient, type PackageOffer, type RecipeV2 } from './catalog'
import { dimensionOf } from './units'

export type Catalog = { ingredients: CanonicalIngredient[]; recipes: RecipeV2[]; offers: PackageOffer[] }
export type CatalogIssue = { path: string; message: string }
export type CatalogResult = { success: true; data: Catalog } | { success: false; issues: CatalogIssue[] }

export function validateCatalog(input: unknown): CatalogResult {
  if (!input || typeof input !== 'object') return { success: false, issues: [{ path: '$', message: 'Catalog must be an object' }] }
  const raw = input as Record<string, unknown>
  const ingredientsResult = canonicalIngredientSchema.array().safeParse(raw.ingredients)
  const recipesResult = recipeV2Schema.array().safeParse(raw.recipes)
  const offersResult = packageOfferSchema.array().safeParse(raw.offers)
  const issues: CatalogIssue[] = []
  const collect = (prefix: string, result: typeof ingredientsResult | typeof recipesResult | typeof offersResult) => {
    if (!result.success) result.error.issues.forEach((issue) => issues.push({ path: `${prefix}.${issue.path.join('.')}`, message: issue.message }))
  }
  collect('ingredients', ingredientsResult); collect('recipes', recipesResult); collect('offers', offersResult)
  if (issues.length || !ingredientsResult.success || !recipesResult.success || !offersResult.success) return { success: false, issues }
  const ingredients = ingredientsResult.data
  const recipes = recipesResult.data
  const offers = offersResult.data
  const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const duplicates = <T>(items: T[], value: (item: T) => string, path: string) => {
    const seen = new Set<string>()
    items.forEach((item, index) => { const key = value(item); if (seen.has(key)) issues.push({ path: `${path}.${index}`, message: `Duplicate ${key}` }); seen.add(key) })
  }
  duplicates(ingredients, (item) => item.id, 'ingredients'); duplicates(recipes, (item) => item.id, 'recipes'); duplicates(recipes, (item) => item.slug, 'recipes'); duplicates(offers, (item) => item.id, 'offers')
  recipes.forEach((recipe, recipeIndex) => recipe.requirements.forEach((line, lineIndex) => {
    const ingredient = ingredientMap.get(line.canonicalIngredientId)
    const path = `recipes.${recipeIndex}.requirements.${lineIndex}`
    if (!ingredient) issues.push({ path, message: `Unknown canonical ingredient ${line.canonicalIngredientId}` })
    else {
      if (!ingredient.variants.some(({ id }) => id === line.variantId)) issues.push({ path: `${path}.variantId`, message: `Variant ${line.variantId} does not belong to ${ingredient.id}` })
      if (line.quantity && dimensionOf(line.quantity.unit) !== dimensionOf(ingredient.baseUnit)) issues.push({ path: `${path}.quantity.unit`, message: `Unit ${line.quantity.unit} is incompatible with base unit ${ingredient.baseUnit}` })
    }
  }))
  offers.forEach((offer, index) => {
    const ingredient = ingredientMap.get(offer.canonicalIngredientId)
    if (!ingredient) issues.push({ path: `offers.${index}`, message: `Unknown canonical ingredient ${offer.canonicalIngredientId}` })
    else if (!ingredient.variants.some(({ id }) => id === offer.variantId)) issues.push({ path: `offers.${index}.variantId`, message: `Unknown variant ${offer.variantId}` })
    if (offer.usableYield && ingredient && dimensionOf(offer.usableYield.unit) !== dimensionOf(ingredient.baseUnit)) issues.push({ path: `offers.${index}.usableYield`, message: 'Usable yield must match the ingredient base dimension' })
  })
  return issues.length ? { success: false, issues } : { success: true, data: { ingredients, recipes, offers } }
}

export function assertCatalog(input: unknown): Catalog {
  const result = validateCatalog(input)
  if (!result.success) throw new Error(`Catalog validation failed:\n${result.issues.map(({ path, message }) => `- ${path}: ${message}`).join('\n')}`)
  return result.data
}
