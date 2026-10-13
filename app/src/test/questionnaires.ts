// The converted Questionnaires, read straight from fhir/ for tests.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Questionnaire } from "fhir/r4";

// Vitest runs from app/; under jsdom, import.meta.url is not a file URL.
const dir = resolve(process.cwd(), "../fhir/questionnaires");

export const realQuestionnaires: { slug: string; questionnaire: Questionnaire }[] = readdirSync(dir)
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .sort()
  .map((file) => ({
    slug: file.slice(0, -".json".length),
    questionnaire: JSON.parse(readFileSync(join(dir, file), "utf8")) as Questionnaire,
  }));

export const bySlug = (slug: string) => realQuestionnaires.find((entry) => entry.slug === slug)!.questionnaire;
