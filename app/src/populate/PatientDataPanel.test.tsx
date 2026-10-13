import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { QuestionnaireForm } from "../renderer/QuestionnaireForm.tsx";
import { emptyPatientData, type PatientData } from "./store.ts";

const questionnaire = {
  resourceType: "Questionnaire" as const,
  status: "active" as const,
  title: "Lomake",
  item: [{ linkId: "a", type: "string" as const, text: "Kysymys" }],
};
const maija = {
  resourceType: "Patient",
  id: "p1",
  identifier: [{ system: "urn:oid:1.2.246.21", value: "010190-900A" }],
  name: [{ given: ["Maija"], family: "Meikäläinen" }],
  birthDate: "1990-01-01",
};
const matti = { resourceType: "Patient", id: "p2", name: [{ text: "Matti Esimerkki" }] };
const bundle = (...resources: object[]) =>
  JSON.stringify({ resourceType: "Bundle", type: "collection", entry: resources.map((resource) => ({ resource })) });

function Harness() {
  const [data, setData] = useState<PatientData>(emptyPatientData);
  const [patientId, setPatientId] = useState<string>();
  return (
    <QuestionnaireForm
      questionnaire={questionnaire}
      lang="fi"
      patientData={data}
      onPatientDataChange={setData}
      patientId={patientId}
      onSelectPatient={setPatientId}
    />
  );
}

const responseJson = () => JSON.parse(document.querySelector(".response pre")!.textContent!);

describe("the patient data panel", () => {
  it("loads files, names the patient and makes them the response's subject", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const file = new File([bundle(maija, { resourceType: "Observation", id: "o1", subject: { reference: "Patient/p1" } })], "maija.json");
    await user.upload(screen.getByLabelText("Lisää tiedostoja…"), file);
    expect(screen.getByText("Maija Meikäläinen, syntynyt 1990-01-01, 010190-900A")).toBeInTheDocument();
    expect(screen.getByText(/maija\.json \(2\) · 1 Patient, 1 Observation/)).toBeInTheDocument();
    expect(responseJson().subject).toEqual({ reference: "Patient/p1", display: "Maija Meikäläinen" });
  });

  it("takes pasted JSON, and asks which patient when there are several", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("textbox", { name: "Tai liitä JSON tähän" }));
    await user.paste(bundle(maija, matti));
    await user.click(screen.getByRole("button", { name: "Lisää" }));
    expect(screen.getByRole("textbox", { name: "Tai liitä JSON tähän" })).toHaveValue("");
    expect(responseJson().subject).toBeUndefined();
    await user.selectOptions(screen.getByRole("combobox", { name: "Potilas" }), "Matti Esimerkki");
    expect(responseJson().subject).toEqual({ reference: "Patient/p2", display: "Matti Esimerkki" });
  });

  it("reports what it can't read, and says when there is no patient", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText("Lisää tiedostoja…"), new File(["{"], "broken.json"));
    expect(screen.getByRole("alert")).toHaveTextContent(/^Tietoja ei voitu lukea: broken\.json: /);
    await user.upload(screen.getByLabelText("Lisää tiedostoja…"), new File([bundle({ resourceType: "Observation", id: "o" })], "obs.json"));
    expect(screen.getByText(/Tiedoissa ei ole Patient-resurssia/)).toBeInTheDocument();
  });

  it("removes the data", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText("Lisää tiedostoja…"), new File([bundle(maija)], "maija.json"));
    await user.click(screen.getByRole("button", { name: "Poista potilastiedot" }));
    expect(screen.queryByText(/Maija Meikäläinen/)).toBeNull();
    expect(responseJson().subject).toBeUndefined();
  });
});

describe("the sample patients", () => {
  it("are offered, and one loads with a click", async () => {
    const user = userEvent.setup();
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { vi } = await import("vitest");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(readFileSync(resolve(process.cwd(), "../samples/bundles/neuvola-eetu.json"), "utf8"))),
    );
    render(<Harness />);
    expect(screen.getAllByRole("button", { name: /Maija|Aino|Eetu|Pekka/ })).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Eetu, 2 v (lastenneuvola)" }));
    expect(screen.getByText("Eetu Esimerkki, syntynyt 2024-06-01, 010624A951B")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
