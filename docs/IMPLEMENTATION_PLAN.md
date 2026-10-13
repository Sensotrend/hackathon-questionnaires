# Pre-visit Questionnaires as FHIR — Implementation Plan

## 1. Goal & Scope

`Esitieto_lomakkeet_hackathon_json/` holds pre-visit and screening questionnaires (*esitietolomakkeet*) exported from the Lunna survey tool. The work has three parts:

1. **Convert** every source questionnaire into a valid **HL7 FHIR R4 `Questionnaire`**, with as little information lost as possible.
2. **Render** the converted Questionnaires in a simple web app that can be filled in and that outputs a `QuestionnaireResponse`.
3. **Pre-populate** (later): feed one or more FHIR `Bundle`s to the form so that answers already known from the patient's record (height, weight, date of the last period, diagnoses, medications, vaccinations, smoking…) are filled in automatically, following the HL7 **Structured Data Capture (SDC)** population patterns.

The converter is the source of truth. Generated Questionnaires are committed but never hand-edited: fixes go into the converter or into its override files (§5.6), and the output is regenerated.

Non-goals: a server or backend, persistence, authentication, submitting responses anywhere, authoring questionnaires, and full SDC conformance. SDC is followed where it is cheap so that the output also works in other SDC renderers.

## 2. Source data

15 files, **14 distinct questionnaires**. The two `esitietolomake-toisen-asteen-terveystarkastukseen-…` files are byte-identical exports of the same revision. Every file uses `schemaVersion` 1.2.0.

| Questionnaire | Kind | Top-level questions | Scoring |
|---|---|---|---|
| GAD-7 (anxiety) | screening | 9 | sum |
| AUDIT (alcohol) | screening | 12 | 4 sums (total + 3 sub-scales by category) |
| Maternity clinic pre-visit form (äitiysneuvola) | pre-visit | 63 | – |
| Upper-secondary health check (opiskeluterveydenhuolto) | pre-visit | 48 | – |
| Low-back physiotherapy baseline | care plan (`type: careplan`) | 46 | – |
| School health, 5th grade, parents | pre-visit | 84 | – |
| School health, 8th grade, pupils | pre-visit | 88 | – |
| ADHD-RS (child/adolescent) | screening | 21 | 3 sums (sub-scales) |
| BDI-21 (depression) | screening | 23 | sum |
| PHQ-9 (depression) | screening | 12 | sum |
| EPDS (postnatal mood) | screening | 12 | sum |
| Child health clinic, 2-year-olds, parents | pre-visit | 32 | – |
| Child health clinic, 5-year-olds, parents | pre-visit | 33 | – |
| Fagerström / HSI (nicotine) | screening | 3 | sum |

### 2.1 Source schema (as observed)

```
Survey
  surveyGuid, revisionGuid, draft, type ("form" | "careplan"), schemaVersion, createdDt, createdBy{…}, tenant, meta, restrictions
  name{fi,sv,en}, description{fi,sv,en}
  categories[]  { categoryId, name{fi,sv,en,…}, subcategories[] (always empty) }
  scoringEnabled, scoreCalculations[] { calculationFunction ("sum"), categoryId?, min, max, title{…}, summaries[] { min, max, title{…}, description{…} } }
  questions[] Question

Question
  questionId, categoryId, type, questionText{fi,sv,en}, description?{…} (always empty, sometimes `{}`), printText{…} (always empty), isOptional,
  scoringEnabled, scores[] { answerId, points }, tags[] (always empty), numericTagConditions[] (always empty),
  minValue, maxValue, minValueOrUnder, maxValueOrOver   (only for type "number")
  answers[] { answerId, answerText{…}, printText{…} (always empty), tags[], question[] Question  ← follow-up questions }
```

Question `type` values: `select` (370), `freetext` (237), `heading` (30), `multiselect` (28), `number` (4), `date` (1).

### 2.2 Observations that shape the design

