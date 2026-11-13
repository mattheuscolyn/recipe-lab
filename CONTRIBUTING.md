# Contributing

## Workflow

1. Create a short-lived branch from `main` using `feat/`, `fix/`, or `docs/`.
2. Keep each pull request focused and include tests for changed behavior.
3. Run `npm run check` locally.
4. Request content review when recipe data or source metadata changes.
5. Merge only after CI and the applicable acceptance checks pass.

## Engineering standards

- TypeScript strict mode stays enabled; avoid `any` and validate all external data at the boundary.
- Domain rules belong in `src/domain`, not in components.
- Components use semantic HTML and accessible names; keyboard behavior is part of acceptance.
- Tests should assert user-visible behavior or domain invariants, not implementation details.
- Schema changes require a versioning decision and an update to `docs/SCHEMA.md`.
- Dependencies must have a clear purpose and use committed lockfile versions.

## Content standards

- Do not add copied recipe prose without confirmed rights and attribution.
- Preserve the original source URL/name and document meaningful adaptations.
- New content begins as `draft`. A different review status requires `reviewedAt`.
- Measurements, yields, timing, allergens, and instructions must be checked by a human before release.

## Commit and review expectations

Use imperative, descriptive commits (for example, `Add collection duplicate checks`). A pull request description should state the change, test evidence, content provenance impact, and any remaining risk. Public hosting or analytics changes require explicit owner approval and are outside the current prototype scope.
