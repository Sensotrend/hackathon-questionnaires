import type { FhirResource } from "fhir/r4";

/** Where a filled-in answer came from: shown next to the answer, and recorded in the response. */
export interface AnswerSource {
  reference: string;
  resourceType: string;
  /** A short description, e.g. the Observation's code text. */
  display?: string;
  /** When the information was recorded or is effective. */
  date?: string;
  resource: FhirResource;
}

function codeText(code: { text?: string; coding?: { display?: string; code?: string }[] } | undefined): string | undefined {
  return code?.text ?? code?.coding?.find((coding) => coding.display)?.display ?? code?.coding?.[0]?.code;
}

/** The effective (or recorded) date of a clinical resource, for display and for picking the latest. */
export function resourceDate(resource: FhirResource): string | undefined {
  const r = resource as unknown as Record<string, unknown>;
  const period = (r.effectivePeriod ?? r.performedPeriod ?? r.onsetPeriod) as { start?: string; end?: string } | undefined;
  return (
    (r.effectiveDateTime as string | undefined) ??
    (r.effectiveInstant as string | undefined) ??
    period?.end ??
    period?.start ??
    (r.occurrenceDateTime as string | undefined) ??
    (r.performedDateTime as string | undefined) ??
    (r.onsetDateTime as string | undefined) ??
    (r.recordedDate as string | undefined) ??
    (r.authoredOn as string | undefined) ??
    (r.dateAsserted as string | undefined) ??
    (r.issued as string | undefined)
  );
}

export function answerSource(resource: FhirResource): AnswerSource {
  const r = resource as unknown as Record<string, unknown>;
  const display =
    codeText(r.code as never) ??
    codeText(r.vaccineCode as never) ??
    codeText(r.medicationCodeableConcept as never) ??
    (r.medicationReference as { display?: string } | undefined)?.display;
  return {
    reference: `${resource.resourceType}/${resource.id ?? "?"}`,
    resourceType: resource.resourceType,
    ...(display && { display }),
    ...(resourceDate(resource) && { date: resourceDate(resource) }),
    resource,
  };
}
