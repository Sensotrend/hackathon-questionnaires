# Pre-visit questionnaires as FHIR

Converts the Lunna survey exports in `Esitieto_lomakkeet_hackathon_json/` into HL7 FHIR R4 Questionnaires and renders them in a small web app. Pre-population from FHIR Bundles comes later. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the plan and progress.

## Layout

- `Esitieto_lomakkeet_hackathon_json/`: the source exports, a public data set kept unchanged. There are 15 files but 14 questionnaires: the two `esitietolomake-toisen-asteen-terveystarkastukseen-…` files are byte-identical exports of the same revision.
- `converter/`: TypeScript converter (Node, run with tsx).
- `app/`: Vite + React + TypeScript renderer.
- `fhir/`: generated output; don't edit it by hand. Change the converter or `converter/overrides/` and run `npm run convert`.
  - `questionnaires/`: one Questionnaire per survey, and `index.json`, a Bundle with all of them
  - `codesystems/`: the answer options of each survey
  - `definitions/`: the project's own extension (score bands)
  - `conversion-report.md`: what each questionnaire contains and every correction the conversion made
  - `validation.md`: the last `npm run validate` result
- `docs/`: the implementation plan.

## Scripts

Requires Node 24 or later.

```bash
npm install
```

| Command | What it does |
|---|---|
| `npm run convert` | regenerate `fhir/` from the source exports and the overrides |
| `npm run validate` | run the HL7 FHIR Validator over `fhir/` and update `fhir/validation.md`; fails on errors |
| `npm run dev` | start the app at http://localhost:5173 |
| `npm run build` | type-check and build the app into `app/dist/` |
| `npm run lint` | ESLint over the whole repo |
| `npm run typecheck` | `tsc` in every workspace |
| `npm test` | Vitest in every workspace |
| `npm run check` | lint, type-check and test |

TypeScript is pinned to 6.0 because typescript-eslint does not support TypeScript 7 yet.

## The FHIR Validator

`npm run validate` needs Java 17 or later and the HL7 FHIR Validator 6.10.4, which isn't committed (it's about 200 MB). Download it into `tools/` and check it against the SHA-256 digest that GitHub publishes for the release asset:

```bash
mkdir -p tools && curl -L -o tools/validator_cli.jar https://github.com/hapifhir/org.hl7.fhir.core/releases/download/6.10.4/validator_cli.jar
```

```bash
shasum -a 256 tools/validator_cli.jar
```

The digest should be `1106b9d58f9e363e47bea7c4fc065841e5fc91fe9d062775c3bfdd212bd653cc`. On its first run the validator downloads the FHIR packages it needs (R4 core, the extensions pack, SDC) into `~/.fhir/packages`.
