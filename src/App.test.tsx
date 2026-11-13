import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Recipe Lab prototype', () => {
  it('searches by ingredient and opens a recipe', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByPlaceholderText(/search titles or ingredients/i), 'mushroom')
    expect(screen.getByText('Miso Mushroom Toast')).toBeInTheDocument()
    expect(screen.queryByText('Lemon Herb Orzo')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open recipe/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('mixed mushrooms')
  })
  it('filters by tag and resets an empty search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Vegan' }))
    expect(screen.getByText('Showing 1 of 4 recipes')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/search titles or ingredients/i), 'no-such-recipe')
    await user.click(screen.getByRole('button', { name: /reset filters/i }))
    expect(screen.getByText('Showing 4 of 4 recipes')).toBeInTheDocument()
  })
})
