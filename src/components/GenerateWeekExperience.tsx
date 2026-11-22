import { useMemo, useState } from 'react'
import { canonicalIngredients } from '../data/pilotCatalog'
import { buildGenerateWeekPreviewRequest, previewCatalog, shiftIsoDate, type GenerateWeekMode, type MealKind, type MealOverride } from '../domain/generateWeekPreview'
import type { PantryAvailability } from '../domain/planningGroceryV3'
import type { PlanningRequest } from '../domain/generatorV3'
import { generateWeekDraft, type WeekDraft } from '../domain/weekGeneratorV3'
import { activePersonalRecipes, loadPersonalRecipeLibrary } from '../domain/personalRecipesV3'
import { PersonalRecipeForm } from './PersonalRecipeForm'
import type { PersonalDataV3 } from '../domain/personalDataV3'
import { exportAcceptedWeekPlanBackup, GENERATED_PLAN_ACCEPTANCE_ENABLED, reviewWeekDraftAcceptance, type AcceptanceReview } from '../domain/weekDraftAcceptanceV3'

const meals: MealKind[] = ['breakfast', 'lunch', 'dinner']
const friendly = (date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en-US', options).format(new Date(`${date}T12:00:00.000Z`))
const requirementKey = (date: string, meal: MealKind) => `${date}-${meal}`
const serviceLabel = (service: WeekDraft['meals'][number]['service']) => service === 'fresh' ? 'Fresh' : service === 'refrigerated-leftover' ? 'Leftover' : service === 'frozen-leftover' ? 'Frozen' : ''

type Result = { request: PlanningRequest; draft: WeekDraft }

export function GenerateWeekExperience({ weekStart, timeZone, pantry, onWeekChange, currentPersonalData }: { weekStart: string; timeZone: string; pantry: PantryAvailability[]; onWeekChange: (week: string) => void; currentPersonalData?: PersonalDataV3 }) {
  const [mode, setMode] = useState<GenerateWeekMode>('demo')
  const [includedMeals, setIncludedMeals] = useState<Record<MealKind, boolean>>({ breakfast: true, lunch: true, dinner: true })
  const [portions, setPortions] = useState<Record<MealKind, number>>({ breakfast: 2, lunch: 2, dinner: 2 })
  const [sundayPrep, setSundayPrep] = useState(true)
  const [officeLunches, setOfficeLunches] = useState(true)
  const [maxDinnerActiveMinutes, setMaxDinnerActiveMinutes] = useState(45)
  const [overrides, setOverrides] = useState<Record<string, MealOverride>>({})
  const [avoidedRecipeIds, setAvoidedRecipeIds] = useState<string[]>([])
  const [preferredRecipeIds, setPreferredRecipeIds] = useState<string[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acceptanceReview, setAcceptanceReview] = useState<AcceptanceReview | null>(null)
  const [personalLibrary, setPersonalLibrary] = useState(() => { try { return loadPersonalRecipeLibrary(window.localStorage) } catch { return loadPersonalRecipeLibrary(null) } })
  const personalRecipes = useMemo(() => activePersonalRecipes(personalLibrary), [personalLibrary])
  const catalog = useMemo(() => previewCatalog(mode, personalRecipes), [mode, personalRecipes])
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftIsoDate(weekStart, index)), [weekStart])

  const generate = (nextOverrides = overrides) => {
    setGenerating(true)
    setError(null)
    window.setTimeout(() => {
      try {
        const request = buildGenerateWeekPreviewRequest({ weekStart, timeZone, mode, includedMeals, portions, sundayPrep, maxDinnerActiveMinutes, officeLunches, avoidedRecipeIds, preferredRecipeIds, overrides: nextOverrides, pantry, personalRecipes })
        const draft = generateWeekDraft({ request, ingredients: canonicalIngredients, options: { maxSearchNodes: 12_000, maxOptionsPerRequirement: 8, maxCompleteSolutions: 6, maxRoutes: 900, maxPrepWindowsPerRoute: 1, maxStoredMealsPerBatch: 3 } })
        setResult({ request, draft })
        setAcceptanceReview(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The draft could not be generated.')
      } finally { setGenerating(false) }
    }, 0)
  }

  const updateMeal = (date: string, meal: MealKind, patch: MealOverride, regenerate = false) => {
    const key = requirementKey(date, meal)
    const next = { ...overrides, [key]: { ...overrides[key], ...patch } }
    setOverrides(next)
    if (regenerate) generate(next)
  }
  const visibleResult = result?.request.horizon.start === weekStart && result.request.requestId.includes(`-${mode}-`) ? result : null
  const recipeById = new Map((visibleResult?.request.recipeSnapshot ?? catalog.recipes).map((recipe) => [recipe.identity.recipeId, recipe]))
  const draft = visibleResult?.draft ?? null
  const planned = draft?.meals.filter(({ status }) => status === 'planned').length ?? 0
  const required = draft?.meals.filter(({ status }) => status !== 'skipped').length ?? 0
  const unresolvedLines = draft?.groceryDemand.lines.filter(({ unresolved }) => unresolved).length ?? 0
  const shoppingReady = Boolean(draft?.status === 'complete' && draft.shoppingReadiness.status === 'ready')
  const pantryApplied = draft?.groceryDemand.lines.reduce((sum, line) => sum + line.pantry.applied, 0) ?? 0
  const reviewAcceptance = () => {
    if (!visibleResult || !currentPersonalData) return
    setAcceptanceReview(reviewWeekDraftAcceptance({ mode, request: visibleResult.request, draft: visibleResult.draft, current: currentPersonalData, acceptedAt: new Date().toISOString() }))
  }
  const downloadAcceptanceBackup = () => {
    if (!acceptanceReview?.candidate) return
    const url = URL.createObjectURL(new Blob([exportAcceptedWeekPlanBackup(acceptanceReview.candidate)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `recipe-lab-generated-plan-${weekStart}.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  return <section className="generate-week" aria-labelledby="generate-week-title">
      <div className="generate-heading"><div><p className="eyebrow">Experimental v3 planner</p><h2 id="generate-week-title">Generate a draft week.</h2><p>Configure the essentials, then inspect every meal, cooking batch, leftover, and shopping uncertainty before anything is saved.</p></div><div className="mode-switch" aria-label="Recipe mode">{(['demo', 'real'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setResult(null); setOverrides({}); setAvoidedRecipeIds([]); setPreferredRecipeIds([]) }}>{value === 'demo' ? 'Interactive demo' : 'Real catalog'}</button>)}</div></div>

    <div className={`mode-disclosure ${mode}`} role="status"><strong>{catalog.label}</strong><span>{mode === 'demo' ? 'Clearly synthetic recipes demonstrate the real engine. They cannot be accepted as production recipes.' : `${catalog.productionEligibleCount} authorized production recipe${catalog.productionEligibleCount === 1 ? '' : 's'} plus ${catalog.personalEligibleCount ?? 0} browser-local personal recipe${catalog.personalEligibleCount === 1 ? '' : 's'}. No approval safeguards are bypassed.`}</span></div>
    {mode === 'real' ? <PersonalRecipeForm library={personalLibrary} onSaved={(next) => { setPersonalLibrary(next); setResult(null) }}/> : null}

    <div className="generate-config">
      <div className="config-week"><span>Week</span><button type="button" aria-label="Previous generator week" onClick={() => { setResult(null); setOverrides({}); onWeekChange(shiftIsoDate(weekStart, -7)) }}>←</button><strong>{friendly(weekStart, { month: 'short', day: 'numeric' })}–{friendly(dates[6], { month: 'short', day: 'numeric' })}</strong><button type="button" aria-label="Next generator week" onClick={() => { setResult(null); setOverrides({}); onWeekChange(shiftIsoDate(weekStart, 7)) }}>→</button></div>
      <fieldset><legend>Meals and portions</legend>{meals.map((meal) => <label key={meal}><input type="checkbox" checked={includedMeals[meal]} onChange={(event) => setIncludedMeals((current) => ({ ...current, [meal]: event.target.checked }))}/><span>{meal}</span><input aria-label={`${meal} default portions`} type="number" min="1" max="12" value={portions[meal]} onChange={(event) => setPortions((current) => ({ ...current, [meal]: Math.max(1, Number(event.target.value) || 1) }))}/></label>)}</fieldset>
      <fieldset><legend>Cooking defaults</legend><label><input type="checkbox" checked={sundayPrep} onChange={(event) => setSundayPrep(event.target.checked)}/><span>Sunday meal prep</span></label><label><input type="checkbox" checked={officeLunches} onChange={(event) => setOfficeLunches(event.target.checked)}/><span>Office-safe lunches</span></label><label><span>Dinner hands-on limit</span><select aria-label="Dinner hands-on limit" value={maxDinnerActiveMinutes} onChange={(event) => setMaxDinnerActiveMinutes(Number(event.target.value))}><option value="25">25 min</option><option value="45">45 min</option><option value="60">60 min</option></select></label></fieldset>
      <details><summary>Recipe preferences and avoidances</summary><div className="recipe-preference-grid">{catalog.recipes.map((recipe) => <div key={recipe.identity.recipeId}><strong>{recipe.identity.emoji} {recipe.identity.title}</strong><label><input type="checkbox" checked={preferredRecipeIds.includes(recipe.identity.recipeId)} onChange={(event) => setPreferredRecipeIds((current) => event.target.checked ? [...current, recipe.identity.recipeId] : current.filter((id) => id !== recipe.identity.recipeId))}/> Prefer</label><label><input type="checkbox" checked={avoidedRecipeIds.includes(recipe.identity.recipeId)} onChange={(event) => setAvoidedRecipeIds((current) => event.target.checked ? [...current, recipe.identity.recipeId] : current.filter((id) => id !== recipe.identity.recipeId))}/> Avoid</label></div>)}</div></details>
      <button type="button" className="primary generate-action" disabled={generating} onClick={() => generate()}>{generating ? 'Building a safe draft…' : draft ? 'Regenerate Draft Week' : 'Generate Draft Week'}</button>
    </div>

    {error ? <div className="v3-preview-alert danger" role="alert"><div><strong>Generation stopped safely</strong><span>{error}</span></div></div> : null}
    {draft ? <>
      <div className={`draft-summary ${draft.status}`} aria-label="Generated draft summary"><div><span>Meal coverage</span><strong>{planned}/{required}</strong></div><div><span>Dinner variety</span><strong>{draft.score.distinctDinners}</strong></div><div><span>Hands-on cooking</span><strong>{draft.score.activeCookingMinutes} min</strong></div><div><span>Shopping</span><strong>{shoppingReady ? 'Ready' : 'Review'}</strong></div><p>{draft.search.exhausted || draft.search.routeLimitReached ? `Best plan found within bounded search (${draft.search.nodesVisited.toLocaleString()} nodes).` : `Deterministic search evaluated ${draft.search.completeSolutionsEvaluated} complete solution${draft.search.completeSolutionsEvaluated === 1 ? '' : 's'}.`}</p></div>
      <div className={`shopping-readiness ${shoppingReady ? 'ready' : 'review'}`}><strong>{draft.status === 'complete' ? 'Meal plan complete' : 'Meal plan incomplete'}</strong><span>{shoppingReady ? 'Shopping quantities are consolidated and resolved.' : `${unresolvedLines} unresolved line${unresolvedLines === 1 ? '' : 's'} and ${draft.groceryDemand.uncertainties.length} shopping uncertaint${draft.groceryDemand.uncertainties.length === 1 ? 'y' : 'ies'} remain. Prices are not available in this v3 preview.`}</span></div>
      <section className="generated-week" aria-label="Generated meal calendar">{dates.map((date) => <article key={date}><header><span>{friendly(date, { weekday: 'short' })}</span><strong>{friendly(date, { month: 'short', day: 'numeric' })}</strong></header>{meals.map((meal) => {
        const item = draft.meals.find((candidate) => candidate.date === date && candidate.meal === meal)!
        const recipe = item.recipeId ? recipeById.get(item.recipeId) : null
        const override = overrides[requirementKey(date, meal)] ?? {}
        return <div className={`generated-meal ${item.status}`} key={meal}><div><span>{meal}</span>{override.lockedRecipeId ? <b>Locked</b> : item.service ? <b>{serviceLabel(item.service)}</b> : null}</div>{item.status === 'skipped' ? <><strong>Intentionally skipped</strong><button type="button" onClick={() => updateMeal(date, meal, { skipped: false }, true)}>Restore</button></> : item.status === 'unmet' ? <><strong>Unfilled</strong><small>{draft.unmetRequirements.find(({ mealRequirementId }) => mealRequirementId === item.mealRequirementId)?.blockers.slice(0, 2).map(({ code }) => code.replaceAll('-', ' ')).join(' · ') || 'No eligible route'}</small><button type="button" onClick={() => updateMeal(date, meal, { skipped: true }, true)}>Skip</button></> : <><strong>{recipe?.identity.emoji} {recipe?.identity.title}</strong><small>{item.requestedPortions} portion{item.requestedPortions === 1 ? '' : 's'} · {serviceLabel(item.service)}</small><div className="generated-actions"><button type="button" aria-pressed={Boolean(override.lockedRecipeId)} onClick={() => updateMeal(date, meal, { lockedRecipeId: override.lockedRecipeId ? null : item.recipeId })}>{override.lockedRecipeId ? 'Unlock' : 'Lock'}</button><button type="button" onClick={() => updateMeal(date, meal, { avoidRecipeIds: [...new Set([...(override.avoidRecipeIds ?? []), item.recipeId!])], lockedRecipeId: null }, true)}>Try another</button><button type="button" onClick={() => updateMeal(date, meal, { skipped: true, lockedRecipeId: null }, true)}>Skip</button></div></>}
          {item.status !== 'skipped' ? <label className="portion-edit">Portions <input aria-label={`${date} ${meal} portions`} type="number" min="1" max="12" value={override.portions ?? item.requestedPortions} onChange={(event) => updateMeal(date, meal, { portions: Math.max(1, Number(event.target.value) || 1) })}/></label> : null}</div>
      })}</article>)}</section>
      <div className="draft-details">
        <section><p className="eyebrow">Cooking schedule</p><h3>{draft.batches.length} actual batch{draft.batches.length === 1 ? '' : 'es'}</h3>{draft.selectedRoutes.filter(({ cookingStartsAt }) => cookingStartsAt).map((route) => <article key={route.routeId}><strong>{recipeById.get(route.recipeId)?.identity.title}</strong><span>{new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(route.cookingStartsAt!))} · {route.activeMinutes} min hands-on</span><small>Supplies {route.mealRequirementIds.length} meal{route.mealRequirementIds.length === 1 ? '' : 's'} · {route.pattern.replaceAll('-', ' ')}</small></article>)}</section>
        <section><p className="eyebrow">Consolidated grocery list</p><h3>{draft.groceryDemand.lines.length} ingredient line{draft.groceryDemand.lines.length === 1 ? '' : 's'}</h3>{draft.groceryDemand.lines.map((line) => <article className={line.unresolved ? 'unresolved' : ''} key={`${line.canonicalIngredientId}:${line.variantId}`}><strong>{line.name} · {line.variant}</strong><span>{line.pantry.toBuy === null ? `${line.pantry.knownToBuy} ${line.unit} known + unresolved` : `${line.pantry.toBuy} ${line.unit} to buy`}</span><small>{line.pantry.applied ? `${line.pantry.applied} ${line.unit} deducted from pantry · ` : ''}{line.contributions.length} batch contribution{line.contributions.length === 1 ? '' : 's'}</small></article>)}{pantryApplied ? <p className="pantry-credit">Pantry offsets are estimates only; nothing was consumed.</p> : null}</section>
      </div>
      <section className="why-plan"><div><p className="eyebrow">Why this draft</p><h3>Recommendations stay explainable.</h3><p>Completion and household acceptability come first, followed by dinner variety, practical batch reuse, effort, pantry reuse, and waste. Unknown preferences receive no bonus.</p></div><div>{draft.selectedRoutes.map((route) => <article key={route.routeId}><strong>{recipeById.get(route.recipeId)?.identity.title}</strong><span>{route.explanations.join(' ')}</span></article>)}{draft.rejectedAlternatives.length ? <details><summary>{draft.rejectedAlternatives.length} rejected or review-needed alternatives sampled</summary><ul>{[...new Set(draft.rejectedAlternatives.flatMap(({ reasons }) => reasons.map(({ message }) => message)))].slice(0, 8).map((message) => <li key={message}>{message}</li>)}</ul></details> : null}</div></section>
      {draft.unmetRequirements.length ? <section className="unmet-panel"><p className="eyebrow">Why slots remain open</p><h3>{draft.unmetRequirements.length} meal{draft.unmetRequirements.length === 1 ? '' : 's'} need a decision</h3><ul>{draft.unmetRequirements.map((item) => <li key={item.mealRequirementId}><strong>{item.mealRequirementId.replace('meal-requirement-', '').replaceAll('-', ' ')}</strong><span>{item.blockers.slice(0, 3).map(({ code, count }) => `${code.replaceAll('-', ' ')} (${count})`).join(' · ')}</span></li>)}</ul></section> : null}
      <section className="v3-conversion-card generated-acceptance-review" aria-labelledby="generated-acceptance-title">
        <div><p className="eyebrow">Acceptance safety review</p><h3 id="generated-acceptance-title">Inspect the exact proposed changes.</h3><p>The conversion preserves exact recipe revisions, selected ingredient branches, cooking events, allocations, and grocery provenance. Proposed cooking is never recorded as completed, and pantry stock is never consumed.</p></div>
        {!acceptanceReview ? <button type="button" onClick={reviewAcceptance} disabled={!currentPersonalData}>Review proposed acceptance</button> : <div className="v3-conversion-review">
          <dl><div><dt>Meals</dt><dd>{acceptanceReview.changes.meals} planned · {acceptanceReview.changes.skipped} skipped</dd></div><div><dt>Cooking</dt><dd>{acceptanceReview.changes.cookEvents} proposed events · {acceptanceReview.changes.batches} unprepared batches</dd></div><div><dt>Allocations</dt><dd>{acceptanceReview.changes.allocations} total · {acceptanceReview.changes.preparedLotReservations} prepared-food reservations</dd></div><div><dt>Base fingerprint</dt><dd>{acceptanceReview.baseFingerprint}</dd></div></dl>
          {acceptanceReview.blockers.length || acceptanceReview.warnings.length ? <ul>{[...acceptanceReview.blockers, ...acceptanceReview.warnings].map((issue) => <li key={`${issue.code}:${issue.entityIds.join(':')}`}><strong>{issue.code.replaceAll('-', ' ')}</strong><span>{issue.message}</span></li>)}</ul> : <p role="status">The proposal passed the pure conversion review.</p>}
          <div><button type="button" onClick={() => setAcceptanceReview(null)}>Close review</button>{acceptanceReview.candidate ? <button type="button" onClick={downloadAcceptanceBackup}>Download proposed-plan backup</button> : null}<button type="button" className="primary" disabled={!GENERATED_PLAN_ACCEPTANCE_ENABLED}>Accept generated week</button></div>
          <p className="v3-commit-message">Acceptance remains disabled pending explicit owner authorization. This review does not write personal data.</p>
        </div>}
      </section>
    </> : <div className="generate-empty"><span>Ready when you are</span><h3>No draft has been generated.</h3><p>The interactive demo can produce a full week. Real-catalog mode stays partial until authorized recipe revisions pass every readiness gate.</p></div>}
  </section>
}
