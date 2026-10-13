import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertSurvey } from "./convert/questionnaire.ts";
import { indexBundle, toJson, writeQuestionnaires } from "./output.ts";
import { loadOverrides, Overrides, unusedOverrideFiles } from "./overrides.ts";
import { OUTPUT_DIR } from "./paths.ts";
import { loadSources } from "./source/loader.ts";

describe("writeQuestionnaires", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaces the directory with one file per slug plus the index", () => {
    dir = mkdtempSync(join(tmpdir(), "output-"));
    writeFileSync(join(dir, "stale.json"), "{}");
    writeQuestionnaires(dir, [{ slug: "a", questionnaire: { resourceType: "Questionnaire", status: "active", url: "u" } }]);
    expect(readdirSync(dir).sort()).toEqual(["a.json", "index.json"]);
    expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).entry).toEqual([
      { fullUrl: "u", resource: { resourceType: "Questionnaire", status: "active", url: "u" } },
    ]);
  });
});

describe("overrides", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("are optional", () => {
    dir = mkdtempSync(join(tmpdir(), "overrides-"));
    expect(loadOverrides("missing", dir)).toEqual({});
  });

  it("reject unknown keys", () => {
    dir = mkdtempSync(join(tmpdir(), "overrides-"));
    writeFileSync(join(dir, "x.json"), JSON.stringify({ structure: "flat", typo: 1 }));
    expect(() => loadOverrides("x", dir)).toThrow(/typo/);
  });

  it("report files that match no survey", () => {
    dir = mkdtempSync(join(tmpdir(), "overrides-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "known.json"), "{}");
    writeFileSync(join(dir, "renamed.json"), "{}");
    expect(unusedOverrideFiles(["known"], dir)).toEqual(["renamed.json"]);
  });

  it("in the repo are all valid and used", () => {
    const slugs = loadSources().surveys.map((source) => source.slug);
    expect(unusedOverrideFiles(slugs)).toEqual([]);
    for (const slug of slugs) expect(() => Overrides.parse(loadOverrides(slug))).not.toThrow();
  });
});

describe("the committed output in fhir/questionnaires", () => {
  // Regenerate with `npm run convert` when this fails after a converter change.
  const converted = loadSources().surveys.map((source) => ({
    slug: source.slug,
    questionnaire: convertSurvey(source, loadOverrides(source.slug)).questionnaire,
  }));

  it("is up to date with the converter", () => {
    for (const { slug, questionnaire } of converted) {
      const path = join(OUTPUT_DIR, `${slug}.json`);
      expect(existsSync(path), `${path} exists`).toBe(true);
      expect(readFileSync(path, "utf8"), `${slug}.json`).toBe(toJson(questionnaire));
    }
    expect(readFileSync(join(OUTPUT_DIR, "index.json"), "utf8")).toBe(
      toJson(indexBundle(converted.map((entry) => entry.questionnaire))),
    );
    expect(readdirSync(OUTPUT_DIR).length).toBe(converted.length + 1);
  });

  it("has unique linkIds within each Questionnaire", () => {
    for (const { slug, questionnaire } of converted) {
      const linkIds: string[] = [];
      const collect = (items: typeof questionnaire.item = []) =>
        items.forEach((item) => (linkIds.push(item.linkId), collect(item.item)));
      collect(questionnaire.item);
      expect(new Set(linkIds).size, slug).toBe(linkIds.length);
    }
  });
});
