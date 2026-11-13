# Recipe Lab

Recipe Lab is a private, local-first prototype for turning reviewed source material into structured, testable recipes. The first release includes a React/TypeScript/Vite catalog, schema v1, runtime validation with Zod, and automated tests.

> **Review gate:** all included recipes are synthetic draft fixtures. No public deployment is configured or approved. Review source rights, recipe accuracy, and the application before adding any hosting integration.

## Quick start

Prerequisites: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run check` before every pull request; it runs lint, unit/component tests, TypeScript compilation, and the production build.

## What works

- Browse four schema-validated draft recipes.
- Search titles, descriptions, categories, tags, and ingredient names.
- Filter by tag and inspect ingredients and method in a detail dialog.
- Reject malformed recipes, inconsistent timings, duplicate identifiers, non-sequential steps, and incomplete review metadata.

## Project map

```text
src/data/recipes.ts          Draft fixture data; validated during import
src/domain/recipe.ts         Versioned Zod schema and TypeScript types
src/domain/validation.ts     Record and collection validation pipeline
src/App.tsx                  Local catalog prototype
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
