import type { Patient, Questionnaire, QuestionnaireItem } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { emptyForm, formReducer } from "../renderer/state.ts";
import { populate } from "./populate.ts";
import { localQuery } from "./query.ts";
import { addDocument, emptyPatientData, patients } from "./store.ts";
import { convert } from "./units.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const LOINC = "http://loinc.org";
const SNOMED = "http://snomed.info/sct";
const LOCAL = "urn:local";

const period = (value: number, code: string) => ({
  url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationLinkPeriod",
  valueDuration: { value, unit: code, system: "http://unitsofmeasure.org", code },
});
const unit = (code: string) => ({
  url: "http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
  valueCoding: { system: "http://unitsofmeasure.org", code, display: code },
});
const initial = (expression: string) => ({
  url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression",
  valueExpression: { language: "text/fhirpath", expression },
});
const variable = (name: string, expression: string, language = "application/x-fhir-query") => ({
  url: "http://hl7.org/fhir/StructureDefinition/variable",
  valueExpression: { name, language, expression },
});
const option = (code: string, display: string) => ({ valueCoding: { system: LOCAL, code, display } });

const items: QuestionnaireItem[] = [
  { linkId: "name", type: "string", text: "Nimi", extension: [initial("%patient.name.first().given.first()")] },
  {
    linkId: "height",
    type: "decimal",
    text: "Pituus",
    code: [{ system: LOINC, code: "8302-2" }],
    extension: [unit("cm"), period(1, "a")],
  },
  {
    linkId: "weight",
    type: "integer",
    text: "Paino",
    code: [{ system: LOINC, code: "29463-7" }],
    extension: [unit("kg"), period(1, "a")],
  },
  {
    linkId: "systolic",
    type: "integer",
    text: "Yläpaine",
    code: [{ system: LOINC, code: "8480-6" }],
    extension: [period(1, "a")],
  },
  {
    linkId: "lmp",
    type: "date",
    text: "Kuukautiset",
    code: [{ system: LOINC, code: "8665-2" }],
    extension: [period(1, "a")],
  },
  {
    linkId: "smoking",
    type: "choice",
    text: "Tupakointi",
    code: [{ system: LOINC, code: "72166-2" }],
    extension: [period(5, "a")],
    answerOption: [
      { valueCoding: { system: SNOMED, code: "77176002", display: "Tupakoi" } },
      { valueCoding: { system: SNOMED, code: "8517006", display: "Lopettanut" } },
    ],
  },
  {
    linkId: "allergies",
    type: "choice",
    text: "Allergioita?",
    answerOption: [option("yes", "Kyllä"), option("no", "Ei")],
    extension: [
      variable("allergies", "AllergyIntolerance?patient={{%patient.id}}&clinical-status=active"),
      initial("iif(%allergies.entry.exists(), 'yes', 'no')"),
    ],
    item: [
      {
        linkId: "which",
        type: "text",
        text: "Mitkä?",
        enableWhen: [{ question: "allergies", operator: "=", answerCoding: { system: LOCAL, code: "yes" } }],
        extension: [initial("%allergies.entry.resource.code.text.first()")],
      },
    ],
  },
  {
    linkId: "conditions",
    type: "choice",
    repeats: true,
    text: "Sairaudet",
    answerOption: [
      { valueCoding: { system: SNOMED, code: "195967001", display: "Astma" } },
      { valueCoding: { system: SNOMED, code: "73211009", display: "Diabetes" } },
      { valueCoding: { system: SNOMED, code: "38341003", display: "Verenpainetauti" } },
    ],
    extension: [initial("%conditions.entry.resource.code.coding")],
  },
  {
    linkId: "previous",
    type: "string",
    text: "Jo vastattu",
    extension: [initial("'ei tätä'")],
  },
  {
    linkId: "broken",
    type: "string",
    text: "Rikki",
    extension: [variable("x", "Condition?onset=2020"), initial("%x.entry.count()")],
  },
];

const questionnaire: Questionnaire = {
  resourceType: "Questionnaire",
  status: "active",
  extension: [
    {
      url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-launchContext",
      extension: [
        { url: "name", valueCoding: { system: "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", code: "patient" } },
        { url: "type", valueCode: "Patient" },
      ],
    },
    {
      url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-launchContext",
      extension: [
        { url: "name", valueCoding: { system: "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", code: "user" } },
        { url: "type", valueCode: "Practitioner" },
      ],
    },
    variable("conditions", "Condition?patient={{%patient.id}}&clinical-status=active"),
  ],
  item: items,
};

const observation = (id: string, date: string, code: string, value: object, status = "final") => ({
  resourceType: "Observation",
  id,
  status,
  code: { coding: [{ system: LOINC, code }], text: id },
  subject: { reference: "urn:uuid:p1" },
  effectiveDateTime: date,
  ...value,
});

const bundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    { fullUrl: "urn:uuid:p1", resource: { resourceType: "Patient", id: "p1", name: [{ given: ["Maija"], family: "M" }] } },
    { resource: { resourceType: "Patient", id: "p2" } },
    // Height: the latest final one within a year, in metres.
    { resource: observation("h-old", "2024-01-01", "8302-2", { valueQuantity: { value: 160, unit: "cm", code: "cm" } }) },
    { resource: observation("h-new", "2026-06-01", "8302-2", { valueQuantity: { value: 1.65, unit: "m", code: "m" } }) },
    { resource: observation("h-pre", "2026-09-01", "8302-2", { valueQuantity: { value: 170, code: "cm" } }, "preliminary") },
    // Weight: not a whole number of kg for an integer item.
    { resource: observation("w", "2026-06-01", "29463-7", { valueQuantity: { value: 62.4, code: "kg" } }) },
    // Blood pressure: the systolic value is a component.
    {
      resource: observation("bp", "2026-05-01", "85354-9", {
        component: [
          { code: { coding: [{ system: LOINC, code: "8480-6" }] }, valueQuantity: { value: 128, code: "mm[Hg]" } },
          { code: { coding: [{ system: LOINC, code: "8462-4" }] }, valueQuantity: { value: 82, code: "mm[Hg]" } },
        ],
      }),
    },
    { resource: observation("lmp", "2026-09-20", "8665-2", { valueDateTime: "2026-08-30" }) },
    {
      resource: observation("smoke", "2025-01-01", "72166-2", {
        valueCodeableConcept: { coding: [{ system: SNOMED, code: "8517006" }] },
      }),
    },
    {
      resource: {
        resourceType: "AllergyIntolerance",
        id: "a1",
        patient: { reference: "Patient/p1" },
        clinicalStatus: { coding: [{ code: "active" }] },
        code: { text: "Pähkinä" },
        recordedDate: "2020-03-01",
      },
    },
    ...[
      ["c1", "195967001", "active"],
      ["c2", "38341003", "active"],
      ["c3", "73211009", "resolved"],
    ].map(([id, code, status]) => ({
      resource: {
        resourceType: "Condition",
        id,
        subject: { reference: "Patient/p1" },
        clinicalStatus: { coding: [{ code: status }] },
        code: { coding: [{ system: SNOMED, code }] },
      },
    })),
    // Someone else's data must not be used.
    { resource: { ...observation("h-p2", "2026-10-01", "8302-2", { valueQuantity: { value: 190, code: "cm" } }), subject: { reference: "Patient/p2" } } },
  ],
};

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
