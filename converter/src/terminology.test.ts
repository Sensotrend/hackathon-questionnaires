import { describe, expect, it } from "vitest";
import { codeUses, report, sampleCodeUses, type Checked } from "./terminology.ts";

describe("codeUses", () => {
  it("collects the codes of Questionnaire.code, item codes and every kind of evidence", () => {
    const uses = codeUses("lomake", {
      code: [{ system: "http://loinc.org", code: "44249-1", display: "PHQ-9" }],
      items: {
        "aaaaaaaa-1": {
          code: [{ system: "http://loinc.org", code: "8302-2", display: "Body height" }],
          observationLinkPeriod: { value: 1, unit: "a" },
        },
        "bbbbbbbb-2": { populate: { answer: "Kyllä", when: { in: "conditions", codes: { "urn:oid:1.2.246.537.6.1": ["E10", "E11"] } } } },
        "cccccccc-3": { populate: { options: { Astma: { in: "conditions", codes: { "urn:oid:1.2.246.537.6.1": ["J45"] } } } } },
        "dddddddd-4": { populate: { list: { in: "allergies" } } },
      },
    });
    expect(uses.map((use) => [use.code, use.display, use.usedIn])).toEqual([
      ["44249-1", "PHQ-9", "lomake: Questionnaire.code"],
      ["8302-2", "Body height", "lomake: aaaaaaaa code"],
      ["E10", undefined, 'lomake: bbbbbbbb "Kyllä"'],
      ["E11", undefined, 'lomake: bbbbbbbb "Kyllä"'],
      ["J45", undefined, 'lomake: cccccccc "Astma"'],
    ]);
  });
});

describe("report", () => {
  it("groups by system and names the problems", () => {
    const checked: Checked[] = [
      { system: "urn:oid:1.2.246.537.6.1", code: "J45", usedIn: "x", ok: true, result: { found: true, display: "Astma", source: "THL" } },
      { system: "urn:oid:1.2.246.537.6.1", code: "J99X", usedIn: "y", ok: false, result: { found: false, source: "THL", error: "HTTP 404" } },
      {
        system: "http://loinc.org",
        code: "8302-2",
        display: "Height",
        usedIn: "z",
        ok: false,
        result: { found: true, display: "Body height", source: "tx" },
      },
    ];
    const text = report(checked, "2026-10-13");
    expect(text).toContain("3 uses of 3 codes: **2 problems**.");
    expect(text).toContain("## THL – ICD-10");
    expect(text).toContain("| J45 | Astma | x | ✓ |");
    expect(text).toContain("| J99X |  | y | **HTTP 404** |");
    expect(text).toContain('| 8302-2 | Body height | z | **display "Height" differs** |');
  });
});

describe("sampleCodeUses", () => {
  it("collects the codings of known systems, exact, with THL displays only", () => {
    const uses = sampleCodeUses("s", {
      resourceType: "Bundle",
      entry: [
        { resource: { id: "c1", code: { coding: [{ system: "urn:oid:1.2.246.537.6.1", code: "J45.0", display: "Allerginen astma" }] } } },
        { resource: { id: "m1", medicationCodeableConcept: { coding: [{ system: "http://www.whocc.no/atc", code: "H03AA01", display: "levothyroxine" }] } } },
        { resource: { id: "x", category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }] }] } },
      ],
    });
    expect(uses).toEqual([
      { system: "urn:oid:1.2.246.537.6.1", code: "J45.0", display: "Allerginen astma", usedIn: "sample s: c1", exact: true },
      { system: "urn:oid:1.2.246.537.6.32", code: "H03AA01", usedIn: "sample s: m1", exact: true },
    ]);
  });
});
