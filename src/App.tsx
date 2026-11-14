import { useMemo, useState } from 'react'
import './App.css'
import './Planner.css'
import { canonicalIngredients, packageOffers, pilotRecipes } from './data/pilotCatalog'
import { buildGroceryList } from './domain/grocery'
import { formatAmount } from './domain/units'
import type { RecipeV2 } from './domain/catalog'

const formatMinutes = (minutes: number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`
const ingredientNames = new Map(canonicalIngredients.map((ingredient) => [ingredient.id, ingredient.displayName]))

function RecipeCard({ recipe, selected, onToggle, onOpen }: { recipe: RecipeV2; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  return <article className={`recipe-card ${selected ? 'selected-card' : ''}`}>
    <div className="card-topline"><span className="recipe-emoji" aria-hidden="true">{recipe.emoji}</span><span>{recipe.category}</span></div>
    <h2>{recipe.title}</h2><p>{recipe.description}</p>
    <div className="tags" aria-label="Recipe tags">{recipe.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    <dl className="recipe-meta"><div><dt>Total</dt><dd>{formatMinutes(recipe.times.totalMinutes)}</dd></div><div><dt>Source yield</dt><dd>{recipe.yield.source.label}</dd></div><div><dt>Source</dt><dd>{recipe.source.publisher}</dd></div></dl>
    <div className="card-actions"><button type="button" onClick={onOpen}>View source facts →</button><button className="select-recipe" type="button" aria-pressed={selected} onClick={onToggle}>{selected ? 'Added to list ✓' : 'Add to grocery list'}</button></div>
  </article>
}

function RecipeDetail({ recipe, onClose }: { recipe: RecipeV2; onClose: () => void }) {
  return <div className="detail-backdrop" role="presentation" onMouseDown={onClose}><section className="recipe-detail" role="dialog" aria-modal="true" aria-labelledby="recipe-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="close-button" type="button" onClick={onClose} aria-label="Close recipe">×</button>
    <div className="detail-heading"><span className="detail-emoji" aria-hidden="true">{recipe.emoji}</span><div><p className="eyebrow">{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</p><h2 id="recipe-title">{recipe.title}</h2><p>{recipe.description}</p></div></div>
    <p className="planning-note"><strong>Source yield:</strong> {recipe.yield.source.label}. <strong>Planning default:</strong> {recipe.yield.planningServings.default} people{recipe.yield.planningServings.assumption ? ` — ${recipe.yield.planningServings.assumption}` : ''}</p>
    <div className="detail-grid"><div><h3>Source ingredient facts</h3><ul className="ingredients">{recipe.requirements.map((line) => <li key={line.id}><strong>{line.originalText}</strong><small>{ingredientNames.get(line.canonicalIngredientId)} · {line.confidence}{line.optional ? ' · optional (excluded by default)' : ''}{line.quantity?.approximate ? ' · approximate planning value' : ''}{line.sourceRange ? ` · source range ${line.sourceRange.min}–${line.sourceRange.max} ${line.sourceRange.unit}` : ''}{line.sourceQuantity ? ` · preserved source measure ${line.sourceQuantity.amount} ${line.sourceQuantity.unit}` : ''}</small>{line.alternatives.length ? <small>Chosen branch shown above. Alternative{line.alternatives.length === 1 ? '' : 's'}: {line.alternatives.map(({ label }) => label).join('; ')}</small> : null}{line.sourcePackage ? <small>Purchase fact: {line.sourcePackage.count} × {line.sourcePackage.netQuantityEach.amount} {line.sourcePackage.netQuantityEach.unit} net. {line.sourcePackage.yieldAssumption}</small> : null}{line.reviewNote ? <small>{line.reviewNote}</small> : null}</li>)}</ul></div><div><h3>Independent method summary</h3><ol className="steps">{recipe.methodSummary.map((step, index) => <li key={index}>{step}</li>)}</ol></div></div>
    <aside className="source-note">Source reviewed, not kitchen-tested. <a href={recipe.source.url} target="_blank" rel="noreferrer">Open the original recipe at {recipe.source.publisher}</a>. Checked {recipe.source.checkedAt}.</aside>
  </section></div>
}

function App() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>(pilotRecipes.slice(0, 3).map(({ id }) => id))
  const [servings, setServings] = useState<Record<string, number>>(() => Object.fromEntries(pilotRecipes.map((recipe) => [recipe.id, recipe.yield.planningServings.default])))
  const [includeOptional, setIncludeOptional] = useState(false)
  const [detail, setDetail] = useState<RecipeV2 | null>(null)
  const filteredRecipes = useMemo(() => pilotRecipes.filter((recipe) => [recipe.title, recipe.description, recipe.source.publisher, ...recipe.tags, ...recipe.requirements.map((line) => ingredientNames.get(line.canonicalIngredientId) ?? '')].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [query])
  const groceryLines = useMemo(() => buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, selected.map((recipeId) => ({ recipeId, servings: servings[recipeId] })), { includeOptional }), [selected, servings, includeOptional])
  const optionalCount = selected.reduce((count, recipeId) => count + (pilotRecipes.find(({ id }) => id === recipeId)?.requirements.filter(({ optional }) => optional).length ?? 0), 0)
  const checkout = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedCheckoutCost ?? 0), 0)
  const consumed = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedConsumptionCost ?? 0), 0)
  const toggle = (recipeId: string) => setSelected((current) => current.includes(recipeId) ? current.filter((id) => id !== recipeId) : current.length < 3 ? [...current, recipeId] : current)

  return <>
    <header className="site-header"><a className="brand" href="#top"><span>R</span> Recipe Lab</a><p>Private pilot · schema v2 · {pilotRecipes.length} source-reviewed recipes</p></header>
    <main id="top">
      <section className="hero-section"><div><p className="eyebrow">Ingredient normalization pilot</p><h1>Plan meals.<br/><em>Inspect the math.</em></h1><p className="hero-copy">Choose up to three source-reviewed recipes. Compatible quantities consolidate; alternatives and ambiguous inputs remain visible.</p></div><div className="lab-note"><span>DATA NOTE 003</span><p>Normalization corrections passed before expansion to a diverse twenty-five-recipe private pilot.</p><strong>{pilotRecipes.length} real records validated</strong></div></section>
      <section className="library" aria-labelledby="library-title"><div className="library-heading"><div><p className="eyebrow">Source-reviewed pilot</p><h2 id="library-title">Choose recipes</h2></div><label className="search"><span className="sr-only">Search recipes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes or ingredients…" /></label></div>
        <p className="result-count">Showing {filteredRecipes.length} of {pilotRecipes.length} real recipes · {selected.length}/3 selected</p>
        <div className="recipe-grid">{filteredRecipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} selected={selected.includes(recipe.id)} onToggle={() => toggle(recipe.id)} onOpen={() => setDetail(recipe)} />)}</div>
      </section>
      <section className="planner" aria-labelledby="planner-title"><div className="planner-heading"><div><p className="eyebrow">Consolidated grocery demo</p><h2 id="planner-title">Your inspectable list</h2></div><p>Estimate only · no optimization or live store pricing</p></div>
        <div className="serving-controls">{selected.map((recipeId) => { const recipe = pilotRecipes.find(({ id }) => id === recipeId)!; return <label key={recipeId}>{recipe.title}<small>{recipe.yield.source.label}</small><span><input aria-label={`${recipe.title} planning servings`} type="number" min="1" step="1" value={servings[recipeId]} onChange={(event) => setServings((current) => ({ ...current, [recipeId]: Math.max(1, Number(event.target.value)) }))}/> people</span></label> })}</div>
        {selected.length === 0 ? <p className="empty-state">Add one to three recipes to calculate a grocery list.</p> : <><label className="optional-toggle"><input type="checkbox" checked={includeOptional} onChange={(event) => setIncludeOptional(event.target.checked)} /> Include {optionalCount} optional item{optionalCount === 1 ? '' : 's'} (excluded by default)</label><div className="cost-summary"><div><span>Priced-items checkout subtotal</span><strong>${checkout.toFixed(2)}</strong><small>Only items with hypothetical price fixtures</small></div><div><span>Estimated consumed</span><strong>${consumed.toFixed(2)}</strong><small>Prorated hypothetical package use</small></div><div><span>Unpriced or unresolved</span><strong>{groceryLines.filter((line) => !line.pricing).length}</strong><small>Never treated as $0</small></div></div>
          <div className="grocery-list">{groceryLines.map((line) => <article key={`${line.canonicalIngredientId}:${line.variantId}`} className={line.unresolved ? 'unresolved' : ''}><div className="grocery-total"><div><h3>{line.name}{line.optional ? ' (optional)' : ''}</h3><p>{line.variant}</p></div><strong>{line.total ? `${formatAmount(line.total.amount)} ${line.total.unit}` : <>Needs judgment{line.knownSubtotal.amount > 0 ? <small>Known subtotal: {formatAmount(line.knownSubtotal.amount)} {line.knownSubtotal.unit} + unresolved</small> : null}</>}</strong></div><details><summary>{line.contributions.length} recipe contribution{line.contributions.length === 1 ? '' : 's'}</summary><ul>{line.contributions.map((contribution) => <li key={contribution.requirementId}><span>{contribution.recipeTitle}</span><span>{contribution.amount !== null ? `${formatAmount(contribution.amount)} ${contribution.unit}` : contribution.note}</span><small>{contribution.originalText}{contribution.approximate ? ' · approximate' : ''}{contribution.confidence === 'needs-review' ? ' · chosen planning branch' : ''}</small></li>)}</ul></details>{line.pricing ? <div className="price-math"><span>{line.pricing.packages} package{line.pricing.packages === 1 ? '' : 's'} · checkout ${line.pricing.estimatedCheckoutCost.toFixed(2)}</span><span>purchased {formatAmount(line.pricing.packagePurchased.amount)} {line.pricing.packagePurchased.unit} net · usable {formatAmount(line.pricing.usablePurchased.amount)} {line.pricing.usablePurchased.unit}</span><span>used ${line.pricing.estimatedConsumptionCost.toFixed(2)} · usable remainder {formatAmount(line.pricing.unused.amount)} {line.pricing.unused.unit}</span></div> : <p className="no-price">No compatible hypothetical price fixture — cost unknown</p>}</article>)}</div></>}
      </section>
    </main>
    <footer><span>Recipe Lab · internal review build</span><span>No public deployment configured</span></footer>
    {detail ? <RecipeDetail recipe={detail} onClose={() => setDetail(null)} /> : null}
  </>
}

export default App
