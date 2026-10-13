import type { Questionnaire, QuestionnaireItem } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { conditionHolds, enabledAnswers, enabledItems } from "./enable.ts";
import { buildResponse } from "./response.ts";
import { emptyForm, type Answers } from "./state.ts";
import { validate } from "./validation.ts";

const yes = { valueCoding: { system: "s", code: "yes", display: "Kyllä" } };
const no = { valueCoding: { system: "s", code: "no", display: "Ei" } };
const when = (question: string, code: string) => [
  { question, operator: "=" as const, answerCoding: { system: "s", code } },
];
const choice = (linkId: string, extra: Partial<QuestionnaireItem> = {}): QuestionnaireItem => ({
  linkId,
  type: "choice",
  text: linkId.toUpperCase(),
  answerOption: [{ valueCoding: yes.valueCoding }, { valueCoding: no.valueCoding }],
  ...extra,
});
const questionnaire = (item: QuestionnaireItem[]): Questionnaire => ({
  resourceType: "Questionnaire",
  status: "active",
  url: "https://example.org/Questionnaire/q",
  version: "1",
  item,
});

describe("conditionHolds", () => {
  const integer = (operator: "=" | "!=" | ">" | "<" | ">=" | "<=", answerInteger: number) => ({
    question: "n",
    operator,
    answerInteger,
  });

  it.each([
    ["=", 3, [{ valueInteger: 3 }], true],
    ["=", 3, [{ valueInteger: 4 }], false],
    ["!=", 3, [{ valueInteger: 4 }], true],
    ["!=", 3, [], true],
    [">", 3, [{ valueInteger: 4 }], true],
    [">", 3, [{ valueInteger: 3 }], false],
    [">=", 3, [{ valueInteger: 3 }], true],
    ["<", 3, [{ valueInteger: 2 }], true],
    ["<=", 3, [{ valueInteger: 4 }], false],
    [">", 3, [], false],
  ] as const)("%s %s on %j is %s", (operator, value, answers, expected) => {
    expect(conditionHolds(integer(operator, value), answers)).toBe(expected);
  });

  it("handles exists, codings by system and code, and dates", () => {
    expect(conditionHolds({ question: "a", operator: "exists", answerBoolean: true }, [yes])).toBe(true);
    expect(conditionHolds({ question: "a", operator: "exists", answerBoolean: false }, [])).toBe(true);
    expect(conditionHolds({ question: "a", operator: "exists", answerBoolean: false }, [yes])).toBe(false);
    expect(conditionHolds(when("a", "yes")[0]!, [{ valueCoding: { system: "s", code: "yes" } }])).toBe(true);
    expect(conditionHolds(when("a", "yes")[0]!, [no, yes])).toBe(true);
    expect(
      conditionHolds({ question: "d", operator: "<", answerDate: "2026-01-01" }, [{ valueDate: "2025-12-31" }]),
    ).toBe(true);
  });
});

describe("enabledItems", () => {
  const chain = questionnaire([
    choice("a", {
      item: [choice("b", { enableWhen: when("a", "yes"), item: [choice("c", { enableWhen: when("b", "yes") })] })],
    }),
    { linkId: "g", type: "group", enableWhen: when("a", "no"), item: [choice("d")] },
    choice("e", { enableWhen: [...when("a", "yes"), ...when("d", "yes")], enableBehavior: "any" }),
    choice("f", { enableWhen: [...when("a", "yes"), ...when("b", "yes")] }),
  ]);
  const enabled = (answers: Answers) => [...enabledItems(chain, answers)].sort();

  it("enables items whose conditions hold, and their children with them", () => {
    expect(enabled({})).toEqual(["a"]);
    expect(enabled({ a: [yes] })).toEqual(["a", "b", "e"]);
    expect(enabled({ a: [yes], b: [yes] })).toEqual(["a", "b", "c", "e", "f"]);
    expect(enabled({ a: [no] })).toEqual(["a", "d", "g"]);
    expect(enabled({ a: [no], d: [yes] })).toEqual(["a", "d", "e", "g"]);
  });

  it("treats answers of disabled items as absent, all the way down", () => {
    // b and c keep their answers in the state, but with a = no they count for nothing.
    expect(enabled({ a: [no], b: [yes], c: [yes] })).toEqual(["a", "d", "g"]);
  });

  it("follows conditions that point forward", () => {
    const forward = questionnaire([choice("x", { enableWhen: when("y", "yes") }), choice("y")]);
    expect([...enabledItems(forward, { y: [yes] })].sort()).toEqual(["x", "y"]);
  });

  it("stops on conditions that keep flipping each other", () => {
    const flipping = questionnaire([
      choice("x", { enableWhen: [{ question: "y", operator: "exists", answerBoolean: false }] }),
      choice("y", { enableWhen: [{ question: "x", operator: "exists", answerBoolean: true }] }),
    ]);
    expect(() => enabledItems(flipping, { x: [yes], y: [yes] })).not.toThrow();
  });
});

