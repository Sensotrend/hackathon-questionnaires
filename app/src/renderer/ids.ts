import type { QuestionnaireItem } from "fhir/r4";

/** The DOM id of an item's control or heading; linkIds are unique within a Questionnaire. */
export const fieldId = (item: QuestionnaireItem) => `item-${item.linkId}`;
