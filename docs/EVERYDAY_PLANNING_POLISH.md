# Everyday Generate Week behavior

This slice makes the interactive proposal safer to use repeatedly while keeping generated-plan persistence disabled.

## Draft freshness

Every generated result records a deterministic fingerprint of its week, mode, meal/portion defaults, cooking limits, office policy, avoids, per-person preferences, manual overrides, pantry snapshot, and exact active personal-recipe revisions. Changing any of those inputs leaves the proposal visible for comparison but marks it stale. Acceptance review is disabled until regeneration finishes.

Per-meal portion changes, skips, locks, and “try another” choices are request inputs rather than silent edits to a displayed proposal. Changes that regenerate immediately produce a new fingerprint; pending changes show the same stale warning. Moving to another week clears inappropriate per-slot overrides.

Browser generation now runs in a module worker. The same deterministic bounded domain function and limits remain in force, but the page can keep painting progress and accessibility controls instead of blocking on search. Test environments without workers use the same function directly.

## Two-person preferences

Each recipe can carry independent Person A and Person B votes: like, dislike, or unknown. The request converts these into explicit household vote counts. Unknown remains unknown. A mixed like/dislike is a conflict and receives the existing dislike penalty; it is not treated as household approval. A hard avoid remains absolute and separate from preference scoring.

The result summary now emphasizes meal coverage, dinner variety, cook sessions, hands-on time, stored-meal reuse, and shopping readiness. Meal-plan completeness and shopping readiness remain separate states.

## Acceptance review

The review now distinguishes proposed meals, existing in-horizon meals that would be replaced, compatible locks retained, and existing requirements outside the target week that stay untouched. Versioned rollback creates a new envelope revision from the previous snapshot; it never rewrites history in place. The activation gate remains off.

## Evidence-backed preparation boundary

S06 thaw-task execution remains blocked in the live generator because the implemented pantry-availability contract does not yet carry the architecture's structured, evidenced per-lot `storageState`, and the recipe/request contracts do not carry a reviewed thaw timing-window policy. A pantry note is not evidence and must never create a defrost task.

The pending product/architecture decision is whether private pantry lots should adopt the full v3 sourced storage-state record and which versioned policy authority may supply thaw windows and safe-method notes. Until that is approved and implemented, frozen prepared-food routes that require thaw tasks remain explicitly ineligible. Existing reviewed refrigeration/freezing maxima, storage-start timestamps, leftover deadlines, and reheating/service gates remain enforced unchanged.
