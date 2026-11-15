import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { RecipeV2 } from '../domain/catalog'
import { shiftWeek, weekDates } from '../domain/mealPlan'
import type { MealSlot, RecipePreference } from '../domain/personalData'

export type MealName = 'Breakfast' | 'Lunch' | 'Dinner'

const friendlyDate = (iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en-US', options).format(new Date(`${iso}T12:00:00`))
const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function ModalFrame({ titleId, onClose, returnFocus, children, className = '' }: { titleId: string; onClose: () => void; returnFocus: HTMLElement | null; children: React.ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return }
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    const containFocus = (event: FocusEvent) => { if (dialog && !dialog.contains(event.target as Node)) closeRef.current?.focus() }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', containFocus)
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', containFocus)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [onClose, returnFocus])
  return <div className="detail-backdrop planner-backdrop" role="presentation" onMouseDown={onClose}><section ref={dialogRef} tabIndex={-1} className={`planner-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
    <button ref={closeRef} className="close-button" type="button" onClick={onClose} aria-label="Close planner">×</button>
    {children}
  </section></div>
}
export function ScheduleRecipeDialog({ recipe, selectedWeek, plan, recipeTitles, returnFocus, onClose, onSchedule }: { recipe: RecipeV2; selectedWeek: string; plan: MealSlot[]; recipeTitles: ReadonlyMap<string, string>; returnFocus: HTMLElement | null; onClose: () => void; onSchedule: (date: string, meal: MealName, servings: number) => void }) {
  const [pickerWeek, setPickerWeek] = useState(selectedWeek)
  const [date, setDate] = useState(selectedWeek)
  const [meal, setMeal] = useState<MealName>(recipe.category === 'Breakfast' ? 'Breakfast' : recipe.category === 'Lunch' ? 'Lunch' : 'Dinner')
  const [servings, setServings] = useState(String(recipe.yield.planningServings.default))
  const [confirming, setConfirming] = useState(false)
  const dates = useMemo(() => weekDates(pickerWeek), [pickerWeek])
  const existing = plan.find((slot) => slot.date === date && slot.meal === meal)

  const moveWeek = (amount: number) => {
    const next = shiftWeek(pickerWeek, amount)
    setPickerWeek(next)
    setDate(next)
    setConfirming(false)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (existing?.locked) return
    if (existing && !confirming) { setConfirming(true); return }
    onSchedule(date, meal, Math.max(1, Number(servings) || 1))
  }

  return <ModalFrame titleId="schedule-title" onClose={onClose} returnFocus={returnFocus}>
    <form className="schedule-form" onSubmit={submit}>
      <p className="eyebrow">Quick add to plan</p><h2 id="schedule-title">Schedule {recipe.title}</h2><p>Choose one explicit meal slot. Your recipe preference will not change.</p>
      <div className="schedule-week-heading"><button type="button" aria-label="Previous scheduling week" onClick={() => moveWeek(-1)}>←</button><strong>Week of {friendlyDate(pickerWeek, { month: 'long', day: 'numeric', year: 'numeric' })}</strong><button type="button" aria-label="Next scheduling week" onClick={() => moveWeek(1)}>→</button></div>
      <div className="schedule-days" aria-label="Choose a day">{dates.map((day) => <button key={day} type="button" aria-pressed={date === day} aria-label={`Choose ${friendlyDate(day)}`} onClick={() => { setDate(day); setConfirming(false) }}><span>{friendlyDate(day, { weekday: 'short' })}</span><strong>{friendlyDate(day, { month: 'short', day: 'numeric' })}</strong></button>)}</div>
      <div className="schedule-fields"><label>Meal<select aria-label="Meal" value={meal} onChange={(event) => { setMeal(event.target.value as MealName); setConfirming(false) }}>{(['Breakfast','Lunch','Dinner'] as MealName[]).map((name) => <option key={name}>{name}</option>)}</select></label><label>Servings<input aria-label="Servings" type="number" min="1" step="1" value={servings} onChange={(event) => setServings(event.target.value)}/></label></div>
      {existing ? <div className={`slot-warning ${existing.locked ? 'locked' : ''}`} role="status"><strong>{existing.locked ? 'This meal is locked.' : `${friendlyDate(date)} ${meal} is filled.`}</strong><span>{recipeTitles.get(existing.recipeId)} · {existing.servings} serving{existing.servings === 1 ? '' : 's'}{existing.locked ? ' Unlock it in Plan before making changes.' : ' Confirmation is required before replacement.'}</span></div> : null}
      {confirming && existing && !existing.locked ? <div className="replace-confirm" role="alert"><span>Replace <strong>{recipeTitles.get(existing.recipeId)}</strong> with <strong>{recipe.title}</strong>?</span><button type="button" onClick={() => setConfirming(false)}>Keep existing meal</button></div> : null}
      <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={existing?.locked}>{confirming ? 'Confirm replacement' : existing ? 'Review replacement' : 'Schedule recipe'}</button></div>
    </form>
  </ModalFrame>
}
type PickerFilter = 'all' | 'picks' | 'breakfast' | 'lunch' | 'dinner'

export function RecipePickerDialog({ date, meal, existing, recipes, preferences, returnFocus, onClose, onChoose }: { date: string; meal: MealName; existing: MealSlot | undefined; recipes: RecipeV2[]; preferences: Record<string, RecipePreference>; returnFocus: HTMLElement | null; onClose: () => void; onChoose: (recipe: RecipeV2) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PickerFilter>('all')
  const [pending, setPending] = useState<RecipeV2 | null>(null)
  const currentRecipe = existing ? recipes.find(({ id }) => id === existing.recipeId) : undefined
  const filtered = useMemo(() => recipes
    .filter((recipe) => {
      const preference = preferences[recipe.id]
      const matchesFilter = filter === 'all' || (filter === 'picks' && (preference?.status === 'interested' || preference?.status === 'saved')) || recipe.category.toLowerCase() === filter
      return matchesFilter && [recipe.title, recipe.description, recipe.cuisine, ...recipe.tags].join(' ').toLowerCase().includes(query.trim().toLowerCase())
    })
    .sort((left, right) => {
      const score = (recipe: RecipeV2) => preferences[recipe.id]?.status === 'interested' ? 0 : preferences[recipe.id]?.status === 'saved' ? 1 : 2
      return score(left) - score(right) || left.title.localeCompare(right.title)
    }), [filter, preferences, query, recipes])

  return <ModalFrame titleId="picker-title" onClose={onClose} returnFocus={returnFocus} className="recipe-picker-dialog">
    <>
      <p className="eyebrow">{existing ? 'Swap recipe' : 'Fill open slot'}</p><h2 id="picker-title">{friendlyDate(date)} · {meal}</h2><p>{existing ? `Currently ${currentRecipe?.title}. Choose a replacement; nothing changes until you confirm.` : 'Interested and saved recipes appear first, with the complete collection always available.'}</p>
      <label className="picker-search"><span className="sr-only">Search recipes for meal slot</span><input aria-label="Search recipes for meal slot" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes, cuisines, or tags…"/></label>
      <div className="picker-filters" aria-label="Recipe picker filters">{(['all','picks','breakfast','lunch','dinner'] as PickerFilter[]).map((name) => <button type="button" key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name === 'picks' ? 'Your picks' : name[0].toUpperCase() + name.slice(1)}</button>)}</div>
      {pending && existing ? <div className="picker-confirm" role="alert"><span>Replace <strong>{currentRecipe?.title}</strong> with <strong>{pending.title}</strong>?</span><div><button type="button" onClick={() => setPending(null)}>Cancel replacement</button><button className="primary" type="button" onClick={() => onChoose(pending)}>Confirm replacement</button></div></div> : null}
      <div className="picker-results" aria-label="Available recipes">{filtered.map((recipe) => { const status = preferences[recipe.id]?.status; return <button type="button" key={recipe.id} onClick={() => existing ? setPending(recipe) : onChoose(recipe)}><span className="picker-emoji" aria-hidden="true">{recipe.emoji}</span><span><strong>{recipe.title}</strong><small>{recipe.category} · {recipe.times.totalMinutes} min</small></span>{status ? <b>{status === 'saved' ? 'Saved' : status === 'interested' ? 'Interested' : 'Passed'}</b> : null}</button> })}{!filtered.length ? <p>No recipes match this search and filter.</p> : null}</div>
    </>
  </ModalFrame>
}
