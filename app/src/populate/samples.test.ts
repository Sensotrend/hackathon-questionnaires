// The real questionnaires filled in from the sample patients (plan §7.6,
// §7.7): what each mapping gives, and what it must not give.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Patient } from "fhir/r4";
import { describe, expect, it, vi } from "vitest";
import { emptyForm } from "../renderer/state.ts";
import { bySlug } from "../test/questionnaires.ts";
import { populate, type PopulateResult } from "./populate.ts";
import { addDocument, emptyPatientData, patients, type PatientData } from "./store.ts";

const NOW = new Date("2026-10-13T12:00:00+03:00");
const sample = (name: string): PatientData =>
  addDocument(emptyPatientData, JSON.parse(readFileSync(resolve(process.cwd(), `../samples/bundles/${name}.json`), "utf8")), name);
const person = (data: PatientData, id: string) => patients(data).find((patient) => patient.id === id) as Patient;

function fill(slug: string, data: PatientData, patientId: string) {
  const result = populate(bySlug(slug), data, person(data, patientId), emptyForm, NOW);
  const entry = (prefix: string) => result.filled.find((filled) => filled.linkId.startsWith(prefix));
  /** What the answer shows: option texts, numbers, dates, strings. */
  const shown = (prefix: string) =>
    entry(prefix)?.answers.map(
      (answer) => answer.valueCoding?.display ?? answer.valueDecimal ?? answer.valueInteger ?? answer.valueDate ?? answer.valueString,
    );
  const sources = (prefix: string) => entry(prefix)?.sources.map((source) => source.reference.split("/")[1]);
  return { result, shown, sources };
}

const expectNoProblems = (result: PopulateResult) => expect(result.warnings).toEqual([]);

describe("the maternity form, filled in from Maija", () => {
  const { result, shown, sources } = fill("esitietolomake-aitiysneuvola", sample("aitiysneuvola-maija"), "maija");

  it("takes measurements from the latest Observations, in FinLOINC or LOINC", () => {
    expect(shown("68be95fd")).toEqual([166]);
    expect(sources("68be95fd")).toEqual(["maija-height"]);
    expect(shown("8196e6f6")).toEqual([63.5]);
    expect(shown("866c93c6")).toEqual(["2026-08-20"]);
  });

  it("answers previous pregnancies from the parity, then fills the follow-up it enables", () => {
    expect(shown("886e1458")).toEqual(["Kyllä"]);
    expect(shown("0c89ddd8")).toEqual([1]);
  });

  it("ticks the illnesses with active diagnoses and allergies, by ICD-10 category", () => {
    expect(shown("e665d3a7")).toEqual(["astma", "kilpirauhasen toimintahäiriö", "allergiat (ml. lääkeaineallergiat)"]);
    expect(sources("e665d3a7")).toEqual(["maija-asthma", "maija-hypothyroidism", "maija-penicillin"]);
  });

  it("counts a resolved chickenpox for varicella, and the MMR vaccination", () => {
    expect(shown("49556984")).toEqual(["Kyllä"]);
    expect(sources("49556984")).toEqual(["maija-chickenpox"]);
    expect(shown("0c644616")).toEqual(["Kyllä"]);
  });

  it("finds medications and supplements by ATC, under THL's and WHO's URIs", () => {
    expect(shown("82b179aa")).toEqual(["Kyllä"]);
    expect(sources("82b179aa")).toEqual(["maija-levothyroxine", "maija-folic-acid", "maija-vitamin-d"]);
    expect(shown("8120b4a7")).toEqual(["Kyllä"]);
    expect(shown("836dd534")).toEqual(["Kyllä"]);
  });

  it("leaves what has no evidence unanswered: never 'no' from an absence of records", () => {
    for (const unanswered of ["30aa0618", "06a41017", "f00a0014", "8b6e7bf5", "7b7192c9"]) expect(shown(unanswered)).toBeUndefined();
  });

  it("takes the contact person from Patient.contact", () => {
    expect(shown("f847604c")).toEqual(["Matti Esimerkki, puoliso"]);
    expect(sources("f847604c")).toEqual(["maija"]);
    expect(shown("2a56afb9")).toEqual(["040 000 0000"]);
  });

  it("fills 13 answers without problems", () => {
    expect(result.filled).toHaveLength(13);
    expectNoProblems(result);
  });
});

