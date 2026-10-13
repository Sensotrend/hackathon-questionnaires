// Form state (plan §6.2): the answers so far by linkId, and which items hold
// typed text that isn't a valid answer yet. A pure reducer; the
// QuestionnaireResponse is derived from this, never the other way round.

import type { QuestionnaireResponseItemAnswer } from "fhir/r4";

export type Answer = QuestionnaireResponseItemAnswer;
export type Answers = Readonly<Record<string, readonly Answer[]>>;

export interface FormState {
  answers: Answers;
  /** Items whose field holds text that is no valid answer, e.g. "1.5" for an integer. */
  invalid: Readonly<Record<string, true>>;
}

export const emptyForm: FormState = { answers: {}, invalid: {} };

export type Action =
  /** Replaces an item's answers; an empty list clears it. */
  | { type: "set"; linkId: string; answers: Answer[] }
  /** Adds the answer to a repeating item, or removes it if already there. */
  | { type: "toggle"; linkId: string; answer: Answer }
  /** Marks an item's field as holding text that isn't a valid answer, or clears the mark. */
  | { type: "invalid"; linkId: string; invalid: boolean }
  | { type: "reset" };

/** A string identifying an answer's value, for comparing answers and options. */
export function answerKey(answer: Answer): string {
  if (answer.valueCoding) return `coding:${answer.valueCoding.system ?? ""}|${answer.valueCoding.code ?? ""}`;
  for (const [key, value] of Object.entries(answer)) {
    if (key.startsWith("value")) return `${key}:${JSON.stringify(value)}`;
  }
  return "empty";
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export function formReducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case "set": {
      const answers = without(state.answers, action.linkId);
      return {
        answers: action.answers.length === 0 ? answers : { ...answers, [action.linkId]: action.answers },
        invalid: action.answers.length === 0 ? state.invalid : without(state.invalid, action.linkId),
      };
    }
    case "toggle": {
      const current = state.answers[action.linkId] ?? [];
      const key = answerKey(action.answer);
      const next = current.some((answer) => answerKey(answer) === key)
        ? current.filter((answer) => answerKey(answer) !== key)
        : [...current, action.answer];
      return formReducer(state, { type: "set", linkId: action.linkId, answers: next });
    }
    case "invalid":
      return {
        ...state,
        invalid: action.invalid ? { ...state.invalid, [action.linkId]: true } : without(state.invalid, action.linkId),
      };
    case "reset":
      return emptyForm;
  }
}
