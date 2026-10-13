import { createContext, useContext, type Dispatch } from "react";
import type { Lang } from "../fhir/text.ts";
import type { Action, Answers } from "./state.ts";

export interface FormContextValue {
  lang: Lang;
  answers: Answers;
  dispatch: Dispatch<Action>;
}

export const FormContext = createContext<FormContextValue | null>(null);

export function useForm(): FormContextValue {
  const value = useContext(FormContext);
  if (value === null) throw new Error("useForm outside a QuestionnaireForm");
  return value;
}
