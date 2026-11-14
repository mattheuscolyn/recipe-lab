import { useMemo, useState, type ChangeEvent } from 'react'
import './App.css'
import { canonicalIngredients, packageOffers, pilotRecipes } from './data/pilotCatalog'
import type { RecipeV2 } from './domain/catalog'
import { buildGroceryList } from './domain/grocery'
import { removeMealSlot, shiftWeek, startOfWeek, toggleMealLock, upsertMealSlot, weekDates } from './domain/mealPlan'
import { emptyPreference, exportPersonalData, importPersonalData, type MealSlot, type PreferenceStatus, type RecipePreference } from './domain/personalData'
import { formatAmount } from './domain/units'
import { usePersonalData } from './hooks/usePersonalData'

type Section = 'discover' | 'library' | 'plan' | 'grocery'
type HistoryEntry = { recipeId: string; previous: RecipePreference | undefined; index: number }
const MEALS = ['Breakfast', 'Lunch', 'Dinner'] as const
const ingredientNames = new Map(canonicalIngredients.map((ingredient) => [ingredient.id, ingredient.displayName]))
const recipeMap = new Map(pilotRecipes.map((recipe) => [recipe.id, recipe]))
const formatMinutes = (minutes: number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`
const todayIso = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const friendlyDate = (iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en-US', options).format(new Date(`${iso}T12:00:00`))
const preferenceLabel = (status: PreferenceStatus | null) => status === 'interested' ? 'Interested' : status === 'saved' ? 'Saved for later' : status === 'passed' ? 'Passed' : 'Unreviewed'

function PreferenceButtons({ preference, onStatus }: { preference: RecipePreference; onStatus: (status: PreferenceStatus) => void }) {
  return <div className="preference-actions" aria-label="Recipe preference">
    <button type="button" className={preference.status === 'interested' ? 'active' : ''} aria-pressed={preference.status === 'interested'} onClick={() => onStatus('interested')}>Interested</button>
    <button type="button" className={preference.status === 'saved' ? 'active' : ''} aria-pressed={preference.status === 'saved'} onClick={() => onStatus('saved')}>Save for later</button>
    <button type="button" className={preference.status === 'passed' ? 'active muted' : 'muted'} aria-pressed={preference.status === 'passed'} onClick={() => onStatus('passed')}>Pass</button>
  </div>
}

function RecipeDetail({ recipe, preference, onPreference, onClose }: { recipe: RecipeV2; preference: RecipePreference; onPreference: (next: RecipePreference) => void; onClose: () => void }) {
  return <div className="detail-backdrop" role="presentation" onMouseDown={onClose}><section className="recipe-detail" role="dialog" aria-modal="true" aria-labelledby="recipe-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="close-button" type="button" onClick={onClose} aria-label="Close recipe">×</button>
    <div className="detail-heading"><span className="detail-emoji" aria-hidden="true">{recipe.emoji}</span><div><p className="eyebrow">{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</p><h2 id="recipe-title">{recipe.title}</h2><p>{recipe.description}</p></div></div>
    <div className="personal-panel"><div><p className="eyebrow">Your recipe</p><PreferenceButtons preference={preference} onStatus={(status) => onPreference({ ...preference, status })} /></div><label>Personal rating<select aria-label="Personal rating" value={preference.personalRating ?? ''} onChange={(event) => onPreference({ ...preference, personalRating: event.target.value ? Number(event.target.value) : null })}><option value="">Not rated</option>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label><label className="check-label"><input type="checkbox" checked={preference.cooked} onChange={(event) => onPreference({ ...preference, cooked: event.target.checked })}/> Cooked</label><label className="notes-label">Personal notes<textarea value={preference.note} onChange={(event) => onPreference({ ...preference, note: event.target.value })} placeholder="What would you change next time?"/></label></div>
    <p className="planning-note"><strong>Source yield:</strong> {recipe.yield.source.label}. <strong>Planning default:</strong> {recipe.yield.planningServings.default} people{recipe.yield.planningServings.assumption ? ` — ${recipe.yield.planningServings.assumption}` : ''}</p>
    <div className="detail-grid"><div><h3>Source ingredient facts</h3><ul className="ingredients">{recipe.requirements.map((line) => <li key={line.id}><strong>{line.originalText}</strong><small>{ingredientNames.get(line.canonicalIngredientId)} · {line.confidence}{line.optional ? ' · optional' : ''}{line.quantity?.approximate ? ' · approximate' : ''}</small></li>)}</ul></div><div><h3>Independent method summary</h3><ol className="steps">{recipe.methodSummary.map((step, index) => <li key={index}>{step}</li>)}</ol></div></div>
    <aside className="source-note">Source reviewed, not kitchen-tested. <a href={recipe.source.url} target="_blank" rel="noreferrer">Open the original at {recipe.source.publisher}</a>. Checked {recipe.source.checkedAt}.</aside>
  </section></div>
}

function BrowseCard({ recipe, preference, onStatus, onOpen }: { recipe: RecipeV2; preference: RecipePreference; onStatus: (status: PreferenceStatus) => void; onOpen: () => void }) {
  return <article className="browse-card">
    <div className="card-topline"><span className="recipe-emoji" aria-hidden="true">{recipe.emoji}</span><span className={`status-pill ${preference.status ?? ''}`}>{preferenceLabel(preference.status)}</span></div>
    <p className="card-kicker">{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</p><h3>{recipe.title}</h3><p>{recipe.description}</p>
    <div className="tags">{recipe.tags.slice(0,3).map((tag) => <span key={tag}>{tag}</span>)}</div>
    <PreferenceButtons preference={preference} onStatus={onStatus}/><button className="text-button" type="button" onClick={onOpen}>Recipe details and source →</button>
  </article>
}

function App() {
  const { data, setData, replaceData, storageError, loaded, persistent } = usePersonalData()
  const [section, setSection] = useState<Section>('discover')
  const [detail, setDetail] = useState<RecipeV2 | null>(null)
  const [discoverIndex, setDiscoverIndex] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()))
  const [includeOptional, setIncludeOptional] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const week = useMemo(() => weekDates(weekStart), [weekStart])
  const weekEnd = week[6]
  const weekSlots = useMemo(() => data.plan.filter(({ date }) => date >= weekStart && date <= weekEnd), [data.plan, weekStart, weekEnd])
  const candidate = pilotRecipes[discoverIndex % pilotRecipes.length]
  const preferenceFor = (recipeId: string) => data.preferences[recipeId] ?? emptyPreference()

  const updatePreference = (recipeId: string, next: RecipePreference) => setData((current) => ({ ...current, preferences: { ...current.preferences, [recipeId]: next } }))
  const setStatus = (recipeId: string, status: PreferenceStatus) => updatePreference(recipeId, { ...preferenceFor(recipeId), status })
  const actOnCandidate = (status: PreferenceStatus | null) => {
    setHistory((current) => [...current, { recipeId: candidate.id, previous: data.preferences[candidate.id], index: discoverIndex }])
    if (status) setStatus(candidate.id, status)
    setDiscoverIndex((current) => (current + 1) % pilotRecipes.length)
  }
  const undo = () => {
    const entry = history.at(-1)
    if (!entry) return
    setData((current) => { const preferences = { ...current.preferences }; if (entry.previous) preferences[entry.recipeId] = entry.previous; else delete preferences[entry.recipeId]; return { ...current, preferences } })
    setDiscoverIndex(entry.index); setHistory((current) => current.slice(0, -1))
  }

  const allTags = useMemo(() => ['All', 'Breakfast', 'Lunch', 'Dinner', 'Vegetarian', 'Vegan', 'Interested', 'Saved', 'Cooked'], [])
  const libraryRecipes = useMemo(() => pilotRecipes.filter((recipe) => {
    const text = [recipe.title, recipe.description, recipe.cuisine, recipe.source.publisher, ...recipe.tags, ...recipe.requirements.map((line) => ingredientNames.get(line.canonicalIngredientId) ?? '')].join(' ').toLowerCase()
    const preference = data.preferences[recipe.id] ?? emptyPreference()
    const matchesFilter = filter === 'All' || recipe.category === filter || recipe.tags.includes(filter) || (filter === 'Interested' && preference.status === 'interested') || (filter === 'Saved' && preference.status === 'saved') || (filter === 'Cooked' && preference.cooked)
    return matchesFilter && text.includes(query.trim().toLowerCase())
  }), [data.preferences, filter, query])

  const saveSlot = (date: string, meal: typeof MEALS[number], recipeId: string) => {
    const existing = data.plan.find((slot) => slot.date === date && slot.meal === meal)
    if (!recipeId) { if (existing) setData((current) => ({ ...current, plan: removeMealSlot(current.plan, existing.id) })); return }
    const recipe = recipeMap.get(recipeId)!
    const slot: MealSlot = { id: existing?.id ?? `${date}-${meal.toLowerCase()}`, date, meal, recipeId, servings: existing?.recipeId === recipeId ? existing.servings : recipe.yield.planningServings.default, locked: existing?.locked ?? false }
    setData((current) => ({ ...current, plan: upsertMealSlot(current.plan, slot) }))
  }
  const updateSlot = (slot: MealSlot, patch: Partial<MealSlot>) => setData((current) => ({ ...current, plan: upsertMealSlot(current.plan, { ...slot, ...patch }) }))

  const groceryLines = useMemo(() => buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, weekSlots.map((slot) => ({ recipeId: slot.recipeId, servings: slot.servings, selectionId: slot.id, label: `${friendlyDate(slot.date)} ${slot.meal} · ${recipeMap.get(slot.recipeId)?.title}` })), { includeOptional }), [weekSlots, includeOptional])
  const checkout = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedCheckoutCost ?? 0), 0)
  const consumed = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedConsumptionCost ?? 0), 0)
  const optionalCount = weekSlots.reduce((count, slot) => count + (recipeMap.get(slot.recipeId)?.requirements.filter(({ optional }) => optional).length ?? 0), 0)
  const groceryKey = (ingredientId: string, variantId: string) => `${weekStart}:${ingredientId}:${variantId}`

  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([exportPersonalData(data)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `recipe-lab-backup-${todayIso()}.json`; anchor.click(); URL.revokeObjectURL(url); setBackupMessage('Backup exported.')
  }
  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try { replaceData(importPersonalData(await file.text())); setBackupMessage('Backup imported and saved.') } catch (error) { setBackupMessage(error instanceof Error ? error.message : 'Backup import failed.') }
    event.target.value = ''
  }

  if (!loaded) return <main className="state-page"><p>Loading your Recipe Lab…</p></main>
  return <div className="app-shell">
    <header className="app-header"><button type="button" className="brand" onClick={() => setSection('discover')}><span>R</span><b>Recipe Lab</b><small>Private kitchen</small></button><nav aria-label="Primary">{(['discover','library','plan','grocery'] as Section[]).map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item[0].toUpperCase() + item.slice(1)}{item === 'plan' && weekSlots.length ? <span>{weekSlots.length}</span> : null}</button>)}</nav><div className="privacy-note">Local only · no account</div></header>
    {storageError ? <div className="storage-banner" role="status">{storageError}</div> : null}

    {section === 'discover' ? <main className="discover-page"><section className="discover-intro"><div><p className="eyebrow">Find your next meal</p><h1>Recipes worth<br/><em>coming back to.</em></h1><p>Make a quick choice or skip for now. Passing never removes a recipe from your library.</p></div><aside><strong>{Object.keys(data.preferences).length}</strong><span>recipes reviewed</span><strong>{data.plan.length}</strong><span>meals scheduled</span></aside></section>
      <section className="discovery-stage" aria-labelledby="discover-title"><div className="discovery-card"><div className="discovery-visual"><span>{candidate.emoji}</span><p>{candidate.cuisine}</p></div><div className="discovery-copy"><div className="card-topline"><span>{candidate.category} · {formatMinutes(candidate.times.totalMinutes)}</span><span className={`status-pill ${preferenceFor(candidate.id).status ?? ''}`}>{preferenceLabel(preferenceFor(candidate.id).status)}</span></div><h2 id="discover-title">{candidate.title}</h2><p>{candidate.description}</p><div className="tags">{candidate.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><dl><div><dt>Planning default</dt><dd>{candidate.yield.planningServings.default} people</dd></div><div><dt>Source</dt><dd>{candidate.source.publisher}</dd></div></dl><div className="decision-grid"><button type="button" className="interest" onClick={() => actOnCandidate('interested')}>Interested</button><button type="button" onClick={() => actOnCandidate('saved')}>Save for later</button><button type="button" className="pass" onClick={() => actOnCandidate('passed')}>Pass</button><button type="button" className="not-now" onClick={() => actOnCandidate(null)}>Not now</button></div><div className="discovery-links"><button className="text-button" type="button" onClick={() => setDetail(candidate)}>Details and source</button><button className="text-button" type="button" disabled={!history.length} onClick={undo}>↶ Undo last choice</button></div></div></div></section>
    </main> : null}

    {section === 'library' ? <main className="content-page"><section className="page-heading"><div><p className="eyebrow">All recipes</p><h1>Your recipe library</h1><p>Every recipe stays discoverable, including anything you passed.</p></div><div className="backup-card"><strong>Your data</strong><span>{persistent ? 'Saved in this browser' : 'Temporary memory only'}</span><div><button type="button" onClick={exportBackup}>Export JSON</button><label className="button-label">Import JSON<input type="file" accept="application/json" onChange={importBackup}/></label></div>{backupMessage ? <small role="status">{backupMessage}</small> : null}</div></section><section className="browse-tools"><label><span className="sr-only">Search all recipes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes, ingredients, or cuisines…"/></label><div className="filter-row" aria-label="Recipe filters">{allTags.map((tag) => <button type="button" key={tag} className={filter === tag ? 'active' : ''} aria-pressed={filter === tag} onClick={() => setFilter(tag)}>{tag}</button>)}</div><p>{libraryRecipes.length} of {pilotRecipes.length} recipes</p></section>{libraryRecipes.length ? <section className="browse-grid">{libraryRecipes.map((recipe) => <BrowseCard key={recipe.id} recipe={recipe} preference={preferenceFor(recipe.id)} onStatus={(status) => setStatus(recipe.id, status)} onOpen={() => setDetail(recipe)}/>)}</section> : <section className="empty-state"><span>⌕</span><h2>No recipes match</h2><p>Try another search or clear the active filter.</p><button type="button" onClick={() => { setQuery(''); setFilter('All') }}>Clear filters</button></section>}</main> : null}

    {section === 'plan' ? <main className="content-page"><section className="page-heading compact"><div><p className="eyebrow">Weekly plan</p><h1>Make the week yours.</h1><p>Plans start empty. Add, repeat, swap, resize, or lock meals explicitly.</p></div><WeekNavigation weekStart={weekStart} onChange={setWeekStart}/></section>{weekSlots.length === 0 ? <div className="plan-empty"><span>7 days · 21 open slots</span><strong>Nothing planned yet — exactly as it should be.</strong><p>Choose a recipe in any slot below. Recipe Lab never fills your calendar for you.</p></div> : null}<section className="week-grid">{week.map((date) => <article className="day-column" key={date}><header><span>{friendlyDate(date,{weekday:'short'})}</span><strong>{friendlyDate(date,{month:'short',day:'numeric'})}</strong></header>{MEALS.map((meal) => { const slot = data.plan.find((item) => item.date === date && item.meal === meal); return <div className={`meal-slot ${slot ? 'filled' : ''}`} key={meal}><label>{meal}<select aria-label={`Choose ${meal} for ${friendlyDate(date)}`} value={slot?.recipeId ?? ''} disabled={slot?.locked} onChange={(event) => saveSlot(date, meal, event.target.value)}><option value="">Open slot</option>{pilotRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}</select></label>{slot ? <><div className="slot-meta"><label>People<input aria-label={`${meal} people for ${friendlyDate(date)}`} type="number" min="1" step="1" disabled={slot.locked} value={slot.servings} onChange={(event) => updateSlot(slot,{servings:Math.max(1,Number(event.target.value))})}/></label><button type="button" aria-pressed={slot.locked} onClick={() => setData((current) => ({ ...current, plan: toggleMealLock(current.plan, slot.id) }))}>{slot.locked ? 'Locked' : 'Lock'}</button><button type="button" disabled={slot.locked} aria-label={`Remove ${meal} for ${friendlyDate(date)}`} onClick={() => setData((current) => ({ ...current, plan: removeMealSlot(current.plan, slot.id) }))}>Remove</button></div></> : <small>Choose when you are ready.</small>}</div>})}</article>)}</section></main> : null}

    {section === 'grocery' ? <main className="content-page grocery-page"><section className="page-heading compact"><div><p className="eyebrow">Derived from your plan</p><h1>One weekly grocery list.</h1><p>{friendlyDate(weekStart,{month:'long',day:'numeric'})}–{friendlyDate(weekEnd,{month:'long',day:'numeric'})} · {weekSlots.length} scheduled meal{weekSlots.length === 1 ? '' : 's'} · no three-recipe cap</p></div><WeekNavigation weekStart={weekStart} onChange={setWeekStart}/></section>{weekSlots.length === 0 ? <section className="empty-state"><span>🧺</span><h2>Your list is waiting for a plan</h2><p>Add meals to this week and the normalized grocery list will appear here automatically.</p><button type="button" onClick={() => setSection('plan')}>Plan this week</button></section> : <><section className="grocery-toolbar"><label><input type="checkbox" checked={includeOptional} onChange={(event) => setIncludeOptional(event.target.checked)}/> Include {optionalCount} optional item{optionalCount === 1 ? '' : 's'}</label><p>Checking items never changes pantry quantities.</p></section><section className="cost-strip"><div><span>Priced-items checkout subtotal</span><strong>${checkout.toFixed(2)}</strong><small>Hypothetical fixtures only</small></div><div><span>Estimated consumed</span><strong>${consumed.toFixed(2)}</strong><small>Prorated hypothetical use</small></div><div><span>Unpriced or unresolved</span><strong>{groceryLines.filter((line) => !line.pricing).length}</strong><small>Never treated as $0</small></div></section><section className="integrated-grocery">{groceryLines.map((line) => { const key = groceryKey(line.canonicalIngredientId,line.variantId); const checked = data.checkedGroceries[key] ?? false; return <article key={key} className={`${line.unresolved ? 'unresolved' : ''} ${checked ? 'checked' : ''}`}><label className="grocery-check"><input type="checkbox" checked={checked} onChange={(event) => setData((current) => ({ ...current, checkedGroceries: { ...current.checkedGroceries, [key]: event.target.checked } }))}/><span><strong>{line.name}</strong><small>{line.variant}{line.optional ? ' · optional' : ''}</small></span></label><div className="line-total">{line.total ? `${formatAmount(line.total.amount)} ${line.total.unit}` : <>Needs judgment{line.knownSubtotal.amount ? <small>Known {formatAmount(line.knownSubtotal.amount)} {line.knownSubtotal.unit} + unresolved</small> : null}</>}</div><details><summary>{line.contributions.length} scheduled contribution{line.contributions.length === 1 ? '' : 's'}</summary><ul>{line.contributions.map((contribution) => <li key={`${contribution.selectionId}:${contribution.requirementId}`}><span>{contribution.label}</span><b>{contribution.amount === null ? contribution.note : `${formatAmount(contribution.amount)} ${contribution.unit}`}</b><small>{contribution.originalText}</small></li>)}</ul></details>{line.pricing ? <footer><span>{line.pricing.packages} package{line.pricing.packages === 1 ? '' : 's'} · ${line.pricing.estimatedCheckoutCost.toFixed(2)} checkout</span><span>{formatAmount(line.pricing.unused.amount)} {line.pricing.unused.unit} usable remainder</span></footer> : <footer>Cost unknown</footer>}</article>})}</section></>}</main> : null}

    <footer className="app-footer"><span>Recipe Lab · personal data stays in this browser</span><span>Private repository · no public deployment</span></footer>
    {detail ? <RecipeDetail recipe={detail} preference={preferenceFor(detail.id)} onPreference={(next) => updatePreference(detail.id,next)} onClose={() => setDetail(null)}/> : null}
  </div>
}

function WeekNavigation({ weekStart, onChange }: { weekStart: string; onChange: (week: string) => void }) {
  return <div className="week-navigation" aria-label="Week navigation"><button type="button" aria-label="Previous week" onClick={() => onChange(shiftWeek(weekStart,-1))}>←</button><div><span>Week of</span><strong>{friendlyDate(weekStart,{month:'long',day:'numeric',year:'numeric'})}</strong></div><button type="button" onClick={() => onChange(startOfWeek(todayIso()))}>Today</button><button type="button" aria-label="Next week" onClick={() => onChange(shiftWeek(weekStart,1))}>→</button></div>
}

export default App
