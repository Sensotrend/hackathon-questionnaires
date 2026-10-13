import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Questionnaire } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { allItems } from "../fhir/items.ts";
import { realQuestionnaires } from "../test/questionnaires.ts";
import { QuestionnaireForm } from "./QuestionnaireForm.tsx";

const sv = (text: string) => ({
  extension: [
    {
      url: "http://hl7.org/fhir/StructureDefinition/translation",
      extension: [
        { url: "lang", valueCode: "sv" },
        { url: "content", valueString: text },
      ],
    },
  ],
});
const control = (code: string) => ({
  url: "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
  valueCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/questionnaire-item-control", code }] },
});
const coding = (code: string, display: string, svDisplay?: string) => ({
  valueCoding: { system: "urn:test", code, display, ...(svDisplay && { _display: sv(svDisplay) }) },
});

/** One item of every type the renderer knows, plus one it doesn't. */
const everyType: Questionnaire = {
  resourceType: "Questionnaire",
  status: "active",
  title: "Kaikki tyypit",
  _title: sv("Alla typer"),
  description: "Rivi 1\nRivi 2",
  item: [
    {
      linkId: "g",
      type: "group",
      text: "Ryhmä",
      _text: sv("Grupp"),
      item: [
        { linkId: "info", type: "display", text: "Ohje" },
        {
          linkId: "smoke",
          type: "choice",
          text: "Tupakoitko?",
          _text: sv("Röker du?"),
          required: true,
          extension: [control("radio-button")],
          answerOption: [coding("yes", "Kyllä", "Ja"), coding("no", "Ei", "Nej")],
          item: [{ linkId: "amount", type: "text", text: "Kuinka paljon?" }],
        },
        {
          linkId: "conditions",
          type: "choice",
          repeats: true,
          text: "Sairaudet",
          answerOption: [coding("asthma", "Astma"), coding("diabetes", "Diabetes")],
        },
        {
          linkId: "country",
          type: "choice",
          text: "Maa",
          answerOption: Array.from({ length: 11 }, (_, index) => coding(`c${index}`, `Maa ${index}`)),
        },
        { linkId: "pet", type: "open-choice", text: "Lemmikki", answerOption: [{ valueString: "Kissa" }] },
        { linkId: "name", type: "string", text: "Nimi" },
        { linkId: "count", type: "integer", text: "Lukumäärä" },
        { linkId: "weight", type: "decimal", text: "Paino" },
        {
          linkId: "pain",
          type: "integer",
          text: "Kipu",
          extension: [
            { url: "http://hl7.org/fhir/StructureDefinition/minValue", valueInteger: 0 },
            { url: "http://hl7.org/fhir/StructureDefinition/maxValue", valueInteger: 10 },
            control("slider"),
          ],
        },
        { linkId: "lmp", type: "date", text: "Päivä" },
        { linkId: "at", type: "dateTime", text: "Aika" },
        { linkId: "clock", type: "time", text: "Kello" },
        { linkId: "ok", type: "boolean", text: "Onko?" },
        { linkId: "site", type: "url", text: "Sivu" },
        { linkId: "photo", type: "attachment", text: "Kuva" },
      ],
    },
    {
      linkId: "score-total",
      type: "decimal",
      text: "Pisteet",
      readOnly: true,
      extension: [
        {
          url: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression",
          valueExpression: { language: "text/fhirpath", expression: "0" },
        },
        { url: "http://hl7.org/fhir/StructureDefinition/minValue", valueDecimal: 0 },
        { url: "http://hl7.org/fhir/StructureDefinition/maxValue", valueDecimal: 27 },
      ],
    },
  ],
};

