import { describe, expect, it } from 'vitest'
import { canonicalIngredients, packageOffers, pilotRecipes } from '../data/pilotCatalog'
import { buildGroceryList, calculatePackagePurchase } from './grocery'

const recipe = (slug: string) => pilotRecipes.find((item) => item.slug === slug)!
const selection = (slug: string, servings?: number) => { const item = recipe(slug); return { recipeId: item.id, servings: servings ?? item.yield.servings } }

describe('grocery calculation', () => {
  it('applies serving multipliers and consolidates canonical garlic', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('smoky-black-bean-soup', 8), selection('white-bean-soup')])
    const garlic = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(garlic.total).toEqual({ amount: 7, unit: 'clove' })
    expect(garlic.contributions).toHaveLength(2)
  })
  it('keeps fresh and dried herb variants separate', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('white-bean-soup'), selection('best-lentil-soup')])
    const thyme = list.filter(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-thyme')
    expect(thyme).toHaveLength(2)
    expect(thyme.map(({ variant }) => variant).sort()).toEqual(['Dried', 'Fresh leaves'])
  })
  it('rounds package checkout separately from consumption and remainder', () => {
    const garlic = canonicalIngredients.find(({ id }) => id === 'ingredient-garlic')!
    const offer = packageOffers.find(({ id }) => id === 'offer-garlic-head')!
    const price = calculatePackagePurchase({ amount: 12, unit: 'clove' }, garlic, offer)
    expect(price.packages).toBe(2)
    expect(price.estimatedCheckoutCost).toBeCloseTo(1.78)
    expect(price.estimatedConsumptionCost).toBeCloseTo(1.068)
    expect(price.unused).toEqual({ amount: 8, unit: 'clove' })
  })
  it('leaves missing prices unknown and preserves approximate inputs', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('best-lentil-soup')])
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-black-pepper')?.pricing).toBeNull()
    const lemon = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-lemon-juice')!
    expect(lemon.contributions[0].approximate).toBe(true)
  })
})
