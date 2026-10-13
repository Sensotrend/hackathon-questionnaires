// Answer options: what answer each option gives, and how it is labelled.

import type { QuestionnaireItemAnswerOption } from "fhir/r4";
import { localized, type Lang } from "../fhir/text.ts";
import type { Answer } from "./state.ts";

/** The answer an option gives. Codings keep only system, code and display. */
export function optionAnswer(option: QuestionnaireItemAnswerOption): Answer {
  if (option.valueCoding) {
    const { system, code, display } = option.valueCoding;
    return { valueCoding: { system, code, display } };
  }
  if (option.valueString !== undefined) return { valueString: option.valueString };
  if (option.valueInteger !== undefined) return { valueInteger: option.valueInteger };
  if (option.valueDate !== undefined) return { valueDate: option.valueDate };
  if (option.valueTime !== undefined) return { valueTime: option.valueTime };
  return { valueReference: option.valueReference };
}

export function optionLabel(option: QuestionnaireItemAnswerOption, lang: Lang): string {
  if (option.valueCoding) {
    const { display, _display, code } = option.valueCoding;
    return localized(display, _display, lang) || code || "";
  }
  if (option.valueString !== undefined) return localized(option.valueString, option._valueString, lang);
  return String(option.valueInteger ?? option.valueDate ?? option.valueTime ?? option.valueReference?.display ?? "");
}
