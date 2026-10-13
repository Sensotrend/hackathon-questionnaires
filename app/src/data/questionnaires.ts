// The converted Questionnaires, and any the user opens from a file.

import type { Bundle, FhirResource, Questionnaire } from "fhir/r4";
// A URL rather than a module: the Bundle is large, and fetching it keeps it
// out of the JavaScript (and out of the type checker).
import indexUrl from "../../../fhir/questionnaires/index.json?url";

export async function loadBundledQuestionnaires(): Promise<Questionnaire[]> {
  const response = await fetch(indexUrl);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return questionnairesIn(await response.json());
}

/** The Questionnaires in a parsed FHIR JSON document: a Questionnaire itself, or a Bundle's entries. */
export function questionnairesIn(json: unknown): Questionnaire[] {
  const resource = json as FhirResource | undefined;
  if (resource?.resourceType === "Questionnaire") return [resource];
  if (resource?.resourceType === "Bundle") {
    return ((resource as Bundle).entry ?? []).flatMap((entry) =>
      entry.resource?.resourceType === "Questionnaire" ? [entry.resource as Questionnaire] : [],
    );
  }
  return [];
}
