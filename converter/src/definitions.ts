// Definitions of the project's own extensions, published next to the
// Questionnaires so that validators and other tools can resolve them.

import type { ElementDefinition, StructureDefinition } from "fhir/r4";
import { EXT } from "./constants.ts";

function subExtension(name: string, type: string, min: 0 | 1, short: string): ElementDefinition[] {
  const id = `Extension.extension:${name}`;
  return [
    { id, path: "Extension.extension", sliceName: name, short, definition: short, min, max: "1" },
    { id: `${id}.extension`, path: "Extension.extension.extension", max: "0" },
    { id: `${id}.url`, path: "Extension.extension.url", fixedUri: name },
    { id: `${id}.value[x]`, path: "Extension.extension.value[x]", min: 1, type: [{ code: type }] },
  ];
}

export const scoreInterpretation: StructureDefinition = {
  resourceType: "StructureDefinition",
  id: "score-interpretation",
  url: EXT.scoreInterpretation,
  version: "0.1.0",
  name: "ScoreInterpretation",
  title: "Score interpretation band",
  status: "draft",
  description:
    "A band of a calculated score item: the range it covers and what a score in that range means. Translations go on the title and description strings with the core translation extension.",
  fhirVersion: "4.0.1",
  kind: "complex-type",
  abstract: false,
  context: [{ type: "element", expression: "Questionnaire.item" }],
  type: "Extension",
  baseDefinition: "http://hl7.org/fhir/StructureDefinition/Extension",
  derivation: "constraint",
  differential: {
    element: [
      {
        id: "Extension",
        path: "Extension",
        short: "Score interpretation band",
        definition: "A band of a calculated score item: the range it covers and what a score in that range means.",
      },
      {
        id: "Extension.extension",
        path: "Extension.extension",
        slicing: { discriminator: [{ type: "value", path: "url" }], rules: "closed" },
        min: 3,
      },
      ...subExtension("min", "decimal", 1, "Lowest score in the band (inclusive)"),
      ...subExtension("max", "decimal", 1, "Highest score in the band (inclusive)"),
      ...subExtension("title", "string", 1, "Name of the band"),
      ...subExtension("description", "string", 0, "What a score in the band means"),
      { id: "Extension.url", path: "Extension.url", fixedUri: EXT.scoreInterpretation },
      { id: "Extension.value[x]", path: "Extension.value[x]", max: "0" },
    ],
  },
};

export const definitions: StructureDefinition[] = [scoreInterpretation];
