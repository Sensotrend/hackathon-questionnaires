// What stops a response from being completed: required questions without an
// answer, numbers out of range, and fields holding text that isn't a valid
// answer. Only enabled items count.

import type { Questionnaire, QuestionnaireItem } from "fhir/r4";
import { calculatedExpression, maxValue, minValue } from "../fhir/items.ts";
import type { FormState } from "./state.ts";

export type Issue =
  | { linkId: string; kind: "required" }
  | { linkId: string; kind: "invalidNumber" | "invalidInteger" }
  | { linkId: string; kind: "min" | "max"; limit: number };

/** Issues in document order, at most one per item. */
export function validate(questionnaire: Questionnaire, state: FormState, enabled: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  const answered = (item: QuestionnaireItem): boolean =>
    item.type === "group"
      ? (item.item ?? []).some((child) => enabled.has(child.linkId) && answered(child))
      : (state.answers[item.linkId]?.length ?? 0) > 0;

  const visit = (items: QuestionnaireItem[] = []) => {
    for (const item of items) {
      if (!enabled.has(item.linkId)) continue;
      const issue = itemIssue(item);
      if (issue) issues.push(issue);
      visit(item.item);
    }
  };

  const itemIssue = (item: QuestionnaireItem): Issue | undefined => {
    if (item.type === "display" || calculatedExpression(item) !== undefined || item.readOnly) return undefined;
    const { linkId } = item;
    if (state.invalid[linkId]) return { linkId, kind: item.type === "integer" ? "invalidInteger" : "invalidNumber" };
    if (item.required && !answered(item)) return { linkId, kind: "required" };
    const [min, max] = [minValue(item), maxValue(item)];
    for (const answer of state.answers[linkId] ?? []) {
      const value = answer.valueInteger ?? answer.valueDecimal;
      if (value === undefined) continue;
      if (min !== undefined && value < min) return { linkId, kind: "min", limit: min };
      if (max !== undefined && value > max) return { linkId, kind: "max", limit: max };
    }
    return undefined;
  };

  visit(questionnaire.item);
  return issues;
}
