// A questionnaire and patient Bundle that exercise every population path:
// observations (latest in period, units, components, dates, codes), FHIRPath
// over the patient and local queries, a follow-up enabled by a filled answer,
// and things that must be skipped.

import type { Questionnaire, QuestionnaireItem } from "fhir/r4";

export const NOW = new Date("2026-10-13T12:00:00Z");
const LOINC = "http://loinc.org";
export const SNOMED = "http://snomed.info/sct";
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

export const questionnaire: Questionnaire = {
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

export const bundle = {
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

