import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { pilotRecipes } from './data/pilotCatalog'
import { emptyPersonalData, emptyPreference, PERSONAL_DATA_KEY } from './domain/personalData'

describe('Recipe Lab personal planning experience', () => {
  beforeEach(() => window.localStorage.clear())

  it('records a discovery choice, supports undo, and keeps passed recipes browsable', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Smoky Black Bean Soup' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Smoky Black Bean Soup' })).not.toBeInTheDocument())
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
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Smoky Black Bean Soup' })).not.toBeInTheDocument())
    first.unmount()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.type(screen.getByPlaceholderText(/search recipes, ingredients/i), 'Smoky Black Bean')
    const card = screen.getByRole('heading', { name: 'Smoky Black Bean Soup' }).closest('article')!
    expect(within(card).getByRole('button', { name: 'Interested' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('resumes discovery at the first recipe without a prior decision', () => {
    const data = { ...emptyPersonalData(), preferences: { [pilotRecipes[0].id]: { ...emptyPreference(), status: 'passed' as const } } }
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify(data))
    render(<App />)
    expect(screen.getByRole('heading', { name: pilotRecipes[1].title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: pilotRecipes[0].title })).not.toBeInTheDocument()
  })

  it('treats Not now as a deferral with an explicit end and revisit action', async () => {
    const user = userEvent.setup()
    const preferences = Object.fromEntries(pilotRecipes.slice(1).map(({ id }) => [id, { ...emptyPreference(), status: 'saved' as const }]))
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), preferences }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.getByRole('heading', { name: /reached the end/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revisit deferred recipes' }))
    expect(screen.getByRole('heading', { name: pilotRecipes[0].title })).toBeInTheDocument()
    expect(screen.getByText('Unreviewed')).toBeInTheDocument()
  })

  it('keeps Save for later equivalent to other persisted decision buttons', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Save for later' }))
    expect(screen.getByRole('heading', { name: pilotRecipes[1].title })).toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}')
    expect(saved.preferences[pilotRecipes[0].id].status).toBe('saved')
  })

  it('shows a stable end state when every recipe already has a decision', () => {
    const preferences = Object.fromEntries(pilotRecipes.map(({ id }) => [id, { ...emptyPreference(), status: 'saved' as const }]))
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), preferences }))
    render(<App />)
    expect(screen.getByRole('heading', { name: /reached the end/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review choices again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse all recipes' })).toBeInTheDocument()
  })

  it('reviews consecutive recipes as a complete pass without clearing existing preferences', async () => {
    const user = userEvent.setup()
    const preferences = Object.fromEntries(pilotRecipes.map(({ id }) => [id, { ...emptyPreference(), status: 'saved' as const }]))
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), preferences }))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Review choices again' }))
    expect(screen.getByRole('heading', { name: pilotRecipes[0].title })).toBeInTheDocument()
    expect(screen.getByLabelText('Discovery progress')).toHaveTextContent('25 left in this pass')
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.getByRole('heading', { name: pilotRecipes[1].title })).toBeInTheDocument()
    expect(screen.getByLabelText('Discovery progress')).toHaveTextContent('24 left in this pass')
    await user.click(screen.getByRole('button', { name: 'Save for later' }))
    expect(screen.getByRole('heading', { name: pilotRecipes[2].title })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Interested/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: pilotRecipes[3].title })).toBeInTheDocument())

    const saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}')
    expect(Object.keys(saved.preferences)).toHaveLength(pilotRecipes.length)
    expect(saved.preferences[pilotRecipes[0].id].status).toBe('saved')
    expect(saved.preferences[pilotRecipes[1].id].status).toBe('saved')
    expect(saved.preferences[pilotRecipes[2].id].status).toBe('interested')
  })

  it('keeps Undo focused after the final review choice and restores its prior preference', async () => {
    const user = userEvent.setup()
    const preferences = Object.fromEntries(pilotRecipes.map(({ id }) => [id, { ...emptyPreference(), status: 'saved' as const }]))
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), preferences }))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Review choices again' }))
    for (let index = 0; index < pilotRecipes.length - 1; index += 1) {
      expect(screen.getByRole('heading', { name: pilotRecipes[index].title })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save for later' }))
    }
    const finalRecipe = pilotRecipes.at(-1)!
    expect(screen.getByRole('heading', { name: finalRecipe.title })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Interested/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /reached the end/i })).toBeInTheDocument())
    const undo = screen.getByRole('button', { name: /Undo last choice/i })
    await waitFor(() => expect(undo).toHaveFocus())
    expect(JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}').preferences[finalRecipe.id].status).toBe('interested')
    await user.click(undo)
    expect(screen.getByRole('heading', { name: finalRecipe.title })).toBeInTheDocument()
    expect(screen.getByText('Saved for later', { selector: '.status-pill' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}').preferences[finalRecipe.id].status).toBe('saved')
  })

  it('maps committed pointer swipes to preferences and ignores a duplicate click', async () => {
    render(<App />)
    const card = screen.getByRole('article', { name: /Smoky Black Bean Soup.*Swipe/i })
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 120, clientY: 200 })
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 245, clientY: 205 })
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 245, clientY: 205 })
    fireEvent.click(screen.getByRole('button', { name: /Interested/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: pilotRecipes[1].title })).toBeInTheDocument())
    const saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}')
    expect(saved.preferences[pilotRecipes[0].id].status).toBe('interested')
    expect(saved.preferences[pilotRecipes[1].id]).toBeUndefined()
  })

  it('cancels short and vertical gestures without recording a preference', () => {
    render(<App />)
    const card = screen.getByRole('article', { name: /Smoky Black Bean Soup.*Swipe/i })

    fireEvent.pointerDown(card, { pointerId: 2, button: 0, clientX: 140, clientY: 140 })
    fireEvent.pointerMove(card, { pointerId: 2, clientX: 190, clientY: 144 })
    fireEvent.pointerUp(card, { pointerId: 2, clientX: 190, clientY: 144 })
    fireEvent.pointerDown(card, { pointerId: 3, button: 0, clientX: 180, clientY: 120 })
    fireEvent.pointerMove(card, { pointerId: 3, clientX: 188, clientY: 270 })
    fireEvent.pointerUp(card, { pointerId: 3, clientX: 188, clientY: 270 })

    expect(screen.getByRole('heading', { name: 'Smoky Black Bean Soup' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}').preferences ?? {}).toEqual({})
    expect(screen.getByText(/No choice made for Smoky Black Bean Soup/i)).toBeInTheDocument()
  })

  it('supports arrow-key decisions from the deck and exposes progress', async () => {
    const user = userEvent.setup()
    render(<App />)
    const card = screen.getByRole('article', { name: /Smoky Black Bean Soup.*Swipe/i })
    expect(screen.getByRole('progressbar', { name: /0 of 25 recipes reviewed/i })).toBeInTheDocument()
    card.focus()
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.getByRole('heading', { name: pilotRecipes[1].title })).toBeInTheDocument())
    const saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}')
    expect(saved.preferences[pilotRecipes[0].id].status).toBe('passed')
  })

  it('removes send-off delay for reduced-motion users', async () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    expect(screen.getByRole('heading', { name: pilotRecipes[1].title })).toBeInTheDocument()
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
  })

  it('traps keyboard focus in recipe details, closes with Escape, and restores the opener', async () => {
    const user = userEvent.setup()
    render(<App />)
    const opener = screen.getByRole('button', { name: 'Details and source' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: 'Close recipe' })
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.tab()
    expect(close).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
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
