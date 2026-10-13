import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "./build.ts";
import { scoreInterpretation } from "./definitions.ts";
import { GENERATED_DIRS, outputFiles, writeOutput } from "./output.ts";
import { loadOverrides, Overrides, unusedOverrideFiles } from "./overrides.ts";
import { FHIR_DIR } from "./paths.ts";
import { loadSources } from "./source/loader.ts";

describe("writeOutput", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaces the generated directories and writes the report", () => {
    dir = mkdtempSync(join(tmpdir(), "output-"));
    mkdirSync(join(dir, "questionnaires"));
    writeFileSync(join(dir, "questionnaires", "stale.json"), "{}");
    writeFileSync(join(dir, "validation.md"), "kept");
    const questionnaire = { resourceType: "Questionnaire", status: "active", url: "u" } as const;
    const codeSystem = { resourceType: "CodeSystem", status: "active", content: "complete" } as const;
    writeOutput(dir, {
      converted: [{ slug: "a", questionnaire, codeSystem }],
      definitions: [{ ...scoreInterpretation }],
      report: "# Report\n",
    });
    expect(readdirSync(join(dir, "questionnaires")).sort()).toEqual(["a.json", "index.json"]);
    expect(readdirSync(join(dir, "codesystems"))).toEqual(["a.json"]);
    expect(readdirSync(join(dir, "definitions"))).toEqual(["StructureDefinition-score-interpretation.json"]);
    expect(readFileSync(join(dir, "conversion-report.md"), "utf8")).toBe("# Report\n");
    expect(readFileSync(join(dir, "validation.md"), "utf8")).toBe("kept");
    expect(JSON.parse(readFileSync(join(dir, "questionnaires", "index.json"), "utf8")).entry).toEqual([
      { fullUrl: "u", resource: questionnaire },
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

describe("the committed output in fhir/", () => {
  // Regenerate with `npm run convert` when this fails after a converter or override change.
  const output = build();

  it("is up to date with the converter", () => {
    const files = outputFiles(output);
    for (const [path, content] of files) {
      const onDisk = join(FHIR_DIR, path);
      expect(existsSync(onDisk), `${path} exists`).toBe(true);
      expect(readFileSync(onDisk, "utf8"), path).toBe(content);
    }
    for (const dir of GENERATED_DIRS) {
      const generated = [...files.keys()].filter((path) => path.startsWith(`${dir}/`)).map((path) => path.slice(dir.length + 1));
      expect(readdirSync(join(FHIR_DIR, dir)).sort(), `no stale files in ${dir}/`).toEqual(generated.sort());
    }
  });

  it("has unique linkIds within each Questionnaire", () => {
    for (const { slug, questionnaire } of output.converted) {
      const linkIds: string[] = [];
      const collect = (items: typeof questionnaire.item = []) =>
        items.forEach((item) => (linkIds.push(item.linkId), collect(item.item)));
      collect(questionnaire.item);
      expect(new Set(linkIds).size, slug).toBe(linkIds.length);
    }
  });

  it("has a CodeSystem concept for every answer option, with the same display", () => {
    for (const { slug, questionnaire, codeSystem } of output.converted) {
      const concepts = new Map(codeSystem.concept?.map((concept) => [concept.code, concept.display]));
      const options: { code?: string; display?: string }[] = [];
      const collect = (items: typeof questionnaire.item = []) =>
        items.forEach((item) => {
          item.answerOption?.forEach((option) => options.push(option.valueCoding!));
          collect(item.item);
        });
      collect(questionnaire.item);
      expect(options.length, slug).toBe(concepts.size);
      for (const option of options) expect(concepts.get(option.code!), `${slug} ${option.code}`).toBe(option.display);
    }
  });
});
