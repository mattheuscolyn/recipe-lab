import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { DiscoveryDeck } from './components/DiscoveryDeck'
import { RecipePickerDialog, ScheduleRecipeDialog, type MealName } from './components/PlannerDialogs'
import { canonicalIngredients, packageOffers, pilotRecipes } from './data/pilotCatalog'
import type { RecipeV2 } from './domain/catalog'
import { buildGroceryList } from './domain/grocery'
import { removeMealSlot, shiftWeek, startOfWeek, toggleMealLock, upsertMealSlot, weekDates } from './domain/mealPlan'
import { emptyPreference, exportPersonalData, importPersonalData, type MealSlot, type PreferenceStatus, type RecipePreference } from './domain/personalData'
import { formatAmount } from './domain/units'
import { usePersonalData } from './hooks/usePersonalData'

type Section = 'discover' | 'library' | 'plan' | 'grocery'
type HistoryEntry = { recipeId: string; previous: RecipePreference | undefined; index: number; wasDeferred: boolean; reviewQueue: string[] | null }
const MEALS = ['Breakfast', 'Lunch', 'Dinner'] as const
const ingredientNames = new Map(canonicalIngredients.map((ingredient) => [ingredient.id, ingredient.displayName]))
const recipeMap = new Map(pilotRecipes.map((recipe) => [recipe.id, recipe]))
const knownRecipeIds = new Set(recipeMap.keys())
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

