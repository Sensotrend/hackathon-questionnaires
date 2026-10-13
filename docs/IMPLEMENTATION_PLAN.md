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
  src/report.ts                      conversion report: notes and data-quality fixes
  src/validate.ts                    runs the HL7 FHIR Validator and summarises its result
fhir/                                GENERATED (§5.7)
  questionnaires/                    one Questionnaire per survey + index.json
  codesystems/                       the answer options of each survey
  definitions/                       the score-interpretation extension
tools/validator_cli.jar              the HL7 FHIR Validator, downloaded, not committed (README)
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

`converter/overrides/{slug}.json` holds the **only hand-maintained input**. It's named after the slug so it's readable. A file whose slug matches no survey fails the conversion. Milestone 2 implements `code` and `structure`. Milestone 8 implements the per-item `type`, `unit`, `minValue` and `maxValue`; `code` and `observationLinkPeriod` come with population in milestones 9–10. Items are keyed by `linkId`:

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

The converter validates overrides: an unknown `linkId` or an incompatible retyping fails the build. Data-quality fixes also live here, each with a `$comment` explaining the source error, and every applied fix is a note in the conversion report with the original text:

- `scores.{linkId}.title`: score titles (§5.5)
- `texts.{key}`: any source text, keyed by `name`, `description`, or a category, question or answer id. The value holds new texts per language, and `remove` drops extra languages (fi, sv and en can only be replaced). Applied before conversion. An unknown key, a change to the text it already has, or removing a language that isn't there fails the conversion, so stale overrides can't linger.
- Control characters (C0 except tab and line breaks, and DEL) are stripped from every text automatically and noted. There's one in the data: a U+0002 inside a Swedish word.

### 5.7 Output

- `fhir/questionnaires/{slug}.json`, where the slug comes from the source filename without the guid and timestamp, e.g. `masennuskysely-phq-9.json`.
- `fhir/questionnaires/index.json`: an R4 `Bundle` of type `collection` with all of them, which the app loads.
- `fhir/codesystems/{slug}.json`: a CodeSystem per survey, one concept per answer option (`answerId`) with the Finnish display and sv/en designations. It lets the validator check every answer code and display the Questionnaires use.
- `fhir/definitions/StructureDefinition-score-interpretation.json`: the definition of the score-band extension (§5.5).
- `fhir/conversion-report.md`: a table of all questionnaires (groups, questions, follow-ups, scores, notes), the skipped duplicate, and per questionnaire its source, output, identity, item counts, overrides used and every note.
- `fhir/validation.md`: written by `npm run validate`, not `npm run convert`: the validator's issues grouped by severity and message, each warning with the reason it's accepted, or **not accepted**.
- `npm run convert` regenerates all of it. A test (`converter/src/output.test.ts`) regenerates everything in memory and fails if the committed output differs, so a converter change without `npm run convert` fails `npm test`.

## 6. The renderer app

### 6.1 Features (milestones 6–7)

- **Questionnaire list**: title, description and kind (screening / pre-visit / care plan). Any Questionnaire JSON can also be opened from a file, so the renderer isn't tied to our own output.
- **Language switch** fi / sv / en for the UI and the questionnaire texts (translation extensions, falling back to the base text).
- **Item rendering**: group (section heading), display, choice (radio buttons, or a dropdown for long option lists), repeating choice (checkboxes), string, text (textarea), integer/decimal (with unit and min/max), slider, date, read-only calculated score.
- **Conditionality**: `enableWhen` / `enableBehavior`. Disabled items are hidden and their answers are dropped from the response and from validation (SDC default). They stay in the form state, so they come back if the item is enabled again.
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

