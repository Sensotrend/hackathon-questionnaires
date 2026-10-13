import { createContext, useContext, type Dispatch } from "react";
import type { Lang } from "../fhir/text.ts";
import type { Action, FormState } from "./state.ts";
import type { Issue } from "./validation.ts";

export interface FormContextValue {
  lang: Lang;
  state: FormState;
  dispatch: Dispatch<Action>;
  enabled: ReadonlySet<string>;
  /** Issues to show, by linkId: empty until the person first presses Done. */
  issues: ReadonlyMap<string, Issue>;
  scores: ReadonlyMap<string, number | undefined>;
}

export const FormContext = createContext<FormContextValue | null>(null);

export function useForm(): FormContextValue {
  const value = useContext(FormContext);
  if (value === null) throw new Error("useForm outside a QuestionnaireForm");
  return value;
}
