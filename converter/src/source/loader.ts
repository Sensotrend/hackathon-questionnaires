// Loads and validates the source exports, and drops duplicate exports of the
// same revision (§2 of the plan: two of the 15 files are identical).

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import { SOURCE_DIR } from "../paths.ts";
import { checkIntegrity } from "./integrity.ts";
import { Survey } from "./schema.ts";

export class SourceError extends Error {
  readonly file: string;
  readonly problems: string[];

  constructor(file: string, problems: string[]) {
    super(`${file}:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "SourceError";
    this.file = file;
    this.problems = problems;
  }
}

export interface SourceFile {
  /** File name within the source directory. */
  file: string;
  /** File name without the survey guid and export timestamp, e.g. `masennuskysely-phq-9`. */
  slug: string;
  survey: Survey;
}

export interface Duplicate {
  file: string;
  /** The file kept in its place. */
  duplicateOf: string;
}

export interface LoadResult {
  surveys: SourceFile[];
  /** Files skipped because an identical export of the same revision was already loaded. */
  duplicates: Duplicate[];
}

const FILE_NAME = /^(?<slug>.+)-survey-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-\d{4}(?:-\d{2}){5}\.json$/;

export function slugFromFileName(file: string): string {
  const slug = FILE_NAME.exec(file)?.groups?.slug;
  if (slug === undefined) {
    throw new SourceError(file, ["file name is not of the form <slug>-survey-<guid>-<yyyy-mm-dd-hh-mm-ss>.json"]);
  }
  return slug;
}

function formatPath(path: z.core.$ZodIssue["path"]): string {
  return path.map((key, index) => (typeof key === "number" ? `[${key}]` : `${index > 0 ? "." : ""}${String(key)}`)).join("");
}

/** Validates parsed JSON against the schema and the integrity checks. Throws a SourceError listing every problem. */
export function parseSurvey(json: unknown, file: string): Survey {
  const result = Survey.safeParse(json);
  if (!result.success) {
    throw new SourceError(
      file,
      result.error.issues.map((issue) => `${formatPath(issue.path) || "(root)"}: ${issue.message}`),
    );
  }
  const problems = checkIntegrity(result.data);
  if (problems.length > 0) throw new SourceError(file, problems);
  return result.data;
}

export function loadSurveyFile(path: string): SourceFile {
  const file = basename(path);
  const slug = slugFromFileName(file);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SourceError(file, [`not valid JSON: ${(error as Error).message}`]);
  }
  return { file, slug, survey: parseSurvey(json, file) };
}

/**
 * Loads every `.json` file in `dir`, in file-name order. An export identical
 * to an earlier one of the same revision is skipped and listed in
 * `duplicates`. Anything else that would give two Questionnaires the same
 * identity is an error: differing exports of one revision, two revisions of
 * one survey, or two surveys with the same slug.
 */
export function loadSources(dir: string = SOURCE_DIR): LoadResult {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const surveys: SourceFile[] = [];
  const duplicates: Duplicate[] = [];

  for (const file of files) {
    const loaded = loadSurveyFile(join(dir, file));
    const { survey } = loaded;

    const sameRevision = surveys.find((kept) => kept.survey.revisionGuid === survey.revisionGuid);
    if (sameRevision !== undefined) {
      if (!isDeepStrictEqual(sameRevision.survey, survey)) {
        throw new SourceError(file, [
          `revision ${survey.revisionGuid} is also in ${sameRevision.file}, with different content`,
        ]);
      }
      duplicates.push({ file, duplicateOf: sameRevision.file });
      continue;
    }

    const sameSurvey = surveys.find((kept) => kept.survey.surveyGuid === survey.surveyGuid);
    if (sameSurvey !== undefined) {
      throw new SourceError(file, [
        `survey ${survey.surveyGuid} is also in ${sameSurvey.file}, as another revision; keep only one export per survey`,
      ]);
    }

    const sameSlug = surveys.find((kept) => kept.slug === loaded.slug);
    if (sameSlug !== undefined) {
      throw new SourceError(file, [`slug ${loaded.slug} is also used by ${sameSlug.file}`]);
    }

    surveys.push(loaded);
  }

  return { surveys, duplicates };
}
