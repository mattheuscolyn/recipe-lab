import { useState } from 'react'
import { canonicalIngredients } from '../data/pilotCatalog'
import { activePersonalRecipes, exportPersonalRecipeLibrary, importPersonalRecipeLibrary, removePersonalRecipe, savePersonalRecipeRevision, type PersonalRecipeLibrary } from '../domain/personalRecipesV3'
import type { MealKind } from '../domain/generateWeekPreview'
import type { UnitCode } from '../domain/catalog'

const units: UnitCode[] = ['g', 'kg', 'oz_mass', 'lb', 'ml', 'l', 'fl_oz', 'tsp', 'tbsp', 'cup', 'item', 'clove', 'head', 'can', 'pinch']
type Row = { ingredientId: string; variantId: string; amount: number; unit: UnitCode; optional: boolean }
const firstIngredient = canonicalIngredients[0]
const newRow = (): Row => ({ ingredientId: firstIngredient.id, variantId: firstIngredient.variants[0].id, amount: 1, unit: firstIngredient.baseUnit, optional: false })

export function PersonalRecipeForm({ library, onSaved, recoveryError = null, recoveryRaw = null }: { library: PersonalRecipeLibrary; onSaved: (library: PersonalRecipeLibrary) => void; recoveryError?: string | null; recoveryRaw?: string | null }) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [emoji, setEmoji] = useState('🍽️')
  const [servings, setServings] = useState(2)
  const [activeMinutes, setActiveMinutes] = useState(20)
  const [totalMinutes, setTotalMinutes] = useState(30)
  const [roles, setRoles] = useState<MealKind[]>(['dinner'])
  const [ingredients, setIngredients] = useState<Row[]>([newRow()])
  const [authorship, setAuthorship] = useState(false)
  const [freshReview, setFreshReview] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const updateRow = (index: number, patch: Partial<Row>) => setIngredients((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  const chooseIngredient = (index: number, ingredientId: string) => {
    const ingredient = canonicalIngredients.find(({ id }) => id === ingredientId)!
    updateRow(index, { ingredientId, variantId: ingredient.variants[0].id, unit: ingredient.baseUnit })
  }
  const reset = () => { setEditingId(null); setTitle(''); setDescription(''); setEmoji('🍽️'); setServings(2); setActiveMinutes(20); setTotalMinutes(30); setRoles(['dinner']); setIngredients([newRow()]); setAuthorship(false); setFreshReview(false) }
  const startEdit = (personalRecipeId: string) => {
    const record = library.recipes.find((item) => item.personalRecipeId === personalRecipeId)!
    const active = record.revisions.find(({ recipe }) => recipe.identity.revisionId === record.activeRevisionId)!.input
    setEditingId(personalRecipeId); setTitle(active.title); setDescription(active.description); setEmoji(active.emoji); setServings(active.servings); setActiveMinutes(active.activeMinutes); setTotalMinutes(active.totalMinutes); setRoles([...active.mealRoles]); setIngredients(active.ingredients.map((item) => ({ ...item }))); setAuthorship(true); setFreshReview(true); setMessage(null); setOpen(true)
  }
  const download = (contents: string, name: string) => { const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url) }
  const save = () => {
    try {
      const storage = window.localStorage
      const now = new Date().toISOString()
      const existing = editingId ? library.recipes.find(({ personalRecipeId }) => personalRecipeId === editingId)! : null
      const prior = existing?.revisions.find(({ recipe }) => recipe.identity.revisionId === existing.activeRevisionId)?.input
      const next = savePersonalRecipeRevision(storage, library, {
        personalRecipeId: editingId ?? crypto.randomUUID(), revision: existing ? Math.max(...existing.revisions.map(({ input }) => input.revision)) + 1 : 1, title, description, emoji, servings, activeMinutes, totalMinutes, mealRoles: roles,
        ingredients, authorshipConfirmed: authorship as true, authorshipStatement: 'I confirm I wrote this recipe or have permission to use these facts privately.', freshUseReviewed: freshReview as true, createdAt: prior?.createdAt ?? now, updatedAt: now,
      }, canonicalIngredients)
      onSaved(next)
      setMessage(`${title} ${editingId ? 'has a new immutable revision' : 'is available for fresh private planning'}. Storage and leftovers remain unavailable; generated drafts were invalidated.`)
      reset()
      setOpen(false)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The personal recipe could not be saved locally.') }
  }

  const remove = (personalRecipeId: string) => { try { const next = removePersonalRecipe(window.localStorage, library, personalRecipeId); onSaved(next); setDeleteId(null); setMessage('Recipe removed. Immutable revisions in exported backups remain recoverable; generated drafts were invalidated.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Recipe could not be removed.') } }
  const importFile = async (file: File | undefined) => { if (!file) return; try { const next = importPersonalRecipeLibrary(window.localStorage, library, await file.text()); onSaved(next); setMessage('Personal recipes imported with immutable histories preserved. Generated drafts were invalidated.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed safely.') } }
  const recipes = activePersonalRecipes(library)

  if (!open) return <section className="personal-recipe-entry"><div><p className="eyebrow">Private My Recipes</p><h3>{recipes.length ? `${recipes.length} personal recipe${recipes.length === 1 ? '' : 's'}` : 'Use a recipe you own.'}</h3><p>Add planning facts locally. Fresh use stays separate from unreviewed storage and leftovers. Edits create revisions; they never overwrite history.</p></div><div className="personal-library-actions"><button type="button" onClick={() => { reset(); setOpen(true); setMessage(null) }}>＋ Add personal recipe</button><button type="button" onClick={() => download(exportPersonalRecipeLibrary(library), 'recipe-lab-personal-recipes.json')} disabled={!recipes.length}>Export JSON</button><label className="button-like">Import JSON<input type="file" accept="application/json,.json" onChange={(event) => void importFile(event.target.files?.[0])}/></label></div>
    {recoveryError ? <div className="personal-error" role="alert"><strong>Personal recipe recovery required</strong><span>{recoveryError}</span>{recoveryRaw ? <button type="button" onClick={() => download(recoveryRaw, 'recipe-lab-personal-recipes-recovery.json')}>Download raw recovery</button> : null}</div> : null}
    {recipes.length ? <div className="personal-recipe-library">{library.recipes.map((record) => { const recipe = recipes.find(({ identity }) => identity.recipeId === record.personalRecipeId)!; return <article key={record.personalRecipeId}><div><span>{recipe.identity.emoji}</span><div><strong>{recipe.identity.title}</strong><small>{recipe.mealRoles.primary.join(' · ')} · {record.revisions.length} revision{record.revisions.length === 1 ? '' : 's'} · fresh only</small></div></div><div><button type="button" onClick={() => startEdit(record.personalRecipeId)}>Edit</button><details><summary>History</summary><ol>{[...record.revisions].reverse().map(({ input, recipe: revision }) => <li key={revision.identity.revisionId}><strong>r{input.revision} · {input.title}</strong><span>{new Date(input.updatedAt).toLocaleString()} · {revision.identity.revisionId}</span></li>)}</ol></details>{deleteId === record.personalRecipeId ? <><button type="button" onClick={() => setDeleteId(null)}>Keep</button><button type="button" className="danger" onClick={() => remove(record.personalRecipeId)}>Confirm delete</button></> : <button type="button" onClick={() => setDeleteId(record.personalRecipeId)}>Delete…</button>}</div></article> })}</div> : null}
    <p className="personal-catalog-note">Custom ingredients are intentionally not accepted yet: an ingredient needs a canonical identity, variant, and safe unit/conversion policy before it can enter grocery math.</p>{message ? <p role="status">{message}</p> : null}</section>

  return <section className="personal-recipe-form" aria-labelledby="personal-recipe-title"><div className="personal-form-heading"><div><p className="eyebrow">Stored only in this browser</p><h3 id="personal-recipe-title">{editingId ? 'Edit personal recipe' : 'Add a personal recipe'}</h3></div><button type="button" onClick={() => { setOpen(false); reset() }}>Cancel</button></div>
    <p className="personal-boundary">This {editingId ? 'creates a new immutable revision and invalidates the current generated draft' : 'creates a private, versioned v3 recipe revision'}. It does not grant publisher rights, verify food safety, or approve leftovers.</p>
    <div className="personal-basics"><label>Recipe name<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)}/></label><label>Emoji<input value={emoji} maxLength={8} onChange={(event) => setEmoji(event.target.value)}/></label><label className="wide">Description<input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)}/></label><label>Output portions<input type="number" min="1" value={servings} onChange={(event) => setServings(Math.max(1, Number(event.target.value)))}/></label><label>Hands-on minutes<input type="number" min="0" value={activeMinutes} onChange={(event) => setActiveMinutes(Math.max(0, Number(event.target.value)))}/></label><label>Total minutes<input type="number" min="1" value={totalMinutes} onChange={(event) => setTotalMinutes(Math.max(1, Number(event.target.value)))}/></label></div>
    <fieldset className="personal-roles"><legend>Meal roles</legend>{(['breakfast', 'lunch', 'dinner'] as MealKind[]).map((role) => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={(event) => setRoles((current) => event.target.checked ? [...current, role] : current.filter((item) => item !== role))}/>{role}</label>)}</fieldset>
    <div className="personal-ingredients"><div><strong>Ingredients</strong><button type="button" onClick={() => setIngredients((current) => [...current, newRow()])}>＋ Add ingredient</button></div>{ingredients.map((row, index) => {
      const ingredient = canonicalIngredients.find(({ id }) => id === row.ingredientId)!
      return <div className="personal-ingredient-row" key={index}><label>Ingredient<select aria-label={`Ingredient ${index + 1}`} value={row.ingredientId} onChange={(event) => chooseIngredient(index, event.target.value)}>{canonicalIngredients.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label><label>Variant<select aria-label={`Ingredient ${index + 1} variant`} value={row.variantId} onChange={(event) => updateRow(index, { variantId: event.target.value })}>{ingredient.variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.label}</option>)}</select></label><label>Amount<input aria-label={`Ingredient ${index + 1} amount`} type="number" min="0.01" step="any" value={row.amount} onChange={(event) => updateRow(index, { amount: Number(event.target.value) })}/></label><label>Unit<select aria-label={`Ingredient ${index + 1} unit`} value={row.unit} onChange={(event) => updateRow(index, { unit: event.target.value as UnitCode })}>{units.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label><label className="optional-check"><input type="checkbox" checked={row.optional} onChange={(event) => updateRow(index, { optional: event.target.checked })}/> Optional</label><button type="button" disabled={ingredients.length === 1} onClick={() => setIngredients((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></div>
    })}</div>
    <div className="personal-confirmations"><label><input type="checkbox" checked={authorship} onChange={(event) => setAuthorship(event.target.checked)}/><span><strong>I wrote this recipe or have permission to use it privately.</strong> This statement—not Recipe Lab—establishes the local rights basis.</span></label><label><input type="checkbox" checked={freshReview} onChange={(event) => setFreshReview(event.target.checked)}/><span><strong>I reviewed these facts for fresh meal planning.</strong> This does not approve storage, reheating, freezing, or leftovers.</span></label></div>
    {message ? <p className="personal-error" role="alert">{message}</p> : null}<div className="personal-form-actions"><button type="button" onClick={() => { setOpen(false); reset() }}>Cancel</button><button className="primary" type="button" disabled={!title.trim() || !description.trim() || !roles.length || !authorship || !freshReview || totalMinutes < activeMinutes} onClick={save}>{editingId ? 'Save new revision' : 'Save private recipe'}</button></div>
  </section>
}
