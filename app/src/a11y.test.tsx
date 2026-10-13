// Accessibility checks with axe-core (milestone 11). jsdom has no layout, so
// colour contrast is checked in the browser instead (docs/IMPLEMENTATION_PLAN.md).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { emptyPatientData, type PatientData } from "./populate/store.ts";
import { QuestionnaireForm } from "./renderer/QuestionnaireForm.tsx";
import { bySlug, realQuestionnaires } from "./test/questionnaires.ts";

async function violations(container: Element) {
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

function Harness({ slug }: { slug: string }) {
  const [data, setData] = useState<PatientData>(emptyPatientData);
  const [patientId, setPatientId] = useState<string>();
  return (
    <main>
      <QuestionnaireForm
        questionnaire={bySlug(slug)}
        lang="fi"
        patientData={data}
        onPatientDataChange={setData}
        patientId={patientId}
        onSelectPatient={setPatientId}
      />
    </main>
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});

describe("accessibility (axe-core)", () => {
  it("the list", async () => {
    const bundle = { resourceType: "Bundle", type: "collection", entry: realQuestionnaires.map(({ questionnaire }) => ({ resource: questionnaire })) };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(bundle))));
    const { container } = render(<App />);
    await screen.findAllByRole("listitem");
    expect(await violations(container)).toEqual([]);
    vi.unstubAllGlobals();
  });

  it.each(realQuestionnaires.map(({ slug }) => slug))("%s", async (slug) => {
    const { container } = render(<Harness slug={slug} />);
    expect(await violations(container)).toEqual([]);
  });

  it("a form showing its errors", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness slug="masennuskysely-phq-9" />);
    await user.click(screen.getByRole("button", { name: "Valmis" }));
    expect(await violations(container)).toEqual([]);
  });

  it("a form filled in from a sample, with badges and the skipped list", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T12:00:00+03:00"));
    const { container } = render(<Harness slug="esitietolomake-aitiysneuvola" />);
    const text = readFileSync(resolve(process.cwd(), "../samples/bundles/aitiysneuvola-maija.json"), "utf8");
    await user.upload(screen.getByLabelText("Lisää tiedostoja…"), new File([text], "maija.json"));
    await user.click(screen.getByRole("button", { name: "Täytä lomake potilastiedoista" }));
    vi.useRealTimers();
    expect(screen.getAllByText("Potilastiedoista").length).toBeGreaterThan(10);
    // A source and the response JSON open: their scrolling boxes must be reachable by keyboard.
    await user.click(screen.getAllByRole("button", { name: "Näytä lähdetiedot" })[0]!);
    container.querySelector("details.response")!.setAttribute("open", "");
    expect(await violations(container)).toEqual([]);
  });
});
