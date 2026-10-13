import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The Lunna survey exports the converter reads (§2 of the plan). */
export const SOURCE_DIR = `${repoRoot}Esitieto_lomakkeet_hackathon_json/`;

/** Hand-maintained per-questionnaire overrides (§5.6 of the plan). */
export const OVERRIDES_DIR = `${repoRoot}converter/overrides/`;

/** Where the generated Questionnaires go (§5.7 of the plan). */
export const OUTPUT_DIR = `${repoRoot}fhir/questionnaires/`;
