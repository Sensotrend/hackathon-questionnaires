// Writes the generated Questionnaires (plan §5.7). The output directory is
// wholly generated: it is emptied first, so removed surveys don't linger.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bundle, Questionnaire } from "fhir/r4";

export const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function writeQuestionnaires(dir: string, questionnaires: { slug: string; questionnaire: Questionnaire }[]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const { slug, questionnaire } of questionnaires) {
    writeFileSync(join(dir, `${slug}.json`), toJson(questionnaire));
  }
  writeFileSync(join(dir, "index.json"), toJson(indexBundle(questionnaires.map((entry) => entry.questionnaire))));
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
