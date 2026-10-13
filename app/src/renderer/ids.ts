import type { QuestionnaireItem } from "fhir/r4";

/** The DOM id of an item's control or heading; linkIds are unique within a Questionnaire. */
export const fieldId = (item: Pick<QuestionnaireItem, "linkId">) => `item-${item.linkId}`;

/** The DOM id of an item's error message. */
export const errorId = (item: Pick<QuestionnaireItem, "linkId">) => `${fieldId(item)}-error`;

/** Moves focus to an item's first control and brings it into view. */
export function focusItem(linkId: string) {
  const element = document.getElementById(fieldId({ linkId }));
  if (!element) return;
  const control = element.matches("input, select, textarea") ? element : element.querySelector<HTMLElement>("input, select, textarea");
  element.scrollIntoView?.({ block: "center" });
  control?.focus({ preventScroll: true });
}