describe("buildResponse", () => {
  const form = questionnaire([
    {
      linkId: "g",
      type: "group",
      text: "Ryhmä",
      item: [
        { linkId: "info", type: "display", text: "Ohje" },
        choice("smoke", {
          repeats: true,
          item: [
            { linkId: "amount", type: "text", text: "Paljonko?", enableWhen: when("smoke", "no") },
            { linkId: "always", type: "string", text: "Aina" },
          ],
        }),
      ],
    },
    { linkId: "empty", type: "group", item: [choice("unanswered")] },
    {
      linkId: "score",
      type: "decimal",
      text: "Pisteet",
      extension: [
        {
          url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression",
          valueExpression: { language: "text/fhirpath", expression: "1" },
        },
      ],
    },
  ]);
  const respond = (answers: Answers, scores = new Map<string, number | undefined>()) => {
    const enabled = enabledItems(form, answers);
    return buildResponse(form, enabledAnswers(answers, enabled), enabled, { status: "in-progress", scores });
  };

  it("mirrors the structure, with follow-ups under the answer that enables them", () => {
    expect(respond({ smoke: [yes, no], amount: [{ valueString: "5" }], always: [{ valueString: "x" }] }, new Map([["score", 3]])))
      .toEqual({
        resourceType: "QuestionnaireResponse",
        language: "fi",
        text: { status: "generated", div: expect.stringMatching(/^<div xmlns="http:\/\/www.w3.org\/1999\/xhtml" lang="fi" xml:lang="fi">/) },
        questionnaire: "https://example.org/Questionnaire/q|1",
        status: "in-progress",
        item: [
          {
            linkId: "g",
            text: "Ryhmä",
            item: [
              {
                linkId: "smoke",
                text: "SMOKE",
                answer: [
                  { ...yes, item: [{ linkId: "always", text: "Aina", answer: [{ valueString: "x" }] }] },
                  { ...no, item: [{ linkId: "amount", text: "Paljonko?", answer: [{ valueString: "5" }] }] },
                ],
              },
            ],
          },
          { linkId: "score", text: "Pisteet", answer: [{ valueDecimal: 3 }] },
        ],
      });
  });

  it("leaves out disabled items, even with answers in the state", () => {
    const response = respond({ smoke: [yes], amount: [{ valueString: "5" }] });
    expect(JSON.stringify(response)).not.toContain("amount");
  });

  it("puts children of an unanswered question under the item itself", () => {
    const response = respond({ always: [{ valueString: "x" }] });
    expect(response.item?.[0]?.item).toEqual([
      { linkId: "smoke", text: "SMOKE", item: [{ linkId: "always", text: "Aina", answer: [{ valueString: "x" }] }] },
    ]);
  });

  it("carries the identifier, subject and source when given", () => {
    const enabled = enabledItems(form, {});
    const subject = { reference: "Patient/p1", display: "Maija Meikäläinen" };
    const response = buildResponse(form, {}, enabled, { status: "in-progress", id: "1234", subject });
    expect(response.identifier).toEqual({ system: "urn:ietf:rfc:3986", value: "urn:uuid:1234" });
    expect(response.subject).toEqual(subject);
    expect(response.source).toEqual(subject);
  });

  it("writes every answered question into the narrative, escaped", () => {
    const response = respond({ smoke: [yes], always: [{ valueString: "<b>x & y</b>" }] });
    expect(response.text?.div).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml" lang="fi" xml:lang="fi"><ul><li><b>Ryhmä</b><ul><li><b>SMOKE</b>: Kyllä' +
        "<ul><li><b>Aina</b>: &lt;b&gt;x &amp; y&lt;/b&gt;</li></ul></li></ul></li></ul></div>",
    );
  });

  it("does not change the answers in the state", () => {
    const answers = { smoke: [yes], always: [{ valueString: "x" }] };
    respond(answers);
    expect(answers.smoke).toEqual([yes]);
  });
});

describe("validate", () => {
  const form = questionnaire([
    choice("a", { required: true, item: [{ linkId: "b", type: "string", required: true, enableWhen: when("a", "yes") }] }),
    {
      linkId: "n",
      type: "integer",
      extension: [
        { url: "http://hl7.org/fhir/StructureDefinition/minValue", valueInteger: 0 },
        { url: "http://hl7.org/fhir/StructureDefinition/maxValue", valueInteger: 10 },
      ],
    },
    { linkId: "g", type: "group", required: true, item: [{ linkId: "h", type: "string" }] },
    { linkId: "info", type: "display", text: "x" },
  ]);
  const issues = (answers: Answers, invalid: Record<string, true> = {}) =>
    validate(form, { answers, invalid, provenance: {} }, enabledItems(form, answers));

  it("reports required questions and groups, in document order", () => {
    expect(issues({})).toEqual([
      { linkId: "a", kind: "required" },
      { linkId: "g", kind: "required" },
    ]);
  });

  it("checks enabled follow-ups only", () => {
    expect(issues({ a: [no], h: [{ valueString: "x" }] })).toEqual([]);
    expect(issues({ a: [yes], h: [{ valueString: "x" }] })).toEqual([{ linkId: "b", kind: "required" }]);
  });

  it("checks ranges and text that is no number", () => {
    const base = { a: [no], h: [{ valueString: "x" }] };
    expect(issues({ ...base, n: [{ valueInteger: -1 }] })).toEqual([{ linkId: "n", kind: "min", limit: 0 }]);
    expect(issues({ ...base, n: [{ valueInteger: 11 }] })).toEqual([{ linkId: "n", kind: "max", limit: 10 }]);
    expect(issues(base, { n: true })).toEqual([{ linkId: "n", kind: "invalidInteger" }]);
  });

  it("is empty for an empty form without requirements", () => {
    expect(validate(questionnaire([{ linkId: "x", type: "string" }]), emptyForm, new Set(["x"]))).toEqual([]);
  });
});
