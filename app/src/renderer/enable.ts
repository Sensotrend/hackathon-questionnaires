// Which items are enabled (R4 enableWhen / enableBehavior). Disabled items
// are hidden, and their answers count as absent: in other items' conditions,
// in validation and in the QuestionnaireResponse. The answers stay in the
// form state, so they come back if the item is enabled again.

import type { Questionnaire, QuestionnaireItem, QuestionnaireItemEnableWhen } from "fhir/r4";
import { allItems } from "../fhir/items.ts";
import { answerKey, type Answer, type Answers } from "./state.ts";

/** The answer value of a condition (answer[x]) as an answer (value[x]), for comparing. */
function conditionAnswer(condition: QuestionnaireItemEnableWhen): Answer | undefined {
  for (const [key, value] of Object.entries(condition)) {
    if (key.startsWith("answer") && value !== undefined) return { [`value${key.slice("answer".length)}`]: value };
  }
  return undefined;
}

/** A comparable number or string for ordering answers (integer, decimal, date, dateTime, time, quantity). */
function ordered(answer: Answer): number | string | undefined {
  return (
    answer.valueInteger ??
    answer.valueDecimal ??
    answer.valueQuantity?.value ??
    answer.valueDate ??
    answer.valueDateTime ??
    answer.valueTime ??
    answer.valueString
  );
}

export function conditionHolds(condition: QuestionnaireItemEnableWhen, answers: readonly Answer[]): boolean {
  if (condition.operator === "exists") return (answers.length > 0) === (condition.answerBoolean ?? true);
  const expected = conditionAnswer(condition);
  if (expected === undefined) return false;
  const key = answerKey(expected);
  switch (condition.operator) {
    case "=":
      return answers.some((answer) => answerKey(answer) === key);
    case "!=":
      // True when no answer equals the value, including when there is no answer.
      return !answers.some((answer) => answerKey(answer) === key);
    default: {
      const target = ordered(expected);
      return answers.some((answer) => {
        const value = ordered(answer);
        if (value === undefined || target === undefined || typeof value !== typeof target) return false;
        switch (condition.operator) {
          case ">":
            return value > target;
          case "<":
            return value < target;
          case ">=":
            return value >= target;
          case "<=":
            return value <= target;
          default:
            return false;
        }
      });
    }
  }
}

function ownConditionHolds(item: QuestionnaireItem, answers: Answers): boolean {
  const conditions = item.enableWhen ?? [];
  if (conditions.length === 0) return true;
  const results = conditions.map((condition) => conditionHolds(condition, answers[condition.question] ?? []));
  return item.enableBehavior === "any" ? results.some(Boolean) : results.every(Boolean);
}

/**
 * The linkIds of the enabled items. An item is enabled when its parent is and
 * its own conditions hold on the answers of enabled items. Conditions may
 * point anywhere in the questionnaire, so this repeats until nothing changes.
 */
export function enabledItems(questionnaire: Questionnaire, answers: Answers): ReadonlySet<string> {
  let enabled = new Set(allItems(questionnaire.item).map((item) => item.linkId));
  for (let round = 0; round < 100; round++) {
    const effective = enabledAnswers(answers, enabled);
    const next = new Set<string>();
    const visit = (items: QuestionnaireItem[] = []) => {
      for (const item of items) {
        if (!ownConditionHolds(item, effective)) continue;
        next.add(item.linkId);
        visit(item.item);
      }
    };
    visit(questionnaire.item);
    if (next.size === enabled.size && [...next].every((linkId) => enabled.has(linkId))) return next;
    enabled = next;
  }
  // Conditions that keep flipping each other: settle on the last round.
  return enabled;
}

/** The answers of enabled items only. */
export function enabledAnswers(answers: Answers, enabled: ReadonlySet<string>): Answers {
  return Object.fromEntries(Object.entries(answers).filter(([linkId]) => enabled.has(linkId)));
}
