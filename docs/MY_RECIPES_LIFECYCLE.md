# My Recipes lifecycle

The browser-local My Recipes library now supports browse, immutable edit history, JSON export, safe merge import, and warned deletion. It remains separate from the reviewed production catalog and does not alter v2 recipe or planner data.

## Revision and dependency behavior

Editing creates a new numbered revision with the same stable recipe id. Previous input and validated `RecipeV3` snapshots remain unchanged and exportable. Active generation uses only the selected active revision. Saving, importing, or deleting clears the current ephemeral generated draft so it must be regenerated against the new catalog.

Existing v3 plans retain their exact recipe revision rather than silently switching to an edit. Generated-plan acceptance is still disabled; before activation, accepted plans that reference an edited or removed personal recipe must be surfaced as stale and explicitly regenerated or retained against their recorded revision.

## Import and recovery

Import validates the complete v1 library and every nested v3 recipe before merge. New recipe ids and new immutable revisions can merge. The operation blocks when the same revision id has different content or when current and imported libraries disagree on the active revision without an explicit selection. Storage is re-read before commit to prevent stale-tab overwrites.

Writes use a pending import journal, authoritative write, read-back validation, then journal removal. A corrupt primary library or interrupted journal is shown as recovery state with a raw download; it is never rendered as an empty library and cannot be overwritten through the normal save path.

## Custom ingredient decision

Free-text custom ingredients remain blocked for now. Grocery consolidation requires a stable canonical ingredient id, variant, base unit, and explicit conversion/compatibility policy. Treating an arbitrary label as a canonical ingredient would create unsafe merging and pantry matching. A future ingredient-registration flow should create a versioned local ingredient record and review its unit family before a personal recipe may reference it.

## Trust boundaries

Household authorship and fresh-planning confirmations remain required for each revision. They do not establish publisher rights for third-party material, food-safety review, storage duration, reheating, freezing, or leftover suitability. Those values remain unknown unless separately evidenced and reviewed.
