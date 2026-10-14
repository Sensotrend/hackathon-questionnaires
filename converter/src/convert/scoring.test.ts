import { readFileSync } from "node:fs";
import fhirpath from "fhirpath";
import r4 from "fhirpath/fhir-context/r4";
import type { Extension, Questionnaire, QuestionnaireItem, QuestionnaireResponseItem } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { loadOverrides } from "../overrides.ts";
import { loadSources, parseSurvey, type SourceFile } from "../source/loader.ts";
import { convertSurvey } from "./questionnaire.ts";
import { sumExpression } from "./scoring.ts";

const fixturePath = new URL("../../test/fixtures/minimal-survey.json", import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests mutate the raw JSON freely
const fixture = (): any => JSON.parse(readFileSync(fixturePath, "utf8"));
const source = (json = fixture()): SourceFile => ({
  file: "fixture.json",
  slug: "testikysely",
  survey: parseSurvey(json, "fixture.json"),
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const allItems = (items: QuestionnaireItem[] = []): QuestionnaireItem[] =>
  items.flatMap((item) => [item, ...allItems(item.item)]);
const itemById = (questionnaire: Questionnaire, linkId: string) =>
  allItems(questionnaire.item).find((item) => item.linkId === linkId);
const ext = (item: { extension?: Extension[] } | undefined, url: string) =>
  item?.extension?.filter((extension) => extension.url === url) ?? [];

const CALCULATED = "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression";
const BAND = "https://sensotrend.com/fhir/StructureDefinition/score-interpretation";
const WEIGHT = "http://hl7.org/fhir/StructureDefinition/itemWeight";

/** Two scored questions in two categories, with a total and a per-category score. */
function twoCategorySurvey() {
  const json = fixture();
  const scored = structuredClone(json.questions[1]);
  scored.questionId = id(108);
  scored.categoryId = id(11);
  scored.answers = scored.answers.map((answer: { answerId: string }, index: number) => ({
    ...answer,
    answerId: id(211 + index),
    question: [],
  }));
  scored.scores = [
    { points: 3, answerId: id(211) },
    { points: 2, answerId: id(212) },
  ];
  json.questions.splice(1, 0, scored);
  json.scoreCalculations[0].max = 4;
  json.scoreCalculations[0].summaries[0].max = 2;
  json.scoreCalculations.push({
    ...json.scoreCalculations[0],
    categoryId: id(11),
    min: 2,
    max: 3,
    title: { fi: "Ohjepisteet", sv: "Instruktionspoäng", en: "Instruction points" },
    summaries: [],
  });
  return json;
}

describe("answer scores", () => {
  it("go on the coding (ordinalValue) and on the option (itemWeight)", () => {
    const { questionnaire } = convertSurvey(source());
    expect(itemById(questionnaire, id(102))?.answerOption?.[0]).toMatchObject({
      extension: [{ url: WEIGHT, valueDecimal: 1 }],
      valueCoding: {
        code: id(201),
        extension: [{ url: "http://hl7.org/fhir/StructureDefinition/ordinalValue", valueDecimal: 1 }],
      },
    });
  });

  it("are left out on unscored questions", () => {
    const option = itemById(convertSurvey(source()).questionnaire, id(104))?.answerOption?.[0];
    expect(option?.extension).toBeUndefined();
    expect(option?.valueCoding?.extension).toBeUndefined();
  });
});

describe("score items", () => {
  it("are read-only calculated decimals with range and bands", () => {
    const { questionnaire } = convertSurvey(source());
    expect(itemById(questionnaire, "score-total")).toEqual({
      linkId: "score-total",
      text: "Pisteet",
      _text: expect.objectContaining({ extension: expect.any(Array) }),
      type: "decimal",
      readOnly: true,
      extension: [
        {
          url: CALCULATED,
          valueExpression: { language: "text/fhirpath", expression: sumExpression([id(102)]) },
        },
        { url: "http://hl7.org/fhir/StructureDefinition/minValue", valueDecimal: 0 },
        { url: "http://hl7.org/fhir/StructureDefinition/maxValue", valueDecimal: 1 },
        {
          url: BAND,
          extension: [
            { url: "min", valueDecimal: 0 },
            { url: "max", valueDecimal: 0 },
            { url: "title", valueString: "Matala", _valueString: expect.any(Object) },
            { url: "description", valueString: "Matala pistemäärä", _valueString: expect.any(Object) },
          ],
        },
      ],
    });
  });

  it("go at the end of their category's group, totals at the end of the questionnaire", () => {
    const { questionnaire } = convertSurvey(source(twoCategorySurvey()));
    expect(questionnaire.item?.map((item) => item.linkId)).toEqual([id(11), id(12), "score-total"]);
    expect(questionnaire.item?.[0]?.item?.map((item) => item.linkId)).toEqual([id(101), id(108), `score-${id(11)}`]);
    expect(ext(itemById(questionnaire, `score-${id(11)}`), CALCULATED)[0]?.valueExpression?.expression).toBe(
      sumExpression([id(108)]),
    );
    expect(ext(itemById(questionnaire, "score-total"), CALCULATED)[0]?.valueExpression?.expression).toBe(
      sumExpression([id(108), id(102)]),
    );
  });

  it("all go at the end in a flat questionnaire", () => {
    const { questionnaire } = convertSurvey(source(twoCategorySurvey()), { structure: "flat" });
    expect(questionnaire.item?.slice(-2).map((item) => item.linkId)).toEqual(["score-total", `score-${id(11)}`]);
  });

  it("note bands that cover the whole range and range mismatches", () => {
    const json = fixture();
    expect(convertSurvey(source(json)).notes).toEqual([]);
    json.scoreCalculations[0].max = 5;
    json.scoreCalculations[0].summaries[0].max = 5;
    expect(convertSurvey(source(json)).notes).toEqual([
      'Score "Pisteet": the source range is 0–5, the questions give 0–1.',
      `Score bands that cover the whole range, so they don't interpret the score: "Pisteet".`,
    ]);
  });

  it("take corrected titles from overrides", () => {
    const title = { fi: "Kokonaispisteet", sv: "Totalpoäng", en: "Total score" };
    const { questionnaire, notes } = convertSurvey(source(), { scores: { "score-total": { title } } });
    expect(itemById(questionnaire, "score-total")?.text).toBe("Kokonaispisteet");
    expect(notes[0]).toMatch(/^Score "Kokonaispisteet": title corrected by override \(the source has fi "Pisteet"/);
  });

  it("reject overrides for scores that don't exist", () => {
    const title = { fi: "x", sv: "x", en: "x" };
    expect(() => convertSurvey(source(), { scores: { "score-nope": { title } } })).toThrow(/score-nope/);
  });
});

/**
 * A QuestionnaireResponse answering every scored question with the option
 * `pick` chooses (by weight), mirroring the Questionnaire's nesting.
 */
function respond(questionnaire: Questionnaire, pick: (weights: number[]) => number) {
  const toResponse = (items: QuestionnaireItem[] = []): QuestionnaireResponseItem[] =>
    items.flatMap((item): QuestionnaireResponseItem[] => {
      if (item.type === "group") return [{ linkId: item.linkId, item: toResponse(item.item) }];
      const options = (item.answerOption ?? []).filter((option) => ext(option, WEIGHT).length > 0);
      if (options.length === 0) return [];
      const weights = options.map((option) => ext(option, WEIGHT)[0]!.valueDecimal!);
      const chosen = options[weights.indexOf(pick(weights))]!;
      return [{ linkId: item.linkId, answer: [{ valueCoding: chosen.valueCoding }] }];
    });
  return { resourceType: "QuestionnaireResponse", status: "completed", item: toResponse(questionnaire.item) };
}

function evaluateScores(questionnaire: Questionnaire, response: object) {
  return allItems(questionnaire.item)
    .filter((item) => ext(item, CALCULATED).length > 0)
    .map((item) => {
      const expression = ext(item, CALCULATED)[0]!.valueExpression!.expression!;
      const result = fhirpath.evaluate(response, expression, { resource: response, questionnaire }, r4);
      if (!Array.isArray(result)) throw new Error("weight() should not need asynchronous terminology lookups here");
      const [value] = result;
      const range = (url: string) => ext(item, url)[0]?.valueDecimal;
      return {
        linkId: item.linkId,
        value,
        min: range("http://hl7.org/fhir/StructureDefinition/minValue"),
        max: range("http://hl7.org/fhir/StructureDefinition/maxValue"),
      };
    });
}

describe("the score expressions of the real questionnaires, evaluated with fhirpath.js", () => {
  const scored = loadSources()
    .surveys.filter((source) => source.survey.scoringEnabled)
    .map((source) => ({ slug: source.slug, ...convertSurvey(source, loadOverrides(source.slug)) }));

  it("cover the eight scored questionnaires and their thirteen scores", () => {
    expect(scored).toHaveLength(8);
    expect(scored.flatMap(({ questionnaire }) => evaluateScores(questionnaire, respond(questionnaire, (weights) => Math.max(...weights))))).toHaveLength(13);
  });

  it.each(scored.map(({ slug, questionnaire }) => [slug, questionnaire] as const))(
    "%s: highest answers give the maximum, lowest the minimum, none give no score",
    (_slug, questionnaire) => {
      for (const score of evaluateScores(questionnaire, respond(questionnaire, (weights) => Math.max(...weights)))) {
        expect(score.value, score.linkId).toBe(score.max);
      }
      for (const score of evaluateScores(questionnaire, respond(questionnaire, (weights) => Math.min(...weights)))) {
        expect(score.value, score.linkId).toBe(score.min);
      }
      const empty = { resourceType: "QuestionnaireResponse", status: "in-progress" };
      for (const score of evaluateScores(questionnaire, empty)) expect(score.value, score.linkId).toBeUndefined();
    },
  );
});
