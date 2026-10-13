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

/**
 * A free-text question retyped to what its answers really are, e.g. height
 * in cm as a decimal (plan §5.6). Only free-text questions can be retyped.
 */
export const ItemOverride = z
  .strictObject({
    $comment: z.string().optional(),
    type: z.enum(["integer", "decimal", "string", "date"]),
    unit: z.enum(Object.keys(UNITS) as [Unit, ...Unit[]]).optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
  })
  .refine((item) => item.minValue === undefined || item.maxValue === undefined || item.minValue < item.maxValue, {
    message: "minValue must be below maxValue",
  })
  .refine(
    (item) =>
      ["integer", "decimal"].includes(item.type) ||
      (item.unit === undefined && item.minValue === undefined && item.maxValue === undefined),
    { message: "unit, minValue and maxValue need type integer or decimal" },
  )
  .refine(
    (item) => item.type !== "integer" || [item.minValue, item.maxValue].every((value) => value === undefined || Number.isInteger(value)),
    { message: "an integer item needs whole-number limits" },
  );
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
  /** Retyped free-text questions, keyed by linkId (questionId). */
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
