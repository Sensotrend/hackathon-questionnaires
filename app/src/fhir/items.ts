// Reading the extensions the renderer understands off Questionnaire items.

import type { Extension, Questionnaire, QuestionnaireItem } from "fhir/r4";

export const EXT = {
  itemControl: "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
  minValue: "http://hl7.org/fhir/StructureDefinition/minValue",
  maxValue: "http://hl7.org/fhir/StructureDefinition/maxValue",
  sliderStepValue: "http://hl7.org/fhir/StructureDefinition/questionnaire-sliderStepValue",
  calculatedExpression: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression",
  scoreInterpretation: "https://sensotrend.com/fhir/StructureDefinition/score-interpretation",
  hidden: "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden",
  unit: "http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
  usageContextType: "http://terminology.hl7.org/CodeSystem/usage-context-type",
} as const;

const find = (holder: { extension?: Extension[] } | undefined, url: string) =>
  holder?.extension?.find((extension) => extension.url === url);

export function itemControl(item: QuestionnaireItem): string | undefined {
  return find(item, EXT.itemControl)?.valueCodeableConcept?.coding?.[0]?.code;
}

const numberValue = (extension: Extension | undefined) =>
  extension?.valueInteger ?? extension?.valueDecimal ?? undefined;

export const minValue = (item: QuestionnaireItem) => numberValue(find(item, EXT.minValue));
export const maxValue = (item: QuestionnaireItem) => numberValue(find(item, EXT.maxValue));
export const sliderStep = (item: QuestionnaireItem) => numberValue(find(item, EXT.sliderStepValue));
export const unit = (item: QuestionnaireItem) => find(item, EXT.unit)?.valueCoding;
export const isHidden = (item: QuestionnaireItem) => find(item, EXT.hidden)?.valueBoolean === true;

export function calculatedExpression(item: QuestionnaireItem): string | undefined {
  return find(item, EXT.calculatedExpression)?.valueExpression?.expression;
}

export interface Band {
  min: number;
  max: number;
  title?: Extension;
  description?: Extension;
}

/** The score bands of a calculated item (the project's score-interpretation extension). */
export function bands(item: QuestionnaireItem): Band[] {
  return (item.extension ?? [])
    .filter((extension) => extension.url === EXT.scoreInterpretation)
    .map((extension) => {
      const part = (url: string) => extension.extension?.find((sub) => sub.url === url);
      return {
        min: part("min")?.valueDecimal ?? -Infinity,
        max: part("max")?.valueDecimal ?? Infinity,
        title: part("title"),
        description: part("description"),
      };
    });
}

export type Kind = "screening" | "previsit" | "careplan";

const ITEM_WEIGHT = "http://hl7.org/fhir/StructureDefinition/itemWeight";

/**
 * How the list presents a questionnaire: care plan (from useContext);
 * screening when at least half of its questions are scored (a pre-visit form
 * may embed a short scored instrument, like AUDIT-C); pre-visit otherwise.
 */
export function kindOf(questionnaire: Questionnaire): Kind {
  const careplan = questionnaire.useContext?.some(
    (context) => context.code.code === "task" && context.valueCodeableConcept?.text === "careplan",
  );
  if (careplan) return "careplan";
  const questions = allItems(questionnaire.item).filter(
    (item) => item.type !== "group" && item.type !== "display" && calculatedExpression(item) === undefined,
  );
  const scored = questions.filter((item) =>
    item.answerOption?.some((option) => option.extension?.some((extension) => extension.url === ITEM_WEIGHT)),
  );
  return scored.length > 0 && scored.length * 2 >= questions.length ? "screening" : "previsit";
}

export function allItems(items: QuestionnaireItem[] = []): QuestionnaireItem[] {
  return items.flatMap((item) => [item, ...allItems(item.item)]);
}

/** Items a person answers: not groups, display texts or calculated items. */
export function questionCount(questionnaire: Questionnaire): number {
  return allItems(questionnaire.item).filter(
    (item) => item.type !== "group" && item.type !== "display" && calculatedExpression(item) === undefined,
  ).length;
}