- **Three languages** (fi, sv, en) on every text, with Finnish as the primary one. Some category names carry extra languages (ar, de, et, it, ru).
- **Follow-up questions** hang off answers (`answers[].question[]`), nested up to three levels (114 answers have follow-ups). They show only when that answer is chosen.
- **Categories are not always sections.** In 13 questionnaires the questions of each category are contiguous, so a category is a section. In ADHD-RS the two categories alternate question by question (19 runs over 3 categories), because they are the scoring sub-scales (inattention / hyperactivity). The 8th-grade form has one category split into two runs.
- **Most "numeric" data is free text.** Height (cm), weight (kg), number of pregnancies, the year of the last childbirth and similar are all `freetext`. Only the four pain/EQ-VAS scales are `number`. Pre-population needs proper types, so the converter must be able to retype items through overrides (§5.6).
- **Formatting lives in the text**: `\n` line breaks, Markdown-style trailing double spaces, and headings embedded in the first line of a question (e.g. "My health information␤What is your height (cm)?").
- **Data-quality problems** must be reported, not silently "fixed". For example, the AUDIT score titles are shifted between languages, so the `sv` title of one sum is the `fi` title of the next.
- **`createdBy`, `tenant`, `restrictions` and `meta`** describe the source system, not the questionnaire, so they are not carried into the Questionnaire. The source files are a public data set and are committed unchanged.

## 3. Architecture & tech stack

```
Esitieto_lomakkeet_hackathon_json/   source exports (input, read-only)
converter/                           TypeScript, run with Node (tsx)
  src/source/schema.ts               zod schema and types for §2.1 (strict: unknown or unsupported content fails loading)
  src/source/integrity.ts            cross-reference checks (unique ids, scores ↔ answers, categories)
  src/source/loader.ts               loads the directory, drops identical duplicate exports
  src/convert.ts                     Survey → Questionnaire
  src/convert/                       Survey → Questionnaire
  overrides/<slug>.json              per-questionnaire overrides: codes, structure, retyping, population (§5.6, §7)
  src/report.ts                      conversion report: warnings and data-quality findings
fhir/questionnaires/                 GENERATED Questionnaire JSON, one file per questionnaire + index.json
app/                                 Vite + React + TypeScript single-page app
  src/renderer/                      Questionnaire renderer (form state, enableWhen, validation)
  src/response/                      QuestionnaireResponse builder
  src/scoring/                       score calculation
  src/populate/                      pre-population engine (§7)
samples/bundles/                     synthetic test Bundles for pre-population
docs/                                this plan, conversion notes
```

- **One npm workspace** (`converter`, `app`) with shared `tsconfig` and ESLint, and **Vitest** for both.
- **Vite + React + TypeScript** for the app: a static SPA with no server is all this needs. Next.js (used in other projects) would add nothing here.
- **`fhirpath`** (fhirpath.js, with the R4 model) for `enableWhenExpression`, `calculatedExpression` and population expressions.
- **`@types/fhir`** for R4 resource types.
- **HL7 FHIR Validator** (`validator_cli.jar`, Java) run from an npm script to validate the generated output against R4 and the SDC IG.
- **A custom renderer** rather than adopting LHC-Forms or CSIRO Smart Forms (`@aehrc/smart-forms-renderer`, `@aehrc/sdc-populate`). The needed subset is small, and owning it keeps the trilingual UI and the population provenance (§7.5) under our control. Both external renderers are still used as **conformance checks**: if our Questionnaires render correctly there too, the conversion is sound.

## 4. Milestones

Each milestone ends with tests passing, a short "what was verified" note added to this file, and a commit. Sub-steps (`3a`, `3b`, …) are committed separately when it helps review.

