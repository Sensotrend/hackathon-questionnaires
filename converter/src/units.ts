// The units the item overrides may give a retyped question (plan §5.6):
// UCUM codes with the text shown next to the field in each language.

export const UCUM = "http://unitsofmeasure.org";

export const UNITS = {
  cm: { fi: "cm", sv: "cm", en: "cm" },
  kg: { fi: "kg", sv: "kg", en: "kg" },
  g: { fi: "g", sv: "g", en: "g" },
  ug: { fi: "µg", sv: "µg", en: "µg" },
  h: { fi: "tuntia", sv: "timmar", en: "hours" },
  d: { fi: "päivää", sv: "dagar", en: "days" },
  wk: { fi: "viikkoa", sv: "veckor", en: "weeks" },
  a: { fi: "vuotta", sv: "år", en: "years" },
} as const;

export type Unit = keyof typeof UNITS;
