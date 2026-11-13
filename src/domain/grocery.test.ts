import { describe, expect, it } from 'vitest'
import { canonicalIngredients, packageOffers, pilotRecipes } from '../data/pilotCatalog'
import { buildGroceryList, calculatePackagePurchase } from './grocery'

const recipe = (slug: string) => pilotRecipes.find((item) => item.slug === slug)!
const selection = (slug: string, servings?: number) => { const item = recipe(slug); return { recipeId: item.id, servings: servings ?? item.yield.planningServings.default } }

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
  it('scales countable pancake output from a distinct people assumption', () => {
    const pancakes = recipe('simply-perfect-pancakes')
    expect(pancakes.yield.source).toMatchObject({ kind: 'countable-output', amount: 12, unit: 'large pancakes' })
    expect(pancakes.yield.planningServings.default).toBe(4)
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('simply-perfect-pancakes', 2)])
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-flour')?.total?.amount).toBeCloseTo(90)
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-egg')?.total).toEqual({ amount: 1, unit: 'item' })
  })
  it('consolidates the chosen kale branch across recipes', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('white-bean-soup'), selection('best-lentil-soup')])
    const kale = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-kale')!
    expect(kale.total).toEqual({ amount: 3, unit: 'cup' })
    expect(kale.contributions).toHaveLength(2)
  })
  it('separates canned net purchase mass from assumed drained usable mass', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('chickpea-coriander-lime-soup')])
    const chickpeas = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-chickpeas')!
    expect(chickpeas.total).toEqual({ amount: 480, unit: 'g' })
    expect(chickpeas.pricing).toMatchObject({ packages: 2, estimatedCheckoutCost: 2.38, packagePurchased: { amount: 820, unit: 'g' }, usablePurchased: { amount: 480, unit: 'g' }, unused: { amount: 0, unit: 'g' } })
  })
  it('excludes optional items by default and can include them visibly', () => {
    const selected = [selection('smoky-black-bean-soup')]
    const defaultList = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, selected)
    expect(defaultList.some(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-jalapeno')).toBe(false)
    const withOptional = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, selected, { includeOptional: true })
    expect(withOptional.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-jalapeno')?.optional).toBe(true)
  })
  it('produces a stable three-recipe consolidated sample', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('creamy-pesto-chicken'), selection('greek-chicken-pasta-salad'), selection('easy-sesame-chicken')])
    const garlic = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(garlic.total).toEqual({ amount: 7, unit: 'clove' })
    expect(garlic.contributions).toHaveLength(3)
    expect(garlic.pricing).toMatchObject({ packages: 1, estimatedCheckoutCost: .89, packagePurchased: { amount: 1, unit: 'head' }, usablePurchased: { amount: 10, unit: 'clove' }, unused: { amount: 3, unit: 'clove' } })
    expect(garlic.pricing?.estimatedConsumptionCost).toBeCloseTo(.623)
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-olive-oil')?.total).toEqual({ amount: .375, unit: 'cup' })
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
