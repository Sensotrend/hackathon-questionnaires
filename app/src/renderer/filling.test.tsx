import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuestionnaireItem } from "fhir/r4";
import { describe, expect, it, vi } from "vitest";
import { allItems } from "../fhir/items.ts";
import { bySlug } from "../test/questionnaires.ts";
import { optionLabel } from "./options.ts";
import { QuestionnaireForm } from "./QuestionnaireForm.tsx";

const responseJson = () => JSON.parse(document.querySelector(".response pre")!.textContent!);

describe("filling in PHQ-9", () => {
  const phq9 = bySlug("masennuskysely-phq-9");
  const required = allItems(phq9.item).filter((item) => item.required && !item.enableWhen).length;

  it("lists what is missing on Done, then completes with the highest score", async () => {
    const user = userEvent.setup();
    render(<QuestionnaireForm questionnaire={phq9} lang="fi" />);
    const score = screen.getByRole("status", { name: "Kyselyn kokonaispistemäärä" });
    expect(score).toHaveTextContent("–");

    await user.click(screen.getByRole("button", { name: "Valmis" }));
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent(`Lomakkeesta puuttuu vielä ${required} kohtaa:`);
    expect(within(summary).getAllByRole("listitem")).toHaveLength(required);
    expect(summary).toHaveFocus();
    const first = screen.getAllByRole("group").find((group) => group.getAttribute("aria-invalid") === "true")!;
    expect(first).toHaveAccessibleDescription("Vastaa tähän kysymykseen.");

    // The summary moves focus to the question.
    await user.click(within(summary).getAllByRole("button")[0]!);
    expect(document.activeElement).toBe(within(first).getAllByRole("radio")[0]);

    for (const group of screen.getAllByRole("group")) {
      const radios = within(group).queryAllByRole("radio");
      if (radios.length > 0) await user.click(radios.at(-1)!);
    }
    expect(score).toHaveTextContent("27");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(responseJson().status).toBe("in-progress");

    await user.click(screen.getByRole("button", { name: "Valmis" }));
    expect(screen.getByText(/Lomake on valmis/)).toBeInTheDocument();
    const response = responseJson();
    expect(response.status).toBe("completed");
    expect(response.authored).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(response.questionnaire).toBe(`${phq9.url}|${phq9.version}`);
    expect(response.item.at(-1)).toEqual({ linkId: "score-total", text: "Kyselyn kokonaispistemäärä", answer: [{ valueDecimal: 27 }] });
  });

  it("downloads the response and clears the answers after confirmation", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:response");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<QuestionnaireForm questionnaire={phq9} lang="en" />);

    await user.click(screen.getAllByRole("radio", { name: "Nearly every day" })[0]!);
    expect(screen.getByRole("status", { name: "Points" })).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: "Download as JSON" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click.mock.contexts[0]).toMatchObject({ download: `QuestionnaireResponse-${phq9.id}.json` });

    await user.click(screen.getByRole("button", { name: "Clear answers" }));
    const confirm = screen.getByRole("group", { name: "Clear all answers?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("status", { name: "Points" })).toHaveTextContent("3");
    await user.click(screen.getByRole("button", { name: "Clear answers" }));
    await user.click(within(screen.getByRole("group", { name: "Clear all answers?" })).getByRole("button", { name: "Clear answers" }));
    expect(screen.getByRole("status", { name: "Points" })).toHaveTextContent("–");
    expect(screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(0);
    click.mockRestore();
  });
});

describe("follow-up questions", () => {
  it("appear for their answer only, and leave the response when hidden", async () => {
    const user = userEvent.setup();
    const maternity = bySlug("esitietolomake-aitiysneuvola");
    const parent = allItems(maternity.item).find((item) => item.type === "choice" && !item.repeats && item.item?.length)!;
    const followUp = parent.item![0]!;
    const code = followUp.enableWhen![0]!.answerCoding!.code;
    const [trigger, other] = [
      parent.answerOption!.find((option) => option.valueCoding?.code === code)!,
      parent.answerOption!.find((option) => option.valueCoding?.code !== code)!,
    ];
    const label = (option: NonNullable<QuestionnaireItem["answerOption"]>[number]) => optionLabel(option, "fi");

    const { container } = render(<QuestionnaireForm questionnaire={maternity} lang="fi" />);
    const question = () => within(container.querySelector<HTMLElement>(`[id="item-${parent.linkId}"]`)!);
    const followUpElement = () => container.querySelector(`[id="item-${followUp.linkId}"]`);
    expect(followUpElement()).toBeNull();

    await user.click(question().getByRole("radio", { name: label(trigger) }));
    expect(followUpElement()).not.toBeNull();
    const field = within(followUpElement()!.closest(".question")!).queryByRole("textbox");
    if (field) await user.type(field, "2");
    expect(JSON.stringify(responseJson())).toContain(followUp.linkId);

    await user.click(question().getByRole("radio", { name: label(other) }));
    expect(followUpElement()).toBeNull();
    expect(JSON.stringify(responseJson())).not.toContain(followUp.linkId);
  });
});

describe("number fields", () => {
  it("flag text that isn't a valid number on Done", async () => {
    const user = userEvent.setup();
    const questionnaire = {
      resourceType: "Questionnaire" as const,
      status: "active" as const,
      item: [{ linkId: "count", type: "integer" as const, text: "Lukumäärä" }],
    };
    render(<QuestionnaireForm questionnaire={questionnaire} lang="fi" />);
    const field = screen.getByRole("textbox", { name: "Lukumäärä" });
    await user.type(field, "1.5");
    await user.click(screen.getByRole("button", { name: "Valmis" }));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Anna kokonaisluku.");
    await user.clear(field);
    await user.type(field, "2");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(responseJson().item).toEqual([{ linkId: "count", text: "Lukumäärä", answer: [{ valueInteger: 2 }] }]);
  });
});
