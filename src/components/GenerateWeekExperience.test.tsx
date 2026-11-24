import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { GenerateWeekExperience } from './GenerateWeekExperience'
import { personalDataV3Schema } from '../domain/personalDataV3'
import { canonicalIngredients } from '../data/pilotCatalog'
import { emptyPersonalRecipeLibrary, PERSONAL_RECIPE_STORAGE_KEY, savePersonalRecipeRevision } from '../domain/personalRecipesV3'

const emptyV3 = personalDataV3Schema.parse({ schemaVersion: 3, preferences: {}, plan: [], checkedGroceries: {}, pantry: [], mealRequirements: [], cookEvents: [], batches: [], allocations: [], preparedFoodLots: [], tasks: [], legacyRecipeChoices: [], migrationRecovery: null })

describe('Generate Week interactive preview', () => {
  it('shows an honest incomplete real-catalog result without fabricating approvals', async () => {
    const user = userEvent.setup()
    render(<GenerateWeekExperience weekStart="2027-06-07" timeZone="America/Los_Angeles" pantry={[]} onWeekChange={() => undefined}/>)
    expect(screen.getByText(/0 authorized production recipes plus 0 browser-local personal recipes/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate Week' }))
    expect(await screen.findByLabelText('Generated draft summary')).toHaveTextContent('0/21')
    expect(screen.getByText('Meal plan incomplete')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /21 meals need a decision/i })).toBeInTheDocument()
  })

  it('exposes a streamlined local-only recipe path with explicit fresh-use boundaries', async () => {
    const user = userEvent.setup()
    render(<GenerateWeekExperience weekStart="2027-06-07" timeZone="America/Los_Angeles" pantry={[]} onWeekChange={() => undefined}/>)
    await user.click(screen.getByRole('button', { name: /Add recipe/i }))
    expect(screen.getByRole('heading', { name: 'Add a personal recipe' })).toBeInTheDocument()
    expect(screen.getByText(/Storage notes remain notes until separately safety-reviewed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save recipe' })).toBeDisabled()
    expect(screen.getByLabelText(/I confirm I can use this recipe privately/i)).not.toBeChecked()
    expect(screen.getByLabelText('Search ingredient 1')).toBeInTheDocument()
    expect(screen.getByLabelText(/Source or reference URL/i)).toBeInTheDocument()
  })

  it('browses immutable personal history and opens edits as a new revision', async () => {
    const ingredient = canonicalIngredients[0]
    savePersonalRecipeRevision(window.localStorage, emptyPersonalRecipeLibrary(), {
      personalRecipeId: '90000000-0000-4000-8000-000000000099', revision: 1, title: 'Our Test Tacos', description: 'A household taco dinner for lifecycle testing.', sourceUrl: null, notes: '', storageNotes: '', emoji: '🌮', servings: 2, activeMinutes: 20, totalMinutes: 30, mealRoles: ['dinner'], ingredients: [{ ingredientId: ingredient.id, variantId: ingredient.variants[0].id, amount: 2, unit: ingredient.baseUnit, optional: false }], authorshipConfirmed: true, authorshipStatement: 'I wrote this household recipe and can use it privately.', freshUseReviewed: true, createdAt: '2026-11-22T12:00:00.000Z', updatedAt: '2026-11-22T12:00:00.000Z',
    }, canonicalIngredients)
    try {
      const user = userEvent.setup()
      render(<GenerateWeekExperience weekStart="2027-06-07" timeZone="America/Los_Angeles" pantry={[]} onWeekChange={() => undefined}/>)
      expect(screen.getByText('Our Test Tacos')).toBeInTheDocument()
      await user.click(screen.getByText('History'))
      expect(screen.getByText(/r1 · Our Test Tacos/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(screen.getByRole('heading', { name: 'Edit personal recipe' })).toBeInTheDocument()
      expect(screen.getByDisplayValue('Our Test Tacos')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save new revision' })).toBeEnabled()
    } finally { window.localStorage.removeItem(PERSONAL_RECIPE_STORAGE_KEY) }
  })

  it('shows a reviewable but blocked acceptance path for synthetic plans', async () => {
    const user = userEvent.setup()
    render(<GenerateWeekExperience weekStart="2027-06-07" timeZone="America/Los_Angeles" pantry={[]} currentPersonalData={emptyV3} onWeekChange={() => undefined}/>)
    await user.click(screen.getByRole('button', { name: 'Try synthetic demo' }))
    await user.click(screen.getByRole('button', { name: 'Generate Week' }))
    const reviewButton = await screen.findByRole('button', { name: 'Review proposed acceptance' }, { timeout: 30_000 })
    await user.clear(screen.getByLabelText('dinner default portions'))
    await user.type(screen.getByLabelText('dinner default portions'), '3')
    expect(screen.getByText('Draft settings changed')).toBeInTheDocument()
    expect(reviewButton).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Regenerate now' }))
    await waitFor(() => expect(screen.queryByText('Draft settings changed')).not.toBeInTheDocument(), { timeout: 30_000 })
    await user.click(screen.getByRole('button', { name: 'Review proposed acceptance' }))
    expect(screen.getByText(/synthetic demo plans can be reviewed but never accepted/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save as My Week' })).toBeDisabled()
    expect(screen.getByText(/Saving writes only to this browser/i)).toBeInTheDocument()
  }, 40_000)
})
