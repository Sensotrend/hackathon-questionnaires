import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The Lunna survey exports the converter reads (§2 of the plan). */
export const SOURCE_DIR = `${repoRoot}Esitieto_lomakkeet_hackathon_json/`;

/** Hand-maintained per-questionnaire overrides (§5.6 of the plan). */
export const OVERRIDES_DIR = `${repoRoot}converter/overrides/`;

/** Where the generated FHIR resources and reports go (§5.7 of the plan). */
export const FHIR_DIR = `${repoRoot}fhir/`;

/** Synthetic patient data for pre-population (plan §7.6). */
export const SAMPLES_DIR = `${repoRoot}samples/bundles/`;

/** The HL7 FHIR Validator; not committed, see the README. */
export const VALIDATOR_JAR = `${repoRoot}tools/validator_cli.jar`;
