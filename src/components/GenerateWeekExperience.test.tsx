import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { GenerateWeekExperience } from './GenerateWeekExperience'

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
})
