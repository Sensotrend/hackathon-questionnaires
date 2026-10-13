// Patient data for pre-population (plan §7.1): the resources of every Bundle
// (or single resource) the person loads, merged into one store, with
// references resolvable by `Type/id`, absolute URL or `urn:uuid` fullUrl.

import type { Bundle, FhirResource, HumanName, Patient, Reference } from "fhir/r4";

export interface Source {
  name: string;
  count: number;
}

export interface PatientData {
  /** Every resource, once, in load order (a later copy of Type/id replaces the earlier one). */
  resources: FhirResource[];
  /** What was loaded: file names (or "pasted") and how many resources each gave. */
  sources: Source[];
  /** Reference string → resource. */
  index: ReadonlyMap<string, FhirResource>;
}

export const emptyPatientData: PatientData = { resources: [], sources: [], index: new Map() };

const keyOf = (resource: FhirResource) => (resource.id ? `${resource.resourceType}/${resource.id}` : undefined);

/** The resources in a parsed JSON document, with the fullUrls they had in their Bundles. Nested Bundles are opened too. */
function flatten(json: unknown, fullUrl?: string): { resource: FhirResource; fullUrl?: string }[] {
  const resource = json as FhirResource | undefined;
  if (!resource || typeof resource !== "object" || typeof resource.resourceType !== "string") {
    throw new Error("not a FHIR resource");
  }
  if (resource.resourceType === "Bundle") {
    return ((resource as Bundle).entry ?? []).flatMap((entry) =>
      entry.resource ? flatten(entry.resource, entry.fullUrl) : [],
    );
  }
  return [{ resource, fullUrl }];
}

/** Adds the resources of one loaded document. Throws if it isn't FHIR JSON or holds no resources. */
export function addDocument(data: PatientData, json: unknown, name: string): PatientData {
  const found = flatten(json);
  if (found.length === 0) throw new Error("no resources");

  const byKey = new Map<string, FhirResource>();
  const unkeyed: FhirResource[] = [];
  for (const resource of data.resources) {
    const key = keyOf(resource);
    if (key) byKey.set(key, resource);
    else unkeyed.push(resource);
  }
  const index = new Map(data.index);
  for (const { resource, fullUrl } of found) {
    const key = keyOf(resource);
    if (key) byKey.set(key, resource);
    else unkeyed.push(resource);
    if (key) index.set(key, resource);
    if (fullUrl) index.set(fullUrl, resource);
  }
  return {
    resources: [...byKey.values(), ...unkeyed],
    sources: [...data.sources, { name, count: found.length }],
    index,
  };
}

/** The resource a reference points to: by `Type/id`, a full URL ending in `Type/id`, or a `urn:uuid` fullUrl. */
export function resolve(data: PatientData, reference: Reference | string | undefined): FhirResource | undefined {
  const ref = typeof reference === "string" ? reference : reference?.reference;
  if (!ref) return undefined;
  const direct = data.index.get(ref);
  if (direct) return direct;
  const match = /([A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/[^/]+)?$/.exec(ref);
  return match ? data.index.get(`${match[1]}/${match[2]}`) : undefined;
}

export function patients(data: PatientData): Patient[] {
  return data.resources.filter((resource): resource is Patient => resource.resourceType === "Patient");
}

/** The elements that point from a resource to the patient it is about. */
const SUBJECT_ELEMENTS = ["subject", "patient", "beneficiary"] as const;

/** Whether `resource` is about `patient`: its subject or patient reference resolves to it. */
export function isAbout(data: PatientData, resource: FhirResource, patient: Patient): boolean {
  if (resource === patient) return true;
  return SUBJECT_ELEMENTS.some((element) => {
    const reference = (resource as unknown as Record<string, Reference | undefined>)[element];
    return reference !== undefined && resolve(data, reference) === patient;
  });
}

/** The resources of one type about the patient. */
export function resourcesAbout<T extends FhirResource>(data: PatientData, patient: Patient, type: T["resourceType"]): T[] {
  return data.resources.filter(
    (resource): resource is T => resource.resourceType === type && isAbout(data, resource, patient),
  );
}

/** The Finnish personal identity code system. */
export const HETU = "urn:oid:1.2.246.21";

export function patientName(patient: Patient): string {
  const name: HumanName | undefined = patient.name?.find((candidate) => candidate.use === "official") ?? patient.name?.[0];
  if (!name) return patient.id ?? "?";
  return name.text ?? [...(name.given ?? []), name.family].filter(Boolean).join(" ");
}

export function patientReference(patient: Patient): Reference {
  return { reference: `Patient/${patient.id}`, display: patientName(patient) };
}
