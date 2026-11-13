import { useMemo, useState } from 'react'
import './App.css'
import { recipeCollection } from './data/recipes'
import type { Recipe } from './domain/recipe'

const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}

function RecipeCard({ recipe, onOpen }: { recipe: Recipe; onOpen: () => void }) {
  return (
    <article className="recipe-card">
      <div className="card-topline">
        <span className="recipe-emoji" aria-hidden="true">{recipe.emoji}</span>
        <span>{recipe.category}</span>
      </div>
      <h2>{recipe.title}</h2>
      <p>{recipe.description}</p>
      <div className="tags" aria-label="Recipe tags">
        {recipe.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <dl className="recipe-meta">
        <div><dt>Total</dt><dd>{formatMinutes(recipe.times.totalMinutes)}</dd></div>
        <div><dt>Yield</dt><dd>{recipe.yield.amount} {recipe.yield.unit}</dd></div>
        <div><dt>Ingredients</dt><dd>{recipe.ingredients.length}</dd></div>
      </dl>
      <button type="button" onClick={onOpen}>Open recipe <span aria-hidden="true">→</span></button>
    </article>
  )
}

function RecipeDetail({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="recipe-detail" role="dialog" aria-modal="true" aria-labelledby="recipe-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close recipe">×</button>
        <div className="detail-heading">
          <span className="detail-emoji" aria-hidden="true">{recipe.emoji}</span>
          <div><p className="eyebrow">{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</p><h2 id="recipe-title">{recipe.title}</h2><p>{recipe.description}</p></div>
        </div>
        <div className="detail-grid">
          <div><h3>Ingredients</h3><ul className="ingredients">{recipe.ingredients.map((ingredient) => <li key={ingredient.id}><strong>{ingredient.amount} {ingredient.unit ?? ''}</strong> {ingredient.item}{ingredient.preparation ? `, ${ingredient.preparation}` : ''}</li>)}</ul></div>
          <div><h3>Method</h3><ol className="steps">{recipe.steps.map((step) => <li key={step.position}>{step.instruction}{step.timerMinutes ? <span>{step.timerMinutes} min</span> : null}</li>)}</ol></div>
        </div>
        <aside className="source-note">Source note: {recipe.source.name}. Content review status: <strong>{recipe.review.status}</strong>.</aside>
      </section>
    </div>
  )
}

function App() {
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState('All')
  const [selected, setSelected] = useState<Recipe | null>(null)
  const tags = ['All', ...new Set(recipeCollection.flatMap((recipe) => recipe.tags))]
  const filteredRecipes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return recipeCollection.filter((recipe) => {
      const matchesTag = activeTag === 'All' || recipe.tags.includes(activeTag)
      const searchable = [recipe.title, recipe.description, recipe.category, ...recipe.tags, ...recipe.ingredients.map((item) => item.item)].join(' ').toLowerCase()
      return matchesTag && searchable.includes(normalizedQuery)
    })
  }, [activeTag, query])

  return (
    <>
      <header className="site-header"><a className="brand" href="#top"><span>R</span> Recipe Lab</a><p>Private prototype · schema v1</p></header>
      <main id="top">
        <section className="hero-section">
          <div><p className="eyebrow">A careful kitchen notebook</p><h1>Recipes worth<br /><em>repeating.</em></h1><p className="hero-copy">A small, structured recipe library for testing how source material becomes dependable, cookable instructions.</p></div>
          <div className="lab-note"><span>LAB NOTE 001</span><p>Every recipe in this prototype passes the same versioned validation pipeline.</p><strong>{recipeCollection.length} records passing</strong></div>
        </section>
        <section className="library" aria-labelledby="library-title">
          <div className="library-heading"><div><p className="eyebrow">The collection</p><h2 id="library-title">Browse the bench</h2></div><label className="search"><span className="sr-only">Search recipes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles or ingredients…" /></label></div>
          <div className="filters" aria-label="Filter by tag">{tags.map((tag) => <button className={activeTag === tag ? 'active' : ''} type="button" key={tag} onClick={() => setActiveTag(tag)}>{tag}</button>)}</div>
          <p className="result-count">Showing {filteredRecipes.length} of {recipeCollection.length} recipes</p>
          <div className="recipe-grid">{filteredRecipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} onOpen={() => setSelected(recipe)} />)}</div>
          {filteredRecipes.length === 0 ? <div className="empty-state"><h3>No matching experiments</h3><p>Try another search or clear the active filter.</p><button type="button" onClick={() => { setQuery(''); setActiveTag('All') }}>Reset filters</button></div> : null}
        </section>
      </main>
      <footer><span>Recipe Lab · internal review build</span><span>No public deployment configured</span></footer>
      {selected ? <RecipeDetail recipe={selected} onClose={() => setSelected(null)} /> : null}
    </>
  )
}

export default App
