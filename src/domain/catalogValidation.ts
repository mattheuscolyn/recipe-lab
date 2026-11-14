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
      if (line.sourceRange && dimensionOf(line.sourceRange.unit) !== dimensionOf(ingredient.baseUnit)) issues.push({ path: `${path}.sourceRange.unit`, message: 'Source range must match the ingredient base dimension' })
      if (line.sourcePackage?.usableQuantityEach && dimensionOf(line.sourcePackage.usableQuantityEach.unit) !== dimensionOf(ingredient.baseUnit)) issues.push({ path: `${path}.sourcePackage.usableQuantityEach`, message: 'Usable package quantity must match the ingredient base dimension' })
    }
    line.alternatives.forEach((alternative, alternativeIndex) => {
      const alternativeIngredient = ingredientMap.get(alternative.canonicalIngredientId)
      const alternativePath = `${path}.alternatives.${alternativeIndex}`
      if (!alternativeIngredient) issues.push({ path: alternativePath, message: `Unknown canonical ingredient ${alternative.canonicalIngredientId}` })
      else {
        if (!alternativeIngredient.variants.some(({ id }) => id === alternative.variantId)) issues.push({ path: `${alternativePath}.variantId`, message: `Variant ${alternative.variantId} does not belong to ${alternativeIngredient.id}` })
        if (alternative.quantity && dimensionOf(alternative.quantity.unit) !== dimensionOf(alternativeIngredient.baseUnit)) issues.push({ path: `${alternativePath}.quantity.unit`, message: 'Alternative quantity must match its ingredient base dimension' })
      }
    })
  }))
  offers.forEach((offer, index) => {
    const ingredient = ingredientMap.get(offer.canonicalIngredientId)
    if (!ingredient) issues.push({ path: `offers.${index}`, message: `Unknown canonical ingredient ${offer.canonicalIngredientId}` })
    else if (!ingredient.variants.some(({ id }) => id === offer.variantId)) issues.push({ path: `offers.${index}.variantId`, message: `Unknown variant ${offer.variantId}` })
    if (ingredient) {
      const packageDimension = dimensionOf(offer.packageQuantity.unit)
      const baseDimension = dimensionOf(ingredient.baseUnit)
      if (!offer.usableYield && packageDimension !== baseDimension) issues.push({ path: `offers.${index}.packageQuantity`, message: 'Package quantity must match the ingredient base dimension when no usable yield is supplied' })
      if (offer.usableYield && dimensionOf(offer.usableYield.unit) !== baseDimension) issues.push({ path: `offers.${index}.usableYield`, message: 'Usable yield must match the ingredient base dimension' })
      if (offer.usableYield && packageDimension !== baseDimension && !offer.conversionNote) issues.push({ path: `offers.${index}.conversionNote`, message: 'Cross-dimension package yields need a documented conversion' })
    }
  })
  return issues.length ? { success: false, issues } : { success: true, data: { ingredients, recipes, offers } }
}

export function assertCatalog(input: unknown): Catalog {
  const result = validateCatalog(input)
  if (!result.success) throw new Error(`Catalog validation failed:\n${result.issues.map(({ path, message }) => `- ${path}: ${message}`).join('\n')}`)
  return result.data
}
