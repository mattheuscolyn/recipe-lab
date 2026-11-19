import { useMemo, useState } from 'react'
import type { RecipeV2 } from '../domain/catalog'
import { shiftWeek, weekDates } from '../domain/mealPlan'
import type { PersonalDataV3MigrationPreview, LoadPersonalDataV3Result } from '../domain/personalDataV3'

const friendlyDate = (iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en-US', options).format(new Date(`${iso}T12:00:00`))

export function V3PlannerPreview({ preview, saved, weekStart, recipes, onWeekChange, onExit, onDownloadBackup, onDownloadRecovery, onCommit }: {
  preview: PersonalDataV3MigrationPreview
  saved: LoadPersonalDataV3Result
  weekStart: string
  recipes: ReadonlyMap<string, RecipeV2>
  onWeekChange: (week: string) => void
  onExit: () => void
  onDownloadBackup: () => void
  onDownloadRecovery: () => void
  onCommit: () => { persisted: boolean; error: string | null }
}) {
  const [reviewing, setReviewing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [commitMessage, setCommitMessage] = useState<string | null>(null)
  const week = useMemo(() => weekDates(weekStart), [weekStart])
  const weekEnd = week[6]
  const choices = new Map(preview.data.legacyRecipeChoices.map((choice) => [choice.legacySlotId, choice]))
  const requirements = new Map(preview.data.mealRequirements.map((requirement) => [requirement.mealRequirementId, requirement]))
  const issues = new Map(preview.issues.filter((issue) => issue.entity === 'meal-slot').map((issue) => [issue.legacySlotId, issue]))
  const weekSlots = preview.data.plan.filter(({ date }) => date >= weekStart && date <= weekEnd)
  const save = () => {
    const result = onCommit()
    setCommitMessage(result.persisted ? 'Preview snapshot saved separately. Your original planner is still active.' : result.error)
    if (result.persisted) { setConfirmed(false); setReviewing(false) }
  }

  return <main className="content-page v3-preview-page">
    <section className="v3-preview-hero">
      <div>
        <p className="eyebrow">Optional planning preview · read-only until confirmed</p>
        <h1>A safer look at your week.</h1>
        <p>Your current planner stays in charge. This preview translates compatible meals into whole portions without guessing cooking, leftovers, or meal times.</p>
        <div className="v3-preview-actions"><button type="button" className="primary" onClick={onExit}>← Return to original planner</button><button type="button" onClick={onDownloadBackup}>Download original backup</button></div>
      </div>
      <aside aria-label="Migration preview summary">
        <span><strong>{preview.summary.convertedMeals}</strong> meals ready</span>
        <span><strong>{preview.summary.needsReview}</strong> need review</span>
        <span><strong>0</strong> cooking batches inferred</span>
      </aside>
    </section>

    {saved.error ? <section className="v3-preview-alert danger" role="status"><div><strong>Saved preview needs recovery</strong><span>{saved.error}</span></div>{saved.recoveryBackup ? <button type="button" onClick={onDownloadRecovery}>Download unreadable snapshot</button> : null}</section> : saved.data ? <section className={`v3-preview-alert ${saved.stale ? 'warning' : 'success'}`} role="status"><div><strong>{saved.stale ? 'Saved preview is out of date' : 'A v3 preview snapshot is saved'}</strong><span>{saved.stale ? 'Your original planner changed. Review a fresh snapshot before replacing the saved preview.' : 'It remains separate; the original planner is still the default and editable version.'}</span></div></section> : null}

    <section className="v3-week-toolbar">
      <div><p className="eyebrow">Previewed week</p><h2>{friendlyDate(weekStart, { month: 'long', day: 'numeric' })}–{friendlyDate(weekEnd, { month: 'long', day: 'numeric', year: 'numeric' })}</h2></div>
      <div className="v3-week-controls"><button type="button" aria-label="Previous preview week" onClick={() => onWeekChange(shiftWeek(weekStart, -1))}>←</button><button type="button" aria-label="Next preview week" onClick={() => onWeekChange(shiftWeek(weekStart, 1))}>→</button></div>
    </section>

    {weekSlots.length ? <section className="v3-preview-week" aria-label="New planner weekly preview">{week.map((date) => {
      const daySlots = weekSlots.filter((slot) => slot.date === date)
      return <article key={date} className="v3-preview-day"><header><span>{friendlyDate(date, { weekday: 'short' })}</span><strong>{friendlyDate(date, { month: 'short', day: 'numeric' })}</strong></header>{daySlots.length ? daySlots.map((slot) => {
        const choice = choices.get(slot.id)
        const requirement = choice ? requirements.get(choice.mealRequirementId) : null
        const issue = issues.get(slot.id)
        const recipe = recipes.get(slot.recipeId)
        return <div className={`v3-preview-meal ${issue ? 'needs-review' : ''}`} key={`${slot.id}:${slot.date}:${slot.meal}`}>
          <div className="v3-meal-top"><span>{slot.meal}</span>{slot.locked ? <b>Locked</b> : null}</div>
          <strong>{recipe?.emoji ?? '◌'} {recipe?.title ?? 'Unavailable recipe'}</strong>
          {requirement ? <><p>{requirement.requestedPortions} whole meal portion{requirement.requestedPortions === 1 ? '' : 's'}</p><small>Recipe choice preserved · not allocated to cooking yet</small></> : <><p>{slot.servings} legacy serving{slot.servings === 1 ? '' : 's'}</p><small>{issue?.message ?? 'This meal needs review before conversion.'}</small></>}
        </div>
      }) : <p className="v3-day-empty">No saved meals</p>}</article>
    })}</section> : <section className="v3-preview-empty"><span>7 days</span><h2>No saved meals in this week</h2><p>The preview does not fill open days or recommend recipes automatically.</p></section>}

    {preview.issues.length ? <section className="v3-migration-issues" aria-labelledby="migration-issues-title"><div><p className="eyebrow">Needs your decision</p><h2 id="migration-issues-title">Some original records stay unchanged.</h2><p>They remain in the preview and exact recovery backup; nothing is rounded, filtered, or discarded.</p></div><ul>{preview.issues.map((issue) => <li key={issue.entity === 'meal-slot' ? `${issue.legacySlotId}:${issue.code}` : `${issue.pantryLotId}:${issue.code}`}><strong>{issue.entity === 'meal-slot' ? `${friendlyDate(issue.date)} · ${issue.meal}` : `Pantry · ${issue.pantryLotId}`}</strong><span>{issue.message}</span></li>)}</ul></section> : null}

    <section className="v3-capability-grid" aria-label="Preview availability">
      <article><span>Available now</span><h3>Manual choices, portions, and locks</h3><p>Compatible meals become unallocated needs while their original recipe choices stay visible.</p></article>
      <article><span>Not available yet</span><h3>Automatic batches and leftovers</h3><p>Current recipes still need serving and storage review, so no cooked food or grocery demand is invented.</p></article>
      <article><span>Not available yet</span><h3>Cooking mode and optimization</h3><p>Cooking steps, safe timing, and recommendation readiness require later reviewed data.</p></article>
    </section>

    <section className="v3-conversion-card">
      <div><p className="eyebrow">Optional saved snapshot</p><h2>Review before anything new is written.</h2><p>Saving creates a separate v3 snapshot. It never replaces the original storage key, and the original planner remains the app default.</p></div>
      {!reviewing ? <button type="button" className="primary" onClick={() => { setReviewing(true); setCommitMessage(null) }}>Review conversion</button> : <div className="v3-conversion-review">
        <dl><div><dt>Converted</dt><dd>{preview.summary.convertedMeals} compatible meal need{preview.summary.convertedMeals === 1 ? '' : 's'}</dd></div><div><dt>Preserved unchanged</dt><dd>{preview.data.plan.length} original slots, {Object.keys(preview.data.preferences).length} preferences, {preview.data.pantry.length} pantry lots, and grocery checks</dd></div><div><dt>Not created</dt><dd>Cooking events, batches, allocations, leftovers, and tasks</dd></div><div><dt>Recovery</dt><dd>Complete v2 payload and {preview.summary.needsReview} review item{preview.summary.needsReview === 1 ? '' : 's'}</dd></div></dl>
        <button type="button" onClick={onDownloadBackup}>Download original data first</button>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/> I reviewed what changes and understand the original planner remains authoritative.</label>
        <div><button type="button" onClick={() => { setReviewing(false); setConfirmed(false) }}>Cancel</button><button type="button" className="primary" disabled={!confirmed} onClick={save}>{saved.data || saved.recoveryBackup ? 'Replace saved preview snapshot' : 'Save separate preview snapshot'}</button></div>
      </div>}
      {commitMessage ? <p className="v3-commit-message" role="status">{commitMessage}</p> : null}
    </section>
  </main>
}

export function V3MigrationBlocked({ error, canDownloadRaw, onExit, onDownloadRaw }: { error: string; canDownloadRaw: boolean; onExit: () => void; onDownloadRaw: () => void }) {
  return <main className="content-page v3-preview-page">
    <section className="v3-preview-hero">
      <div><p className="eyebrow">Optional planning preview · conversion blocked</p><h1>Your original data comes first.</h1><p>The stored planner could not be preserved as a validated v2 payload, so Recipe Lab will not create or replace a v3 snapshot.</p><div className="v3-preview-actions"><button type="button" className="primary" onClick={onExit}>← Return to original planner</button>{canDownloadRaw ? <button type="button" onClick={onDownloadRaw}>Download raw recovery copy</button> : null}</div></div>
      <aside aria-label="Migration blocked"><span><strong>0</strong> records converted</span><span><strong>0</strong> v3 writes allowed</span><span><strong>1</strong> recovery action</span></aside>
    </section>
    <section className="v3-preview-alert danger" role="alert"><div><strong>Conversion is unavailable</strong><span>{error}</span></div></section>
  </main>
}
