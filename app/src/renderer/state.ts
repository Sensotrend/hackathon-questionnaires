// Form state (plan §6.2): the answers so far, by linkId. A pure reducer;
// the QuestionnaireResponse is derived from this, never the other way round.

import type { QuestionnaireResponseItemAnswer } from "fhir/r4";

export type Answer = QuestionnaireResponseItemAnswer;
export type Answers = Readonly<Record<string, readonly Answer[]>>;

export type Action =
  /** Replaces an item's answers; an empty list clears it. */
  | { type: "set"; linkId: string; answers: Answer[] }
  /** Adds the answer to a repeating item, or removes it if already there. */
  | { type: "toggle"; linkId: string; answer: Answer }
  | { type: "reset" };

/** A string identifying an answer's value, for comparing answers and options. */
export function answerKey(answer: Answer): string {
  if (answer.valueCoding) return `coding:${answer.valueCoding.system ?? ""}|${answer.valueCoding.code ?? ""}`;
  for (const [key, value] of Object.entries(answer)) {
    if (key.startsWith("value")) return `${key}:${JSON.stringify(value)}`;
  }
  return "empty";
}

export function answersReducer(state: Answers, action: Action): Answers {
  switch (action.type) {
    case "set": {
      const { [action.linkId]: _previous, ...rest } = state;
      return action.answers.length === 0 ? rest : { ...rest, [action.linkId]: action.answers };
    }
    case "toggle": {
      const current = state[action.linkId] ?? [];
      const key = answerKey(action.answer);
      const next = current.some((answer) => answerKey(answer) === key)
        ? current.filter((answer) => answerKey(answer) !== key)
        : [...current, action.answer];
      return answersReducer(state, { type: "set", linkId: action.linkId, answers: next });
    }
    case "reset":
      return {};
  }
}