describe("the school health forms, filled in from Aino", () => {
  it("8th grade: long-term illnesses (permanent, or unmarked on the problem list) and allergies", () => {
    const { result, shown, sources } = fill("kouluterveydenhuolto-esitietolomake-8-luokan-oppilaille", sample("kouluterveys-aino"), "aino");
    expect(shown("74261e1e")).toEqual(["Kyllä"]);
    // The time-limited ear infection is not a long-term illness.
    expect(sources("74261e1e")).toEqual(["aino-rhinitis", "aino-eczema"]);
    expect(shown("360e50a8")).toEqual(["Siitepölyallerginen nuha, Atooppinen ihottuma"]);
    expect(shown("7806e00f")).toEqual(["Kyllä"]);
    expect(shown("88051b2a")).toEqual(["Koivun siitepöly"]);
    expect(result.filled).toHaveLength(4);
  });

  it("5th grade, by the parents: also medications", () => {
    const { result, shown } = fill("kouluterveydenhuolto-esitietolomake-5-luokkalaisten-vanhemmille", sample("kouluterveys-aino"), "aino");
    expect(shown("9efeeb4b")).toEqual(["Kyllä"]);
    expect(shown("f6b4127b")).toEqual(["Kyllä"]);
    expect(shown("f10b152e")).toEqual(["Setiritsiini 10 mg tarvittaessa"]);
    expect(result.filled).toHaveLength(6);
  });

  it("upper secondary: the same three questions and their follow-ups", () => {
    const { result } = fill("esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto", sample("kouluterveys-aino"), "aino");
    expect(result.filled).toHaveLength(6);
  });
});

describe("the child health clinic forms, filled in from Eetu", () => {
  it.each(["neuvolapalvelut-esitietolomake-2-v-ikaisen-lapsen-vanhemmille", "neuvolapalvelut-esitietolomake-5-v-ikaisen-lapsen-vanhemmille"])(
    "%s: illnesses and allergies as text, vitamin D",
    (slug) => {
      const { result, shown } = fill(slug, sample("neuvola-eetu"), "eetu");
      expect(result.filled.map((filled) => shown(filled.linkId.slice(0, 8))?.[0])).toEqual([
        "Atooppinen ihottuma",
        "Lehmänmaito",
        "Kyllä",
      ]);
    },
  );
});

describe("the low-back physiotherapy form, filled in from Pekka and from Seppo", () => {
  const data = sample("fysioterapia-pekka-ja-seppo");

  it("Pekka: reported height, the latest weight, active diagnoses only", () => {
    const { result, shown, sources } = fill("fysioterapia-alaselkakysely-lahtotilanne", data, "pekka");
    expect(shown("3ac062e0")).toEqual([182]);
    expect(shown("ae88f684")).toEqual([91.4]);
    expect(sources("ae88f684")).toEqual(["pekka-weight"]);
    expect(shown("36c778a4")).toEqual(["Verenpainetauti, Tyypin 2 diabetes, Alaselkäkipu"]);
    expect(shown("c3348bab")).toEqual(["Korkea verenpaine", "Selkäkipu", "2-tyypin diabetes"]);
    expect(shown("f1c26c96")).toEqual(["Mies"]);
    expect(result.filled).toHaveLength(5);
  });

  it("Seppo: a height in inches, in centimetres", () => {
    const { shown } = fill("fysioterapia-alaselkakysely-lahtotilanne", data, "seppo");
    expect(shown("3ac062e0")).toEqual([177.8]);
  });
});

describe("the low-back physiotherapy form, filled in from Kaisa", () => {
  const data = sample("aitiys-kaisa");

  it("takes sex from Patient.gender and smoking from the Observation", () => {
    const { result, shown } = fill("fysioterapia-alaselkakysely-lahtotilanne", data, "96167f3b-9491-5081-9ff6-33562c55685e");
    expect(shown("f1c26c96")).toEqual(["Nainen"]);
    expect(shown("098effd9")).toEqual(["En"]);
    expect(shown("3ac062e0")).toEqual([168]);
    expect(shown("ae88f684")).toEqual([70]);
    expect(shown("36c778a4")).toEqual(["Alaselkäkipu, Astma, Kilpirauhasen vajaatoiminta"]);
    expect(result.filled).toHaveLength(6);
    expectNoProblems(result);
  });
});

