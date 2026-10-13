import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ItemOverride } from "../overrides.ts";
import { parseSurvey, type SourceFile } from "../source/loader.ts";
import { convertSurvey } from "./questionnaire.ts";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/minimal-survey.json", import.meta.url), "utf8"));
const source: SourceFile = { file: "fixture.json", slug: "testikysely", survey: parseSurvey(fixture, "fixture.json") };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const followUp = (overrides: Parameters<typeof convertSurvey>[1]) =>
  convertSurvey(source, overrides).questionnaire.item?.[1]?.item?.[0]?.item?.[0];

describe("item overrides", () => {
  it("retype a free-text question to a decimal with unit and limits", () => {
    const { questionnaire, notes } = convertSurvey(source, {
      items: { [id(103)]: { type: "decimal", unit: "kg", minValue: 30, maxValue: 300 } },
    });
    const item = questionnaire.item?.[1]?.item?.[0]?.item?.[0];
    expect(item).toMatchObject({
      linkId: id(103),
      type: "decimal",
      extension: [
        { url: "http://hl7.org/fhir/StructureDefinition/minValue", valueDecimal: 30 },
        { url: "http://hl7.org/fhir/StructureDefinition/maxValue", valueDecimal: 300 },
        {
          url: "http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
          valueCoding: { system: "http://unitsofmeasure.org", code: "kg", display: "kg" },
        },
      ],
    });
    // The follow-up's condition is untouched.
    expect(item?.enableWhen).toHaveLength(1);
    expect(notes).toContain('Retyped "Kuinka paljon?" from free text to decimal in kg, 30–300.');
  });

  it("give integer limits and translated unit texts", () => {
    const item = followUp({ items: { [id(103)]: { type: "integer", unit: "wk", minValue: 1 } } });
    expect(item?.type).toBe("integer");
    expect(item?.extension?.[0]).toEqual({ url: "http://hl7.org/fhir/StructureDefinition/minValue", valueInteger: 1 });
    const unit = item?.extension?.[1]?.valueCoding;
    // UCUM's own display; the words for each language are translations.
    expect(unit?.display).toBe("wk");
    expect(
      unit?._display?.extension?.map((translation) => translation.extension?.map((part) => part.valueCode ?? part.valueString)),
    ).toEqual([
      ["fi", "viikkoa"],
      ["sv", "veckor"],
      ["en", "weeks"],
    ]);
  });

  it("can retype to a string or date without extensions", () => {
    expect(followUp({ items: { [id(103)]: { type: "date" } } })).not.toHaveProperty("extension");
    expect(followUp({ items: { [id(103)]: { type: "string" } } })?.type).toBe("string");
  });

  it.each([
    ["a question that isn't free text", id(102), /is select, not free text, so it can't be retyped/],
    ["a heading", id(101), /don't exist or are headings/],
    ["a question that doesn't exist", id(999), /don't exist or are headings/],
  ])("reject %s", (_case, linkId, error) => {
    expect(() => convertSurvey(source, { items: { [linkId]: { type: "integer" } } })).toThrow(error);
  });

  it.each([
    [{ type: "integer", minValue: 5, maxValue: 5 }, /minValue must be below maxValue/],
    [{ type: "string", unit: "cm" }, /need type integer or decimal/],
    [{ type: "integer", maxValue: 2.5 }, /whole-number limits/],
    [{ type: "decimal", unit: "furlong" }, /unit/],
    [{ type: "boolean" }, /type/],
    [{ $comment: "nothing" }, /needs a type, an observation code or a populate rule/],
    [{ code: [{ system: "http://loinc.org", code: "8302-2", display: "Body height" }] }, /go together/],
  ])("validate their shape: %j", (override, error) => {
    const result = ItemOverride.safeParse(override);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(error);
  });
});