- **Profiles.** Input Bundles are expected to conform to **FinnishCore** (Finnish Base Profiles, `hl7.fhir.fi.base`) and, for patient-entered measurements, the **Kanta PHR** (Omatietovaranto) profiles. The Patient is identified by the Finnish personal identity code (`urn:oid:1.2.246.21`).
- **Questionnaire and QuestionnaireResponse profiles (checked in milestone 9).** FinnishCore 2.0.0 has none. Kanta PHR has the Finnish PHR Questionnaire and QuestionnaireResponse profiles (1.1.0, R4). [Kanta's developer page](https://kanta.fi/en/system-developers/questionnaires) (updated 14.11.2023) says the R4 versions are not yet in production and no application uses them yet.
  - **Questionnaire profile: not adopted.** It requires a `code` from the Finnish PHR Questionnaire Code value set, which is assigned per questionnaire, and outside sandboxes only Kela stores Questionnaires in Kanta PHR. It also says `language` must be left out when one resource holds several languages, whereas ours declare `fi` and carry sv/en translations. Our Questionnaires therefore don't claim the profile. They already have its other required elements: url, identifier, version, name, title, status, date, description, item.
  - **QuestionnaireResponse profile: followed where possible.** It requires `language`, a narrative (`text`) with the questions and answers, one globally unique `identifier`, `questionnaire`, `status` (not `entered-in-error`), `subject` (a Patient in Kanta PHR), `authored` and `source`. The app's response has all of these, but `subject`/`source` only once patient data identifies the person, and `authored` only once the response is completed. It doesn't set `meta.profile`, since the subject isn't a Kanta PHR Patient.
- **Code systems.** Population value sets list the **Finnish national codes from THL's code server** (Koodistopalvelu): the Finnish ICD-10 edition for diagnoses, THL's vaccine codes for immunizations, ATC (Fimea) for medications, and the measurement codes Kanta PHR uses. Where Finnish data commonly also carries international codes (LOINC, SNOMED CT), they are listed alongside, so Bundles coded either way are matched. Every code-system URI and OID is looked up from the THL code server or the published IGs when the mapping is written, never typed from memory, and the source is noted next to it in the override file.
- **Validation.** The sample Bundles (§7.6) are validated with the FHIR Validator with the FinnishCore and Kanta PHR packages loaded, so the test data is realistic Finnish data and not just valid R4.

### 7.4 Rules

- **Never overwrite** an answer the user has already given. Only empty items are filled.
- **Only fill enabled items**, iterating to a fixed point: filling a parent answer may enable follow-ups that can then be filled too.
- Type mismatches and unconvertible units are skipped and logged, never guessed.
- Population is pure: `(Questionnaire, store, currentState) → { newState, provenance[] }`. Unit tests cover each mechanism against the sample Bundles.

### 7.5 Provenance in the UI

Every pre-filled answer gets a "from patient data" badge showing its source resources (display, date) and their raw JSON on demand. Editing the answer removes the badge. The QuestionnaireResponse records each source as the project's `answer-source` extension (a Reference) on the answer, defined in `fhir/definitions/`. Values computed rather than read from a resource (yes for "any active allergies?") cite the records in the variables the expression used.

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

- Converter: unit tests per rule with a fixture survey; a freshness test that regenerates everything and compares it with the committed `fhir/`; score expressions evaluated with fhirpath.js; `npm run validate` with zero errors (it needs Java and the downloaded validator, so it isn't part of `npm test`).
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

### Milestone 5 — Validation & report ✅

- **Validator:** the HL7 FHIR Validator 6.10.4 (SHA-256 checked against GitHub's digest) runs as `npm run validate` with R4 and SDC 3.0.0, plus our CodeSystems and extension definition. It writes `fhir/validation.md` and fails on any error. **Result: 29 files, 0 errors**, 33 warnings, all of two accepted kinds:
  - no narrative (dom-6, a best-practice recommendation)
  - no Finnish LOINC display for the four instrument codes
- **Before the fixes**, the first run reported 8 errors and 1,399 information messages:
  - the 8 errors: the score-band extension had no definition
  - the 1,399 messages: the answer code systems couldn't be found, so no answer code was checked
  - one warning: an illegal control character
- **New output:** answer CodeSystems, the extension's StructureDefinition, and `fhir/conversion-report.md`.
- **Checked by breaking copies on purpose:** the validator rejects a band with a missing or unknown part, an unknown answer code and a wrong display. So the zero errors is a real check, not a silent pass.
- **Data-quality fixes** (text overrides; the translations are ours and should be reviewed by a native speaker):
  - AUDIT: the three sub-scale category names (sv, en), plus one untranslated sv answer option
  - Upper-secondary health check: the en texts of the alcohol-portions follow-up and its five options
  - Low-back physiotherapy: the en description
  - 5th-grade form: one sv answer option
  - ADHD-RS: the two en category names
  - Fagerström: five filler languages dropped from a category name
  - Upper-secondary health check: the control character (U+0002) stripped automatically from a sv text
  - Found by scanning all texts for sv or en identical to fi, extra languages, and control characters. The conversion report lists 36 notes in all.
- Verified: 81 tests pass. New tests cover the fixes (each override form and each rejection), the CodeSystem (also checked against every answer option of every real Questionnaire), the report, the validator output parsing and summary, and the writer, which leaves `validation.md` alone. `npm run validate` passes.

### Milestone 6 — Renderer basics ✅

- **List:** `app/` fetches `fhir/questionnaires/index.json` as a separate asset (3.5 MB, 211 kB gzipped; the JavaScript is 74 kB gzipped) and lists the questionnaires with title, first line of the description, kind and question count. Kind is care plan from `useContext`, screening if the questionnaire has score items, pre-visit otherwise.
- **Opening files:** the list can also open any Questionnaire, or a Bundle of them, from a file.
- **Routing:** a `#/q/<id>` hash route; no router library. A new page scrolls to the top.
- **Language:** a fi / sv / en switch for the app's texts and the questionnaire texts (translation extensions, falling back to the base text). It is remembered in `localStorage` (guarded, since storage may be unavailable). The first default comes from the browser's language, then Finnish. Switching keeps the answers.
- **Rendering every item type:**
  - group as a section with a heading; display as a paragraph; line breaks kept
  - choice as radio buttons, or check boxes when repeating, or a drop-down when the item control says so (or more than 10 options without one); open-choice adds "Other"
  - string, url, text (textarea), date, dateTime, time, boolean (yes/no)
  - integer and decimal as text fields that keep what is typed until it's a valid number; a slider when the item control says so and a range is given. An unanswered slider shows "–" and a dimmed thumb, and gets a Clear button once answered.
  - calculated scores as a read-only output with the scale (the value comes in milestone 7)
  - anything else is named as unsupported
- **Accessibility:** choices are `fieldset`/`legend`, single controls have labels, and required questions show `*` with the word ("pakollinen") for screen readers.
- **State:** the answers live in a reducer keyed by `linkId` (`app/src/renderer/state.ts`).
- **Not yet (milestone 7):** follow-ups are always shown, nothing is validated, scores show "–", and there is no QuestionnaireResponse.
- Verified:
  - 35 app tests pass (Vitest + jsdom + Testing Library): the reducer, localization, list classification, every control type and its interactions, language switching keeping answers, App routing, language memory, load errors, and opening files. Every one of the 14 real Questionnaires renders an element for every item in all three languages, with nothing unsupported.
  - Checked in the browser:
    - list, navigation, PHQ-9 and maternity forms (8 sections, follow-up blocks, date field)
    - answering and switching to Finnish keeps the answer
    - the physiotherapy sliders at 375 px wide with no horizontal scroll
    - dark mode
  - Two bugs found in the browser and fixed:
    - a page opened from far down the list kept its scroll position
    - the fix's `useEffect(() => window.scrollTo(…))` crashed React, because newer Chromium returns a Promise from `scrollTo`

### Milestone 7 — Renderer behaviour ✅

- **Conditionality** (`app/src/renderer/enable.ts`):
  - R4 `enableWhen` with all operators (`exists`, `=`, `!=` (true also with no answer), `>`, `<`, `>=`, `<=`), and `enableBehavior`.
  - An item is enabled when its parent is and its conditions hold on the answers of enabled items. This repeats to a fixed point, so conditions may point forward, and hiding a question also hides what depends on it. Endless flipping is cut off after 100 rounds.
- **Response** (`response.ts`):
  - Derived from the state. It mirrors the questionnaire: groups only when they have answers; no display items; each follow-up under the answer that satisfies its condition (with a repeating parent, the right one of several); children of an unanswered question under the item itself.
  - `questionnaire` = `url|version`. `status` is `completed` after a successful Done while the form stays valid, otherwise `in-progress`. `authored` is set when completed.
- **Scores** (`scores.ts`): each item's `calculatedExpression` is evaluated with fhirpath.js on the response so far, with `%resource` and `%questionnaire`. Shown live with the band, and included in the response as `valueDecimal`.
- **Validation** (`validation.ts`):
  - Covers required questions and groups, min/max, and text in a number field that isn't a valid (whole) number. The field's text is flagged in the form state, so the response and validation agree with what is on screen.
  - Issues show after the first Done: inline messages tied with `aria-describedby`/`aria-invalid`, and a summary (`role=alert`) that gets focus and links each issue to its question.
- **Actions:** Done; Clear answers with an inline confirmation (no browser dialog); a collapsible JSON view of the response with its status, which opens on completion; Download as `QuestionnaireResponse-<id>.json`.
- **Bundle size:** fhirpath.js and its R4 model are 1.2 MB, so the form is lazy-loaded (`React.lazy`). The list page stays at 73 kB gzipped; the form chunk is 233 kB gzipped and loads when a questionnaire is opened.
- **Found in the browser and fixed:** focus didn't move to the issue summary while the page wasn't being painted, because it waited for `requestAnimationFrame`. It now moves in an effect after render.
- Verified:
  - 63 app tests pass:
    - logic: every operator, chains, `any`/`all`, forward references, flipping conditions; response structure including follow-ups under the right answer of a repeating question; every validation rule
    - end to end on real questionnaires: PHQ-9 from empty, through the 10-item summary with focus and links, to score 27 and a completed response with `authored`, the score answer, download and reset with confirmation; a maternity follow-up appearing for its answer only and leaving the response when hidden; invalid number text flagged and then fixed
  - In the browser, with no errors on a fresh load:
    - all 14 questionnaires opened, answered with each question's first option, and Done pressed: the 7 screening forms complete (EPDS 21 and Fagerström 3, since their first options carry points); the pre-visit forms list their remaining required free-text questions
    - AUDIT's three sub-scores sit in their sections and add up to the total (8 + 12 + 16 = 36; the last option of question 2, "I don't drink alcohol", scores 0)

### Milestone 8 — Retyping overrides ✅

- **The override:** `items.{linkId}` takes `type` (integer, decimal, string, date), `unit` (a UCUM code from `converter/src/units.ts`: cm, kg, g, ug, h, d, wk, a), `minValue` and `maxValue`.
  - Only free-text questions can be retyped. An override for anything else, or for a linkId that doesn't exist, fails the conversion.
  - The shape is checked: min below max; unit and limits only on numbers; whole-number limits on integers.
- **Units in the output:** the core `questionnaire-unit` extension with UCUM's own display (the code). The words shown next to the field (cm, vuotta / år / years, …) are `translation` extensions, Finnish included. The first validation run showed why: a Coding's display must be the code system's display, so "viikkoa" as the display was an error.
- **32 questions retyped:**
  - maternity: 14 (counts, years, ages, gestational weeks, height, pre-pregnancy weight, hours of activity and sleep)
  - low-back physiotherapy: 3 (pain duration in days, height, weight)
  - 5th grade: 6 (years of family changes, screen time, vitamin D µg)
  - 8th grade: 9 (school grades 4–10, screen time, vitamin D µg, menarche age, cycle and bleeding days)
- **Kept as free text on purpose:** answers that may hold several values (twins' birth weights, years of several miscarriages or abortions, breastfeeding months, sleep from–to) and clock times. Limits are generous, to catch typos like 1655 cm rather than to judge answers. Years are 1950–2100.
- **Renderer:** the unit goes next to the field and the allowed range below it ("Sallittu väli 100–250 cm"). Both are tied to the field with `aria-describedby`, so screen readers hear them, followed by any error.
- Verified:
  - 91 converter tests and 65 app tests pass. The new tests cover retyping with unit, limits and translated unit words; string and date retyping; rejected overrides; every schema rule; and in the app, the maternity height question: description, the max error for 1655, `valueDecimal` 165.5 from "165,5", and Swedish unit words.
  - `npm run validate`: 0 errors. The new warnings, no Finnish display for UCUM codes, are accepted like the LOINC ones.
  - In the browser, the maternity form shows units and ranges in Finnish for its retyped top-level questions.

### Milestone 9 — Pre-population engine ✅

- **9a: Finnish profiles and the response.** FinnishCore has no questionnaire profiles. Kanta PHR's Questionnaire profile isn't adopted, and its QuestionnaireResponse profile is followed where possible (§7.3). The response now has `language`, a generated narrative (questions and answers; escaped; `lang`/`xml:lang`), a UUID `identifier` per form (a reset starts a new one), and `subject`/`source` once a patient is chosen.
- **9b: Patient data** (`app/src/populate/store.ts`, `PatientDataPanel.tsx`):
  - Files (several at once) or pasted JSON, added to one store. Bundles of any type are flattened, also nested ones. A later copy of a resource replaces the earlier one.
  - References resolve by `Type/id`, absolute URL, `_history` URL or `urn:uuid` fullUrl. A resource is about a patient when its `subject`/`patient`/`beneficiary` resolves to them.
  - With several Patients the person picks one. With none the panel says so. The data is kept across questionnaires and can be removed.
- **9c: The engine** (`populate.ts`, `observation.ts`, `expression.ts`, `query.ts`, `units.ts`):
  - **Observation-based:** `code` + `observationLinkPeriod` take the latest final/amended/corrected Observation about the patient effective within the period, or a matching component of it. Values: quantities converted between units of the same dimension (length, mass, time; `units.ts`); integers that must be whole; codes mapped to answer options; dates; strings; booleans.
  - **Expression-based:** `initialExpression` (FHIRPath) with launch context `%patient` and `variable`s (FHIRPath or `x-fhir-query`) on the Questionnaire and on items, inherited by descendants.
  - **`x-fhir-query`** is answered from the store as a searchset Bundle. It supports `_id`, `patient`, `subject`, `code` (token, comma = or), `status` and `clinical-status`; any other parameter is an error, not a silently wrong answer.
  - **Answers from expressions:** codings, CodeableConcepts or option codes for choices; quantities converted to the item's unit. A repeating item takes all distinct values; a single-answer item with several values is skipped.
  - **Sources:** each value is traced to the resource it came from (fhirpath.js internal types).
  - **Rules:** only enabled, empty, valid items are filled, and never over an answer; it repeats until nothing more fills, so filled answers can enable follow-ups that then fill. Each item that could have been filled but wasn't gets a reason, and launch contexts that aren't available are warned about.
- **9d: In the form:**
  - "Fill in from patient data" (disabled until a patient is chosen), a status line with the count, the skipped items with their reasons, and undo (back to the state before filling).
  - Badges with sources and raw JSON; editing an answer removes its badge.
  - `answer-source` extensions in the response.
- **Not yet:** the converted Questionnaires have no population definitions. Codes, `observationLinkPeriod`, launch context, variables and expressions come with the mappings in milestone 10, and so do the sample Bundles.
- Verified:
  - 91 converter and 101 app tests pass.
  - Engine tests use one questionnaire and Bundle that exercise every path and skip reason (latest-in-period, preliminary and other patients' data ignored, m→cm, a component, a date, a code, FHIRPath on the patient, a local query with a computed yes, a follow-up filled in a second round, never overwriting, an unsupported query parameter, a non-integer weight, a missing launch context), plus the query and unit tables.
  - UI tests: loading, patient choice, filling, badges and source JSON, the response's sources and subject, dropping a badge on edit, undo.
  - `npm run validate` (30 files with the new definition): 0 errors.
  - A filled-in response checked separately with the validator found the narrative missing `lang`/`xml:lang`, now fixed. It also confirmed that a SNOMED code with a Finnish display is an error. **For milestone 10:** answer options keep their local codes; national codes go in the matching, not in the answers.
  - In the browser, the test questionnaire and Bundle were loaded through the file inputs and the patient chosen. The fill gave 9 answers with badges and sources and the 3 expected skips, with no errors.
