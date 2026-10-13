import type { Questionnaire, QuestionnaireItem } from "fhir/r4";
import { allItems } from "../fhir/items.ts";
import { localized, type Lang } from "../fhir/text.ts";

/**
 * A short label for an item in summaries: its text on one line, shortened.
 * (Neither the first nor the last line is reliably the question: some texts
 * start with a section heading, some end with instructions.)
 */
export function itemLabel(questionnaire: Questionnaire, linkId: string, lang: Lang): string {
  const item: QuestionnaireItem | undefined = allItems(questionnaire.item).find((candidate) => candidate.linkId === linkId);
  const oneLine = localized(item?.text, item?._text, lang).replace(/\s+/g, " ").trim();
  if (oneLine === "") return linkId;
  return oneLine.length > 90 ? `${oneLine.slice(0, 89)}…` : oneLine;
}
