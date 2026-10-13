import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertSurvey } from "./convert/questionnaire.ts";
import { conversionReport } from "./report.ts";
import { parseSurvey } from "./source/loader.ts";
import { readIssues, summarise } from "./validate.ts";

const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/minimal-survey.json", import.meta.url), "utf8"));
const source = { file: "fixture.json", slug: "testikysely", survey: parseSurvey(fixture, "fixture.json") };

describe("conversionReport", () => {
  it("summarises each questionnaire, its overrides and notes", () => {
    const overrides = { $comment: "x", structure: "flat" as const };
    const { questionnaire, notes } = convertSurvey(source, overrides);
    const report = conversionReport(
      [{ slug: "testikysely", file: "fixture.json", questionnaire, overrides, notes }],
      [{ file: "copy.json", duplicateOf: "fixture.json" }],
    );
    expect(report).toContain("| [Testikysely](#testikysely) | 0 | 5 | 1 | 1 | 1 |");
    expect(report).toContain("- `copy.json` (same as `fixture.json`)");
    expect(report).toContain("- Items: 1 display, 1 choice, 1 text, 1 choice (repeating), 1 integer, 1 date, 1 decimal");
    expect(report).toContain("- Overrides: `structure`");
    expect(report).toContain("- No groups (override `structure: flat`)");
    expect(report.endsWith("\n")).toBe(true);
  });
});

describe("validation summary", () => {
  const output = {
    resourceType: "Bundle" as const,
    type: "collection" as const,
    entry: [
      {
        resource: {
          resourceType: "OperationOutcome" as const,
          extension: [{ url: "http://hl7.org/fhir/StructureDefinition/operationoutcome-file", valueString: "/r/fhir/a.json" }],
          issue: [
            { severity: "warning" as const, code: "invariant" as const, details: { text: "Constraint failed: dom-6: narrative" } },
            {
              severity: "information" as const,
              code: "informational" as const,
              details: { text: "Code in https://sensotrend.com/fhir/CodeSystem/00000000-0000-4000-8000-000000000001" },
            },
          ],
        },
      },
      {
        resource: {
          resourceType: "OperationOutcome" as const,
          extension: [{ url: "http://hl7.org/fhir/StructureDefinition/operationoutcome-file", valueString: "/r/fhir/b.json" }],
          issue: [
            { severity: "warning" as const, code: "invariant" as const, details: { text: "Constraint failed: dom-6: narrative" } },
            { severity: "error" as const, code: "structure" as const, details: { text: "Broken | badly" } },
            {
              severity: "information" as const,
              code: "informational" as const,
              details: { text: "Code in https://sensotrend.com/fhir/CodeSystem/00000000-0000-4000-8000-000000000002" },
            },
          ],
        },
      },
    ],
  };

  it("reads issues with their files", () => {
    expect(readIssues(output, "/r").map((issue) => [issue.file, issue.severity])).toEqual([
      ["fhir/a.json", "warning"],
      ["fhir/a.json", "information"],
      ["fhir/b.json", "warning"],
      ["fhir/b.json", "error"],
      ["fhir/b.json", "information"],
    ]);
  });

  it("groups them by severity and message, and marks what isn't accepted", () => {
    const summary = summarise(readIssues(output, "/r"), 2);
    expect(summary).toContain("2 files: 0 fatal, 1 error, 2 warning, 2 information.");
    const rows = summary.split("\n").filter((line) => /^\| (error|warning|information) /.test(line));
    expect(rows).toEqual([
      "| error | 1 | 1 | Broken \\| badly | **not accepted** |",
      expect.stringMatching(/^\| warning \| 2 \| 2 \| Constraint failed: dom-6: narrative \| No narrative/),
      "| information | 2 | 2 | Code in <answer CodeSystem> |  |",
    ]);
  });
});
