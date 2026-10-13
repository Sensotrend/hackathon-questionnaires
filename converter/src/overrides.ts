// Per-questionnaire overrides (plan §5.6): the only hand-maintained input to
// the conversion. One file per survey, named after its slug.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { OVERRIDES_DIR } from "./paths.ts";

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
