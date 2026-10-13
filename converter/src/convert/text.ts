// Localized texts: Finnish in the element itself, the other languages as
// core `translation` extensions on the primitive (plan §5.2).

import type { Element, Extension } from "fhir/r4";
import { EXT } from "../constants.ts";
import type { LocalizedText } from "../source/schema.ts";

export const PRIMARY_LANGUAGE = "fi";
const SECONDARY_LANGUAGES = ["sv", "en"];

/**
 * Removes trailing whitespace from every line and the whole text, and Windows
 * line ends. The exports end lines with Markdown-style double spaces, which
 * mean nothing in plain text; the line breaks themselves are kept.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export interface Localized {
  value: string;
  /** The `_element` companion holding the translations, or undefined when there are none. */
  element: Element | undefined;
}

/** Splits a localized text into the Finnish value and its translations. Throws if the Finnish text is empty. */
export function localize(text: LocalizedText, what: string): Localized {
  const value = normalizeText(text[PRIMARY_LANGUAGE]);
  if (value === "") throw new Error(`${what}: the Finnish text is empty`);

  const others = Object.keys(text)
    .filter((lang) => lang !== PRIMARY_LANGUAGE)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const extension: Extension[] = others.flatMap((lang) => {
    const content = normalizeText(text[lang] ?? "");
    if (content === "") return [];
    return [
      {
        url: EXT.translation,
        extension: [
          { url: "lang", valueCode: lang },
          { url: "content", valueString: content },
        ],
      },
    ];
  });

  return { value, element: extension.length > 0 ? { extension } : undefined };
}

function rank(lang: string): number {
  const index = SECONDARY_LANGUAGES.indexOf(lang);
  return index === -1 ? SECONDARY_LANGUAGES.length : index;
}