describe("the unemployed person's health check, filled in from Jari", () => {
  // The vaccination and smoking-status periods count back from today().
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const { result, shown, sources } = fill("esitietolomake-tyottoman-terveystarkastus", sample("terveystarkastus-jari"), "jari");
  vi.useRealTimers();

  it("takes the email, marital status and care provider from the Patient", () => {
    expect(shown("a0b3d169")).toEqual(["jari.esimerkki@example.com"]);
    expect(shown("679f79cb")).toEqual(["Eronnut"]);
    expect(sources("679f79cb")).toEqual(["jari"]);
    expect(shown("542dcf68")).toEqual(["Kyllä"]);
    expect(shown("863addd8")).toEqual(["Esimerkkilän terveysasema"]);
  });

  it("writes the latest weight and height as text, citing only those two", () => {
    expect(shown("5a0ef412")).toEqual(["84.2 kg, 178 cm"]);
    expect(sources("5a0ef412")).toEqual(["jari-weight", "jari-height"]);
  });

  it("goes by the latest smoking status: smokes again after quitting", () => {
    expect(shown("a5a5d696")).toEqual(["Käytän yhtä tai useampaa nikotiinituotetta"]);
    expect(sources("a5a5d696")).toEqual(["jari-smoking"]);
  });

  it("counts a diphtheria-tetanus booster within 10 years as valid vaccinations", () => {
    expect(shown("d2665248")).toEqual(["Kyllä"]);
    expect(sources("d2665248")).toEqual(["jari-td"]);
  });

  it("ticks illnesses diagnosed now or before, but not a passing ear infection", () => {
    expect(shown("73d97f6f")).toEqual([
      "Tapaturmavamma tai tuki- ja liikuntaelinten sairaus",
      "Psyykkinen sairaus, mielenterveyden häiriö, masennus",
      "Huimausta, tasapainohäiriöitä tai pyörtymistä, ruuansulatuselinten sairaus",
    ]);
    expect(sources("73d97f6f")).toEqual(["jari-back-pain", "jari-depression", "jari-reflux"]);
  });

  it("lists the medications, and the supplements among them", () => {
    expect(shown("e0045feb")).toEqual(["Kyllä"]);
    expect(shown("9ceff7c4")).toEqual(["Sertraliini 50 mg, D-vitamiini 20 µg"]);
    expect(shown("72595235")).toEqual(["Kyllä"]);
    expect(shown("9e8f1c96")).toEqual(["D-vitamiini 20 µg"]);
  });

  it("fills 12 answers without problems", () => {
    expect(result.filled).toHaveLength(12);
    expect(result.skipped).toEqual([]);
    expectNoProblems(result);
  });
});

describe("the unemployed person's health check, filled in from Maija", () => {
  it("leaves out an old smoking status, and vaccinations over 10 years old", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { shown } = fill("esitietolomake-tyottoman-terveystarkastus", sample("aitiysneuvola-maija"), "maija");
    vi.useRealTimers();
    expect(shown("d2665248")).toBeUndefined();
    expect(shown("a5a5d696")).toBeUndefined();
    expect(shown("679f79cb")).toBeUndefined();
    expect(shown("5a0ef412")).toEqual(["166 cm"]);
  });
});

