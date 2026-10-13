// x-fhir-query against the loaded patient data instead of a server (plan
// §7.2). Deliberately small, and isolated so a real FHIR client can replace
// it: `Type?param=value&…` with the search parameters below; anything else is
// an error rather than a silently wrong answer.

import type { Bundle, FhirResource, Patient } from "fhir/r4";
import { isAbout, resolve, type PatientData } from "./store.ts";

type Matcher = (resource: FhirResource, value: string, data: PatientData) => boolean;

const tokenMatches = (codings: { system?: string; code?: string }[] | undefined, value: string) =>
  value.split(",").some((token) => {
    const [system, code] = token.includes("|") ? token.split("|") : [undefined, token];
    return (codings ?? []).some(
      (coding) => coding.code === code && (system === undefined || system === "" || coding.system === system),
    );
  });

const field = (resource: FhirResource, name: string) => (resource as unknown as Record<string, unknown>)[name];

const PARAMETERS: Record<string, Matcher> = {
  _id: (resource, value) => value.split(",").includes(resource.id ?? ""),
  patient: (resource, value, data) => isAboutReference(resource, value, data),
  subject: (resource, value, data) => isAboutReference(resource, value, data),
  code: (resource, value) =>
    tokenMatches((field(resource, "code") as { coding?: [] } | undefined)?.coding, value) ||
    tokenMatches((field(resource, "vaccineCode") as { coding?: [] } | undefined)?.coding, value) ||
    tokenMatches((field(resource, "medicationCodeableConcept") as { coding?: [] } | undefined)?.coding, value),
  status: (resource, value) => value.split(",").includes(String(field(resource, "status"))),
  "clinical-status": (resource, value) =>
    tokenMatches((field(resource, "clinicalStatus") as { coding?: [] } | undefined)?.coding, value),
};

function isAboutReference(resource: FhirResource, value: string, data: PatientData): boolean {
  const patient = resolve(data, value.includes("/") ? value : `Patient/${value}`);
  return patient?.resourceType === "Patient" && isAbout(data, resource, patient as Patient);
}

/** Runs `Type?param=value&…` on the data; returns a searchset Bundle, as a server would. */
export function localQuery(query: string, data: PatientData): Bundle {
  const [type, search = ""] = query.split("?", 2) as [string, string?];
  if (!/^[A-Z][A-Za-z]+$/.test(type)) throw new Error(`x-fhir-query "${query}": expected a resource type`);
  const criteria = [...new URLSearchParams(search)].map(([name, value]) => {
    const matcher = PARAMETERS[name];
    if (!matcher) throw new Error(`x-fhir-query "${query}": unsupported search parameter "${name}"`);
    return (resource: FhirResource) => matcher(resource, value, data);
  });
  const matches = data.resources.filter(
    (resource) => resource.resourceType === type && criteria.every((matches) => matches(resource)),
  );
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: matches.length,
    entry: matches.map((resource) => ({ fullUrl: `${resource.resourceType}/${resource.id}`, resource })),
  };
}
