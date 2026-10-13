// Localized texts in FHIR: the element holds the questionnaire's own
// language, translations sit in `translation` extensions on `_element`.

import type { Element } from "fhir/r4";

export const LANGUAGES = ["fi", "sv", "en"] as const;
export type Lang = (typeof LANGUAGES)[number];

const TRANSLATION = "http://hl7.org/fhir/StructureDefinition/translation";

/** The text in `lang`, falling back to the element's own value. */
export function localized(value: string | undefined, element: Element | undefined, lang: Lang): string {
  for (const translation of element?.extension ?? []) {
    if (translation.url !== TRANSLATION) continue;
    const parts = translation.extension ?? [];
    if (parts.find((part) => part.url === "lang")?.valueCode === lang) {
      const content = parts.find((part) => part.url === "content")?.valueString;
      if (content) return content;
    }
  }
  return value ?? "";
}
