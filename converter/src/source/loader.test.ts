import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSources, parseSurvey, slugFromFileName, SourceError } from "./loader.ts";

const fixturePath = new URL("../../test/fixtures/minimal-survey.json", import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests mutate the raw JSON freely
const fixture = (): any => JSON.parse(readFileSync(fixturePath, "utf8"));

const FILE = "testikysely-survey-00000000-0000-4000-8000-000000000002-2026-10-07-13-04-11.json";

function problemsOf(json: unknown): string[] {
  try {
    parseSurvey(json, "fixture.json");
  } catch (error) {
    if (error instanceof SourceError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseSurvey", () => {
  it("accepts the fixture, including follow-ups and extra languages", () => {
    const survey = parseSurvey(fixture(), "fixture.json");
    expect(survey.questions).toHaveLength(5);
    expect(survey.questions[1]?.answers[0]?.question[0]?.type).toBe("freetext");
    expect(survey.categories[0]?.name.ru).toBe("Инструкция");
  });

  it("accepts a survey without restrictions", () => {
    const json = fixture();
    delete json.restrictions;
    expect(problemsOf(json)).toEqual([]);
  });

  it("accepts an empty description without languages", () => {
    const json = fixture();
    json.questions[1].description = {};
    expect(problemsOf(json)).toEqual([]);
  });

  it("rejects unknown keys with their path", () => {
    const json = fixture();
    json.questions[1].answers[0].unexpected = 1;
    expect(problemsOf(json)).toEqual([expect.stringMatching(/^questions\[1\]\.answers\[0\]: .*unexpected/)]);
  });

  it("rejects a missing language", () => {
    const json = fixture();
    delete json.questions[0].questionText.sv;
    expect(problemsOf(json)).toEqual([expect.stringMatching(/^questions\[0\]\.questionText\.sv: /)]);
  });

  it("rejects unknown question types", () => {
    const json = fixture();
    json.questions[0].type = "slider";
    expect(problemsOf(json)).toEqual([expect.stringMatching(/^questions\[0\]\.type: /)]);
  });

  it.each([
    ["printText", (json: ReturnType<typeof fixture>) => (json.questions[0].printText.fi = "Tulosteeseen")],
    ["description", (json: ReturnType<typeof fixture>) => (json.questions[1].description.en = "Help")],
    ["tags", (json: ReturnType<typeof fixture>) => json.questions[0].tags.push("x")],
    ["tags", (json: ReturnType<typeof fixture>) => json.questions[1].answers[1].tags.push("x")],
    ["numericTagConditions", (json: ReturnType<typeof fixture>) => json.questions[3].numericTagConditions.push({})],
    ["subcategories", (json: ReturnType<typeof fixture>) => json.categories[0].subcategories.push({})],
    ["minValueOrUnder", (json: ReturnType<typeof fixture>) => (json.questions[3].minValueOrUnder = true)],
  ])("rejects a non-empty %s, which the converter has no mapping for", (field, mutate) => {
    const json = fixture();
    mutate(json);
    expect(problemsOf(json)).toEqual([expect.stringContaining(`${field}`)]);
  });

  describe("integrity", () => {
    it("rejects a duplicate questionId, also in follow-ups", () => {
      const json = fixture();
      json.questions[1].answers[0].question[0].questionId = json.questions[0].questionId;
      expect(problemsOf(json)).toEqual([
        expect.stringMatching(/^questions\[1\]\.answers\[0\]\.question\[0\]: duplicate questionId/),
      ]);
    });

    it("rejects a duplicate answerId", () => {
      const json = fixture();
      json.questions[2].answers[0].answerId = json.questions[1].answers[0].answerId;
      expect(problemsOf(json)).toEqual([expect.stringMatching(/^questions\[2\]\.answers\[0\]: duplicate answerId/)]);
    });

    it("rejects unknown categories", () => {
      const json = fixture();
      json.questions[0].categoryId = "00000000-0000-4000-8000-000000000999";
      json.scoreCalculations[0].categoryId = "00000000-0000-4000-8000-000000000999";
      expect(problemsOf(json)).toEqual([
        expect.stringMatching(/^questions\[0\]: unknown categoryId/),
        expect.stringMatching(/^scoreCalculations\[0\]: unknown categoryId/),
      ]);
    });

    it("rejects a follow-up in another category than its parent", () => {
      const json = fixture();
      json.questions[1].answers[0].question[0].categoryId = json.categories[0].categoryId;
      expect(problemsOf(json)).toEqual([expect.stringMatching(/follow-up question is in category/)]);
    });

    it("rejects answers on non-choice questions and choice questions without answers", () => {
      const json = fixture();
      json.questions[0].answers.push(json.questions[2].answers.pop());
      expect(problemsOf(json)).toEqual([
        expect.stringMatching(/^questions\[0\]: heading question has answers/),
        expect.stringMatching(/^questions\[2\]: multiselect question has no answers/),
      ]);
    });

    it("requires a valid range on number questions only", () => {
      const json = fixture();
      json.questions[3].minValue = 10;
      json.questions[4].maxValue = 5;
      expect(problemsOf(json)).toEqual([
        expect.stringMatching(/^questions\[3\]: minValue 10 is not below maxValue 10/),
        expect.stringMatching(/^questions\[4\]: date question has maxValue/),
      ]);
    });

    it("requires every answer of a scored question to have a score, and no others", () => {
      const json = fixture();
      json.questions[1].scores.pop();
      json.questions[2].scores.push({ points: 1, answerId: json.questions[1].answers[1].answerId });
      expect(problemsOf(json)).toEqual([
        expect.stringMatching(/^questions\[1\]: answers without a score/),
        expect.stringMatching(/^questions\[2\]: has scores but scoringEnabled is false/),
        expect.stringMatching(/^questions\[2\]: scores refer to answers of another question/),
      ]);
    });

    it("requires score calculations exactly when scoring is enabled", () => {
      const json = fixture();
      json.scoreCalculations = [];
      expect(problemsOf(json)).toEqual([expect.stringMatching(/scoringEnabled is true but there are 0/)]);
    });
  });
});

describe("slugFromFileName", () => {
  it("strips the guid and the export timestamp", () => {
    expect(slugFromFileName(FILE)).toBe("testikysely");
  });

  it("rejects other file names", () => {
    expect(() => slugFromFileName("testikysely.json")).toThrow(SourceError);
  });
});

describe("loadSources", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (file: string, json: unknown) => writeFileSync(join(dir, file), JSON.stringify(json));
  const withTimestamp = (minute: string, slug = "testikysely") =>
    `${slug}-survey-00000000-0000-4000-8000-000000000002-2026-10-07-13-${minute}-00.json`;

  it("skips an identical export of the same revision", () => {
    dir = mkdtempSync(join(tmpdir(), "sources-"));
    write(withTimestamp("31"), fixture());
    write(withTimestamp("07"), fixture());
    const result = loadSources(dir);
    expect(result.surveys.map((source) => source.file)).toEqual([withTimestamp("07")]);
    expect(result.duplicates).toEqual([{ file: withTimestamp("31"), duplicateOf: withTimestamp("07") }]);
  });

  it("rejects differing exports of the same revision", () => {
    dir = mkdtempSync(join(tmpdir(), "sources-"));
    const changed = fixture();
    changed.name.fi = "Muutettu";
    write(withTimestamp("07"), fixture());
    write(withTimestamp("31"), changed);
    expect(() => loadSources(dir)).toThrow(/with different content/);
  });

  it("rejects two revisions of the same survey", () => {
    dir = mkdtempSync(join(tmpdir(), "sources-"));
    const revised = fixture();
    revised.revisionGuid = "00000000-0000-4000-8000-000000000003";
    write(withTimestamp("07"), fixture());
    write(withTimestamp("31"), revised);
    expect(() => loadSources(dir)).toThrow(/as another revision/);
  });

  it("rejects two surveys with the same slug", () => {
    dir = mkdtempSync(join(tmpdir(), "sources-"));
    const other = fixture();
    other.surveyGuid = "00000000-0000-4000-8000-000000000004";
    other.revisionGuid = "00000000-0000-4000-8000-000000000005";
    write(withTimestamp("07"), fixture());
    write(withTimestamp("31"), other);
    expect(() => loadSources(dir)).toThrow(/slug testikysely is also used/);
  });

  it("reports invalid JSON with the file name", () => {
    dir = mkdtempSync(join(tmpdir(), "sources-"));
    writeFileSync(join(dir, withTimestamp("07")), "{");
    expect(() => loadSources(dir)).toThrow(/not valid JSON/);
  });
});

describe("the real source exports", () => {
  const result = loadSources();

  it("load as 14 surveys and one duplicate", () => {
    expect(result.surveys).toHaveLength(14);
    expect(result.duplicates).toEqual([
      {
        file: "esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto-survey-344967ec-df47-4c57-8c44-aa20a3e6b786-2026-10-07-13-31-34.json",
        duplicateOf:
          "esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto-survey-344967ec-df47-4c57-8c44-aa20a3e6b786-2026-10-07-13-07-04.json",
      },
    ]);
  });

  it("have the slugs the output files will use", () => {
    expect(result.surveys.map((source) => source.slug)).toEqual([
      "ahdistuneisuuskysely-gad-7",
      "alkoholin-kayton-riskit-kysely-audit",
      "esitietolomake-aitiysneuvola",
      "esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto",
      "fysioterapia-alaselkakysely-lahtotilanne",
      "kouluterveydenhuolto-esitietolomake-5-luokkalaisten-vanhemmille",
      "kouluterveydenhuolto-esitietolomake-8-luokan-oppilaille",
      "lapsen-tai-nuoren-adhd-oirekysely-adhd-rs",
      "masennuskysely-bdi-21",
      "masennuskysely-phq-9",
      "mielialakysely-epds-neuvolapalvelut-ja-psykologit",
      "neuvolapalvelut-esitietolomake-2-v-ikaisen-lapsen-vanhemmille",
      "neuvolapalvelut-esitietolomake-5-v-ikaisen-lapsen-vanhemmille",
      "nikotiiniriippuvuustesti-fagerstrom",
    ]);
  });
});
