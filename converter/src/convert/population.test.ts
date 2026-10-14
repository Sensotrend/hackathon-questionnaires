import { readFileSync } from "node:fs";
import type { Extension, QuestionnaireItem } from "fhir/r4";
import { describe, expect, it } from "vitest";
import type { Overrides } from "../overrides.ts";
import { parseSurvey, type SourceFile } from "../source/loader.ts";
import { evidenceExpression } from "./population.ts";
import { convertSurvey } from "./questionnaire.ts";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/minimal-survey.json", import.meta.url), "utf8"));
const source: SourceFile = { file: "fixture.json", slug: "testikysely", survey: parseSurvey(fixture, "fixture.json") };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ICD10 = "urn:oid:1.2.246.537.6.1";
const ATC = "urn:oid:1.2.246.537.6.32";

const allItems = (items: QuestionnaireItem[] = []): QuestionnaireItem[] => items.flatMap((item) => [item, ...allItems(item.item)]);
const convert = (items: Overrides["items"]) => convertSurvey(source, { items });
const item = (result: ReturnType<typeof convert>, n: number) =>
  allItems(result.questionnaire.item).find((candidate) => candidate.linkId === id(n))!;
const expressions = (extensions: Extension[] = []) =>
  extensions
    .filter((extension) => extension.valueExpression)
    .map((extension) => [extension.valueExpression!.name ?? "initial", extension.valueExpression!.expression]);

describe("evidenceExpression", () => {
  it("matches hierarchical systems by prefix, others exactly, and adds conditions", () => {
    expect(
      evidenceExpression({
        in: "conditions",
        codes: { [ICD10]: ["E10", "E11"], "http://snomed.info/sct": ["73211009"] },
        where: "onset.exists()",
      }),
    ).toBe(
      "%conditions.where((code | medicationCodeableConcept | vaccineCode).coding.where(" +
        `((system = '${ICD10}' or system = 'http://hl7.org/fhir/sid/icd-10') and (code.startsWith('E10') or code.startsWith('E11'))) or ` +
        "((system = 'http://snomed.info/sct') and (code = '73211009'))).exists()).where(onset.exists())",
    );
    expect(evidenceExpression({ in: "allergies" })).toBe("%allergies");
  });

  it("matches ATC under WHO's URI too", () => {
    expect(evidenceExpression({ in: "medications", codes: { [ATC]: ["A11CC"] } })).toContain(
      `(system = '${ATC}' or system = 'http://www.whocc.no/atc')`,
    );
  });

  it("keeps long-term conditions: marked permanent, or unmarked on the problem list", () => {
    expect(evidenceExpression({ in: "conditions", longTerm: true })).toBe(
      "%conditions.where(extension.where(url = 'https://hl7.fi/fhir/finnish-base-profiles/StructureDefinition/condition-permanence').value.code = 'PYS' or " +
        "(extension.where(url = 'https://hl7.fi/fhir/finnish-base-profiles/StructureDefinition/condition-permanence').empty() and " +
        "category.coding.where(code = 'problem-list-item').exists()))",
    );
  });
});

