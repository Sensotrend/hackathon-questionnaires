import { build } from "./build.ts";
import { writeOutput } from "./output.ts";
import { FHIR_DIR } from "./paths.ts";

try {
  const output = build();
  writeOutput(FHIR_DIR, output);
  const noteCount = [...output.notes.values()].reduce((sum, notes) => sum + notes.length, 0);
  console.log(
    `${output.converted.length} Questionnaires and CodeSystems written to ${FHIR_DIR}, with ${noteCount} notes in fhir/conversion-report.md.`,
  );
} catch (error) {
  if (!(error instanceof Error)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