describe("an IPS patient summary: Mikko", () => {
  const ips = JSON.parse(readFileSync(resolve(process.cwd(), "../samples/bundles/mikko-virtanen.json"), "utf8"));
  const MIKKO = "b4ac89c5-6589-417f-beef-d3fb1ef9c70f";
  /** Mikko's document with some resources changed or left out. */
  const variant = (change: (resources: Record<string, unknown>[]) => Record<string, unknown>[]) => {
    const copy = structuredClone(ips);
    copy.entry = change(copy.entry.map((entry: { resource: unknown }) => entry.resource)).map((resource) => ({
      ...copy.entry.find((entry: { resource: { id?: string } }) => entry.resource.id === resource.id),
      resource,
    }));
    return addDocument(emptyPatientData, copy, "variant");
  };
  const byText = (text: string) => (resource: Record<string, unknown>) => (resource.code as { text?: string } | undefined)?.text === text;
  const run = (slug: string, data: PatientData = addDocument(emptyPatientData, ips, "mikko")) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const filled = fill(slug, data, MIKKO);
    vi.useRealTimers();
    const cited = (prefix: string) =>
      filled.result.filled.find((entry) => entry.linkId.startsWith(prefix))?.sources.map((source) => source.display);
    return { ...filled, cited };
  };

  it("fills the unemployed person's health check from the document", () => {
    const { result, shown, cited } = run("esitietolomake-tyottoman-terveystarkastus");
    expect(shown("a0b3d169")).toEqual(["mikko.virtanen@example.com"]);
    expect(shown("679f79cb")).toEqual(["Avioliitossa"]);
    expect(shown("73d97f6f")).toEqual([
      "Tapaturmavamma tai tuki- ja liikuntaelinten sairaus",
      "Sydänsairaus, verenkiertohäiriö tai korkea verenpaine",
      "Aistielinsairauksia (näkö, kuulo)",
      "Allergia",
      "Diabetes",
      "Leikkauksia tai muita toimenpiteitä",
    ]);
    // Fractures count as injuries, and the operation as a procedure.
    expect(cited("73d97f6f")).toEqual(expect.arrayContaining(["Fracture of left collarbone", "Operation on bone injury of fingers"]));
    // Medications given by reference, named once though both a statement and a request list them.
    expect(shown("9ceff7c4")).toEqual(["Insulin NovoRapid 100 units/ml, Rosuvastatin 10 mg, Ezetimibe 10 mg"]);
    // A tetanus booster from 2015 is over 10 years old; a never-smoker status says nothing of snus.
    expect(shown("d2665248")).toBeUndefined();
    expect(shown("a5a5d696")).toBeUndefined();
    expect(result.filled).toHaveLength(5);
    expectNoProblems(result);
  });

  it("reads the no known allergy in its scope: medications only", () => {
    const { shown, cited } = run("esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto");
    expect(shown("bc4e7413")).toEqual(["Kyllä"]);
    expect(cited("bc4e7413")).toEqual(["Allergy to apple", "Allergy to nut", "Allergy to pollen, birch at least."]);
    // Without the food and pollen allergies, no known medication allergy doesn't answer "any allergies?".
    const allergic = new Set(["Allergy to apple", "Allergy to nut", "Allergy to pollen, birch at least."]);
    const none = variant((resources) => resources.filter((resource) => !allergic.has((resource.code as { text?: string } | undefined)?.text ?? "")));
    expect(run("esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto", none).shown("bc4e7413")).toBeUndefined();
    // Unscoped, it does: no known allergy of any kind.
    const unscoped = variant((resources) =>
      resources
        .filter((resource) => !allergic.has((resource.code as { text?: string } | undefined)?.text ?? ""))
        .map((resource) => (resource.resourceType === "AllergyIntolerance" ? { ...resource, category: undefined } : resource)),
    );
    const { shown: unscopedShown, cited: unscopedCited } = run(
      "esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto",
      unscoped,
    );
    expect(unscopedShown("bc4e7413")).toEqual(["Ei"]);
    expect(unscopedCited("bc4e7413")).toEqual(["No known medication allergies"]);
  });

  it("takes a problem's clinical status over its section, and the section where there is no status", () => {
    // Myopia is active, though listed in the Past Problems section.
    const withoutRetinopathy = variant((resources) => resources.filter((resource) => !byText("Diabetic retinopathy")(resource)));
    const { cited } = run("esitietolomake-tyottoman-terveystarkastus", withoutRetinopathy);
    expect(cited("73d97f6f")).toContain("Myopia");
    // Without a status: current if in the Problems section, not if in Past Problems.
    const statusless = variant((resources) =>
      resources
        .filter((resource) => !byText("Diabetic retinopathy")(resource))
        .map((resource) =>
          byText("Hypercholesterolemia")(resource) || byText("Myopia")(resource) ? { ...resource, clinicalStatus: undefined } : resource,
        ),
    );
    expect(run("fysioterapia-alaselkakysely-lahtotilanne", statusless).shown("c3348bab")).toEqual(["Korkea kolesteroli", "1-tyypin diabetes"]);
    expect(run("esitietolomake-tyottoman-terveystarkastus", statusless).cited("73d97f6f")).not.toContain("Myopia");
  });

  it("matches a medication given by reference by the Medication's code", () => {
    const vitaminD = variant((resources) =>
      resources.map((resource) =>
        resource.resourceType === "Medication" && (resource.code as { text?: string }).text === "Ezetimibe"
          ? { ...resource, code: { coding: [{ system: "http://www.whocc.no/atc", code: "A11CC05", display: "colecalciferol" }], text: "D-vitamiini" } }
          : resource,
      ),
    );
    const { shown, cited } = run("esitietolomake-tyottoman-terveystarkastus", vitaminD);
    expect(shown("72595235")).toEqual(["Kyllä"]);
    expect(cited("72595235")).toEqual(["Ezetimibe 10 mg", "Ezetimibe 10 mg"]);
  });

  it("answers smoking in the physiotherapy form from the smoking status alone", () => {
    const { shown, sources } = run("fysioterapia-alaselkakysely-lahtotilanne");
    expect(shown("098effd9")).toEqual(["En"]);
    expect(sources("098effd9")).toEqual(["ec8d3ccb-d68c-433f-8db7-5bf1fcaf0328"]);
  });
});
