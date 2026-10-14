# Pre-visit questionnaires as FHIR

Fifteen Finnish pre-visit and screening questionnaires (*esitietolomakkeet*), exported from the Lunna survey tool, converted into HL7 FHIR R4 Questionnaires. A small web app fills them in, in Finnish, Swedish or English, and can pre-populate them from a patient's FHIR data.

- **Converter**: Lunna export → FHIR R4 Questionnaire, with translations, sections, follow-up questions (`enableWhen`), scores (`calculatedExpression`), units, and SDC pre-population definitions. Validated with the HL7 FHIR Validator.
- **App**: lists the questionnaires and renders them. It handles follow-ups, validation, live scores, a print view and the QuestionnaireResponse (JSON, downloadable), and checks clean with axe-core.
- **Pre-population**: load FHIR Bundles (FinnishCore-shaped data; synthetic sample patients included) and fill in what the record says: measurements, diagnoses (Finnish ICD-10), medications and vaccinations (ATC), allergies, the contact person. Each filled answer shows where it came from. Only positive evidence fills an answer: a missing record never answers "no".
- **Interoperability**: the same Questionnaires render, score and pre-populate in LHC-Forms, and render and score in CSIRO Smart Forms (see `crosscheck/`).

The plan, every decision and what was verified at each milestone are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Getting started

Requires Node 24 or later.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. Pick a questionnaire. To pre-populate, open "Potilastiedot" (patient data) on the form, choose a sample patient, e.g. Maija for the maternity clinic form (*Esitietolomake - Äitiysneuvola*), and press "Täytä lomake potilastiedoista" (fill in from patient data).

## Repository

| Path | What it is |
|---|---|
| `Esitieto_lomakkeet_hackathon_json/` | The source exports, a public data set kept unchanged. 16 files, 15 questionnaires: the two `esitietolomake-toisen-asteen-terveystarkastukseen-…` files are identical exports. |
| `converter/` | The converter (TypeScript on Node, run with tsx). |
| `converter/overrides/` | **The only hand-maintained input**: per questionnaire, LOINC codes, structure, text corrections, retyped questions, and pre-population mappings, each with a `$comment` on why. |
| `fhir/` | **Generated; don't edit.** `questionnaires/` (one per survey, plus `index.json`, a Bundle of all), `codesystems/` (the answer options), `definitions/` (the project's two extensions), and the reports `conversion-report.md`, `validation.md` and `terminology-check.md`. |
| `app/` | The web app (Vite, React 19, TypeScript). |
| `samples/bundles/` | Synthetic patients: FinnishCore 2.0.0, personal identity codes from the test range. |
| `crosscheck/` | Renders the Questionnaires in LHC-Forms, pre-populated from the samples through a local mock FHIR client. |
| `docs/` | The implementation plan and progress. |
| `tools/` | Git-ignored: the downloaded FHIR Validator and its output. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:5173. |
| `npm run build` | Type-check and build the app into `app/dist/`. |
| `npm run convert` | Regenerate `fhir/` from the exports and the overrides. A test fails if the committed `fhir/` is out of date. |
| `npm run validate` | Run the HL7 FHIR Validator over `fhir/` and `samples/` (R4, SDC 3.0.0, FinnishCore 2.0.0) and write `fhir/validation.md`. Fails on any error. Needs Java and the validator (below). |
| `npm run verify-codes` | Look up every code in the overrides and samples at its source and write `fhir/terminology-check.md`: Finnish ICD-10, ATC and FinLOINC at THL's code server, LOINC at tx.fhir.org, SNOMED CT at the Nordic terminology server. Fails on any code not found or display that differs. Needs network access. |
| `npm run lint` | ESLint over the repository. |
| `npm run typecheck` | `tsc` in every workspace. |
| `npm test` | Vitest in every workspace: the converter, and the app with jsdom, Testing Library and axe-core. |
| `npm run check` | Lint, type-check and test. |

TypeScript is pinned to 6.0, because typescript-eslint doesn't support TypeScript 7 yet.

## How the pieces fit

1. **Convert.** `npm run convert` loads each export strictly: an unknown or unsupported field stops it, rather than losing content. It then applies `converter/overrides/{slug}.json` and writes FHIR. Every decision and correction ends up in `fhir/conversion-report.md`.
2. **Render.** The app fetches `fhir/questionnaires/index.json`. It evaluates `enableWhen`, and runs each score's `calculatedExpression` with fhirpath.js, so what is tested is the expression in the Questionnaire.
3. **Pre-populate.** The patient data panel merges loaded Bundles into one store. "Fill in" then runs the SDC definitions in the Questionnaire:
   - `observationLinkPeriod` + `code` take the latest final Observation within the period, converting units
   - `initialExpression` with launch context `%patient` and `x-fhir-query` variables, which are answered from the store as a FHIR server would
   - filled answers can enable follow-ups, which are then filled too; nothing the person answered is overwritten
   - each answer records its source records, which are shown on screen and stored in the response
4. **Respond.** The QuestionnaireResponse has the elements the Kanta PHR QuestionnaireResponse profile requires: `language`, a narrative, an `identifier`, `subject` once a patient is chosen, and `authored` once completed.

## The FHIR Validator

`npm run validate` needs Java 17 or later and the HL7 FHIR Validator 6.10.4, which isn't committed (it's about 200 MB). Download it into `tools/` and check it against the SHA-256 digest GitHub publishes for the release asset:

```bash
mkdir -p tools && curl -L -o tools/validator_cli.jar https://github.com/hapifhir/org.hl7.fhir.core/releases/download/6.10.4/validator_cli.jar
```

```bash
shasum -a 256 tools/validator_cli.jar
```

The digest should be `1106b9d58f9e363e47bea7c4fc065841e5fc91fe9d062775c3bfdd212bd653cc`. On its first run the validator downloads the FHIR packages it needs into `~/.fhir/packages`.

## Cross-check in LHC-Forms

```bash
cd crosscheck && npm install
```

With `npm run dev` running, open `http://localhost:5173/@fs/<absolute path to the repository>/crosscheck/lhc-forms.html`, choose a questionnaire and a sample, and press Render. The page lists the answers LHC-Forms produced and the searches it made. Nothing leaves the machine.

## Known limits

- **Clinical review is needed.** The pre-population mappings and the corrected translations are reasonable but not clinically reviewed; in particular, which diagnoses count for each illness option. They're all in `converter/overrides/`, each with a comment.
- **Long-term illness** relies on FinnishCore's `condition-permanence` mark (or the problem list). Medications given as a `medicationReference` aren't resolved. SNOMED CT isn't used for matching, since Finnish diagnosis data is ICD-10.
- **The samples' dates are around 2026-10-13.** As time passes, the observation-based answers fall outside their periods. The tests use a fixed date.
- **Other renderers** show UCUM unit codes (e.g. "wk") where this app shows the unit words (*viikkoa*). LHC-Forms doesn't fill date questions from `valueDateTime` Observations.
- **No persistence and no server:** answers stay in the page until downloaded.