describe("QuestionnaireForm", () => {
  it("renders title, description, groups and display texts", () => {
    render(<QuestionnaireForm questionnaire={everyType} lang="fi" />);
    expect(screen.getByRole("heading", { level: 1, name: "Kaikki tyypit" })).toBeInTheDocument();
    expect(screen.getByText(/Rivi 1/)).toHaveTextContent("Rivi 1 Rivi 2");
    expect(screen.getByRole("region", { name: "Ryhmä" })).toBeInTheDocument();
    expect(screen.getByText("Ohje")).toBeInTheDocument();
  });

  it("renders a control for every item type, and names the unsupported one", () => {
    render(<QuestionnaireForm questionnaire={everyType} lang="fi" />);
    expect(within(screen.getByRole("group", { name: /Tupakoitko/ })).getAllByRole("radio")).toHaveLength(2);
    expect(within(screen.getByRole("group", { name: "Sairaudet" })).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(screen.getByRole("combobox", { name: "Maa" })).getAllByRole("option")).toHaveLength(12);
    expect(screen.getByRole("textbox", { name: "Nimi" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Kuinka paljon?" }).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("textbox", { name: "Lukumäärä" })).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByRole("textbox", { name: "Paino" })).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("slider", { name: "Kipu" })).toHaveAttribute("aria-valuetext", "Ei vastattu");
    expect(screen.getByLabelText("Päivä")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Aika")).toHaveAttribute("type", "datetime-local");
    expect(screen.getByLabelText("Kello")).toHaveAttribute("type", "time");
    expect(within(screen.getByRole("group", { name: "Onko?" })).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Sivu" })).toHaveAttribute("type", "url");
    expect(screen.getByText(/Kysymystyyppiä ei tueta: attachment/)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Pisteet" })).toHaveTextContent("–");
    expect(screen.getByText("Asteikko 0–27")).toBeInTheDocument();
  });

  it("marks required questions for sight and for screen readers", () => {
    render(<QuestionnaireForm questionnaire={everyType} lang="fi" />);
    // The asterisk is aria-hidden; screen readers hear the word instead.
    const group = screen.getByRole("group", { name: /^Tupakoitko\?\s*\(pakollinen\)$/ });
    expect(group).toHaveAttribute("aria-required", "true");
    expect(group).toHaveTextContent("Tupakoitko? *");
  });

  it("keeps answers as the person answers", async () => {
    const user = userEvent.setup();
    render(<QuestionnaireForm questionnaire={everyType} lang="fi" />);

    const smoke = within(screen.getByRole("group", { name: /Tupakoitko/ }));
    await user.click(smoke.getByRole("radio", { name: "Kyllä" }));
    await user.click(smoke.getByRole("radio", { name: "Ei" }));
    expect(smoke.getByRole("radio", { name: "Ei" })).toBeChecked();
    expect(smoke.getByRole("radio", { name: "Kyllä" })).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Astma" }));
    await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));
    await user.click(screen.getByRole("checkbox", { name: "Astma" }));
    expect(screen.getByRole("checkbox", { name: "Astma" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Diabetes" })).toBeChecked();

    await user.selectOptions(screen.getByRole("combobox", { name: "Maa" }), "Maa 10");
    expect(screen.getByRole("combobox", { name: "Maa" })).toHaveDisplayValue("Maa 10");

    await user.type(screen.getByRole("textbox", { name: "Muu:" }), "Kani");
    expect(screen.getByRole("textbox", { name: "Muu:" })).toHaveValue("Kani");

    await user.type(screen.getByRole("textbox", { name: "Nimi" }), "Maija");
    expect(screen.getByRole("textbox", { name: "Nimi" })).toHaveValue("Maija");

    await user.click(within(screen.getByRole("group", { name: "Onko?" })).getByRole("radio", { name: "Kyllä" }));
    expect(within(screen.getByRole("group", { name: "Onko?" })).getByRole("radio", { name: "Kyllä" })).toBeChecked();
  });

  it("keeps what is typed in a number field even before it is a valid number", async () => {
    const user = userEvent.setup();
    render(<QuestionnaireForm questionnaire={everyType} lang="fi" />);
    const count = screen.getByRole("textbox", { name: "Lukumäärä" });
    await user.type(count, "1.5");
    expect(count).toHaveValue("1.5");
    const weight = screen.getByRole("textbox", { name: "Paino" });
    await user.type(weight, "62,5");
    expect(weight).toHaveValue("62,5");
  });

  it("switches language without losing answers", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<QuestionnaireForm questionnaire={everyType} lang="fi" />);
    await user.click(within(screen.getByRole("group", { name: /Tupakoitko/ })).getByRole("radio", { name: "Kyllä" }));
    rerender(<QuestionnaireForm questionnaire={everyType} lang="sv" />);
    expect(screen.getByRole("heading", { level: 1, name: "Alla typer" })).toBeInTheDocument();
    const smoke = within(screen.getByRole("group", { name: /^Röker du\?\s*\(obligatorisk\)$/ }));
    expect(smoke.getByRole("radio", { name: "Ja" })).toBeChecked();
    // Untranslated texts fall back to the questionnaire's own language.
    expect(screen.getByText("Ohje")).toBeInTheDocument();
  });
});

describe("every real questionnaire", () => {
  it.each(realQuestionnaires.map(({ slug, questionnaire }) => [slug, questionnaire] as const))(
    "%s renders every item, in every language",
    (_slug, questionnaire) => {
      for (const lang of ["fi", "sv", "en"] as const) {
        const { container, unmount } = render(<QuestionnaireForm questionnaire={questionnaire} lang={lang} />);
        for (const item of allItems(questionnaire.item)) {
          const element = container.querySelector(`[id="item-${item.linkId}"]`);
          if (item.type === "group" && !item.text) continue;
          expect(element, `${lang} ${item.type} ${item.linkId}`).not.toBeNull();
        }
        expect(container.querySelector(".unsupported"), lang).toBeNull();
        unmount();
      }
    },
  );
});
