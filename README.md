# Pre-visit questionnaires as FHIR

Converts the Lunna survey exports in `Esitieto_lomakkeet_hackathon_json/` into HL7 FHIR R4 Questionnaires and renders them in a small web app. Pre-population from FHIR Bundles comes later. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the plan and progress.

## Layout

- `Esitieto_lomakkeet_hackathon_json/`: the source exports, a public data set kept unchanged. There are 15 files but 14 questionnaires: the two `esitietolomake-toisen-asteen-terveystarkastukseen-…` files are byte-identical exports of the same revision.
- `converter/`: TypeScript converter (Node, run with tsx).
- `app/`: Vite + React + TypeScript renderer.
- `fhir/`: generated Questionnaires. Don't edit them by hand; change the converter and run `npm run convert`.
- `docs/`: the implementation plan.

## Scripts

Requires Node 24 or later.

```bash
npm install
```

| Command | What it does |
|---|---|
| `npm run convert` | regenerate `fhir/` from the source exports |
| `npm run dev` | start the app at http://localhost:5173 |
| `npm run build` | type-check and build the app into `app/dist/` |
| `npm run lint` | ESLint over the whole repo |
| `npm run typecheck` | `tsc` in every workspace |
| `npm test` | Vitest in every workspace |
| `npm run check` | lint, type-check and test |

TypeScript is pinned to 6.0 because typescript-eslint does not support TypeScript 7 yet.
