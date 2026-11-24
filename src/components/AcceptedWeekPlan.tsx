import { useMemo, useState } from 'react'
import type { AcceptedWeekPlanEnvelope } from '../domain/weekDraftAcceptanceV3'

const CHECKS_KEY = 'recipe-lab.generated-grocery-checks.v1'
const meals = ['breakfast', 'lunch', 'dinner'] as const
const friendly = (date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en-US', options).format(new Date(`${date}T12:00:00.000Z`))

function readChecks(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHECKS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, boolean> : {}
  } catch { return {} }
}

function keyFor(envelope: AcceptedWeekPlanEnvelope, ingredientId: string, variantId: string) {
  return `${envelope.current.request.horizon.start}:${ingredientId}:${variantId}`
}

export function AcceptedWeekCalendar({ envelope }: { envelope: AcceptedWeekPlanEnvelope }) {
  const plan = envelope.current
  const recipes = useMemo(() => new Map(plan.request.recipeSnapshot.map((recipe) => [recipe.identity.recipeId, recipe])), [plan.request.recipeSnapshot])
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${plan.request.horizon.start}T12:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  }), [plan.request.horizon.start])
  return <section className="accepted-plan" aria-labelledby="accepted-plan-title">
    <header className="accepted-plan-heading"><div><p className="eyebrow">Your saved week</p><h2 id="accepted-plan-title">{friendly(plan.request.horizon.start, { month: 'long', day: 'numeric' })}–{friendly(plan.request.horizon.end, { month: 'long', day: 'numeric', year: 'numeric' })}</h2><p>{plan.draft.status === 'complete' ? 'Every requested meal is covered.' : `${plan.draft.unmetRequirements.length} meal${plan.draft.unmetRequirements.length === 1 ? '' : 's'} remain open.`} Saved locally on {new Date(plan.acceptedAt).toLocaleString()}.</p></div><span className={`saved-status ${plan.draft.status}`}>{plan.draft.status === 'complete' ? 'Complete plan' : 'Partial plan'}</span></header>
    <div className="generated-week accepted-calendar">{dates.map((date) => <article key={date}><header><span>{friendly(date, { weekday: 'short' })}</span><strong>{friendly(date, { month: 'short', day: 'numeric' })}</strong></header>{meals.map((meal) => {
      const item = plan.draft.meals.find((candidate) => candidate.date === date && candidate.meal === meal)
      const recipe = item?.recipeId ? recipes.get(item.recipeId) : null
      return <div className={`generated-meal ${item?.status ?? 'unmet'}`} key={meal}><div><span>{meal}</span>{item?.service ? <b>{item.service === 'fresh' ? 'Fresh' : 'Leftover'}</b> : null}</div>{item?.status === 'planned' ? <><strong>{recipe?.identity.emoji} {recipe?.identity.title ?? 'Saved recipe'}</strong><small>{item.requestedPortions} portion{item.requestedPortions === 1 ? '' : 's'}</small></> : item?.status === 'skipped' ? <strong>Intentionally skipped</strong> : <><strong>Open meal</strong><small>Generate again or leave this slot open.</small></>}</div>
    })}</article>)}</div>
    {plan.draft.shoppingReadiness.status !== 'ready' ? <p className="accepted-warning" role="status"><strong>Shopping review needed.</strong> Known quantities are saved, but {plan.draft.shoppingReadiness.unresolvedLineCount} ingredient line{plan.draft.shoppingReadiness.unresolvedLineCount === 1 ? '' : 's'} still need confirmation.</p> : null}
  </section>
}

export function AcceptedWeekGrocery({ envelope }: { envelope: AcceptedWeekPlanEnvelope }) {
  const [checks, setChecks] = useState(readChecks)
  const toggle = (key: string, checked: boolean) => {
    const next = { ...checks, [key]: checked }
    setChecks(next)
    try { window.localStorage.setItem(CHECKS_KEY, JSON.stringify(next)) } catch { /* keep the current session usable */ }
  }
  const demand = envelope.current.groceryProvenance.demand
  return <section className="accepted-grocery" aria-label="Saved plan grocery list">
    {demand.lines.map((line) => {
      const key = keyFor(envelope, line.canonicalIngredientId, line.variantId)
      const checked = checks[key] ?? false
      return <article key={key} className={`${line.unresolved ? 'unresolved' : ''} ${checked ? 'checked' : ''}`}><label className="grocery-check"><input type="checkbox" checked={checked} onChange={(event) => toggle(key, event.target.checked)}/><span><strong>{line.name}</strong><small>{line.variant}</small></span></label>{line.unresolved ? <span className="review-badge">Needs review</span> : null}<div className="coverage-grid"><div><span>Required</span><strong>{line.total === null ? 'Partly unresolved' : `${line.total} ${line.unit}`}</strong></div><div><span>In pantry</span><strong>{line.pantry.applied} {line.unit}</strong></div><div><span>To buy</span><strong>{line.pantry.toBuy === null ? `At least ${line.pantry.knownToBuy} ${line.unit}` : `${line.pantry.toBuy} ${line.unit}`}</strong></div></div><details><summary>{line.contributions.length} cooking batch contribution{line.contributions.length === 1 ? '' : 's'}</summary><ul>{line.contributions.map((item) => <li key={`${item.batchId}:${item.requirementId}`}><span>{item.originalText}</span><b>{item.amount === null ? item.note ?? 'Needs review' : `${item.amount} ${item.unit}`}</b></li>)}</ul></details></article>
    })}
    {demand.uncertainties.length ? <aside className="accepted-warning"><strong>Before shopping</strong><ul>{demand.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></aside> : null}
  </section>
}
