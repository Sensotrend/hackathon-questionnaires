// The QuestionnaireResponse, derived from the form state (plan §6.1). It
// mirrors the Questionnaire's structure: groups hold their items, and a
// question's follow-ups go under the answer that enables them.

import type { Questionnaire, QuestionnaireItem, QuestionnaireResponse, QuestionnaireResponseItem, Reference } from "fhir/r4";
import { calculatedExpression } from "../fhir/items.ts";
import { conditionHolds } from "./enable.ts";
import { responseNarrative } from "./narrative.ts";
import type { Answers } from "./state.ts";

export interface ResponseOptions {
  status: QuestionnaireResponse["status"];
  /** When the response was completed; left out while in progress. */
  authored?: string;
  /** Values of calculated items, by linkId. */
  scores?: ReadonlyMap<string, number | undefined>;
  /** A UUID identifying this response; it stays the same while the form is filled in. */
  id?: string;
  /** The person the answers are about, once known (from patient data). */
  subject?: Reference;
}

/** `answers` must hold only enabled items' answers, and `enabled` the enabled linkIds. */
export function buildResponse(
  questionnaire: Questionnaire,
  answers: Answers,
  enabled: ReadonlySet<string>,
  options: ResponseOptions,
): QuestionnaireResponse {
  const scores = options.scores ?? new Map();

  const toItems = (items: QuestionnaireItem[] = []): QuestionnaireResponseItem[] =>
    items.flatMap((item): QuestionnaireResponseItem[] => {
      if (!enabled.has(item.linkId) || item.type === "display") return [];
      const base = { linkId: item.linkId, ...(item.text !== undefined && { text: item.text }) };
      const children = toItems(item.item);

      if (item.type === "group") return children.length > 0 ? [{ ...base, item: children }] : [];

      const score = calculatedExpression(item) !== undefined ? scores.get(item.linkId) : undefined;
      const given = score !== undefined ? [{ valueDecimal: score }] : (answers[item.linkId] ?? []).map((answer) => ({ ...answer }));
      if (given.length === 0) return children.length > 0 ? [{ ...base, item: children }] : [];

      // Each follow-up goes under the first answer that satisfies its condition on this question.
      for (const child of children) {
        const definition = item.item!.find((candidate) => candidate.linkId === child.linkId)!;
        const conditions = (definition.enableWhen ?? []).filter((condition) => condition.question === item.linkId);
        const index = Math.max(
          0,
          given.findIndex((answer) => conditions.every((condition) => conditionHolds(condition, [answer]))),
        );
        const target = given[index]! as { item?: QuestionnaireResponseItem[] };
        target.item = [...(target.item ?? []), child];
      }
      return [{ ...base, answer: given }];
    });

  const canonical = questionnaire.url
    ? `${questionnaire.url}${questionnaire.version ? `|${questionnaire.version}` : ""}`
    : undefined;
  // The elements the Kanta PHR QuestionnaireResponse profile requires (plan
  // §7.3): language, narrative, identifier, questionnaire, status, subject
  // (and source) once known, authored once completed.
  const item = toItems(questionnaire.item);
  return {
    resourceType: "QuestionnaireResponse",
    language: questionnaire.language ?? "fi",
    text: responseNarrative(questionnaire.title, item),
    ...(options.id && { identifier: { system: "urn:ietf:rfc:3986", value: `urn:uuid:${options.id}` } }),
    ...(canonical && { questionnaire: canonical }),
    status: options.status,
    ...(options.subject && { subject: options.subject, source: options.subject }),
    ...(options.authored && { authored: options.authored }),
    item,
  };
}
