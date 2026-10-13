import { describe, expect, it } from "vitest";
import { addDocument, emptyPatientData, isAbout, patientName, patients, resolve, resourcesAbout } from "./store.ts";

const patient = {
  resourceType: "Patient",
  id: "p1",
  name: [{ use: "official", given: ["Maija"], family: "Meikäläinen" }],
};
const other = { resourceType: "Patient", id: "p2", name: [{ text: "Matti Esimerkki" }] };
const height = (id: string, subject: string) => ({
  resourceType: "Observation",
  id,
  status: "final",
  code: { coding: [{ system: "http://loinc.org", code: "8302-2" }] },
  subject: { reference: subject },
});

describe("addDocument", () => {
  it("flattens Bundles, also nested ones, and counts what each source gave", () => {
    const document = {
      resourceType: "Bundle",
      type: "document",
      entry: [
        { fullUrl: "urn:uuid:aaa", resource: patient },
        { resource: { resourceType: "Bundle", type: "collection", entry: [{ resource: height("o1", "urn:uuid:aaa") }] } },
      ],
    };
    const data = addDocument(addDocument(emptyPatientData, document, "ips.json"), other, "other.json");
    expect(data.resources.map((resource) => `${resource.resourceType}/${resource.id}`)).toEqual([
      "Patient/p1",
      "Observation/o1",
      "Patient/p2",
    ]);
    expect(data.sources).toEqual([
      { name: "ips.json", count: 2 },
      { name: "other.json", count: 1 },
    ]);
  });

  it("keeps the later copy of the same resource", () => {
    const updated = { ...patient, name: [{ text: "Maija Uusi" }] };
    const data = addDocument(addDocument(emptyPatientData, patient, "a"), updated, "b");
    expect(data.resources).toHaveLength(1);
    expect(patientName(patients(data)[0]!)).toBe("Maija Uusi");
  });

  it("rejects what isn't FHIR or holds nothing", () => {
    expect(() => addDocument(emptyPatientData, { hello: 1 }, "x")).toThrow("not a FHIR resource");
    expect(() => addDocument(emptyPatientData, { resourceType: "Bundle", type: "collection" }, "x")).toThrow(
      "no resources",
    );
  });
});

describe("references", () => {
  const data = addDocument(
    emptyPatientData,
    {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { fullUrl: "urn:uuid:aaa", resource: patient },
        { resource: other },
        { resource: height("o1", "urn:uuid:aaa") },
        { resource: height("o2", "https://fhir.example.org/r4/Patient/p1") },
        { resource: height("o3", "Patient/p1/_history/2") },
        { resource: height("o4", "Patient/p2") },
      ],
    },
    "test",
  );
  const [maija, matti] = patients(data);

  it("resolve by Type/id, full URL, history URL and urn:uuid", () => {
    expect(resolve(data, "Patient/p1")).toBe(maija);
    expect(resolve(data, { reference: "urn:uuid:aaa" })).toBe(maija);
    expect(resolve(data, "https://fhir.example.org/r4/Patient/p1")).toBe(maija);
    expect(resolve(data, "Patient/p1/_history/2")).toBe(maija);
    expect(resolve(data, "Patient/nope")).toBeUndefined();
  });

  it("find the resources about a patient", () => {
    expect(resourcesAbout(data, maija!, "Observation").map((resource) => resource.id)).toEqual(["o1", "o2", "o3"]);
    expect(resourcesAbout(data, matti!, "Observation").map((resource) => resource.id)).toEqual(["o4"]);
    expect(isAbout(data, maija!, maija!)).toBe(true);
  });

  it("name patients from the official name, or the text", () => {
    expect(patientName(maija!)).toBe("Maija Meikäläinen");
    expect(patientName(matti!)).toBe("Matti Esimerkki");
  });
});
