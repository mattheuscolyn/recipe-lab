import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

describe('Recipe Lab personal planning experience', () => {
  beforeEach(() => window.localStorage.clear())

  it('records a discovery choice, supports undo, and keeps passed recipes browsable', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Smoky Black Bean Soup' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    expect(screen.queryByRole('heading', { name: 'Smoky Black Bean Soup' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /undo last choice/i }))
    expect(screen.getByRole('heading', { name: 'Smoky Black Bean Soup' })).toBeInTheDocument()
    expect(screen.getByText('Unreviewed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.type(screen.getByPlaceholderText(/search recipes, ingredients/i), 'Smoky Black Bean')
    const card = screen.getByRole('heading', { name: 'Smoky Black Bean Soup' }).closest('article')!
    expect(within(card).getByText('Passed')).toBeInTheDocument()
  })

  it('restores personal preferences after a remount', async () => {
    const user = userEvent.setup()
    const first = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Interested' }))
    first.unmount()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.type(screen.getByPlaceholderText(/search recipes, ingredients/i), 'Smoky Black Bean')
    const card = screen.getByRole('heading', { name: 'Smoky Black Bean Soup' }).closest('article')!
    expect(within(card).getByRole('button', { name: 'Interested' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('navigates weeks and starts every week empty', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    const initialWeek = screen.getByText(/Week of/i).nextElementSibling?.textContent
    expect(screen.getByText(/Nothing planned yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText(/Week of/i).nextElementSibling?.textContent).not.toBe(initialWeek)
    expect(screen.getByText(/Nothing planned yet/i)).toBeInTheDocument()
  })

  it('consolidates repeated scheduled recipes at scaled servings and updates after deletion', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    const dinners = screen.getAllByRole('combobox', { name: /Choose Dinner for/i })
    await user.selectOptions(dinners[0], '813d36f1-f9ce-431b-b2f4-594af0510b78')
    await user.selectOptions(dinners[3], '813d36f1-f9ce-431b-b2f4-594af0510b78')
    const people = screen.getAllByRole('spinbutton', { name: /Dinner people for/i })
    await user.click(people[1])
    await user.keyboard('{Control>}a{/Control}8')
    await user.click(screen.getByRole('button', { name: 'Grocery' }))
    const garlic = screen.getByText('Garlic').closest('article')!
    expect(within(garlic).getByText('6 clove')).toBeInTheDocument()
    expect(within(garlic).getByText('2 scheduled contributions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    await user.click(screen.getAllByRole('button', { name: /Remove Dinner for/i })[1])
    await user.click(screen.getByRole('button', { name: 'Grocery' }))
    expect(screen.getByText('Garlic').closest('article')?.querySelector('.line-total')).toHaveTextContent('2 clove')
  })
})
