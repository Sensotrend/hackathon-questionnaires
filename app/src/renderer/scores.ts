// Calculated items (plan §6.1): each item's own calculatedExpression is
// evaluated with fhirpath.js on the response so far, so the expression in
// the Questionnaire is exactly what is tested.

import fhirpath from "fhirpath";
import r4 from "fhirpath/fhir-context/r4";
import type { Questionnaire, QuestionnaireResponse } from "fhir/r4";
import { allItems, calculatedExpression } from "../fhir/items.ts";

/** linkId → value; undefined when the expression gives nothing (e.g. nothing answered yet) or fails. */
export function calculateScores(
  questionnaire: Questionnaire,
  response: QuestionnaireResponse,
): Map<string, number | undefined> {
  const scores = new Map<string, number | undefined>();
  for (const item of allItems(questionnaire.item)) {
    const expression = calculatedExpression(item);
    if (expression === undefined) continue;
    try {
      const result = fhirpath.evaluate(response, expression, { resource: response, questionnaire }, r4);
      const [value] = Array.isArray(result) ? result : [];
      scores.set(item.linkId, typeof value === "number" ? value : undefined);
    } catch (error) {
      console.warn(`Could not calculate ${item.linkId}:`, error);
      scores.set(item.linkId, undefined);
    }
  }
  return scores;
}
