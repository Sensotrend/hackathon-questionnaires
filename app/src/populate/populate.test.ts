import type { Patient } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { emptyForm, formReducer } from "../renderer/state.ts";
import { populate } from "./populate.ts";
import { localQuery } from "./query.ts";
import { addDocument, emptyPatientData, patients } from "./store.ts";
import { convert } from "./units.ts";
import { bundle, NOW, questionnaire, SNOMED } from "../test/population.ts";

const data = addDocument(emptyPatientData, bundle, "test.json");
const maija = patients(data).find((patient) => patient.id === "p1") as Patient;
const answered = formReducer(emptyForm, { type: "set", linkId: "previous", answers: [{ valueString: "oma vastaus" }] });
const result = populate(questionnaire, data, maija, answered, NOW);
const filled = (linkId: string) => result.filled.find((entry) => entry.linkId === linkId);

describe("populate", () => {
  it("fills from the latest final Observation within the period, converting units", () => {
    expect(filled("height")).toMatchObject({
      method: "observation",
      answers: [{ valueDecimal: 165 }],
      sources: [{ reference: "Observation/h-new", date: "2026-06-01" }],
    });
  });

  it("reads a component, a date and a coded value", () => {
    expect(filled("systolic")?.answers).toEqual([{ valueInteger: 128 }]);
    expect(filled("lmp")?.answers).toEqual([{ valueDate: "2026-08-30" }]);
    expect(filled("smoking")?.answers).toEqual([{ valueCoding: { system: SNOMED, code: "8517006", display: "Lopettanut" } }]);
  });

  it("fills from expressions over the patient and local queries, with the records they used", () => {
    expect(filled("name")).toMatchObject({ method: "expression", answers: [{ valueString: "Maija" }] });
    expect(filled("allergies")).toMatchObject({
      answers: [{ valueCoding: { code: "yes" } }],
      sources: [{ reference: "AllergyIntolerance/a1" }],
    });
    expect(filled("conditions")).toMatchObject({
      answers: [{ valueCoding: { code: "195967001" } }, { valueCoding: { code: "38341003" } }],
      sources: [{ reference: "Condition/c1" }, { reference: "Condition/c2" }],
    });
  });

  it("fills follow-ups that the filled answers enable", () => {
    expect(filled("which")).toMatchObject({ answers: [{ valueString: "Pähkinä" }], sources: [{ reference: "AllergyIntolerance/a1" }] });
  });

  it("never overwrites an answer", () => {
    expect(filled("previous")).toBeUndefined();
    expect(result.state.answers.previous).toEqual([{ valueString: "oma vastaus" }]);
  });

  it("says why it skipped what it couldn't fill", () => {
    expect(result.skipped).toEqual([
      { linkId: "weight", reason: "Observation/w: 62.4 is not a whole number" },
      { linkId: "broken", reason: 'variables: x-fhir-query "Condition?onset=2020": unsupported search parameter "onset"' },
    ]);
    expect(result.warnings).toEqual(["launch context %user is not available"]);
  });

  it("puts every filled answer in the returned state, and only there", () => {
    for (const { linkId, answers } of result.filled) expect(result.state.answers[linkId]).toEqual(answers);
    expect(answered.answers).toEqual({ previous: [{ valueString: "oma vastaus" }] });
  });

  it("skips Observations outside the period", () => {
    const later = populate(questionnaire, data, maija, emptyForm, new Date("2028-01-01T00:00:00Z"));
    expect(later.skipped).toContainEqual({ linkId: "height", reason: "no Observation with the item's code within 1 a" });
  });
});

describe("localQuery", () => {
  it("filters by patient, code (with or without system) and status, as a searchset", () => {
    const result = localQuery(`Condition?patient=p1&code=${SNOMED}|195967001,38341003&clinical-status=active`, data);
    expect(result).toMatchObject({ resourceType: "Bundle", type: "searchset", total: 2 });
    expect(localQuery("Observation?subject=Patient/p2", data).total).toBe(1);
    expect(localQuery("Observation?_id=lmp,bp", data).total).toBe(2);
  });

  it("refuses what it can't do", () => {
    expect(() => localQuery("condition?patient=p1", data)).toThrow(/expected a resource type/);
    expect(() => localQuery("Condition?_sort=-date", data)).toThrow(/unsupported search parameter "_sort"/);
  });
});

describe("convert", () => {
  it.each([
    [1.65, "m", "cm", 165],
    [5500, "g", "kg", 5.5],
    [2, "wk", "d", 14],
    [154, "[lb_av]", "kg", 69.8532249],
    [1, "kg", "cm", undefined],
    [1, "furlong", "m", undefined],
  ])("%s %s in %s is %s", (value, from, to, expected) => {
    const result = convert(value, from, to);
    if (expected === undefined) expect(result).toBeUndefined();
    else expect(result).toBeCloseTo(expected, 6);
  });
});
