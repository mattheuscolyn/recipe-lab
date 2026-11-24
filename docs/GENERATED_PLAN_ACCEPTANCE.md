# Generated-plan acceptance foundation

Status: implemented behind a disabled-by-default activation gate. The live v2 planner remains authoritative. No generated plan can currently be accepted.

## Contract

`reviewWeekDraftAcceptance` is a pure conversion from a validated generation request, its `WeekDraft`, and the exact current `PersonalDataV3` snapshot to a review result. A ready result contains a versioned proposal with:

- the exact recipe revisions and selected ingredient branches from the request and draft;
- requested meals, skips, locks, cooking events, batches, allocations, and outstanding grocery-demand provenance;
- proposed cooking state only (`planned` events, unprepared batches, and no inferred prepared-food lots);
- version-checked reservations when an existing prepared-food lot is actually selected; and
- a fingerprint of the personal-data snapshot on which the review was based.

Synthetic demo recipes are rejected even if a caller labels the request as real. Incomplete weeks, unresolved groceries, missing recipe revisions, locked conflicts, served meals, completed cooking, completed tasks, and active prepared-food reservations block conversion. Existing prospective data requires explicit replacement confirmation. The original v2 plan fields and migration recovery payload remain intact.

## Persistence protocol

The future acceptance store uses one versioned envelope at `recipe-lab.personal.v3.accepted-week`. The envelope contains the accepted proposal, its resulting personal-data snapshot, a content fingerprint, a monotonically increasing revision, and the previous proposal for rollback/export.

Writes use a pending journal followed by the authoritative envelope, read-back validation, then journal removal. Loading never substitutes empty state for malformed data. A newer valid journal is surfaced as interrupted-write recovery. Expected envelope fingerprints prevent two tabs from silently overwriting one another, while the proposal's base personal-data fingerprint catches edits made after review. Quota/write failure leaves the prior authoritative envelope unchanged and retains the journal for recovery.

`GENERATED_PLAN_ACCEPTANCE_ENABLED` is intentionally `false`. The live UI exposes a readable pre/post review and JSON backup only; its accept control is disabled. The low-level transaction primitive exists for deterministic failure/recovery tests and a later explicitly authorized activation path, but is not called by the application.

## Deferred activation work

Owner authorization is required before enabling writes. Before activation, browser verification must cover two real tabs, storage quota failure, refresh during the pending write, rollback/import recovery, and reconciliation with browser-local recipe revision edits. Acceptance must not be enabled while the production catalog has no eligible real plan or while grocery selections remain unresolved.