| # | Milestone | Done when |
|---|---|---|
| 0 | Repo setup | git repo, workspace, lint/test scripts; source data committed; duplicate export noted |
| 1 | Source model & loader | typed loader for all 15 files; duplicates detected by `revisionGuid`; fixture-based tests |
| 2 | Core conversion | metadata, translations, groups, `display`/`choice`/`text`/`integer`/`date` items, `required`, follow-ups with `enableWhen`; output written and committed |
| 3 | ~~Follow-ups & conditionality~~ | merged into milestone 2, since the conversion is recursive and follow-ups without `enableWhen` would have been wrong output |
| 4 | Scoring | `ordinalValue` on answer options; visible calculated score items; score bands |
| 5 | Validation & report | FHIR Validator clean (errors = 0) on all 14; conversion report generated; outputs committed |
| 6 | Renderer basics | app lists the questionnaires and renders every item type; fi/sv/en switch |
| 7 | Renderer behaviour | enableWhen, repeats, required, min/max; live scores; QuestionnaireResponse view and download |
| 8 | Retyping overrides | free-text numbers/dates retyped with units, e.g. height → `decimal` + cm |
| 9 | Pre-population engine | Bundle input; `observationLinkPeriod` and `initialExpression` population; provenance badges |
| 10 | Population mappings | codes and expressions for the pre-visit forms; synthetic sample Bundles; end-to-end tests |
| 11 | Polish | accessibility pass, print view, external-renderer cross-check, README |

Milestones 0–7 deliver the converter and the app. 8–10 are the pre-population feature, and 8 can start in parallel with 6–7.

## 5. Conversion rules (Survey → Questionnaire)

### 5.1 Questionnaire metadata

