import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireForm } from "../renderer/QuestionnaireForm.tsx";
import { bundle, NOW, questionnaire } from "../test/population.ts";
import { emptyPatientData, type PatientData } from "./store.ts";

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
const question = (linkId: string) => document.querySelector<HTMLElement>(`[data-link-id="${linkId}"]`)!;

async function loadAndFill() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const user = userEvent.setup();
  render(<Harness />);
  await user.upload(screen.getByLabelText("Lisää tiedostoja…"), new File([JSON.stringify(bundle)], "potilas.json"));
  expect(screen.getByRole("button", { name: "Täytä lomake potilastiedoista" })).toBeDisabled();
  expect(screen.getByText("Valitse potilas ensin.")).toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "Potilas" }), "Maija M");
  // An answer given before filling in stays.
  await user.type(screen.getByRole("textbox", { name: "Jo vastattu" }), "oma vastaus");
  await user.click(screen.getByRole("button", { name: "Täytä lomake potilastiedoista" }));
  vi.useRealTimers();
  return user;
}

describe("filling in from patient data", () => {
  it("fills answers, marks them, and says what it skipped", async () => {
    await loadAndFill();
    expect(screen.getByRole("status", { name: "" }).textContent).toMatch(/Täytettiin 8 kohtaa potilastiedoista\./);
    expect(screen.getByRole("textbox", { name: "Pituus" })).toHaveValue("165");
    expect(within(question("height")).getByText("Potilastiedoista")).toBeInTheDocument();
    expect(within(question("height")).getByText("h-new, 2026-06-01")).toBeInTheDocument();
    expect(within(question("which")).getByRole("textbox", { name: "Mitkä?" })).toHaveValue("Pähkinä");
    expect(within(question("conditions")).getByRole("checkbox", { name: "Astma" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Jo vastattu" })).toHaveValue("oma vastaus");
    expect(within(question("previous")).queryByText("Potilastiedoista")).toBeNull();

    const skipped = screen.getByText("2 kohtaa jäi täyttämättä").closest("details")!;
    expect(skipped).toHaveTextContent("launch context %user is not available");
    expect(skipped).toHaveTextContent("Paino: Observation/w: 62.4 is not a whole number");
  });

  it("shows the source record on request", async () => {
    const user = await loadAndFill();
    await user.click(within(question("height")).getByRole("button", { name: "Näytä lähdetiedot" }));
    expect(within(question("height")).getByText(/"id": "h-new"/)).toBeInTheDocument();
  });

  it("records the sources in the response, and the patient as its subject", async () => {
    await loadAndFill();
    const response = responseJson();
    expect(response.subject).toEqual({ reference: "Patient/p1", display: "Maija M" });
    const height = response.item.find((item: { linkId: string }) => item.linkId === "height");
    expect(height.answer).toEqual([
      {
        extension: [
          { url: "https://sensotrend.com/fhir/StructureDefinition/answer-source", valueReference: { reference: "Observation/h-new", display: "h-new" } },
        ],
        valueDecimal: 165,
      },
    ]);
  });

  it("drops the mark when the person changes the answer", async () => {
    const user = await loadAndFill();
    const field = screen.getByRole("textbox", { name: "Pituus" });
    await user.clear(field);
    await user.type(field, "166");
    expect(within(question("height")).queryByText("Potilastiedoista")).toBeNull();
    const height = responseJson().item.find((item: { linkId: string }) => item.linkId === "height");
    expect(height.answer).toEqual([{ valueDecimal: 166 }]);
  });

  it("can be undone", async () => {
    const user = await loadAndFill();
    await user.click(screen.getByRole("button", { name: "Kumoa täyttö" }));
    expect(screen.getByRole("textbox", { name: "Pituus" })).toHaveValue("");
    expect(screen.queryByText("Potilastiedoista")).toBeNull();
    expect(screen.queryByText(/Täytettiin/)).toBeNull();
  });
});
