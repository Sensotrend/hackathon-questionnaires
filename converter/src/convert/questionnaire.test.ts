import { readFileSync } from "node:fs";
import type { QuestionnaireItem } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { parseSurvey, type SourceFile } from "../source/loader.ts";
import { computableName, convertSurvey } from "./questionnaire.ts";
import { localize, normalizeText } from "./text.ts";

const fixturePath = new URL("../../test/fixtures/minimal-survey.json", import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests mutate the raw JSON freely
const fixture = (): any => JSON.parse(readFileSync(fixturePath, "utf8"));
const source = (json = fixture()): SourceFile => ({
  file: "fixture.json",
  slug: "testikysely",
  survey: parseSurvey(json, "fixture.json"),
});

const SYSTEM = "https://sensotrend.com/fhir/CodeSystem/00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const translations = (sv: string, en: string) => ({
  extension: [
    {
      url: "http://hl7.org/fhir/StructureDefinition/translation",
      extension: [
        { url: "lang", valueCode: "sv" },
        { url: "content", valueString: sv },
      ],
    },
    {
      url: "http://hl7.org/fhir/StructureDefinition/translation",
      extension: [
        { url: "lang", valueCode: "en" },
        { url: "content", valueString: en },
      ],
    },
  ],
});

/** Every item in the tree, depth first. */
const allItems = (items: QuestionnaireItem[] = []): QuestionnaireItem[] =>
  items.flatMap((item) => [item, ...allItems(item.item)]);
const itemById = (items: QuestionnaireItem[] | undefined, linkId: string) =>
  allItems(items).find((item) => item.linkId === linkId)!;

