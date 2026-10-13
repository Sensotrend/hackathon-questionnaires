import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Lang } from "../fhir/text.ts";
import { emptyPatientData, type PatientData } from "../populate/store.ts";
import { bySlug } from "../test/questionnaires.ts";
import { QuestionnaireForm } from "./QuestionnaireForm.tsx";

function Harness({ slug, lang }: { slug: string; lang: Lang }) {
  const [data, setData] = useState<PatientData>(emptyPatientData);
  const [patientId, setPatientId] = useState<string>();
  return (
    <QuestionnaireForm
      questionnaire={bySlug(slug)}
      lang={lang}
      patientData={data}
      onPatientDataChange={setData}
      patientId={patientId}
      onSelectPatient={setPatientId}
    />
  );
}

const summary = () => within(document.querySelector<HTMLElement>(".print-summary")!);

async function fillFromMaija(lang: Lang) {
  const user = userEvent.setup();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00+03:00"));
  render(<Harness slug="esitietolomake-aitiysneuvola" lang={lang} />);
  const text = readFileSync(resolve(process.cwd(), "../samples/bundles/aitiysneuvola-maija.json"), "utf8");
  await user.upload(screen.getByLabelText(lang === "fi" ? "Lisää tiedostoja…" : "Lägg till filer…"), new File([text], "maija.json"));
  await user.click(screen.getByRole("button", { name: lang === "fi" ? "Täytä lomake potilastiedoista" : "Fyll i formuläret från patientuppgifterna" }));
  vi.useRealTimers();
  return user;
}

describe("the print summary", () => {
  it("has the patient, the answered questions, units and where answers came from", async () => {
    await fillFromMaija("fi");
    expect(summary().getByRole("heading", { level: 1, hidden: true })).toHaveTextContent("Esitietolomake - Äitiysneuvola");
    expect(summary().getByText(/Maija Esimerkki, syntynyt 1994-03-12, 120394-912U/)).toBeInTheDocument();
    expect(summary().getByText(/Tila: kesken/)).toBeInTheDocument();
    const height = summary().getByText(/Mikä on pituutesi \(cm\)\?/).closest(".print-answer")!;
    expect(height).toHaveTextContent("166 cm (potilastiedoista: Pituus, mitattu, 2026-09-15)");
    const illnesses = summary().getByText(/Onko sinulla todettu jokin seuraavista sairauksista tai riskeistä/).closest(".print-answer")!;
    expect(illnesses).toHaveTextContent("astma; kilpirauhasen toimintahäiriö; allergiat (ml. lääkeaineallergiat)");
    // Unanswered questions are left out.
    expect(summary().queryByText(/Käytätkö kalsiumia/)).toBeNull();
  });

  it("is in the chosen language", async () => {
    await fillFromMaija("sv");
    expect(summary().getByText(/född 1994-03-12/)).toBeInTheDocument();
    expect(summary().getAllByText(/från patientuppgifterna/).length).toBeGreaterThan(10);
  });

  it("shows scores, and says when nothing is answered", async () => {
    const user = userEvent.setup();
    render(<Harness slug="nikotiiniriippuvuustesti-fagerstrom" lang="fi" />);
    expect(summary().getByText("Ei vastauksia.")).toBeInTheDocument();
    for (const group of screen.getAllByRole("radiogroup")) await user.click(within(group).getAllByRole("radio")[0]!);
    const score = summary().getByText("Nikotiiniriippuvuus").closest(".print-answer")!;
    expect(score).toHaveTextContent("3");
  });

  it("is printed with the Print button", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<Harness slug="masennuskysely-phq-9" lang="fi" />);
    await user.click(screen.getByRole("button", { name: "Tulosta" }));
    expect(print).toHaveBeenCalledOnce();
  });
});
