import { loadSources, SourceError } from "./source/loader.ts";

// Until milestone 2 this only loads and validates the sources.
try {
  const { surveys, duplicates } = loadSources();
  for (const { slug, survey } of surveys) {
    console.log(`${slug}: ${survey.questions.length} top-level questions, score calculations: ${survey.scoreCalculations.length}`);
  }
  for (const { file, duplicateOf } of duplicates) {
    console.log(`skipped ${file}: identical to ${duplicateOf}`);
  }
  console.log(`${surveys.length} surveys loaded. Conversion is not implemented yet (milestones 2–5).`);
} catch (error) {
  if (!(error instanceof SourceError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
