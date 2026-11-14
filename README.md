# Recipe Lab

Recipe Lab is a private, local-first personal recipe application. Milestone 2A connects 25 reviewed recipes to discovery preferences, an explicit weekly meal calendar, and a normalized grocery list while keeping all personal data in the browser.

> **Review gate:** the 25 pilot recipes are source-reviewed, not kitchen-tested or cleared for public republication. No public deployment is configured or approved. The four synthetic v1 fixtures remain preserved but excluded.

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
