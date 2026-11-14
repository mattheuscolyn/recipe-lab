import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Recipe Lab grocery pilot', () => {
  it('searches real recipes and shows source facts', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByText('25 real records validated')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/search recipes or ingredients/i), 'pancake')
    expect(screen.getByRole('heading', { name: 'Simply Perfect Pancakes' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Smoky Black Bean Soup' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /view source facts/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('1 1/2 cups (180g) all-purpose flour')
    expect(screen.getByRole('dialog')).toHaveTextContent('Source reviewed, not kitchen-tested')
  })

  it('updates serving-scaled contributions in the grocery demo', async () => {
    const user = userEvent.setup()
    render(<App />)
    const input = screen.getByLabelText('Smoky Black Bean Soup planning servings')
    await user.click(input)
    await user.keyboard('{Control>}a{/Control}8')
    const garlic = screen.getByRole('heading', { name: 'Garlic' }).closest('article')!
    expect(within(garlic).getByText('7 clove')).toBeInTheDocument()
    expect(screen.getByText(/Priced-items checkout subtotal/i)).toBeInTheDocument()
  })

  it('shows output assumptions and makes optional exclusions controllable', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByPlaceholderText(/search recipes or ingredients/i), 'pancake')
    await user.click(screen.getByRole('button', { name: /view source facts/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('12 large pancakes')
    expect(screen.getByRole('dialog')).toHaveTextContent('Planning default: 4 people')
    await user.click(screen.getByRole('button', { name: /close recipe/i }))
    expect(screen.getByRole('checkbox', { name: /optional item/i })).not.toBeChecked()
  })
})
