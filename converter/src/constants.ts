/** Canonical base for everything this project publishes (plan §9). */
export const BASE = "https://sensotrend.com/fhir";

/** The local code system of a survey's answer options: one code per `answerId`. */
export const answerSystem = (surveyGuid: string) => `${BASE}/CodeSystem/${surveyGuid}`;

export const EXT = {
  translation: "http://hl7.org/fhir/StructureDefinition/translation",
  itemControl: "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
  sliderStepValue: "http://hl7.org/fhir/StructureDefinition/questionnaire-sliderStepValue",
  minValue: "http://hl7.org/fhir/StructureDefinition/minValue",
  maxValue: "http://hl7.org/fhir/StructureDefinition/maxValue",
  unit: "http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
  ordinalValue: "http://hl7.org/fhir/StructureDefinition/ordinalValue",
  itemWeight: "http://hl7.org/fhir/StructureDefinition/itemWeight",
  calculatedExpression: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression",
  /** The project's own extension for score bands (plan §5.5). */
  scoreInterpretation: `${BASE}/StructureDefinition/score-interpretation`,
} as const;

export const ITEM_CONTROL_SYSTEM = "http://hl7.org/fhir/questionnaire-item-control";
export const USAGE_CONTEXT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/usage-context-type";
