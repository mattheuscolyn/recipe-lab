# Recipe Lab

Recipe Lab is a public-preview, local-first personal recipe application. Generate Week is the primary planner: it builds explainable weekly proposals from recommendation-ready recipes, preserves exact cooking batches and leftovers, and can save a reviewed plan and consolidated grocery demand in the browser.

> **Public-preview gate:** the 25 pilot recipes are source-reviewed, not kitchen-tested or cleared for republication. The public GitHub Pages preview uses independent UI/method summaries and no publisher photography, but source terms and data rights still require review. The four synthetic v1 fixtures remain preserved but excluded. Personal preferences and plans stay in each visitor's browser and are not uploaded.

Public preview: <https://mattheuscolyn.github.io/recipe-lab/>

## Quick start

Prerequisites: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run check` before every pull request; it runs lint, unit/component tests, TypeScript compilation, and the production build.

## What works

- Discover, pass, save, undo, search, and revisit all 25 schema-v2 source-reviewed recipes from five publishers.
- Keep recipe preferences, cooked/rating/notes, weekly plans, and grocery checks in this browser with versioned JSON export/import.
- Plan Breakfast, Lunch, and Dinner across a Monday–Sunday week; repeat, swap, resize, lock, or remove each slot.
- Generate complete or explicitly partial weeks with bounded search, portions, skips, locks, cooking windows, safe leftovers, pantry availability, and structured explanations.
- Review and save real-recipe generated plans locally. Synthetic demo plans can demonstrate the engine but can never be saved as personal plans.
- Reopen a saved generated calendar and batch-deduplicated pantry-aware grocery list; unresolved quantities remain visible warnings and grocery checks persist locally.
- Derive an unlimited weekly grocery list from scheduled slots and inspect every dated contribution.
- Include optional ingredients explicitly, inspect chosen alternatives and source ranges, and distinguish canned net from assumed usable mass.
- Keep dimensional conversions, ingredient variants, unresolved quantities, and missing prices explicit.
- Compare estimated checkout, consumed cost, package count, and remainder without claiming optimization.
- Preserve the four flawed schema-v1 fixtures with a documented defect report.

## Project map

```text
src/data/pilotCatalog.ts     Real pilot recipes, canonical data, price fixtures
src/data/recipes.ts          Preserved schema-v1 synthetic fixtures
src/domain/catalog.ts        Schema-v2 Zod contracts
src/domain/grocery.ts        Serving, consolidation, package calculations
src/domain/ingestion.ts      Offline JSON-LD staging/review helpers
src/domain/personalData.ts   Versioned local personal-data schema and backup
src/domain/mealPlan.ts       Calendar date and meal-slot operations
src/domain/weekGeneratorV3.ts Bounded weekly recommendation engine
src/domain/weekDraftAcceptanceV3.ts Safe local acceptance and rollback contract
src/components/AcceptedWeekPlan.tsx Saved generated calendar and grocery view
src/App.tsx                  Discovery, library, plan, and grocery experience
docs/SCHEMA.md               Schema contract and evolution policy
docs/ACCEPTANCE.md           Acceptance criteria and review checklist
docs/MILESTONE_2A.md         Product behavior, storage choice, and QA notes
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run test` | Run unit and component tests once |
| `npm run test:watch` | Run tests interactively |
| `npm run lint` | Enforce TypeScript/React lint rules |
| `npm run build` | Type-check and create a production bundle locally |
| `npm run check` | Run the complete pull-request quality gate |

See [CONTRIBUTING.md](CONTRIBUTING.md) for development standards and [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) for the release gate.
