import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { pilotRecipes } from './data/pilotCatalog'
import { defaultScheduleDate, startOfWeek, weekDates } from './domain/mealPlan'
import { emptyPersonalData, emptyPreference, PERSONAL_DATA_KEY } from './domain/personalData'
import { PERSONAL_DATA_V3_KEY } from './domain/personalDataV3'

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
    await user.click(screen.getByRole('button', { name: 'Open classic manual planner' }))
    const initialWeek = screen.getByText(/Week of/i).nextElementSibling?.textContent
    expect(screen.getByText(/Nothing planned yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText(/Week of/i).nextElementSibling?.textContent).not.toBe(initialWeek)
    expect(screen.getByText(/Nothing planned yet/i)).toBeInTheDocument()
  })

  it('schedules from Discover and Library without changing discovery preference and consolidates groceries', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Add to plan/i }))
    let dialog = screen.getByRole('dialog', { name: /Schedule Smoky Black Bean Soup/i })
    await user.click(within(dialog).getAllByRole('button', { name: /^Choose /i })[1])
    const servings = within(dialog).getByRole('spinbutton', { name: 'Servings' })
    await user.clear(servings)
    await user.type(servings, '2')
    await user.click(within(dialog).getByRole('button', { name: 'Schedule recipe' }))
    expect(screen.getByRole('status')).toHaveTextContent(/Smoky Black Bean Soup scheduled/i)
    let saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}')
    expect(saved.plan).toHaveLength(1)
    expect(saved.plan[0]).toMatchObject({ meal: 'Dinner', servings: 2, recipeId: pilotRecipes[0].id })
    expect(saved.preferences[pilotRecipes[0].id]).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.type(screen.getByPlaceholderText(/search recipes, ingredients/i), 'Smoky Black Bean')
    const card = screen.getByRole('heading', { name: 'Smoky Black Bean Soup' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Save for later' }))
    await user.click(within(card).getByRole('button', { name: /Add to plan/i }))
    dialog = screen.getByRole('dialog', { name: /Schedule Smoky Black Bean Soup/i })
    await user.click(within(dialog).getAllByRole('button', { name: /^Choose /i })[3])
    await user.click(within(dialog).getByRole('button', { name: 'Schedule recipe' }))

    await user.click(screen.getByRole('button', { name: 'Grocery' }))
    const garlic = screen.getByText('Garlic').closest('article')!
    expect(within(within(garlic).getByText('Required').parentElement!).getByText('3 clove')).toBeInTheDocument()
    expect(within(garlic).getByText('2 scheduled contributions')).toBeInTheDocument()
    saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}')
    expect(saved.preferences[pilotRecipes[0].id].status).toBe('saved')
    expect(saved.plan).toHaveLength(2)
  })

  it('defaults Quick Add to today in the current week and Monday in a future week', () => {
    expect(defaultScheduleDate('2026-11-09', '2026-11-12')).toBe('2026-11-12')
    expect(defaultScheduleDate('2026-11-16', '2026-11-12')).toBe('2026-11-16')
  })

  it('focuses the scheduling confirmation after filling an empty slot', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    await user.click(screen.getByRole('button', { name: 'Open classic manual planner' }))
    await user.click(screen.getByRole('button', { name: /Choose recipe for Mon.* Dinner/i }))
    await user.click(screen.getByRole('button', { name: /Smoky Black Bean Soup/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'View week' })).toHaveFocus())
  })

  it('offers Quick Add from recipe details and restores focus when cancelled', async () => {
    const user = userEvent.setup()
    render(<App />)
    const details = screen.getByRole('button', { name: 'Details and source' })
    await user.click(details)
    await user.click(screen.getByRole('button', { name: /Add to weekly plan/i }))
    expect(screen.queryByRole('dialog', { name: 'Smoky Black Bean Soup' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /Schedule Smoky Black Bean Soup/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(details).toHaveFocus()
  })

  it('creates, edits, and explicitly deletes separate pantry inventory', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Pantry/ }))
    const add = screen.getByRole('button', { name: /Add pantry item/i })
    await user.click(add)
    expect(screen.getByRole('button', { name: 'Close pantry item editor' })).toHaveFocus()
    const dialog = screen.getByRole('dialog', { name: 'Add pantry item' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Search pantry ingredients' }), 'Garlic')
    await user.click(within(dialog).getByRole('button', { name: /Garlic.*Fresh clove/i }))
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Pantry quantity' }), '4')
    await user.type(within(dialog).getByLabelText('Best-by date'), '2026-11-20')
    await user.type(within(dialog).getByRole('textbox', { name: 'Pantry note' }), 'Top shelf')
    await user.click(within(dialog).getByRole('button', { name: 'Add to pantry' }))
    expect(screen.getByRole('heading', { name: 'Garlic' })).toBeInTheDocument()
    expect(screen.getByText('4', { selector: '.pantry-quantity' })).toBeInTheDocument()
    expect(add).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const editDialog = screen.getByRole('dialog', { name: 'Edit pantry lot' })
    const quantity = within(editDialog).getByRole('spinbutton', { name: 'Pantry quantity' })
    await user.clear(quantity)
    await user.type(quantity, '6')
    await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('6', { selector: '.pantry-quantity' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(screen.getByRole('heading', { name: /pantry starts empty/i })).toBeInTheDocument()
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('restores pantry focus when an edit removes its original filtered control', async () => {
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), pantry: [{ id: 'garlic-lot', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 4, unit: 'clove', bestBy: null, note: '' }] }))
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Pantry/ }))
    const add = screen.getByRole('button', { name: /Add pantry item/i })
    await user.click(add)
    await user.keyboard('{Escape}')
    expect(add).toHaveFocus()

    await user.type(screen.getByPlaceholderText(/Search pantry items or notes/i), 'Garlic')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit pantry lot' })
    await user.click(within(dialog).getByRole('button', { name: /Garlic.*Change ingredient/i }))
    const ingredientSearch = within(dialog).getByRole('textbox', { name: 'Search pantry ingredients' })
    await user.clear(ingredientSearch)
    await user.type(ingredientSearch, 'Milk')
    await user.click(within(dialog).getByRole('button', { name: /^Milk/i }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('heading', { name: /No pantry lots match/i })).toBeInTheDocument()
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('keeps pantry quantities unchanged when groceries are checked or weeks change', async () => {
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const monday = startOfWeek(iso)
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), plan: [{ id: 'monday-dinner', date: monday, meal: 'Dinner', recipeId: pilotRecipes[0].id, servings: 4, locked: false }], pantry: [{ id: 'garlic-lot', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 4, unit: 'clove', bestBy: null, note: '' }] }))
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Grocery' }))
    const costStrip = document.querySelector<HTMLElement>('.cost-strip')!
    expect(within(costStrip).getByText('Priced-items remaining checkout subtotal')).toBeInTheDocument()
    expect(within(costStrip).getByText('Priced-items estimated remaining consumption subtotal')).toBeInTheDocument()
    expect(Number(within(costStrip).getByText('Unpriced or unresolved').parentElement?.querySelector('strong')?.textContent)).toBeGreaterThan(0)
    const garlic = screen.getByText('Garlic').closest('article')!
    expect(within(within(garlic).getByText('Required').parentElement!).getByText('2 clove')).toBeInTheDocument()
    expect(within(within(garlic).getByText('In pantry').parentElement!).getByText('2 clove')).toBeInTheDocument()
    expect(within(within(garlic).getByText('To buy').parentElement!).getByText('0 clove')).toBeInTheDocument()
    await user.click(within(garlic).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    const saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}')
    expect(saved.pantry).toEqual([{ id: 'garlic-lot', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 4, unit: 'clove', bestBy: null, note: '' }])
  })

  it('requires replacement confirmation and protects locked meals', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const tuesday = weekDates(startOfWeek(iso))[1]
    const plan = [{ id: 'locked-tuesday-dinner', date: tuesday, meal: 'Dinner' as const, recipeId: pilotRecipes[0].id, servings: 4, locked: true }]
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), plan }))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.type(screen.getByPlaceholderText(/search recipes, ingredients/i), 'Simply Perfect Pancakes')
    const card = screen.getByRole('heading', { name: 'Simply Perfect Pancakes' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: /Add to plan/i }))
    let dialog = screen.getByRole('dialog', { name: /Schedule Simply Perfect Pancakes/i })
    await user.click(within(dialog).getAllByRole('button', { name: /^Choose /i })[1])
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Meal' }), 'Dinner')
    expect(within(dialog).getByRole('status')).toHaveTextContent(/meal is locked/i)
    expect(within(dialog).getByRole('button', { name: 'Review replacement' })).toBeDisabled()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    await user.click(screen.getByRole('button', { name: 'Open classic manual planner' }))
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(screen.getByRole('heading', { name: 'Simply Perfect Pancakes' }).closest('article')!.querySelector('.plan-link')!)
    dialog = screen.getByRole('dialog', { name: /Schedule Simply Perfect Pancakes/i })
    await user.click(within(dialog).getAllByRole('button', { name: /^Choose /i })[1])
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Meal' }), 'Dinner')
    await user.click(within(dialog).getByRole('button', { name: 'Review replacement' }))
    expect(JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}').plan[0].recipeId).toBe(pilotRecipes[0].id)
    await user.click(within(dialog).getByRole('button', { name: 'Confirm replacement' }))
    expect(JSON.parse(window.localStorage.getItem(PERSONAL_DATA_KEY) ?? '{}').plan[0].recipeId).toBe(pilotRecipes[1].id)
  })

  it('uses a searchable prioritized slot picker and keeps locked edit controls safe', async () => {
    const user = userEvent.setup()
    const preferences = { [pilotRecipes[0].id]: { ...emptyPreference(), status: 'saved' as const } }
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify({ ...emptyPersonalData(), preferences }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    await user.click(screen.getByRole('button', { name: 'Open classic manual planner' }))
    await user.click(screen.getByRole('button', { name: /Choose recipe for Mon.* Dinner/i }))
    const dialog = screen.getByRole('dialog', { name: /Mon.*Dinner/i })
    const search = within(dialog).getByRole('textbox', { name: /Search recipes for meal slot/i })
    await user.tab()
    expect(search).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Your picks' }))
    expect(within(dialog).getByRole('button', { name: /Smoky Black Bean Soup/i })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Simply Perfect Pancakes/i })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Smoky Black Bean Soup/i }))
    await user.click(screen.getByRole('button', { name: 'Lock' }))
    expect(screen.getByRole('button', { name: /Swap recipe for Mon.* Dinner/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await user.click(screen.getByRole('button', { name: /Swap recipe for Mon.* Dinner/i }))
    const replacement = screen.getByRole('dialog', { name: /Mon.*Dinner/i })
    await user.type(within(replacement).getByRole('textbox', { name: /Search recipes for meal slot/i }), 'Pancakes')
    await user.click(within(replacement).getByRole('button', { name: /Simply Perfect Pancakes/i }))
    expect(within(replacement).getByRole('alert')).toHaveTextContent(/Replace Smoky Black Bean Soup/i)
    await user.click(within(replacement).getByRole('button', { name: 'Confirm replacement' }))
    expect(document.querySelector('.slot-recipe')).toHaveTextContent('Simply Perfect Pancakes')
    await waitFor(() => expect(screen.getByRole('button', { name: 'View week' })).toHaveFocus())
  })

  it('consolidates repeated scheduled recipes at scaled servings and updates after deletion', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    await user.click(screen.getByRole('button', { name: 'Open classic manual planner' }))
    await user.click(screen.getByRole('button', { name: /Choose recipe for Mon.* Dinner/i }))
    await user.click(screen.getByRole('button', { name: /Smoky Black Bean Soup/i }))
    await user.click(screen.getByRole('button', { name: /Choose recipe for Thu.* Dinner/i }))
    await user.click(screen.getByRole('button', { name: /Smoky Black Bean Soup/i }))
    const people = screen.getAllByRole('spinbutton', { name: /Dinner people for/i })
    fireEvent.change(people[1], { target: { value: '8' } })
    await waitFor(() => expect(people[1]).toHaveValue(8))
    await user.click(screen.getByRole('button', { name: 'Grocery' }))
    const garlic = screen.getByText('Garlic').closest('article')!
    expect(within(within(garlic).getByText('Required').parentElement!).getByText('6 clove')).toBeInTheDocument()
    expect(within(garlic).getByText('2 scheduled contributions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    await user.click(screen.getAllByRole('button', { name: /Remove Dinner for/i })[1])
    await user.click(screen.getByRole('button', { name: 'Grocery' }))
    const remainingGarlic = screen.getByText('Garlic').closest('article')!
    expect(within(within(remainingGarlic).getByText('Required').parentElement!).getByText('2 clove')).toBeInTheDocument()
  })

  it('keeps generated planning primary while preserving the classic planner and migration details', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const monday = weekDates(startOfWeek(iso))[0]
    const source = { ...emptyPersonalData(), plan: [{ id: 'preview-monday-dinner', date: monday, meal: 'Dinner' as const, recipeId: pilotRecipes[0].id, servings: 2, locked: true }] }
    const original = JSON.stringify(source)
    window.localStorage.setItem(PERSONAL_DATA_KEY, original)
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    expect(screen.getByRole('heading', { name: /Plan once. Cook with confidence/i })).toBeInTheDocument()
    expect(window.localStorage.getItem(PERSONAL_DATA_V3_KEY)).toBeNull()
    expect(screen.getByText('2 whole meal portions')).toBeInTheDocument()
    expect(screen.getByText(/Recipe choice preserved · not allocated/i)).toBeInTheDocument()
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByLabelText('Migration preview summary')).toHaveTextContent(/0 saved week/i)
    await user.click(screen.getByRole('button', { name: 'Next preview week' }))
    expect(screen.getByRole('heading', { name: /No saved meals in this week/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Open classic manual planner/i }))
    expect(screen.getByRole('heading', { name: 'Make the week yours.' })).toBeInTheDocument()
    expect(window.localStorage.getItem(PERSONAL_DATA_KEY)).toBe(original)
    expect(window.localStorage.getItem(PERSONAL_DATA_V3_KEY)).toBeNull()
  })

  it('requires review and confirmation before saving a separate recoverable v3 snapshot', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const monday = weekDates(startOfWeek(iso))[0]
    const source = { ...emptyPersonalData(), preferences: { [pilotRecipes[0].id]: { ...emptyPreference(), status: 'saved' as const } }, plan: [{ id: 'convert-monday-dinner', date: monday, meal: 'Dinner' as const, recipeId: pilotRecipes[0].id, servings: 2, locked: false }], checkedGroceries: { checked: true }, pantry: [{ id: 'preview-garlic', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 3, unit: 'clove' as const, bestBy: null, note: '' }] }
    const original = JSON.stringify(source)
    window.localStorage.setItem(PERSONAL_DATA_KEY, original)
    const createObjectURL = vi.fn((blob: Blob) => { void blob; return 'blob:backup' })
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const view = render(<App />)
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    await user.click(screen.getByRole('button', { name: 'Download personal-data backup' }))
    expect(createObjectURL).toHaveBeenCalledOnce()
    const backupBlob = createObjectURL.mock.calls[0][0] as Blob
    expect(await backupBlob.text()).toBe(original)
    await user.click(screen.getByRole('button', { name: 'Review conversion' }))
    expect(screen.getByText(/1 original slots, 1 preferences, 1 pantry lots/i)).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Save separate preview snapshot' })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I reviewed what changes/i }))
    await user.click(save)
    expect(screen.getByText(/Preview snapshot saved separately/i)).toBeInTheDocument()
    const v3 = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_V3_KEY) ?? '{}')
    expect(v3).toMatchObject({ schemaVersion: 3, preferences: source.preferences, plan: source.plan, checkedGroceries: source.checkedGroceries, pantry: source.pantry, cookEvents: [], batches: [], allocations: [], preparedFoodLots: [], tasks: [] })
    expect(v3.migrationRecovery.originalPayload).toEqual(source)
    expect(window.localStorage.getItem(PERSONAL_DATA_KEY)).toBe(original)
    view.unmount()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    expect(screen.getByRole('heading', { name: /Plan once. Cook with confidence/i })).toBeInTheDocument()
  })

  it('shows fractional legacy servings as an explicit review issue without rounding them', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const monday = weekDates(startOfWeek(iso))[0]
    const source = { ...emptyPersonalData(), plan: [{ id: 'fractional-preview', date: monday, meal: 'Dinner' as const, recipeId: pilotRecipes[0].id, servings: 1.5, locked: false }] }
    window.localStorage.setItem(PERSONAL_DATA_KEY, JSON.stringify(source))
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    expect(screen.getByText('1.5 legacy servings')).toBeInTheDocument()
    expect(screen.getAllByText(/cannot be reinterpreted as whole meal portions/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('2 whole meal portions')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(PERSONAL_DATA_V3_KEY)).toBeNull()
  })

  it('previews and preserves the exact pre-quarantine source including invalid meals and pantry lots', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const [monday, tuesday, wednesday] = weekDates(startOfWeek(iso))
    const unknownRecipeId = '00000000-0000-4000-8000-000000000099'
    const source = {
      ...emptyPersonalData(),
      plan: [
        { id: 'unknown-recipe-slot', date: monday, meal: 'Dinner' as const, recipeId: unknownRecipeId, servings: 2, locked: false },
        { id: 'duplicate-one', date: tuesday, meal: 'Lunch' as const, recipeId: pilotRecipes[0].id, servings: 1, locked: false },
        { id: 'duplicate-two', date: tuesday, meal: 'Lunch' as const, recipeId: pilotRecipes[1].id, servings: 2, locked: true },
        { id: 'valid-slot', date: wednesday, meal: 'Breakfast' as const, recipeId: pilotRecipes[1].id, servings: 3, locked: true },
      ],
      pantry: [{ id: 'retired-pantry-lot', canonicalIngredientId: 'ingredient-retired', variantId: 'variant-retired', quantity: 1, unit: 'item' as const, bestBy: null, note: 'Preserve exactly' }],
    }
    const raw = `  ${JSON.stringify(source)}\n`
    window.localStorage.setItem(PERSONAL_DATA_KEY, raw)
    const createObjectURL = vi.fn((blob: Blob) => { void blob; return 'blob:exact-source' })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<App />)
    expect(screen.getByText(/invalid saved entries were quarantined/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    expect(screen.getAllByText(/selected recipe is not in the current catalog/i)).toHaveLength(2)
    expect(screen.getAllByText(/more than one saved recipe occupies this date and meal/i)).toHaveLength(4)
    expect(screen.getByText(/retired-pantry-lot references an ingredient outside the current catalog/i)).toBeInTheDocument()
    expect(screen.getByText('3 whole meal portions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download personal-data backup' }))
    expect(createObjectURL).toHaveBeenCalledOnce()
    const exactBackupBlob = createObjectURL.mock.calls[0][0] as Blob
    expect(await exactBackupBlob.text()).toBe(raw)

    await user.click(screen.getByRole('button', { name: 'Review conversion' }))
    await user.click(screen.getByRole('checkbox', { name: /I reviewed what changes/i }))
    await user.click(screen.getByRole('button', { name: 'Save separate preview snapshot' }))
    const saved = JSON.parse(window.localStorage.getItem(PERSONAL_DATA_V3_KEY) ?? '{}')
    expect(saved.plan).toEqual(source.plan)
    expect(saved.pantry).toEqual(source.pantry)
    expect(saved.migrationRecovery.originalPayload).toEqual(source)
    expect(saved.migrationRecovery.sourceRaw).toBe(raw)
    expect(saved.migrationRecovery.issues.map((issue: { code: string }) => issue.code)).toEqual(['unknown-recipe', 'duplicate-meal', 'duplicate-meal', 'unknown-ingredient'])
    expect(window.localStorage.getItem(PERSONAL_DATA_KEY)).toBe(raw)
  })

  it('blocks conversion and keeps a raw recovery download when persisted v2 is unparseable', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(PERSONAL_DATA_KEY, '{broken source')
    const createObjectURL = vi.fn(() => 'blob:raw-recovery')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Plan/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(/conversion is unavailable/i)
    expect(screen.queryByRole('button', { name: 'Review conversion' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download raw recovery copy' }))
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(PERSONAL_DATA_KEY)).toBe('{broken source')
    expect(window.localStorage.getItem(PERSONAL_DATA_V3_KEY)).toBeNull()
  })
})
