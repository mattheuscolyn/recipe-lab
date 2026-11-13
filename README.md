# Recipe Lab

Recipe Lab is a private, local-first prototype for turning reviewed source material into structured, testable recipes. Milestone 1B now includes 25 real recipes, schema-v2 ingredient normalization, and inspectable grocery/package math.

> **Review gate:** the 25 pilot recipes are source-reviewed, not kitchen-tested or cleared for public republication. No public deployment is configured or approved. The four synthetic v1 fixtures remain preserved but excluded.

## Quick start

Prerequisites: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run check` before every pull request; it runs lint, unit/component tests, TypeScript compilation, and the production build.

## What works

- Browse 25 schema-v2 source-reviewed recipes from five publishers.
- Select up to three recipes, scale planning portions independently from source output, and inspect normalized grocery contributions.
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
src/App.tsx                  Catalog and grocery demonstration
docs/SCHEMA.md               Schema contract and evolution policy
docs/ACCEPTANCE.md           Acceptance criteria and review checklist
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
