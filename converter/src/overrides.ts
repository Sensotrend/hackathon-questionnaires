// Per-questionnaire overrides (plan §5.6): the only hand-maintained input to
// the conversion. One file per survey, named after its slug.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { OVERRIDES_DIR } from "./paths.ts";
import { UNITS, type Unit } from "./units.ts";

const LocalizedText = z.strictObject({ fi: z.string().min(1), sv: z.string().min(1), en: z.string().min(1) });

const Coding = z.strictObject({
  system: z.url(),
  code: z.string().min(1),
  display: z.string().min(1),
});

/**
 * A correction to one source text: new texts for some languages, and extra
 * languages to drop (fi, sv and en can only be replaced).
 */
export interface TextFix {
  $comment?: string;
  remove?: string[];
  /** New text per language. */
  [lang: string]: string | string[] | undefined;
}
export const TextFix: z.ZodType<TextFix> = z
  .strictObject({
    $comment: z.string().optional(),
    remove: z.array(z.string().min(2)).min(1).optional(),
  })
  .catchall(z.string().min(1)) as z.ZodType<TextFix>;

/** What the patient data must hold for an answer (plan §7.2). */
export const Evidence = z.strictObject({
  /**
   * The collection: active conditions, every condition but refuted ones
   * (conditionHistory, for "have you had …"), active allergies and
   * medications, completed immunizations, final observations.
   */
  in: z.enum(["conditions", "conditionHistory", "allergies", "medications", "immunizations", "observations"]),
  /**
   * Codes by system. ICD-10 and ATC codes match as prefixes (E11 matches
   * E11.9), since both are hierarchical by code; other systems match exactly.
   */
  codes: z.record(z.url().or(z.string().startsWith("urn:oid:")), z.array(z.string().regex(/^[A-Za-z0-9.-]+$/)).min(1)).optional(),
  /** An extra FHIRPath condition on each resource, e.g. `value.value > 0`. */
  where: z.string().min(1).optional(),
  /**
   * Long-term conditions only: marked permanent (FinnishCore
   * condition-permanence PYS), or unmarked and on the problem list.
   */
  longTerm: z.literal(true).optional(),
}).refine((evidence) => !evidence.longTerm || evidence.in === "conditions" || evidence.in === "conditionHistory", {
  message: "longTerm applies to conditions",
});
export type Evidence = z.infer<typeof Evidence>;

/** Evidence of one kind, or of any of several (e.g. a varicella vaccination or a past chickenpox diagnosis). */
const AnyEvidence = z.union([Evidence, z.array(Evidence).min(1)]);
export type AnyEvidence = z.infer<typeof AnyEvidence>;
export const evidenceList = (evidence: AnyEvidence): Evidence[] => (Array.isArray(evidence) ? evidence : [evidence]);

/** How a question is filled in from patient data, beyond observation-based population (plan §7.2). */
export const Populate = z.union([
  /** A choice question: the option (by its Finnish text) when there is evidence. Nothing when there isn't. */
  z.strictObject({ answer: z.string().min(1), when: AnyEvidence }),
  /** A text question: the names of the evidence's resources, comma-separated. */
  z.strictObject({ list: AnyEvidence }),
  /** A repeating choice question: each option (by its Finnish text) that has evidence. */
  z.strictObject({ options: z.record(z.string().min(1), AnyEvidence) }),
  /**
   * Anything else: a FHIRPath initialExpression over %patient and the
   * collections. `{{option:text}}` stands for the Coding of the item's option
   * with that Finnish text. Item variables, FHIRPath or evidence, come first;
   * the records an answer came from are those in the variables it uses.
   */
  z.strictObject({
    expression: z.string().min(1),
    variables: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), z.union([z.string().min(1), AnyEvidence])).optional(),
  }),
]);
export type Populate = z.infer<typeof Populate>;

const ObservationCoding = z.strictObject({ system: z.string().min(1), code: z.string().min(1), display: z.string().min(1) });

/**
 * Changes to one question (plan §5.6, §7): retyping a free-text question to
 * what its answers really are, and filling any question in from patient data.
 */
export const ItemOverride = z
  .strictObject({
    $comment: z.string().optional(),
    type: z.enum(["integer", "decimal", "string", "date"]).optional(),
    unit: z.enum(Object.keys(UNITS) as [Unit, ...Unit[]]).optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    /** `item.code`, for observation-based population. */
    code: z.array(ObservationCoding).min(1).optional(),
    /** How old an Observation may be, e.g. `{ "value": 1, "unit": "a" }`. Needs `code`. */
    observationLinkPeriod: z.strictObject({ value: z.number().positive(), unit: z.enum(["a", "mo", "wk", "d"]) }).optional(),
    populate: Populate.optional(),
  })
  .refine((item) => item.minValue === undefined || item.maxValue === undefined || item.minValue < item.maxValue, {
    message: "minValue must be below maxValue",
  })
  .refine(
    (item) =>
      (item.type !== undefined && ["integer", "decimal"].includes(item.type)) ||
      (item.unit === undefined && item.minValue === undefined && item.maxValue === undefined),
    { message: "unit, minValue and maxValue need type integer or decimal" },
  )
  .refine(
    (item) => item.type !== "integer" || [item.minValue, item.maxValue].every((value) => value === undefined || Number.isInteger(value)),
    { message: "an integer item needs whole-number limits" },
  )
  .refine((item) => (item.code === undefined) === (item.observationLinkPeriod === undefined), {
    message: "code and observationLinkPeriod go together",
  })
  .refine((item) => item.type !== undefined || item.code !== undefined || item.populate !== undefined, {
    message: "an item override needs a type, an observation code or a populate rule",
  });
export type ItemOverride = z.infer<typeof ItemOverride>;

export const Overrides = z.strictObject({
  /** Free-form notes: where codes come from, why an override exists. */
  $comment: z.union([z.string(), z.array(z.string())]).optional(),
  /** `Questionnaire.code`, e.g. the LOINC panel of a validated instrument. */
  code: z.array(Coding).min(1).optional(),
  /**
   * `flat`: no groups, the questions stay in their original order. For
   * surveys whose categories are scoring sub-scales rather than sections
   * (plan §5.3).
   */
  structure: z.literal("flat").optional(),
  /**
   * Corrections to score items, keyed by their linkId (`score-total`,
   * `score-{categoryId}`), for score titles that are wrong in the source.
   */
  scores: z.record(z.string(), z.strictObject({ $comment: z.string().optional(), title: LocalizedText })).optional(),
  /**
   * Corrections to source texts, keyed by `name`, `description`, or a
   * category, question or answer id. Applied before conversion.
   */
  texts: z.record(z.string(), TextFix).optional(),
  /** Changes to questions, keyed by linkId (questionId): retyping and population. */
  items: z.record(z.string(), ItemOverride).optional(),
});
export type Overrides = z.infer<typeof Overrides>;

export function loadOverrides(slug: string, dir: string = OVERRIDES_DIR): Overrides {
  const path = join(dir, `${slug}.json`);
  if (!existsSync(path)) return {};
  const result = Overrides.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!result.success) throw new Error(`${path}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** Override files whose slug matches no survey: most likely a renamed export. */
export function unusedOverrideFiles(slugs: string[], dir: string = OVERRIDES_DIR): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => !slugs.includes(file.slice(0, -".json".length)));
}
