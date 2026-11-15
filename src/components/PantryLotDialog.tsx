import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { CanonicalIngredient, UnitCode } from '../domain/catalog'
import { compatiblePantryUnits } from '../domain/pantry'
import type { PantryLot } from '../domain/personalData'

const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function PantryLotDialog({ ingredients, lot, newLotId, returnFocus, onClose, onSave }: { ingredients: CanonicalIngredient[]; lot: PantryLot | null; newLotId: string; returnFocus: HTMLElement | null; onClose: () => void; onSave: (lot: PantryLot) => void }) {
  const initialIngredient = lot ? ingredients.find(({ id }) => id === lot.canonicalIngredientId) ?? null : null
  const [query, setQuery] = useState(initialIngredient?.displayName ?? '')
  const [ingredient, setIngredient] = useState<CanonicalIngredient | null>(initialIngredient)
  const [variantId, setVariantId] = useState(lot?.variantId ?? initialIngredient?.variants[0]?.id ?? '')
  const [quantity, setQuantity] = useState(lot ? String(lot.quantity) : '')
  const [unit, setUnit] = useState<UnitCode>(lot?.unit ?? initialIngredient?.baseUnit ?? 'item')
  const [bestBy, setBestBy] = useState(lot?.bestBy ?? '')
  const [note, setNote] = useState(lot?.note ?? '')
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return ingredients.slice(0, 10)
    return ingredients.filter((candidate) => [candidate.displayName, ...candidate.aliases].some((name) => name.toLowerCase().includes(normalized))).slice(0, 10)
  }, [ingredients, query])
  const units = ingredient ? compatiblePantryUnits(ingredient) : []

  useEffect(() => {
    const dialog = dialogRef.current
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [onClose, returnFocus])

  const chooseIngredient = (next: CanonicalIngredient) => {
    setIngredient(next)
    setQuery(next.displayName)
    setVariantId(next.variants[0].id)
    setUnit(next.baseUnit)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const amount = Number(quantity)
    if (!ingredient || !variantId || !Number.isFinite(amount) || amount <= 0 || !units.includes(unit)) return
    onSave({ id: lot?.id ?? newLotId, canonicalIngredientId: ingredient.id, variantId, quantity: amount, unit, bestBy: bestBy || null, note: note.trim() })
  }

  return <div className="detail-backdrop pantry-backdrop" role="presentation" onMouseDown={onClose}><section ref={dialogRef} className="pantry-dialog" role="dialog" aria-modal="true" aria-labelledby="pantry-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
    <button ref={closeRef} className="close-button" type="button" onClick={onClose} aria-label="Close pantry item editor">×</button>
    <p className="eyebrow">Browser-local inventory</p><h2 id="pantry-dialog-title">{lot ? 'Edit pantry lot' : 'Add pantry item'}</h2><p>Record only what you know. Separate packages or best-by dates can stay as separate lots.</p>
    <form onSubmit={submit}>
      <label className="pantry-search"><span>Ingredient</span><input aria-label="Search pantry ingredients" value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value !== ingredient?.displayName) setIngredient(null) }} placeholder="Search the ingredient catalog…" autoComplete="off"/></label>
      {!ingredient ? <div className="ingredient-results" aria-label="Matching ingredients">{results.map((candidate) => <button type="button" key={candidate.id} onClick={() => chooseIngredient(candidate)}><strong>{candidate.displayName}</strong><small>{candidate.variants.map(({ label }) => label).join(' · ')}</small></button>)}{!results.length ? <p>No catalog ingredients match that search.</p> : null}</div> : <button className="chosen-ingredient" type="button" onClick={() => setIngredient(null)}><span><strong>{ingredient.displayName}</strong><small>Change ingredient</small></span>✓</button>}
      {ingredient ? <div className="pantry-fields">
        <label>Form / variant<select aria-label="Pantry variant" value={variantId} onChange={(event) => setVariantId(event.target.value)}>{ingredient.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}</select></label>
        <label>Quantity<input aria-label="Pantry quantity" type="number" min="0.001" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label>
        <label>Unit<select aria-label="Pantry unit" value={unit} onChange={(event) => setUnit(event.target.value as UnitCode)}>{units.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label>
        <label>Best by <span>(optional)</span><input aria-label="Best-by date" type="date" value={bestBy} onChange={(event) => setBestBy(event.target.value)}/></label>
        <label className="pantry-note">Note <span>(optional)</span><textarea aria-label="Pantry note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Package, location, or reminder…"/></label>
      </div> : null}
      <p className="pantry-safety-note">Best-by dates are planning cues, not food-safety verdicts. Pantry amounts are not automatically consumed.</p>
      <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={!ingredient || !(Number(quantity) > 0)}>{lot ? 'Save changes' : 'Add to pantry'}</button></div>
    </form>
  </section></div>
}
