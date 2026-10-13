// The whole conversion, in memory: what `npm run convert` writes and what the
// freshness test compares against the committed files.

import { convertSurvey } from "./convert/questionnaire.ts";
import { definitions } from "./definitions.ts";
import type { Output } from "./output.ts";
import { loadOverrides, unusedOverrideFiles } from "./overrides.ts";
import { conversionReport } from "./report.ts";
import { loadSources } from "./source/loader.ts";

export function build(): Output & { notes: Map<string, string[]> } {
  const { surveys, duplicates } = loadSources();
  const unused = unusedOverrideFiles(surveys.map((source) => source.slug));
  if (unused.length > 0) throw new Error(`Override files that match no survey: ${unused.join(", ")}`);

  const entries = surveys.map((source) => {
    const overrides = loadOverrides(source.slug);
    return { slug: source.slug, file: source.file, overrides, ...convertSurvey(source, overrides) };
  });
  return {
    converted: entries,
    definitions,
    report: conversionReport(entries, duplicates),
    notes: new Map(entries.map((entry) => [entry.slug, entry.notes])),
  };
}