describe("convertSurvey", () => {
  it("maps the metadata", () => {
    const { questionnaire } = convertSurvey(source());
    const { item, ...metadata } = questionnaire;
    expect(metadata).toEqual({
      resourceType: "Questionnaire",
      id: id(1),
      language: "fi",
      url: `https://sensotrend.com/fhir/Questionnaire/${id(1)}`,
      identifier: [{ system: "urn:ietf:rfc:3986", value: `urn:uuid:${id(1)}` }],
      version: id(2),
      name: "FixtureSurvey",
      title: "Testikysely",
      _title: translations("Testenkät", "Fixture survey"),
      status: "active",
      subjectType: ["Patient"],
      date: "2026-05-07T11:03:41.840Z",
      description: "Jokainen kysymystyyppi kerran.",
      _description: translations("Varje frågetyp en gång.", "Every question type once."),
    });
  });

  it("maps draft, careplan and the code override", () => {
    const json = fixture();
    json.draft = true;
    json.type = "careplan";
    const code = [{ system: "http://loinc.org", code: "44249-1", display: "PHQ-9" }];
    const { questionnaire } = convertSurvey(source(json), { code });
    expect(questionnaire.status).toBe("draft");
    expect(questionnaire.code).toEqual(code);
    expect(questionnaire.useContext).toEqual([
      {
        code: { system: "http://terminology.hl7.org/CodeSystem/usage-context-type", code: "task" },
        valueCodeableConcept: { text: "careplan" },
      },
    ]);
  });

  it("makes a group of each category, with extra languages after sv and en", () => {
    const { questionnaire, notes } = convertSurvey(source());
    expect(questionnaire.item?.map(({ linkId, type, text }) => ({ linkId, type, text }))).toEqual([
      { linkId: id(11), type: "group", text: "Ohje" },
      { linkId: id(12), type: "group", text: "Kysymykset" },
      { linkId: "score-total", type: "decimal", text: "Pisteet" },
    ]);
    expect(questionnaire.item?.[0]?._text?.extension?.map((ext) => ext.extension?.[0]?.valueCode)).toEqual([
      "sv",
      "en",
      "ru",
    ]);
    expect(questionnaire.item?.[1]?.item?.map((item) => item.linkId)).toEqual([id(102), id(104), id(105), id(106)]);
    expect(notes).toEqual([]);
  });

  it("makes one group per run when a category is split, and notes it", () => {
    const json = fixture();
    json.questions.push({ ...json.questions[0], questionId: id(107) });
    const { questionnaire, notes } = convertSurvey(source(json));
    expect(questionnaire.item?.map((item) => [item.linkId, item.text])).toEqual([
      [id(11), "Ohje"],
      [id(12), "Kysymykset"],
      [`${id(11)}-2`, "Ohje"],
      ["score-total", "Pisteet"],
    ]);
    expect(notes).toEqual(['Category "Ohje" is split into 2 runs, so it became 2 groups with the same title.']);
  });

  it("notes a category without questions", () => {
    const json = fixture();
    json.categories.push({ ...json.categories[0], categoryId: id(13) });
    expect(convertSurvey(source(json)).notes).toEqual(['Category "Ohje" has no questions and was dropped.']);
  });

  it("keeps the questions flat with the flat override", () => {
    const { questionnaire, notes } = convertSurvey(source(), { structure: "flat" });
    expect(questionnaire.item?.map((item) => item.linkId)).toEqual([
      id(101),
      id(102),
      id(104),
      id(105),
      id(106),
      "score-total",
    ]);
    expect(notes).toHaveLength(1);
  });

  it("maps every question type", () => {
    const { item } = convertSurvey(source()).questionnaire;

    expect(itemById(item, id(101))).toEqual({
      linkId: id(101),
      text: "Ohjeet",
      _text: translations("Instruktioner", "Instructions"),
      type: "display",
    });

    const radio = {
      url: "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
      valueCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/questionnaire-item-control", code: "radio-button" }] },
    };
    const select = itemById(item, id(102));
    expect(select).toMatchObject({ type: "choice", required: true, extension: [radio] });
    expect(select.repeats).toBeUndefined();
    // The fixture's select is scored; scoring.test.ts covers the score extensions.
    expect(select.answerOption).toMatchObject([
      { valueCoding: { system: SYSTEM, code: id(201), display: "Kyllä", _display: translations("Ja", "Yes") } },
      { valueCoding: { system: SYSTEM, code: id(202), display: "Ei", _display: translations("Nej", "No") } },
    ]);

    expect(itemById(item, id(104))).toMatchObject({
      type: "choice",
      repeats: true,
      required: false,
      extension: [{ valueCodeableConcept: { coding: [{ code: "check-box" }] } }],
    });

    expect(itemById(item, id(105))).toMatchObject({
      type: "integer",
      required: true,
      extension: [
        { url: "http://hl7.org/fhir/StructureDefinition/minValue", valueInteger: 0 },
        { url: "http://hl7.org/fhir/StructureDefinition/maxValue", valueInteger: 10 },
        { valueCodeableConcept: { coding: [{ code: "slider" }] } },
        { url: "http://hl7.org/fhir/StructureDefinition/questionnaire-sliderStepValue", valueInteger: 1 },
      ],
    });

    expect(itemById(item, id(106))).toMatchObject({ type: "date", required: true });
  });

  it("nests follow-ups under their question, enabled by their answer", () => {
    const select = itemById(convertSurvey(source()).questionnaire.item, id(102));
    expect(select.item).toEqual([
      {
        linkId: id(103),
        text: "Kuinka paljon?",
        _text: translations("Hur mycket?", "How much?"),
        type: "text",
        required: false,
        enableWhen: [{ question: id(102), operator: "=", answerCoding: { system: SYSTEM, code: id(201) } }],
      },
    ]);
  });

  it("rejects an empty Finnish text", () => {
    const json = fixture();
    json.questions[0].questionText.fi = "  ";
    expect(() => convertSurvey(source(json))).toThrow(/question .*: the Finnish text is empty/);
  });
});

describe("normalizeText", () => {
  it("drops trailing whitespace per line and overall, keeping line breaks", () => {
    expect(normalizeText("  Otsikko:  \r\n\r\nKysymys?  \n")).toBe("Otsikko:\n\nKysymys?");
  });
});

describe("localize", () => {
  it("leaves out empty translations", () => {
    expect(localize({ fi: "Kyllä", sv: "", en: " " }, "x")).toEqual({ value: "Kyllä", element: undefined });
  });
});

describe("computableName", () => {
  it.each([
    ["Nicotine Dependence Test (Fagerström)", "NicotineDependenceTestFagerstrom"],
    ["PHQ-9 depression survey", "PHQ9DepressionSurvey"],
    ["2-year-old check", "Q2YearOldCheck"],
    ["", "Testikysely"],
  ])("%s → %s", (english, name) => {
    expect(computableName(english, "testikysely")).toBe(name);
  });
});
