import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSurvey, type SourceFile } from "../source/loader.ts";
import { answerCodeSystem } from "./codesystem.ts";
import { fixSurvey } from "./fixes.ts";
import { convertSurvey } from "./questionnaire.ts";

const fixturePath = new URL("../../test/fixtures/minimal-survey.json", import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests mutate the raw JSON freely
const fixture = (): any => JSON.parse(readFileSync(fixturePath, "utf8"));
const survey = (json = fixture()) => parseSurvey(json, "fixture.json");
const source = (json = fixture()): SourceFile => ({ file: "fixture.json", slug: "testikysely", survey: survey(json) });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("fixSurvey", () => {
  it("strips control characters anywhere and notes each", () => {
    const json = fixture();
    json.questions[1].questionText.sv = "Röker\u0002 du?";
    json.scoreCalculations[0].summaries[0].description.en = "Low\u0007 score";
    const notes: string[] = [];
    const fixed = fixSurvey(survey(json), {}, notes);
    expect(fixed.questions[1]?.questionText.sv).toBe("Röker du?");
    expect(fixed.scoreCalculations[0]?.summaries[0]?.description.en).toBe("Low score");
    expect(notes).toEqual([
      `Removed control character U+0002 from the sv text of question ${id(102)}: "Röker du?".`,
      'Removed control character U+0007 from the en text of score calculation 0 band 0 description: "Low score".',
    ]);
  });

  it("keeps line breaks and tabs", () => {
    const json = fixture();
    json.questions[1].questionText.fi = "Otsikko\n\tTupakoitko?";
    expect(fixSurvey(survey(json), {}, []).questions[1]?.questionText.fi).toBe("Otsikko\n\tTupakoitko?");
  });

  it("applies text overrides by name, description, category, question and answer id, without touching the original", () => {
    const original = survey();
    const notes: string[] = [];
    const fixed = fixSurvey(
      original,
      {
        name: { en: "Test survey" },
        description: { sv: "Alla frågetyper." },
        [id(11)]: { remove: ["ru"] },
        [id(103)]: { en: "How much do you smoke?" },
        [id(203)]: { sv: "Astma (diagnos)" },
      },
      notes,
    );
    expect(fixed.name.en).toBe("Test survey");
    expect(fixed.description.sv).toBe("Alla frågetyper.");
    expect(fixed.categories[0]?.name).toEqual({ en: "Instruction", fi: "Ohje", sv: "Instruktion" });
    expect(fixed.questions[1]?.answers[0]?.question[0]?.questionText.en).toBe("How much do you smoke?");
    expect(fixed.questions[2]?.answers[0]?.answerText.sv).toBe("Astma (diagnos)");
    expect(original.name.en).toBe("Fixture survey");
    expect(original.categories[0]?.name.ru).toBe("Инструкция");
    expect(notes).toEqual([
      'Corrected the en text of name: "Fixture survey" → "Test survey".',
      'Corrected the sv text of description: "Varje frågetyp en gång." → "Alla frågetyper.".',
      `Removed the ru text of category ${id(11)}: "Инструкция".`,
      `Corrected the en text of question ${id(103)}: "How much?" → "How much do you smoke?".`,
      `Corrected the sv text of answer ${id(203)}: "Astma" → "Astma (diagnos)".`,
    ]);
  });

  it.each([
    ["an unknown key", { [id(999)]: { en: "x" } }, /no name, description, category, question or answer/],
    ["a no-op", { name: { en: "Fixture survey" } }, /sets en to the text it already has/],
    ["removing a missing language", { name: { remove: ["ru"] } }, /removes ru, which it doesn't have/],
    ["removing a core language", { name: { remove: ["sv"] } }, /can't remove sv/],
  ])("rejects %s", (_case, fixes, error) => {
    expect(() => fixSurvey(survey(), fixes, [])).toThrow(error);
  });

  it("feeds the corrected texts into the conversion", () => {
    const { questionnaire, codeSystem } = convertSurvey(source(), { texts: { [id(201)]: { en: "Yes, I do" } } });
    const option = questionnaire.item?.[1]?.item?.[0]?.answerOption?.[0]?.valueCoding;
    expect(option?._display?.extension?.[1]?.extension?.[1]?.valueString).toBe("Yes, I do");
    expect(codeSystem.concept?.[0]?.designation).toContainEqual({ language: "en", value: "Yes, I do" });
  });
});

describe("answerCodeSystem", () => {
  it("has a concept per answer option, follow-ups' too, with designations", () => {
    const { questionnaire, codeSystem } = convertSurvey(source());
    expect(codeSystem).toEqual({
      resourceType: "CodeSystem",
      id: id(1),
      language: "fi",
      url: `https://sensotrend.com/fhir/CodeSystem/${id(1)}`,
      version: id(2),
      name: "FixtureSurveyAnswerOptions",
      status: "active",
      date: "2026-05-07T11:03:41.840Z",
      description: `Answer options of the Questionnaire ${questionnaire.url}: one code per answer option, as identified in the source export.`,
      caseSensitive: true,
      content: "complete",
      count: 3,
      concept: [
        {
          code: id(201),
          display: "Kyllä",
          designation: [
            { language: "sv", value: "Ja" },
            { language: "en", value: "Yes" },
          ],
        },
        {
          code: id(202),
          display: "Ei",
          designation: [
            { language: "sv", value: "Nej" },
            { language: "en", value: "No" },
          ],
        },
        {
          code: id(203),
          display: "Astma",
          designation: [
            { language: "sv", value: "Astma" },
            { language: "en", value: "Asthma" },
          ],
        },
      ],
    });
    expect(answerCodeSystem(survey(), questionnaire)).toEqual(codeSystem);
  });
});