describe("population overrides", () => {
  it("leave a questionnaire without them unchanged", () => {
    expect(convertSurvey(source).questionnaire.extension).toBeUndefined();
  });

  it("give an item its code and observationLinkPeriod", () => {
    const result = convert({
      [id(103)]: {
        type: "decimal",
        unit: "kg",
        code: [{ system: "http://loinc.org", code: "29463-7", display: "Body weight" }],
        observationLinkPeriod: { value: 1, unit: "a" },
      },
    });
    const weight = item(result, 103);
    expect(weight.code).toEqual([{ system: "http://loinc.org", code: "29463-7", display: "Body weight" }]);
    expect(weight.extension?.at(-1)).toEqual({
      url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationLinkPeriod",
      valueDuration: { value: 1, unit: "a", system: "http://unitsofmeasure.org", code: "a" },
    });
    // Observation-based population needs no launch context.
    expect(result.questionnaire.extension).toBeUndefined();
    expect(result.notes).toContain('Filled in from patient data: "Kuinka paljon?" ← from Observations 29463-7 within 1 a.');
  });

  it("choose an option when there is evidence, from collections declared on the Questionnaire", () => {
    const result = convert({
      [id(102)]: { populate: { answer: "Kyllä", when: { in: "medications", codes: { [ATC]: ["N07BA"] } } } },
    });
    expect(expressions(item(result, 102).extension)).toEqual([
      ["evidence", expect.stringMatching(/^%medications\.where\(.*code\.startsWith\('N07BA'\)/)],
      [
        "initial",
        `iif(%evidence.exists(), %questionnaire.repeat(item).where(linkId = '${id(102)}').answerOption.valueCoding.where(code = '${id(201)}'))`,
      ],
    ]);
    const extensions = result.questionnaire.extension!;
    expect(extensions[0]).toMatchObject({
      url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-launchContext",
      extension: [{ url: "name", valueCoding: { code: "patient" } }, { url: "type", valueCode: "Patient" }, { url: "description" }],
    });
    expect(expressions(extensions)).toEqual([
      ["medicationStatementSearch", "MedicationStatement?patient={{%patient.id}}&status=active&_include=MedicationStatement:medication"],
      ["medicationRequestSearch", "MedicationRequest?patient={{%patient.id}}&status=active&_include=MedicationRequest:medication"],
      ["medications", expect.stringMatching(/^\(%medicationStatementSearch\.entry\.resource\.ofType\(MedicationStatement\) \| /)],
    ]);
    // A medication given by reference matches by the code of the Medication the search included.
    expect(expressions(item(result, 102).extension)[0]![1]).toContain(
      "or medicationReference.reference in (%medicationStatementSearch.entry.resource | %medicationRequestSearch.entry.resource).ofType(Medication).where(",
    );
  });

  it("leave statements of an absence out of every collection but noKnownAllergies", () => {
    const result = convert({
      [id(102)]: { populate: { answer: "Kyllä", when: [{ in: "allergies" }, { in: "noKnownAllergies" }, { in: "conditions" }] } },
    });
    const collections = Object.fromEntries(expressions(result.questionnaire.extension));
    const absence = "(code | medicationCodeableConcept | vaccineCode).coding.where(system = 'http://hl7.org/fhir/uv/ips/CodeSystem/absent-unknown-uv-ips' or (system = 'http://snomed.info/sct' and (code = '716186003'";
    expect(collections.allergies).toContain(`and (${absence}`);
    expect(collections.allergies).toMatch(/\)\.exists\(\)\)\.not\(\)\)$/);
    expect(collections.noKnownAllergies).toMatch(/\)\)\)\.exists\(\)\)$/);
    // One search serves both allergy collections.
    expect(Object.keys(collections).filter((name) => name === "allergySearch")).toHaveLength(1);
    // Current conditions: by clinical status, or without one, by a document's Problems section.
    expect(collections.conditionSearch).toBe("Condition?patient={{%patient.id}}");
    expect(collections.compositionSearch).toBe("Composition?patient={{%patient.id}}");
    expect(collections.conditions).toContain(
      "(clinicalStatus.coding.where(code = 'active' or code = 'recurrence' or code = 'relapse').exists() or (clinicalStatus.empty() and ('Condition/' + id) in %compositionSearch.entry.resource.repeat(section).where(code.coding.where(system = 'http://loinc.org' and code = '11450-4').exists()).entry.reference))",
    );
  });

  it("accept evidence of several kinds", () => {
    const result = convert({
      [id(102)]: {
        populate: {
          answer: "Kyllä",
          when: [
            { in: "immunizations", codes: { [ATC]: ["J07BK"] } },
            { in: "conditions", codes: { [ICD10]: ["B01"] } },
          ],
        },
      },
    });
    const [evidence] = expressions(item(result, 102).extension);
    expect(evidence![1]).toMatch(/^\(%immunizations\.where\(.*'J07BK'.*\)\) \| \(%conditions\.where\(.*'B01'.*\)\)$/);
    expect(expressions(result.questionnaire.extension).map(([name]) => name)).toEqual([
      "conditionSearch",
      "compositionSearch",
      "conditions",
      "immunizationSearch",
      "immunizations",
    ]);
  });

  it("list the names of the evidence in a text question", () => {
    const result = convert({ [id(103)]: { populate: { list: { in: "allergies" } } } });
    expect(expressions(item(result, 103).extension)).toEqual([
      ["evidence", "%allergies"],
      [
        "initial",
        "iif(%evidence.exists(), %evidence.select(((code | medicationCodeableConcept | vaccineCode).text | " +
          "(code | medicationCodeableConcept | vaccineCode).coding.display | medicationReference.display).first()).distinct().join(', '))",
      ],
    ]);
  });

  it("choose each option of a repeating question that has evidence", () => {
    const result = convert({ [id(104)]: { populate: { options: { Astma: { in: "conditions", codes: { [ICD10]: ["J45"] } } } } } });
    expect(expressions(item(result, 104).extension)).toEqual([
      ["evidence1", expect.stringContaining("code.startsWith('J45')")],
      [
        "initial",
        `iif(%evidence1.exists(), %questionnaire.repeat(item).where(linkId = '${id(104)}').answerOption.valueCoding.where(code = '${id(203)}'))`,
      ],
    ]);
  });

  it("take a free expression and declare the collections it uses", () => {
    const result = convert({ [id(103)]: { populate: { expression: "%conditions.count().toString()" } } });
    expect(expressions(item(result, 103).extension)).toEqual([["initial", "%conditions.count().toString()"]]);
    expect(expressions(result.questionnaire.extension).map(([name]) => name)).toEqual(["conditionSearch", "compositionSearch", "conditions"]);
  });

  it("give a free expression its variables, evidence or FHIRPath, and options by their text", () => {
    const result = convert({
      [id(102)]: {
        populate: {
          variables: { nicotine: { in: "medications", codes: { [ATC]: ["N07BA"] } }, latest: "%observations.last()" },
          expression: "iif(%nicotine.exists() or %latest.exists(), {{option:Kyllä}})",
        },
      },
    });
    expect(expressions(item(result, 102).extension)).toEqual([
      ["nicotine", expect.stringMatching(/^%medications\.where\(.*code\.startsWith\('N07BA'\)/)],
      ["latest", "%observations.last()"],
      [
        "initial",
        `iif(%nicotine.exists() or %latest.exists(), %questionnaire.repeat(item).where(linkId = '${id(102)}').answerOption.valueCoding.where(code = '${id(201)}'))`,
      ],
    ]);
    expect(expressions(result.questionnaire.extension).map(([name]) => name)).toEqual([
      "medicationStatementSearch",
      "medicationRequestSearch",
      "medications",
      "observationSearch",
      "observations",
    ]);
  });

  it.each([
    [id(104), { answer: "Astma", when: { in: "allergies" } }, /"answer" needs a single-choice question/],
    [id(102), { answer: "Ehkä", when: { in: "allergies" } }, /has 0 options "Ehkä"; it has "Kyllä", "Ei"/],
    [id(102), { list: { in: "allergies" } }, /"list" needs a text question/],
    [id(102), { options: { Kyllä: { in: "allergies" } } }, /"options" needs a repeating choice question/],
    [id(102), { expression: "{{option:Ehkä}}" }, /has 0 options "Ehkä"/],
  ] as const)("reject a rule that doesn't fit the question: %#", (linkId, populate, error) => {
    expect(() => convert({ [linkId]: { populate } as never })).toThrow(error);
  });
});
