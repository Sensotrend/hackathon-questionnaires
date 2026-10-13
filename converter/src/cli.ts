import { convertSurvey } from "./convert/questionnaire.ts";
import { writeQuestionnaires } from "./output.ts";
import { loadOverrides, unusedOverrideFiles } from "./overrides.ts";
import { OUTPUT_DIR } from "./paths.ts";
import { loadSources } from "./source/loader.ts";

try {
  const { surveys, duplicates } = loadSources();
  const unused = unusedOverrideFiles(surveys.map((source) => source.slug));
  if (unused.length > 0) throw new Error(`Override files that match no survey: ${unused.join(", ")}`);

  const converted = surveys.map((source) => ({ slug: source.slug, ...convertSurvey(source, loadOverrides(source.slug)) }));
  writeQuestionnaires(OUTPUT_DIR, converted);

  for (const { slug, questionnaire, notes } of converted) {
    console.log(`${slug}: ${questionnaire.item?.length ?? 0} top-level items`);
    for (const note of notes) console.log(`  - ${note}`);
  }
  for (const { file, duplicateOf } of duplicates) console.log(`skipped ${file}: identical to ${duplicateOf}`);
  console.log(`${converted.length} Questionnaires written to ${OUTPUT_DIR}`);
} catch (error) {
  if (!(error instanceof Error)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