| FHIR element | Source |
|---|---|
| `id` | `surveyGuid` |
| `url` | `{BASE}/Questionnaire/{surveyGuid}`, where `BASE` = `https://sensotrend.com/fhir` (one constant in the converter) |
| `identifier` | `urn:uuid:{surveyGuid}` |
| `version` | `revisionGuid` |
| `name` | PascalCase from the English name, e.g. `PHQ9DepressionSurvey` |
| `title` | `name.fi`, with sv/en as translations (§5.2) |
| `description` | `description.fi` (markdown) + translations |
| `status` | `draft: false` → `active`, otherwise `draft` |
| `date` | `createdDt` |
| `language` | `fi` |
| `subjectType` | `Patient` |
| `code` | for the validated instruments, the LOINC panel code where one exists set by overrides: PHQ-9 44249-1, GAD-7 69737-5, AUDIT 72110-0, EPDS 71354-5, each checked with `$lookup` on tx.fhir.org (LOINC 2.82). None for BDI-21 (the export doesn't say whether it is BDI-I or BDI-II, and only BDI-II has a panel, 89210-9), Fagerström/HSI or ADHD-RS (no LOINC panel), or the pre-visit forms |
| `useContext` | `type: careplan` becomes a `useContext` with code `task` and `valueCodeableConcept.text` `careplan`, so the information is not lost. `form` is the default and gets nothing. |
| dropped | `createdBy`, `tenant`, `meta`, `restrictions`, `showOnTasks`, `printText` (always empty), `tags` and `numericTagConditions` (always empty) |

### 5.2 Languages

Finnish goes in the base element (`text`, `title`, `display`). Swedish and English go in the core `http://hl7.org/fhir/StructureDefinition/translation` extension on the primitive (`_text.extension[]` with `lang` + `content`). Extra languages that appear only on some category names are included the same way. Empty strings never produce a translation.

### 5.3 Structure

- **Each contiguous run of a category's questions becomes a `group`** (`linkId` = `categoryId`, `text` = category name) holding the questions in their original order. This includes the one-question "Ohje"/Instruction categories, which become a group with a `display` item.
- **A category split into several runs gives several groups** with the same title; the second gets `linkId` `{categoryId}-2`, and so on. The only case is the 8th-grade form, where "Päihdetottumukseni" (substance use) sits in the middle of "Terveys ja terveystottumukset" (health and health habits). Flattening the health category instead would have taken 37 questions out of their section. The conversion notes list every split.
- **Categories that are scoring sub-scales, not sections** (ADHD-RS, where the two categories alternate question by question) are handled by the override `"structure": "flat"`: no groups, the questions stay in their original order, and the categories matter only for scoring (§5.5). This is an explicit override and not a heuristic, because the export can't tell the two cases apart.
- Several forms repeat the section name in the first question's text ("Koulu ja vapaa-aika:\n\nLuokka"). That text is kept as is, because removing it would mean guessing.
- `linkId` = `questionId` / `categoryId`. They are stable, unique (verified: no duplicate `questionId` within any survey) and survive reconversion.

### 5.4 Item types

| Source `type` | FHIR item | Notes |
|---|---|---|
| `heading` | `display` | |
| `select` | `choice` | `answerOption.valueCoding` = `{ system: {BASE}/CodeSystem/{surveyGuid}, code: answerId, display: fi }` + translations; `questionnaire-itemControl` = `radio-button` |
| `multiselect` | `choice`, `repeats: true` | `itemControl` = `check-box` |
| `freetext` | `text` | default. Overrides can change it to `string`, `integer`, `decimal`, `date` or `quantity` (§5.6). |
| `number` | `integer` | `minValue`/`maxValue` extensions. `itemControl` = `slider` with `sliderStepValue` 1. `minValueOrUnder`/`maxValueOrOver` are always false in the data; the converter warns if it ever meets a true one. |
| `date` | `date` | |

- `isOptional: false` → `required: true` (never set on `display` or `group`).
- `description` and `printText` are empty in every export, so they are not mapped. The loader rejects non-empty values, so a future export that uses them can't lose content silently.
- Text formatting: line breaks are kept. Trailing whitespace on each line and around the whole text is removed: the trailing double spaces are Markdown hard breaks, and they mean nothing in plain text. No text contains other markup, so there's no `rendering-markdown`. Renderers show the line breaks (`white-space: pre-line`).
- Option-level answer codes are local (`answerId`). Mapping options to Finnish national or international codes (§7.3) happens only through overrides, where population needs it (milestone 10).

### 5.5 Follow-ups and scoring

- **Follow-ups**: `answers[a].question[]` becomes child items **nested under the parent question item** (FHIR allows children under a question), each with `enableWhen { question: parentLinkId, operator: "=", answerCoding: <coding of a> }`. For a `multiselect` parent, `=` matches if any selected value equals the coding, which is the intended meaning. Deeper levels recurse. `enableBehavior` is unnecessary because each follow-up depends on exactly one answer. If a future export puts the same follow-up under several answers, the converter merges them into one item with several `enableWhen` and `enableBehavior: any`.
- **Answer scores**: `scores[].points` go in two places, because tools look for them in different ones:
  - the R4 core `ordinalValue` extension on `answerOption.valueCoding`
  - the SDC `itemWeight` extension on the `answerOption` itself, which is where fhirpath.js's `weight()` reads it
- **Score calculations** → one visible, read-only `decimal` item per calculation. A category's score goes at the end of that category's (last) group, right after its questions. Whole-survey scores, and all scores in a flat questionnaire, go at the end of the questionnaire. Each has:
  - `linkId` = `score-total` / `score-{categoryId}`
  - `text` = the calculation's `title` + translations, unless an override corrects it (below)
  - `sdc-questionnaire-calculatedExpression`: `%resource.repeat(item | answer.item).where(linkId in (…)).answer.value.weight().sum()` over the scored questions in scope (the whole survey, or the category). The evaluator must supply `%resource` (the QuestionnaireResponse) and `%questionnaire`. With nothing answered the result is empty, not 0.
  - `readOnly: true` and never `questionnaire-hidden`: in all of these questionnaires the patient sees the score
  - `minValue`/`maxValue` from the calculation's `min`/`max`
  - `summaries` (bands) as the project's own complex extension `{BASE}/StructureDefinition/score-interpretation` (`min`, `max`, `title`, `description` + translations), because core FHIR has no standard extension for this. **In the current exports every band covers the whole range**, so a band works as a caption, not an interpretation. The conversion notes say so.
- The converter recomputes each score's range from the per-question minimum and maximum points and notes any mismatch (there are none).
- **Score title corrections** (override `scores.{linkId}.title`). The fixes are listed in the conversion notes with the original texts:
  - AUDIT: the sv titles are shifted by one score and the en titles are Finnish.
  - ADHD-RS: the en titles are "Points" or Finnish.
  - Fagerström: the fi title is English.
  - The corrected sv/en texts are our translations. The EPDS score title is a sentence ("A professional will discuss the results with you"); it's odd but not wrong, so it's kept.

### 5.6 Overrides

`converter/overrides/{slug}.json` holds the **only hand-maintained input**. It's named after the slug so it's readable. A file whose slug matches no survey fails the conversion. Milestone 2 implements `code` and `structure`, and the per-item part below comes in milestone 8. Items are keyed by `linkId`:

```json
{
  "items": {
    "<questionId of 'What is your height (cm)?'>": {
      "type": "decimal",
      "unit": { "system": "http://unitsofmeasure.org", "code": "cm" },
      "code": [{ "system": "http://loinc.org", "code": "8302-2", "display": "Body height" }],
      "minValue": 50, "maxValue": 250,
      "observationLinkPeriod": "P1Y"
    }
  },
  "fixes": { "scoreTitles": { … } }
}
```

The converter validates overrides: an unknown `linkId` or an incompatible retyping fails the build. Data-quality fixes (e.g. the AUDIT title shift) also live here, each with a comment explaining the source error, and the report shows which fixes were applied.

### 5.7 Output

- `fhir/questionnaires/{slug}.json`, where the slug comes from the source filename without the guid and timestamp, e.g. `masennuskysely-phq-9.json`.
- `fhir/questionnaires/index.json`: an R4 `Bundle` of type `collection` with all of them, which the app loads.
- `fhir/conversion-report.md`: per questionnaire, the item counts by type, interleaved categories, score max checks, data-quality findings and applied overrides.
- `npm run convert` regenerates all of it. A test (`converter/src/output.test.ts`) regenerates everything in memory and fails if the committed output differs, so a converter change without `npm run convert` fails `npm test`.

## 6. The renderer app

### 6.1 Features (milestones 6–7)

- **Questionnaire list**: title, description and kind (screening / pre-visit / care plan). Any Questionnaire JSON can also be opened from a file, so the renderer isn't tied to our own output.
- **Language switch** fi / sv / en for the UI and the questionnaire texts (translation extensions, falling back to the base text).
- **Item rendering**: group (section heading), display, choice (radio buttons, or a dropdown for long option lists), repeating choice (checkboxes), string, text (textarea), integer/decimal (with unit and min/max), slider, date, read-only calculated score.
- **Conditionality**: `enableWhen` / `enableBehavior`. Disabled items are hidden and their answers are dropped from the response (SDC default).
- **Validation**: required, min/max, and a summary of missing answers when the user presses "Done".
- **Scores**, always shown to the patient, recalculated live by evaluating each score item's `calculatedExpression` with fhirpath.js, so the expression in the Questionnaire is what gets tested. `%resource` and `%questionnaire` are supplied, and an empty result is shown as "–". The band the score falls in is shown with it (its title and description).
- **QuestionnaireResponse**: built live and shown in a JSON panel with a download button. Status `in-progress` / `completed`.

### 6.2 Design

- Form state is a pure reducer over a `linkId`-indexed answer map. The QuestionnaireResponse is derived from the state, never the other way round. This keeps pre-population (§7) simple: it just produces an initial state.
- No form library. Plain accessible HTML controls (`fieldset`/`legend` for choices, labels tied to inputs) and minimal CSS that works on a phone.
- Tests: Vitest + Testing Library for the reducer, enableWhen evaluation, scoring and QuestionnaireResponse generation, plus one snapshot-free smoke test per questionnaire that renders it and fills every required item.

## 7. Pre-population from FHIR Bundles (milestones 8–10)

### 7.1 Input

- The app gets a "Patient data" panel: paste or upload one or more FHIR R4 Bundles (`collection`, `searchset`, `document`, including IPS `document` Bundles), or pick a sample from `samples/bundles/`.
- Resources from all Bundles are merged into one in-memory store indexed by `resourceType` and `id`, and the subject `Patient` is identified (exactly one Patient required, otherwise the user is asked to pick).
- Pre-population runs on demand ("Fill in from patient data") and can be undone.

### 7.2 Mechanisms (SDC)

Two SDC population methods are supported. Both are declared in the Questionnaire through overrides, so the converted Questionnaires stay portable:

1. **Observation-based** (`sdc-questionnaire-observationLinkPeriod` + `item.code`): fill the item from the latest `Observation` for the patient with a matching code, `status` final/amended/corrected, `effective` within the link period. Value types are converted (Quantity → decimal with unit conversion where needed, CodeableConcept → choice when the option codes match). This covers height, weight, blood pressure, smoking status, LMP date (LOINC 8665-2), gravidity/parity (LOINC 11996-6 / 11977-6) and similar.
2. **Expression-based** (`sdc-questionnaire-initialExpression`, FHIRPath): for everything that isn't a single Observation value. The Questionnaire declares `sdc-questionnaire-launchContext` `patient`, and a `sdc-questionnaire-variable` per resource type is resolved against the local store instead of a server. Only `x-fhir-query` of the form `{Type}?patient={{%patient.id}}` (optionally with `code=`) is supported. Examples:
   - "Do you have any medication prescribed by a doctor?" → `yes` if `%medications` has an active `MedicationStatement`/`MedicationRequest`
   - "Do you have any allergies?" → `yes` if `%allergies` has an active `AllergyIntolerance`
   - Multiselect "Have you been diagnosed with any of the following illnesses?" → every option whose value set (§7.3) matches an active `Condition` (the option→code mapping lives in overrides)
   - MMR / varicella vaccination → `Immunization` with the matching vaccine code
   - Contact person's name and phone → `Patient.contact`

The `x-fhir-query` resolver is deliberately tiny and isolated (`populate/localQuery.ts`), so it can later be swapped for a real FHIR server client without touching the rest.

### 7.3 Finnish profiles and code systems

The patient data is expected to follow the Finnish national FHIR specifications, and the population mappings match Finnish codes first:

- **Profiles.** Input Bundles are expected to conform to **FinnishCore** (Finnish Base Profiles, `hl7.fhir.fi.base`) and, for patient-entered measurements, the **Kanta PHR** (Omatietovaranto) profiles. The Patient is identified by the Finnish personal identity code (`urn:oid:1.2.246.21`). Milestone 9 checks whether FinnishCore or Kanta PHR defines Questionnaire / QuestionnaireResponse profiles. If they do, the converter output and the generated QuestionnaireResponse conform to them, and §5 is adjusted.
- **Code systems.** Population value sets list the **Finnish national codes from THL's code server** (Koodistopalvelu): the Finnish ICD-10 edition for diagnoses, THL's vaccine codes for immunizations, ATC (Fimea) for medications, and the measurement codes Kanta PHR uses. Where Finnish data commonly also carries international codes (LOINC, SNOMED CT), they are listed alongside, so Bundles coded either way are matched. Every code-system URI and OID is looked up from the THL code server or the published IGs when the mapping is written, never typed from memory, and the source is noted next to it in the override file.
- **Validation.** The sample Bundles (§7.6) are validated with the FHIR Validator with the FinnishCore and Kanta PHR packages loaded, so the test data is realistic Finnish data and not just valid R4.

### 7.4 Rules

- **Never overwrite** an answer the user has already given. Only empty items are filled.
- **Only fill enabled items**, iterating to a fixed point: filling a parent answer may enable follow-ups that can then be filled too.
- Type mismatches and unconvertible units are skipped and logged, never guessed.
- Population is pure: `(Questionnaire, store, currentState) → { newState, provenance[] }`. Unit tests cover each mechanism against the sample Bundles.

### 7.5 Provenance in the UI

Every pre-filled answer gets a "from record" badge showing the source resource (type, date, display) and the raw JSON on demand. Editing the answer removes the badge. The QuestionnaireResponse records the source with the SDC `itemPopulationContext`-style approach: an `extension` on the answer referencing the source resource.

### 7.6 Sample data

`samples/bundles/` holds **synthetic** patients only, conforming to FinnishCore and using personal identity codes from the test range (individual number 900–999): a pregnant adult for the maternity form, an 8th-grade pupil, a 2-year-old with a parent as `RelatedPerson`, and an adult for the physiotherapy form. Each Bundle is designed to exercise both population paths, including deliberate edge cases: an out-of-period Observation, the wrong unit, an inactive Condition, and two Patients. No real patient data is ever committed.

### 7.7 Mapping coverage (milestone 10)

Start with the items that have obvious codes, then extend:

| Form | First candidates |
|---|---|
| Maternity clinic | height, pre-pregnancy weight (LOINC 56077-1), LMP, gravidity/parity, last childbirth year, diagnosed illnesses, MMR/varicella, prescription and OTC medication, contact person |
| School health (5th/8th grade), upper-secondary | long-term illness, allergies, medication, tobacco/e-cigarette use (where Observations exist) |
| Child health clinic (2 y / 5 y) | long-term illness, allergies, medication, vaccinations up to date |
| Screening instruments | not pre-populated from clinical data. Possibly later from a previous `QuestionnaireResponse` of the same Questionnaire (out of scope for now). |

Each mapped item gets a test asserting the value it receives from the sample Bundle.

## 8. Testing & verification summary

- Converter: unit tests per rule with tiny fixture surveys; golden-output tests over all 14 real files (the diff is reviewed on every change); FHIR Validator with zero errors; score max sanity checks.
- App: reducer, enableWhen, scoring, QuestionnaireResponse, and population tests in Vitest; a manual browser check for each milestone with screenshots noted in the milestone's "verified" entry.
- Cross-check: open three representative Questionnaires (PHQ-9, ADHD-RS, maternity) in LHC-Forms and Smart Forms once, in milestone 11.

## 9. Decisions

- **Canonical base URL**: `https://sensotrend.com/fhir` for `Questionnaire.url`, the local answer CodeSystems and the custom extension.
- **Source data in git**: committed unchanged. It is a public data set, so `createdBy` is not stripped.
- **Finnish profiles and code systems**: used for the input Bundles and the population mappings (§7.3).
- **Free-text retyping**: free-text fields that hold numbers (height, weight, counts, years) are retyped to numeric items through overrides (§5.6).
- **Scores**: shown to the patient in every scored questionnaire, with the interpretation band.

## 10. Progress

### Milestone 0 — Repo setup ✅

- Git repository on `main`; the plan, the decisions and the unchanged source exports committed.
- npm workspace with `converter` (Node + tsx) and `app` (Vite 8 + React 19). Shared `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`) and one flat ESLint config for the repo. Vitest 5 in both workspaces.
- TypeScript is pinned to `~6.0.3`, because typescript-eslint 8.71 only supports TypeScript below 6.1. Revisit when it supports TypeScript 7.
- The duplicate export (§2) is noted in the README. The loader deduplicates it by `revisionGuid` in milestone 1.
- `converter/src/cli.ts` is a placeholder that lists the source files. `app/` renders a placeholder page.
- Verified: `npm run check` passes (lint clean, both workspaces type-check, the converter's smoke test finds the 15 source files), `npm run convert` runs, `npm run build` produces `app/dist/`, and the dev server serves the page at http://localhost:5173 with no console errors.

### Milestone 1 — Source model & loader ✅

- `converter/src/source/schema.ts`: a zod schema for the export format, with the TypeScript types derived from it.
  - Objects are strict, so an unknown key fails loading with its path, e.g. `questions[1].answers[0]: Unrecognized key: "unexpected"`.
  - Fields that are always empty (`printText`, question `description`, `tags`, `numericTagConditions`, `subcategories`, a true `minValueOrUnder`/`maxValueOrOver`) must stay empty, because the converter has no mapping for them.
  - Localized texts need `fi`, `sv` and `en`, and may carry more languages.
- `converter/src/source/integrity.ts`: checks the schema can't express, all reported together with their paths:
  - unique `questionId`s and `answerId`s across the survey, including follow-ups
  - known categories, and follow-ups in the same category as their parent
  - answers only on `select`/`multiselect`, and those always have at least one
  - range fields only (and always) on `number`, with min < max
  - scored questions are `select` and every answer has exactly one score
  - score calculations exist exactly when `scoringEnabled` is true
- `converter/src/source/loader.ts`: loads the directory in file-name order and derives the slug from the file name. An export identical to an earlier one of the same revision is skipped and listed as a duplicate. These are errors: differing content under one `revisionGuid`, two revisions of one survey, a slug collision.
- Found while doing this: question `description` is present on 199 questions but empty everywhere, and in one case it is `{}`. §2.1 and §5.4 are updated.
- Verified: 30 tests pass, against a fixture with every question type, a follow-up, a scored question, an extra language and a score band, plus temporary directories for the duplicate rules. All 15 real files load as 14 surveys plus the one known duplicate. `npm run convert` prints each survey's question and score counts. Lint and type checks are clean.

### Milestone 2 — Core conversion ✅ (milestone 3 merged in)

- `converter/src/convert/questionnaire.ts` converts each survey: the metadata (§5.1), the groups (§5.3, as revised above), every item type (§5.4), `required`, and follow-ups nested under their question with `enableWhen` on the answer's coding (§5.5).
- `converter/src/convert/text.ts`: Finnish in the element itself, Swedish and English (then any extra languages) as `translation` extensions; whitespace normalised; an empty Finnish text is an error.
- `converter/overrides/`: LOINC codes for PHQ-9, GAD-7, AUDIT and EPDS, and `structure: flat` for ADHD-RS. Each file says where its content comes from. The AUDIT code in the original plan (72110-9) doesn't exist; the right one is 72110-0.
- `npm run convert` writes `fhir/questionnaires/{slug}.json` and `index.json` (a collection Bundle), and prints notes per questionnaire. The only notes are the 8th-grade split category and the ADHD-RS flat structure.
- Scoring (`ordinalValue`, score items) is still missing; it's milestone 4.
- Verified:
  - 52 tests pass. They cover every mapping rule on the fixture, the override loading, the output writer, a check that the committed output is identical to a fresh conversion, and unique `linkId`s in every Questionnaire.
  - Item counts in the output match the 14 unique source surveys exactly: 351 choice (323 select + 28 multiselect, 28 of them repeating), 219 text, 28 display, 4 integer, 1 date, 117 follow-ups with `enableWhen`, 575 required, and 66 groups, which is the sum of the category runs.
  - FHIR Validator validation is milestone 5.

### Milestone 4 — Scoring ✅

- `converter/src/convert/scoring.ts` implements the scoring rules of §5.5 (as revised above): answer scores, score items with their FHIRPath, ranges and bands, and placement.
- Score title corrections are in the AUDIT, ADHD-RS and Fagerström override files, each with a `$comment` describing the source error.
- **Found and left for milestone 5** (data-quality fixes and the report):
  - AUDIT's sv/en category names are untranslated Finnish and say "keskiarvo" (mean) where the fi says "summa" (sum).
  - ADHD-RS's en category names are Finnish.
  - Fagerström's category name has copies of the English text under ar/de/et/it/ru.
- Verified:
  - 68 tests pass.
  - Unit tests on the fixture cover both score extensions, the score item, placement in groups, at the end, and flat, title overrides, unknown override keys, and the range and band notes.
  - For all 7 scored questionnaires (12 scores), a test builds QuestionnaireResponses and evaluates each `calculatedExpression` with fhirpath.js 5.2.0. The highest answers give exactly `maxValue`, the lowest give `minValue`, and an empty response gives no value.
