import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { RecipeV2 } from '../domain/catalog'
import type { PreferenceStatus, RecipePreference } from '../domain/personalData'
import { gestureIntent, swipeDecision, SWIPE_COMMIT_THRESHOLD, type GestureIntent } from '../domain/swipe'

type Decision = PreferenceStatus | null
type DragState = {
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  intent: GestureIntent
}

type DiscoveryDeckProps = {
  recipe: RecipeV2
  previewRecipes: RecipeV2[]
  preference: RecipePreference
  remaining: number
  reviewed: number
  total: number
  canUndo: boolean
  formatMinutes: (minutes: number) => string
  preferenceLabel: (status: PreferenceStatus | null) => string
  onDecision: (status: Decision) => void
  onOpen: (opener: HTMLButtonElement) => void
  onSchedule: (opener: HTMLButtonElement) => void
  onUndo: () => void
}

const isInteractive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button, a, input, select, textarea, [role="dialog"]'))

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

export function DiscoveryDeck({ recipe, previewRecipes, preference, remaining, reviewed, total, canUndo, formatMinutes, preferenceLabel, onDecision, onOpen, onSchedule, onUndo }: DiscoveryDeckProps) {
  const deckRef = useRef<HTMLElement>(null)
  const decisionLocked = useRef(false)
  const timerRef = useRef<number | null>(null)
  const pendingDecision = useRef<Decision | undefined>(undefined)
  const onDecisionRef = useRef(onDecision)
  const restoreFocus = useRef(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(null)
  const [locked, setLocked] = useState(false)
  const [announcement, setAnnouncement] = useState(`Ready to review ${recipe.title}.`)
  const reducedMotion = useReducedMotion()

  useEffect(() => { onDecisionRef.current = onDecision }, [onDecision])
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    if (pendingDecision.current !== undefined) {
      onDecisionRef.current(pendingDecision.current)
      pendingDecision.current = undefined
    }
  }, [])

  const completeDecision = (status: Decision) => {
    timerRef.current = null
    pendingDecision.current = undefined
    decisionLocked.current = false
    setLocked(false)
    setDrag(null)
    setExitDirection(null)
    onDecision(status)
    restoreFocus.current = true
    window.requestAnimationFrame(() => {
      if (restoreFocus.current) {
        restoreFocus.current = false
        deckRef.current?.focus()
      }
    })
  }

  const commitDecision = (status: Decision, source: 'gesture' | 'button' | 'keyboard') => {
    if (decisionLocked.current) return
    decisionLocked.current = true
    setLocked(true)
    const label = status === 'interested' ? 'Interested' : status === 'passed' ? 'Passed' : status === 'saved' ? 'Saved for later' : 'Deferred'
    setAnnouncement(`${label}: ${recipe.title}. ${source === 'gesture' ? 'Swipe accepted.' : 'Choice saved.'}`)

    if (status === 'interested' || status === 'passed') {
      setExitDirection(status === 'interested' ? 'right' : 'left')
      if (!reducedMotion) {
        pendingDecision.current = status
        timerRef.current = window.setTimeout(() => completeDecision(status), 240)
        return
      }
    }
    completeDecision(status)
  }

  const resetDrag = () => setDrag(null)
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (decisionLocked.current || isInteractive(event.target) || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({ pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, intent: 'pending' })
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId || decisionLocked.current) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const intent = drag.intent === 'pending' ? gestureIntent(dx, dy) : drag.intent
    if (intent === 'horizontal') event.preventDefault()
    setDrag((current) => current ? { ...current, x: event.clientX, y: event.clientY, intent } : current)
  }
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId || decisionLocked.current) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const decision = drag.intent === 'vertical' ? null : swipeDecision(dx, dy)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    resetDrag()
    if (decision) commitDecision(decision, 'gesture')
    else setAnnouncement(`No choice made for ${recipe.title}.`)
  }
  const onPointerCancel = () => {
    resetDrag()
    setAnnouncement(`No choice made for ${recipe.title}.`)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isInteractive(event.target) || decisionLocked.current) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      commitDecision('interested', 'keyboard')
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      commitDecision('passed', 'keyboard')
    }
  }

  const dx = drag?.intent === 'horizontal' ? drag.x - drag.startX : 0
  const dragProgress = Math.min(1, Math.abs(dx) / SWIPE_COMMIT_THRESHOLD)
  const transform = exitDirection
    ? `translate3d(${exitDirection === 'right' ? '115vw' : '-115vw'}, 0, 0) rotate(${exitDirection === 'right' ? 18 : -18}deg)`
    : `translate3d(${dx}px, 0, 0) rotate(${Math.max(-11, Math.min(11, dx / 22))}deg)`

  return <>
    <div className="deck-meta" aria-label="Discovery progress">
      <div><span>{remaining}</span> left in this pass</div>
      <div className="deck-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed} aria-label={`${reviewed} of ${total} recipes reviewed`}><i style={{ width: `${Math.round((reviewed / total) * 100)}%` }} /></div>
      <p><kbd>←</kbd> Pass <span>·</span> <kbd>→</kbd> Interested</p>
    </div>
    <div className="deck-shell">
      {previewRecipes.slice(0, 2).reverse().map((preview, reverseIndex) => {
        const depth = previewRecipes.slice(0, 2).length - reverseIndex
        return <div className={`deck-preview depth-${depth}`} aria-hidden="true" key={preview.id}>
          <span>{preview.emoji}</span><b>{preview.title}</b>
        </div>
      })}
      <article
        ref={deckRef}
        className={`discovery-card deck-card ${drag?.intent === 'horizontal' ? 'is-dragging' : ''} ${exitDirection ? `is-exiting-${exitDirection}` : ''}`}
        tabIndex={0}
        aria-label={`${recipe.title}. Swipe or use the decision buttons.`}
        style={{ transform }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <span className="swipe-feedback interested-feedback" aria-hidden="true" style={{ opacity: dx > 0 ? dragProgress : 0 }}>Interested</span>
        <span className="swipe-feedback pass-feedback" aria-hidden="true" style={{ opacity: dx < 0 ? dragProgress : 0 }}>Pass</span>
        <div className="discovery-visual"><span>{recipe.emoji}</span><p>{recipe.cuisine}</p><small>Illustrated placeholder · photo slot ready</small></div>
        <div className="discovery-copy">
          <div className="card-topline"><span>{recipe.category} · {formatMinutes(recipe.times.totalMinutes)}</span><span className={`status-pill ${preference.status ?? ''}`}>{preferenceLabel(preference.status)}</span></div>
          <h2 id="discover-title">{recipe.title}</h2><p>{recipe.description}</p>
          <div className="tags">{recipe.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
          <dl><div><dt>Planning default</dt><dd>{recipe.yield.planningServings.default} people</dd></div><div><dt>Source</dt><dd>{recipe.source.publisher}</dd></div></dl>
          <div className="decision-grid" aria-label={`Choose a preference for ${recipe.title}`}>
            <button type="button" className="pass" disabled={locked} onClick={() => commitDecision('passed', 'button')}><span aria-hidden="true">←</span> Pass</button>
            <button type="button" className="interest" disabled={locked} onClick={() => commitDecision('interested', 'button')}>Interested <span aria-hidden="true">→</span></button>
            <button type="button" disabled={locked} onClick={() => commitDecision('saved', 'button')}>Save for later</button>
            <button type="button" className="not-now" disabled={locked} onClick={() => commitDecision(null, 'button')}>Not now</button>
          </div>
          <div className="discovery-links"><button className="text-button plan-link" type="button" disabled={locked} onClick={(event) => onSchedule(event.currentTarget)}>＋ Add to plan</button><button className="text-button" type="button" disabled={locked} onClick={(event) => onOpen(event.currentTarget)}>Details and source</button><button className="text-button" type="button" disabled={!canUndo || locked} onClick={onUndo}>↶ Undo last choice</button></div>
        </div>
      </article>
    </div>
    <p className="gesture-help">Drag sideways to decide. Scroll up or down normally—vertical movement never makes a choice.</p>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
  </>
}
