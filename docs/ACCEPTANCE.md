# Acceptance criteria

## Prototype acceptance

- [x] Application starts locally with `npm run dev` and builds with `npm run build`.
- [x] Catalog shows every valid fixture with title, description, timing, yield, tags, and ingredient count.
- [x] Search matches at least titles and ingredient names; tag filters can be applied and reset.
- [x] A recipe detail view exposes ingredients, ordered method, timing, source, and review status.
- [x] Layout remains usable at desktop and mobile widths.
- [x] Schema v1 rejects invalid IDs/slugs, empty core fields, non-positive amounts, invalid timing, non-sequential steps, duplicate ingredient IDs/tags, and incomplete review state.
- [x] Collection validation rejects duplicate recipe IDs and slugs and reports record paths.
- [x] Automated tests cover successful validation, representative failure modes, search, filtering, reset, and detail opening.
- [x] CI runs lint, tests, and build for pushes and pull requests.
- [x] Documentation explains setup, standards, schema, review policy, and acceptance criteria.

## Required before any public deployment

- [ ] Confirm ownership or reuse rights for every source and asset.
- [ ] Complete editorial/source review and kitchen testing; no records remain `draft`.
- [ ] Review accessibility with keyboard, screen reader, contrast, and reduced-motion checks.
- [ ] Complete dependency, secret, privacy, and threat-model review.
- [ ] Decide hosting, data retention, analytics, error reporting, and privacy policy.
- [ ] Obtain explicit application owner approval in a tracked review.

There is intentionally no deployment workflow, hosting configuration, production environment, analytics SDK, or public URL in this repository.