function RecipeDetail({ recipe, preference, onPreference, onSchedule, onClose, returnFocus }: { recipe: RecipeV2; preference: RecipePreference; onPreference: (next: RecipePreference) => void; onSchedule: () => void; onClose: () => void; returnFocus: HTMLElement | null }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const handleKeyDown = (event: KeyboardEvent) => {
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
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', containFocus)
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', containFocus)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [onClose, returnFocus])

  return <div className="detail-backdrop" role="presentation" onMouseDown={onClose}><section ref={dialogRef} tabIndex={-1} className="recipe-detail" role="dialog" aria-modal="true" aria-labelledby="recipe-title" onMouseDown={(event) => event.stopPropagation()}>
    <button ref={closeRef} className="close-button" type="button" onClick={onClose} aria-label="Close recipe">×</button>
    <div className="detail-heading"><span className="detail-emoji" aria-hidden="true">{recipe.emoji}</span><div><p className="eyebrow">{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</p><h2 id="recipe-title">{recipe.title}</h2><p>{recipe.description}</p><button className="schedule-inline" type="button" onClick={onSchedule}>＋ Add to weekly plan</button></div></div>
    <div className="personal-panel"><div><p className="eyebrow">Your recipe</p><PreferenceButtons preference={preference} onStatus={(status) => onPreference({ ...preference, status })} /></div><label>Personal rating<select aria-label="Personal rating" value={preference.personalRating ?? ''} onChange={(event) => onPreference({ ...preference, personalRating: event.target.value ? Number(event.target.value) : null })}><option value="">Not rated</option>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label><label className="check-label"><input type="checkbox" checked={preference.cooked} onChange={(event) => onPreference({ ...preference, cooked: event.target.checked })}/> Cooked</label><label className="notes-label">Personal notes<textarea value={preference.note} onChange={(event) => onPreference({ ...preference, note: event.target.value })} placeholder="What would you change next time?"/></label></div>
    <p className="planning-note"><strong>Source yield:</strong> {recipe.yield.source.label}. <strong>Planning default:</strong> {recipe.yield.planningServings.default} people{recipe.yield.planningServings.assumption ? ` — ${recipe.yield.planningServings.assumption}` : ''}</p>
    <div className="detail-grid"><div><h3>Source ingredient facts</h3><ul className="ingredients">{recipe.requirements.map((line) => <li key={line.id}><strong>{line.originalText}</strong><small>{ingredientNames.get(line.canonicalIngredientId)} · {line.confidence}{line.optional ? ' · optional' : ''}{line.quantity?.approximate ? ' · approximate' : ''}</small></li>)}</ul></div><div><h3>Independent method summary</h3><ol className="steps">{recipe.methodSummary.map((step, index) => <li key={index}>{step}</li>)}</ol></div></div>
    <aside className="source-note">Source reviewed, not kitchen-tested. <a href={recipe.source.url} target="_blank" rel="noreferrer">Open the original at {recipe.source.publisher}</a>. Checked {recipe.source.checkedAt}.</aside>
  </section></div>
}

function BrowseCard({ recipe, preference, onStatus, onOpen, onSchedule }: { recipe: RecipeV2; preference: RecipePreference; onStatus: (status: PreferenceStatus) => void; onOpen: (opener: HTMLButtonElement) => void; onSchedule: (opener: HTMLButtonElement) => void }) {
  return <article className="browse-card">
    <div className="card-topline"><span className="recipe-emoji" aria-hidden="true">{recipe.emoji}</span><span className={`status-pill ${preference.status ?? ''}`}>{preferenceLabel(preference.status)}</span></div>
    <p className="card-kicker">{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</p><h3>{recipe.title}</h3><p>{recipe.description}</p>
    <div className="tags">{recipe.tags.slice(0,3).map((tag) => <span key={tag}>{tag}</span>)}</div>
    <PreferenceButtons preference={preference} onStatus={onStatus}/><div className="browse-card-links"><button className="text-button" type="button" onClick={(event) => onOpen(event.currentTarget)}>Recipe details and source →</button><button className="text-button plan-link" type="button" onClick={(event) => onSchedule(event.currentTarget)}>＋ Add to plan</button></div>
  </article>
}

function App() {
  const { data, setData, replaceData, storageError, recoveryBackup, loaded, persistent } = usePersonalData(knownRecipeIds)
  const [section, setSection] = useState<Section>('discover')
  const [detail, setDetail] = useState<RecipeV2 | null>(null)
  const [detailOpener, setDetailOpener] = useState<HTMLElement | null>(null)
  const [discoverIndex, setDiscoverIndex] = useState(() => Math.max(0, pilotRecipes.findIndex(({ id }) => !data.preferences[id]?.status)))
  const [discoverComplete, setDiscoverComplete] = useState(() => pilotRecipes.every(({ id }) => Boolean(data.preferences[id]?.status)))
  const [deferredIds, setDeferredIds] = useState<Set<string>>(() => new Set())
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()))
  const [includeOptional, setIncludeOptional] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [scheduleTarget, setScheduleTarget] = useState<{ recipe: RecipeV2; returnFocus: HTMLElement | null } | null>(null)
  const [pickerTarget, setPickerTarget] = useState<{ date: string; meal: MealName; slot: MealSlot | undefined; returnFocus: HTMLElement } | null>(null)
  const [scheduleNotice, setScheduleNotice] = useState<{ message: string; weekStart: string } | null>(null)
  const scheduleNoticeActionRef = useRef<HTMLButtonElement>(null)
  const week = useMemo(() => weekDates(weekStart), [weekStart])
  const weekEnd = week[6]
  const weekSlots = useMemo(() => data.plan.filter(({ date }) => date >= weekStart && date <= weekEnd), [data.plan, weekStart, weekEnd])
  const candidate = discoverComplete ? null : reviewQueue ? recipeMap.get(reviewQueue[0]) ?? null : pilotRecipes[discoverIndex % pilotRecipes.length]
  const reviewedCount = useMemo(() => pilotRecipes.filter(({ id }) => Boolean(data.preferences[id]?.status)).length, [data.preferences])
  const discoveryRemaining = useMemo(() => reviewQueue?.length ?? pilotRecipes.filter(({ id }) => !data.preferences[id]?.status && !deferredIds.has(id)).length, [data.preferences, deferredIds, reviewQueue])
  const previewRecipes = useMemo(() => {
    if (!candidate) return []
    if (reviewQueue) return reviewQueue.slice(1, 3).map((id) => recipeMap.get(id)).filter((recipe): recipe is RecipeV2 => Boolean(recipe))
    return Array.from({ length: pilotRecipes.length - 1 }, (_, index) => pilotRecipes[(discoverIndex + index + 1) % pilotRecipes.length])
      .filter(({ id }) => !data.preferences[id]?.status && !deferredIds.has(id) && id !== candidate.id)
      .slice(0, 2)
  }, [candidate, data.preferences, deferredIds, discoverIndex, reviewQueue])
  const completionUndoRef = useRef<HTMLButtonElement>(null)
  const preferenceFor = (recipeId: string) => data.preferences[recipeId] ?? emptyPreference()
  const openDetail = (recipe: RecipeV2, opener: HTMLElement) => { setDetailOpener(opener); setDetail(recipe) }
  const closeDetail = useCallback(() => setDetail(null), [])
  const openScheduler = (recipe: RecipeV2, opener: HTMLElement | null) => setScheduleTarget({ recipe, returnFocus: opener })
  const scheduleFromDetail = (recipe: RecipeV2) => { const opener = detailOpener; setDetail(null); openScheduler(recipe, opener) }

  const updatePreference = (recipeId: string, next: RecipePreference) => setData((current) => ({ ...current, preferences: { ...current.preferences, [recipeId]: next } }))
  const setStatus = (recipeId: string, status: PreferenceStatus) => updatePreference(recipeId, { ...preferenceFor(recipeId), status })
  const actOnCandidate = (status: PreferenceStatus | null) => {
    if (!candidate) return
    setHistory((current) => [...current, { recipeId: candidate.id, previous: data.preferences[candidate.id], index: discoverIndex, wasDeferred: deferredIds.has(candidate.id), reviewQueue: reviewQueue ? [...reviewQueue] : null }])
    if (reviewQueue) {
      if (status) setStatus(candidate.id, status)
      const remaining = reviewQueue.slice(1)
      if (remaining.length) setReviewQueue(remaining)
      else { setReviewQueue(null); setDiscoverComplete(true) }
      return
    }
    const excluded = new Set(deferredIds)
    excluded.add(candidate.id)
    if (!status) setDeferredIds(excluded)
    if (status) setStatus(candidate.id, status)
    const nextOffset = Array.from({ length: pilotRecipes.length - 1 }, (_, index) => index + 1).find((offset) => {
      const recipe = pilotRecipes[(discoverIndex + offset) % pilotRecipes.length]
      return !data.preferences[recipe.id]?.status && !excluded.has(recipe.id)
    })
    if (nextOffset) setDiscoverIndex((discoverIndex + nextOffset) % pilotRecipes.length)
    else setDiscoverComplete(true)
  }
  const undo = () => {
    const entry = history.at(-1)
    if (!entry) return
    setData((current) => { const preferences = { ...current.preferences }; if (entry.previous) preferences[entry.recipeId] = entry.previous; else delete preferences[entry.recipeId]; return { ...current, preferences } })
    setDeferredIds((current) => { const next = new Set(current); if (entry.wasDeferred) next.add(entry.recipeId); else next.delete(entry.recipeId); return next })
    setDiscoverIndex(entry.index); setReviewQueue(entry.reviewQueue ? [...entry.reviewQueue] : null); setDiscoverComplete(false); setHistory((current) => current.slice(0, -1))
  }
  const revisitDiscovery = () => {
    const deferredIndex = pilotRecipes.findIndex(({ id }) => deferredIds.has(id))
    if (deferredIndex >= 0) {
      setDiscoverIndex(deferredIndex)
      setDeferredIds(new Set())
      setReviewQueue(null)
    } else {
      setDiscoverIndex(0)
      setReviewQueue(pilotRecipes.map(({ id }) => id))
    }
    setDiscoverComplete(false)
  }

  useEffect(() => {
    if (!discoverComplete || !history.length || section !== 'discover') return
    const frame = window.requestAnimationFrame(() => completionUndoRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [discoverComplete, history.length, section])

  useEffect(() => {
    if (!scheduleNotice) return
    const frame = window.requestAnimationFrame(() => scheduleNoticeActionRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [scheduleNotice])

  const allTags = useMemo(() => ['All', 'Breakfast', 'Lunch', 'Dinner', 'Vegetarian', 'Vegan', 'Interested', 'Saved', 'Cooked'], [])
  const libraryRecipes = useMemo(() => pilotRecipes.filter((recipe) => {
    const text = [recipe.title, recipe.description, recipe.cuisine, recipe.source.publisher, ...recipe.tags, ...recipe.requirements.map((line) => ingredientNames.get(line.canonicalIngredientId) ?? '')].join(' ').toLowerCase()
    const preference = data.preferences[recipe.id] ?? emptyPreference()
    const matchesFilter = filter === 'All' || recipe.category === filter || recipe.tags.includes(filter) || (filter === 'Interested' && preference.status === 'interested') || (filter === 'Saved' && preference.status === 'saved') || (filter === 'Cooked' && preference.cooked)
    return matchesFilter && text.includes(query.trim().toLowerCase())
  }), [data.preferences, filter, query])

  const updateSlot = (slot: MealSlot, patch: Partial<MealSlot>) => setData((current) => ({ ...current, plan: upsertMealSlot(current.plan, { ...slot, ...patch }) }))
  const placeRecipe = (recipe: RecipeV2, date: string, meal: MealName, servings: number) => {
    const existing = data.plan.find((slot) => slot.date === date && slot.meal === meal)
    if (existing?.locked) return
    const slot: MealSlot = { id: existing?.id ?? `${date}-${meal.toLowerCase()}`, date, meal, recipeId: recipe.id, servings, locked: false }
    setData((current) => ({ ...current, plan: upsertMealSlot(current.plan, slot) }))
    const targetWeek = startOfWeek(date)
    setWeekStart(targetWeek)
    setScheduleNotice({ message: `${recipe.title} scheduled for ${friendlyDate(date)} ${meal} · ${servings} serving${servings === 1 ? '' : 's'}.`, weekStart: targetWeek })
    setScheduleTarget(null)
  }
  const chooseForSlot = (recipe: RecipeV2) => {
    if (!pickerTarget || pickerTarget.slot?.locked) return
    const servings = pickerTarget.slot?.recipeId === recipe.id ? pickerTarget.slot.servings : recipe.yield.planningServings.default
    placeRecipe(recipe, pickerTarget.date, pickerTarget.meal, servings)
    setPickerTarget(null)
  }

  const groceryLines = useMemo(() => buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, weekSlots.map((slot) => ({ recipeId: slot.recipeId, servings: slot.servings, selectionId: slot.id, label: `${friendlyDate(slot.date)} ${slot.meal} · ${recipeMap.get(slot.recipeId)?.title}` })), { includeOptional }), [weekSlots, includeOptional])
  const checkout = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedCheckoutCost ?? 0), 0)
  const consumed = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedConsumptionCost ?? 0), 0)
  const optionalCount = weekSlots.reduce((count, slot) => count + (recipeMap.get(slot.recipeId)?.requirements.filter(({ optional }) => optional).length ?? 0), 0)
  const groceryKey = (ingredientId: string, variantId: string) => `${weekStart}:${ingredientId}:${variantId}`

  const downloadBackup = (contents: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
  }
  const exportBackup = () => { downloadBackup(exportPersonalData(data), `recipe-lab-backup-${todayIso()}.json`); setBackupMessage('Current personal data exported.') }
  const exportRecoveryBackup = () => { if (recoveryBackup) { downloadBackup(recoveryBackup, `recipe-lab-recovery-${todayIso()}.json`); setBackupMessage('Original recovery backup exported.') } }
  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const imported = importPersonalData(await file.text(), knownRecipeIds)
      const result = replaceData(imported)
      setBackupMessage(result.persisted ? 'Backup imported and persisted to this browser.' : 'Backup imported into temporary memory only. Export JSON now to keep a recoverable copy.')
    } catch (error) { setBackupMessage(error instanceof Error ? error.message : 'Backup import failed. Existing personal data was not changed.') }
    event.target.value = ''
  }

  if (!loaded) return <main className="state-page"><p>Loading your Recipe Lab…</p></main>
  return <div className="app-shell">
    <header className="app-header"><button type="button" className="brand" onClick={() => setSection('discover')}><span>R</span><b>Recipe Lab</b><small>Private kitchen</small></button><nav aria-label="Primary">{(['discover','library','plan','grocery'] as Section[]).map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item[0].toUpperCase() + item.slice(1)}{item === 'plan' && weekSlots.length ? <span>{weekSlots.length}</span> : null}</button>)}</nav><div className="privacy-note">Local only · no account</div></header>
    {storageError || recoveryBackup ? <div className="storage-banner" role="status"><span>{storageError}</span>{recoveryBackup ? <button type="button" onClick={exportRecoveryBackup}>Export recovery backup</button> : null}</div> : null}

    {section === 'discover' ? <main className="discover-page"><section className="discover-intro"><div><p className="eyebrow">Find your next meal</p><h1>Recipes worth<br/><em>coming back to.</em></h1><p>Swipe, use the arrow keys, or choose a button. Passing never removes a recipe from your library.</p></div><aside><strong>{reviewedCount}</strong><span>recipes reviewed</span><strong>{data.plan.length}</strong><span>meals scheduled</span></aside></section>
      <section className="discovery-stage" aria-labelledby="discover-title">{candidate ? <DiscoveryDeck recipe={candidate} previewRecipes={previewRecipes} preference={preferenceFor(candidate.id)} remaining={discoveryRemaining} reviewed={reviewedCount} total={pilotRecipes.length} canUndo={Boolean(history.length)} formatMinutes={formatMinutes} preferenceLabel={preferenceLabel} onDecision={actOnCandidate} onOpen={(opener) => openDetail(candidate, opener)} onSchedule={(opener) => openScheduler(candidate, opener)} onUndo={undo}/> : <div className="empty-state discovery-complete"><span>✓</span><h2 id="discover-title">You reached the end for now.</h2><p>{deferredIds.size ? `${deferredIds.size} deferred recipe${deferredIds.size === 1 ? '' : 's'} can be revisited without changing your saved choices.` : 'Every recipe has a saved choice. You can review them again or browse the complete library.'}</p><div>{history.length ? <button ref={completionUndoRef} type="button" onClick={undo}>↶ Undo last choice</button> : null}<button type="button" onClick={revisitDiscovery}>{deferredIds.size ? 'Revisit deferred recipes' : 'Review choices again'}</button><button type="button" onClick={() => setSection('library')}>Browse all recipes</button></div></div>}</section>
    </main> : null}

    {section === 'library' ? <main className="content-page"><section className="page-heading"><div><p className="eyebrow">All recipes</p><h1>Your recipe library</h1><p>Every recipe stays discoverable, including anything you passed.</p></div><div className="backup-card"><strong>Your data</strong><span>{persistent ? 'Saved in this browser' : 'Temporary memory only — export to keep a copy'}</span><div><button type="button" onClick={exportBackup}>Export JSON</button><label className="button-label">Import JSON<input type="file" accept="application/json" onChange={importBackup}/></label></div>{backupMessage ? <small role="status">{backupMessage}</small> : null}</div></section><section className="browse-tools"><label><span className="sr-only">Search all recipes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes, ingredients, or cuisines…"/></label><div className="filter-row" aria-label="Recipe filters">{allTags.map((tag) => <button type="button" key={tag} className={filter === tag ? 'active' : ''} aria-pressed={filter === tag} onClick={() => setFilter(tag)}>{tag}</button>)}</div><p>{libraryRecipes.length} of {pilotRecipes.length} recipes</p></section>{libraryRecipes.length ? <section className="browse-grid">{libraryRecipes.map((recipe) => <BrowseCard key={recipe.id} recipe={recipe} preference={preferenceFor(recipe.id)} onStatus={(status) => setStatus(recipe.id, status)} onOpen={(opener) => openDetail(recipe, opener)} onSchedule={(opener) => openScheduler(recipe, opener)}/>)}</section> : <section className="empty-state"><span>⌕</span><h2>No recipes match</h2><p>Try another search or clear the active filter.</p><button type="button" onClick={() => { setQuery(''); setFilter('All') }}>Clear filters</button></section>}</main> : null}

    {section === 'plan' ? <main className="content-page"><section className="page-heading compact"><div><p className="eyebrow">Weekly plan</p><h1>Make the week yours.</h1><p>Scan the week, then add, swap, resize, or lock meals explicitly.</p></div><WeekNavigation weekStart={weekStart} onChange={setWeekStart}/></section>{weekSlots.length === 0 ? <div className="plan-empty"><span>7 days · 21 open slots</span><strong>Nothing planned yet — exactly as it should be.</strong><p>Choose a slot and search the complete recipe collection. Recipe Lab never fills your calendar for you.</p></div> : null}<section className="week-grid">{week.map((date) => <article className="day-column" key={date}><header><span>{friendlyDate(date,{weekday:'short'})}</span><strong>{friendlyDate(date,{month:'short',day:'numeric'})}</strong></header>{MEALS.map((meal) => { const slot = data.plan.find((item) => item.date === date && item.meal === meal); const recipe = slot ? recipeMap.get(slot.recipeId) : null; return <div className={`meal-slot ${slot ? 'filled' : ''}`} key={meal}><div className="slot-heading"><span>{meal}</span>{slot?.locked ? <b>Locked</b> : null}</div>{slot && recipe ? <><strong className="slot-recipe">{recipe.emoji} {recipe.title}</strong><small>{slot.servings} serving{slot.servings === 1 ? '' : 's'}</small><div className="slot-meta"><label>People<input aria-label={`${meal} people for ${friendlyDate(date)}`} type="number" min="1" step="1" disabled={slot.locked} value={slot.servings} onChange={(event) => updateSlot(slot,{servings:Math.max(1,Number(event.target.value))})}/></label><button type="button" disabled={slot.locked} aria-label={`Swap recipe for ${friendlyDate(date)} ${meal}`} onClick={(event) => setPickerTarget({ date, meal, slot, returnFocus: event.currentTarget })}>Swap</button><button type="button" aria-pressed={slot.locked} onClick={() => setData((current) => ({ ...current, plan: toggleMealLock(current.plan, slot.id) }))}>{slot.locked ? 'Unlock' : 'Lock'}</button><button type="button" disabled={slot.locked} aria-label={`Remove ${meal} for ${friendlyDate(date)}`} onClick={() => setData((current) => ({ ...current, plan: removeMealSlot(current.plan, slot.id) }))}>Remove</button></div></> : <><button type="button" className="empty-slot-button" aria-label={`Choose recipe for ${friendlyDate(date)} ${meal}`} onClick={(event) => setPickerTarget({ date, meal, slot: undefined, returnFocus: event.currentTarget })}>＋ Choose recipe</button><small>Open slot</small></>}</div>})}</article>)}</section></main> : null}

    {section === 'grocery' ? <main className="content-page grocery-page"><section className="page-heading compact"><div><p className="eyebrow">Derived from your plan</p><h1>One weekly grocery list.</h1><p>{friendlyDate(weekStart,{month:'long',day:'numeric'})}–{friendlyDate(weekEnd,{month:'long',day:'numeric'})} · {weekSlots.length} scheduled meal{weekSlots.length === 1 ? '' : 's'} · no three-recipe cap</p></div><WeekNavigation weekStart={weekStart} onChange={setWeekStart}/></section>{weekSlots.length === 0 ? <section className="empty-state"><span>🧺</span><h2>Your list is waiting for a plan</h2><p>Add meals to this week and the normalized grocery list will appear here automatically.</p><button type="button" onClick={() => setSection('plan')}>Plan this week</button></section> : <><section className="grocery-toolbar"><label><input type="checkbox" checked={includeOptional} onChange={(event) => setIncludeOptional(event.target.checked)}/> Include {optionalCount} optional item{optionalCount === 1 ? '' : 's'}</label><p>Checking items never changes pantry quantities.</p></section><section className="cost-strip"><div><span>Priced-items checkout subtotal</span><strong>${checkout.toFixed(2)}</strong><small>Hypothetical fixtures only</small></div><div><span>Estimated consumed</span><strong>${consumed.toFixed(2)}</strong><small>Prorated hypothetical use</small></div><div><span>Unpriced or unresolved</span><strong>{groceryLines.filter((line) => !line.pricing).length}</strong><small>Never treated as $0</small></div></section><section className="integrated-grocery">{groceryLines.map((line) => { const key = groceryKey(line.canonicalIngredientId,line.variantId); const checked = data.checkedGroceries[key] ?? false; return <article key={key} className={`${line.unresolved ? 'unresolved' : ''} ${checked ? 'checked' : ''}`}><label className="grocery-check"><input type="checkbox" checked={checked} onChange={(event) => setData((current) => ({ ...current, checkedGroceries: { ...current.checkedGroceries, [key]: event.target.checked } }))}/><span><strong>{line.name}</strong><small>{line.variant}{line.optional ? ' · optional' : ''}</small></span></label><div className="line-total">{line.total ? `${formatAmount(line.total.amount)} ${line.total.unit}` : <>Needs judgment{line.knownSubtotal.amount ? <small>Known {formatAmount(line.knownSubtotal.amount)} {line.knownSubtotal.unit} + unresolved</small> : null}</>}</div><details><summary>{line.contributions.length} scheduled contribution{line.contributions.length === 1 ? '' : 's'}</summary><ul>{line.contributions.map((contribution) => <li key={`${contribution.selectionId}:${contribution.requirementId}`}><span>{contribution.label}</span><b>{contribution.amount === null ? contribution.note : `${formatAmount(contribution.amount)} ${contribution.unit}`}</b><small>{contribution.originalText}</small></li>)}</ul></details>{line.pricing ? <footer><span>{line.pricing.packages} package{line.pricing.packages === 1 ? '' : 's'} · ${line.pricing.estimatedCheckoutCost.toFixed(2)} checkout</span><span>{formatAmount(line.pricing.unused.amount)} {line.pricing.unused.unit} usable remainder</span></footer> : <footer>Cost unknown</footer>}</article>})}</section></>}</main> : null}

    {scheduleNotice ? <div className="schedule-toast" role="status"><span>{scheduleNotice.message}</span><button ref={scheduleNoticeActionRef} type="button" onClick={() => { setWeekStart(scheduleNotice.weekStart); setSection('plan'); setScheduleNotice(null) }}>View week</button><button type="button" aria-label="Dismiss scheduling confirmation" onClick={() => setScheduleNotice(null)}>×</button></div> : null}
    <footer className="app-footer"><span>Recipe Lab · personal data stays in this browser</span><span>Public prototype · source rights not cleared</span></footer>
    {detail ? <RecipeDetail recipe={detail} preference={preferenceFor(detail.id)} onPreference={(next) => updatePreference(detail.id,next)} onSchedule={() => scheduleFromDetail(detail)} onClose={closeDetail} returnFocus={detailOpener}/> : null}
    {scheduleTarget ? <ScheduleRecipeDialog recipe={scheduleTarget.recipe} selectedWeek={weekStart} plan={data.plan} recipeTitles={new Map(pilotRecipes.map(({ id, title }) => [id, title]))} returnFocus={scheduleTarget.returnFocus} onClose={() => setScheduleTarget(null)} onSchedule={(date, meal, servings) => placeRecipe(scheduleTarget.recipe, date, meal, servings)}/> : null}
    {pickerTarget ? <RecipePickerDialog date={pickerTarget.date} meal={pickerTarget.meal} existing={pickerTarget.slot} recipes={pilotRecipes} preferences={data.preferences} returnFocus={pickerTarget.returnFocus} onClose={() => setPickerTarget(null)} onChoose={chooseForSlot}/> : null}
  </div>
}

function WeekNavigation({ weekStart, onChange }: { weekStart: string; onChange: (week: string) => void }) {
  return <div className="week-navigation" aria-label="Week navigation"><button type="button" aria-label="Previous week" onClick={() => onChange(shiftWeek(weekStart,-1))}>←</button><div><span>Week of</span><strong>{friendlyDate(weekStart,{month:'long',day:'numeric',year:'numeric'})}</strong></div><button type="button" onClick={() => onChange(startOfWeek(todayIso()))}>Today</button><button type="button" aria-label="Next week" onClick={() => onChange(shiftWeek(weekStart,1))}>→</button></div>
}

export default App
