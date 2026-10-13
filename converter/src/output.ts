// Writes everything under fhir/ that the converter generates (plan §5.7).
// Each generated directory is emptied first, so removed surveys don't linger.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bundle, CodeSystem, Questionnaire, StructureDefinition } from "fhir/r4";

export const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export interface Output {
  converted: { slug: string; questionnaire: Questionnaire; codeSystem: CodeSystem }[];
  definitions: StructureDefinition[];
  report: string;
}

/** Every generated file, relative to the fhir/ directory, with its content. */
export function outputFiles({ converted, definitions, report }: Output): Map<string, string> {
  const files = new Map<string, string>();
  for (const { slug, questionnaire, codeSystem } of converted) {
    files.set(`questionnaires/${slug}.json`, toJson(questionnaire));
    files.set(`codesystems/${slug}.json`, toJson(codeSystem));
  }
  files.set("questionnaires/index.json", toJson(indexBundle(converted.map((entry) => entry.questionnaire))));
  for (const definition of definitions) files.set(`definitions/StructureDefinition-${definition.id}.json`, toJson(definition));
  files.set("conversion-report.md", report);
  return files;
}

export const GENERATED_DIRS = ["questionnaires", "codesystems", "definitions"];

export function writeOutput(fhirDir: string, output: Output) {
  for (const dir of GENERATED_DIRS) rmSync(join(fhirDir, dir), { recursive: true, force: true });
  for (const [path, content] of outputFiles(output)) {
    mkdirSync(join(fhirDir, path, ".."), { recursive: true });
    writeFileSync(join(fhirDir, path), content);
  }
}

/** All Questionnaires in one collection Bundle, which the app loads. */
export function indexBundle(questionnaires: Questionnaire[]): Bundle<Questionnaire> {
  return {
    resourceType: "Bundle",
    id: "questionnaires",
    type: "collection",
    entry: questionnaires.map((resource) => ({ fullUrl: resource.url, resource })),
  };
}
