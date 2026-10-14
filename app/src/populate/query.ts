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

/** `_include` values: the reference element each one follows. */
const INCLUDES: Record<string, string> = {
  "MedicationStatement:medication": "medicationReference",
  "MedicationRequest:medication": "medicationReference",
};

/**
 * The resource as a server holds it: references to loaded resources in
 * `Type/id` form, as a server rewrites a document's `urn:uuid` references on
 * receiving it. A copy; the loaded data stays as it was.
 */
function asStored(resource: FhirResource, data: PatientData): FhirResource {
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => {
        if (key === "reference" && typeof inner === "string") {
          const target = resolve(data, inner);
          return [key, target?.id ? `${target.resourceType}/${target.id}` : inner];
        }
        return [key, rewrite(inner)];
      }),
    );
  };
  return rewrite(resource) as FhirResource;
}

/** Runs `Type?param=value&…` on the data; returns a searchset Bundle, as a server would. */
export function localQuery(query: string, data: PatientData): Bundle {
  const [type, search = ""] = query.split("?", 2) as [string, string?];
  if (!/^[A-Z][A-Za-z]+$/.test(type)) throw new Error(`x-fhir-query "${query}": expected a resource type`);
  const includes: string[] = [];
  const criteria = [...new URLSearchParams(search)].flatMap(([name, value]) => {
    if (name === "_include") {
      if (!INCLUDES[value] || !value.startsWith(`${type}:`)) throw new Error(`x-fhir-query "${query}": unsupported _include "${value}"`);
      includes.push(INCLUDES[value]);
      return [];
    }
    const matcher = PARAMETERS[name];
    if (!matcher) throw new Error(`x-fhir-query "${query}": unsupported search parameter "${name}"`);
    return [(resource: FhirResource) => matcher(resource, value, data)];
  });
  const matches = data.resources.filter(
    (resource) => resource.resourceType === type && criteria.every((matches) => matches(resource)),
  );
  const included = new Set<FhirResource>();
  for (const resource of matches) {
    for (const element of includes) {
      const target = resolve(data, field(resource, element) as { reference?: string } | undefined);
      if (target) included.add(target);
    }
  }
  const entry = (resource: FhirResource, mode: "match" | "include") => ({
    fullUrl: `${resource.resourceType}/${resource.id}`,
    resource: asStored(resource, data),
    search: { mode },
  });
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: matches.length,
    entry: [...matches.map((resource) => entry(resource, "match")), ...[...included].map((resource) => entry(resource, "include"))],
  };
}
