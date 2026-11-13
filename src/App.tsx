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
    <dl className="recipe-meta"><div><dt>Total</dt><dd>{formatMinutes(recipe.times.totalMinutes)}</dd></div><div><dt>Yield</dt><dd>{recipe.yield.servings} servings</dd></div><div><dt>Source</dt><dd>{recipe.source.publisher}</dd></div></dl>
    <div className="card-actions"><button type="button" onClick={onOpen}>View source facts →</button><button className="select-recipe" type="button" aria-pressed={selected} onClick={onToggle}>{selected ? 'Added to list ✓' : 'Add to grocery list'}</button></div>
  </article>
}

function RecipeDetail({ recipe, onClose }: { recipe: RecipeV2; onClose: () => void }) {
  return <div className="detail-backdrop" role="presentation" onMouseDown={onClose}><section className="recipe-detail" role="dialog" aria-modal="true" aria-labelledby="recipe-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="close-button" type="button" onClick={onClose} aria-label="Close recipe">×</button>
    <div className="detail-heading"><span className="detail-emoji" aria-hidden="true">{recipe.emoji}</span><div><p className="eyebrow">{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</p><h2 id="recipe-title">{recipe.title}</h2><p>{recipe.description}</p></div></div>
    <div className="detail-grid"><div><h3>Source ingredient facts</h3><ul className="ingredients">{recipe.requirements.map((line) => <li key={line.id}><strong>{line.originalText}</strong><small>{ingredientNames.get(line.canonicalIngredientId)} · {line.confidence}{line.optional ? ' · optional' : ''}{line.quantity?.approximate ? ' · approximate' : ''}</small></li>)}</ul></div><div><h3>Independent method summary</h3><ol className="steps">{recipe.methodSummary.map((step, index) => <li key={index}>{step}</li>)}</ol></div></div>
    <aside className="source-note">Source reviewed, not kitchen-tested. <a href={recipe.source.url} target="_blank" rel="noreferrer">Open the original recipe at {recipe.source.publisher}</a>. Checked {recipe.source.checkedAt}.</aside>
  </section></div>
}

function App() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>(pilotRecipes.slice(0, 3).map(({ id }) => id))
  const [servings, setServings] = useState<Record<string, number>>(() => Object.fromEntries(pilotRecipes.map((recipe) => [recipe.id, recipe.yield.servings])))
  const [detail, setDetail] = useState<RecipeV2 | null>(null)
  const filteredRecipes = useMemo(() => pilotRecipes.filter((recipe) => [recipe.title, recipe.description, recipe.source.publisher, ...recipe.tags, ...recipe.requirements.map((line) => ingredientNames.get(line.canonicalIngredientId) ?? '')].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [query])
  const groceryLines = useMemo(() => buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, selected.map((recipeId) => ({ recipeId, servings: servings[recipeId] }))), [selected, servings])
  const checkout = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedCheckoutCost ?? 0), 0)
  const consumed = groceryLines.reduce((sum, line) => sum + (line.pricing?.estimatedConsumptionCost ?? 0), 0)
  const toggle = (recipeId: string) => setSelected((current) => current.includes(recipeId) ? current.filter((id) => id !== recipeId) : current.length < 3 ? [...current, recipeId] : current)

  return <>
    <header className="site-header"><a className="brand" href="#top"><span>R</span> Recipe Lab</a><p>Private pilot · schema v2 · 5 source-reviewed recipes</p></header>
    <main id="top">
      <section className="hero-section"><div><p className="eyebrow">Ingredient normalization pilot</p><h1>Plan meals.<br/><em>Inspect the math.</em></h1><p className="hero-copy">Choose up to three source-reviewed recipes. Compatible quantities consolidate; alternatives and ambiguous inputs remain visible.</p></div><div className="lab-note"><span>DATA NOTE 002</span><p>Five hard cases before twenty-five: source traceability, unit dimensions, variant safety, and package rounding first.</p><strong>{pilotRecipes.length} real records validated</strong></div></section>
      <section className="library" aria-labelledby="library-title"><div className="library-heading"><div><p className="eyebrow">Source-reviewed pilot</p><h2 id="library-title">Choose recipes</h2></div><label className="search"><span className="sr-only">Search recipes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes or ingredients…" /></label></div>
        <p className="result-count">Showing {filteredRecipes.length} of {pilotRecipes.length} real recipes · {selected.length}/3 selected</p>
        <div className="recipe-grid">{filteredRecipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} selected={selected.includes(recipe.id)} onToggle={() => toggle(recipe.id)} onOpen={() => setDetail(recipe)} />)}</div>
      </section>
      <section className="planner" aria-labelledby="planner-title"><div className="planner-heading"><div><p className="eyebrow">Consolidated grocery demo</p><h2 id="planner-title">Your inspectable list</h2></div><p>Estimate only · no optimization or live store pricing</p></div>
        <div className="serving-controls">{selected.map((recipeId) => { const recipe = pilotRecipes.find(({ id }) => id === recipeId)!; return <label key={recipeId}>{recipe.title}<span><input aria-label={`${recipe.title} servings`} type="number" min="1" step="1" value={servings[recipeId]} onChange={(event) => setServings((current) => ({ ...current, [recipeId]: Math.max(1, Number(event.target.value)) }))}/> servings</span></label> })}</div>
        {selected.length === 0 ? <p className="empty-state">Add one to three recipes to calculate a grocery list.</p> : <><div className="cost-summary"><div><span>Estimated checkout</span><strong>${checkout.toFixed(2)}</strong><small>Only items with price fixtures</small></div><div><span>Estimated consumed</span><strong>${consumed.toFixed(2)}</strong><small>Prorated package use</small></div><div><span>Unpriced or unresolved</span><strong>{groceryLines.filter((line) => !line.pricing).length}</strong><small>Never treated as $0</small></div></div>
          <div className="grocery-list">{groceryLines.map((line) => <article key={`${line.canonicalIngredientId}:${line.variantId}`} className={line.unresolved ? 'unresolved' : ''}><div className="grocery-total"><div><h3>{line.name}</h3><p>{line.variant}</p></div><strong>{line.total ? `${formatAmount(line.total.amount)} ${line.total.unit}` : 'Needs judgment'}</strong></div><details><summary>{line.contributions.length} recipe contribution{line.contributions.length === 1 ? '' : 's'}</summary><ul>{line.contributions.map((contribution) => <li key={contribution.requirementId}><span>{contribution.recipeTitle}</span><span>{contribution.amount !== null ? `${formatAmount(contribution.amount)} ${contribution.unit}` : contribution.note}</span><small>{contribution.originalText}</small></li>)}</ul></details>{line.pricing ? <div className="price-math"><span>{line.pricing.packages} package{line.pricing.packages === 1 ? '' : 's'} · checkout ${line.pricing.estimatedCheckoutCost.toFixed(2)}</span><span>used ${line.pricing.estimatedConsumptionCost.toFixed(2)} · left {formatAmount(line.pricing.unused.amount)} {line.pricing.unused.unit}</span></div> : <p className="no-price">No compatible price fixture — cost unknown</p>}</article>)}</div></>}
      </section>
    </main>
    <footer><span>Recipe Lab · internal review build</span><span>No public deployment configured</span></footer>
    {detail ? <RecipeDetail recipe={detail} onClose={() => setDetail(null)} /> : null}
  </>
}

export default App
