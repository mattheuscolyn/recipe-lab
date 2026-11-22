import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { GenerateWeekExperience } from './GenerateWeekExperience'
import { personalDataV3Schema } from '../domain/personalDataV3'

const emptyV3 = personalDataV3Schema.parse({ schemaVersion: 3, preferences: {}, plan: [], checkedGroceries: {}, pantry: [], mealRequirements: [], cookEvents: [], batches: [], allocations: [], preparedFoodLots: [], tasks: [], legacyRecipeChoices: [], migrationRecovery: null })

describe('Generate Week interactive preview', () => {
  it('shows an honest incomplete real-catalog result without fabricating approvals', async () => {
    const user = userEvent.setup()
    render(<GenerateWeekExperience weekStart="2027-06-07" timeZone="America/Los_Angeles" pantry={[]} onWeekChange={() => undefined}/>)
    await user.click(screen.getByRole('button', { name: 'Real catalog' }))
    expect(screen.getByText(/0 authorized production recipes plus 0 browser-local personal recipes/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate Draft Week' }))
    expect(await screen.findByLabelText('Generated draft summary')).toHaveTextContent('0/21')
    expect(screen.getByText('Meal plan incomplete')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /21 meals need a decision/i })).toBeInTheDocument()
  })

  it('exposes a local-only personal recipe path with explicit rights and fresh-use boundaries', async () => {
    const user = userEvent.setup()
    render(<GenerateWeekExperience weekStart="2027-06-07" timeZone="America/Los_Angeles" pantry={[]} onWeekChange={() => undefined}/>)
    await user.click(screen.getByRole('button', { name: 'Real catalog' }))
    await user.click(screen.getByRole('button', { name: /Add personal recipe/i }))
    expect(screen.getByRole('heading', { name: 'Add a personal recipe' })).toBeInTheDocument()
    expect(screen.getByText(/does not grant publisher rights, verify food safety, or approve leftovers/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save private recipe' })).toBeDisabled()
    expect(screen.getByLabelText(/I wrote this recipe or have permission/i)).not.toBeChecked()
  })

  it('shows a reviewable but disabled acceptance path for synthetic plans', async () => {
    const user = userEvent.setup()
    render(<GenerateWeekExperience weekStart="2027-06-07" timeZone="America/Los_Angeles" pantry={[]} currentPersonalData={emptyV3} onWeekChange={() => undefined}/>)
    await user.click(screen.getByRole('button', { name: 'Generate Draft Week' }))
    await user.click(await screen.findByRole('button', { name: 'Review proposed acceptance' }, { timeout: 30_000 }))
    expect(screen.getByText(/synthetic demo plans can be reviewed but never accepted/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept generated week' })).toBeDisabled()
    expect(screen.getByText(/disabled pending explicit owner authorization/i)).toBeInTheDocument()
  }, 40_000)
})
