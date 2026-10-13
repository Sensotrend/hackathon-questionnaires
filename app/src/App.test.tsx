import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { bySlug, realQuestionnaires } from "./test/questionnaires.ts";

const bundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: realQuestionnaires.map(({ questionnaire }) => ({ fullUrl: questionnaire.url, resource: questionnaire })),
};

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(bundle))));
  vi.spyOn(navigator, "language", "get").mockReturnValue("fi-FI");
  window.scrollTo = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("lists every questionnaire with its kind and question count", async () => {
    render(<App />);
    const phq9 = await screen.findByRole("link", { name: /Masennuskysely \(PHQ-9\)/ });
    expect(phq9).toHaveTextContent("Seulontakysely");
    expect(phq9).toHaveTextContent("10 kysymystä");
    expect(screen.getAllByRole("listitem")).toHaveLength(14);
  });

  it("opens a questionnaire and goes back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: /Masennuskysely \(PHQ-9\)/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Masennuskysely (PHQ-9)" })).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/q/${bySlug("masennuskysely-phq-9").id}`);
    await user.click(screen.getByRole("link", { name: /Kaikki lomakkeet/ }));
    expect(await screen.findAllByRole("listitem")).toHaveLength(14);
  });

  it("switches and remembers the language", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Svenska" }));
    expect(screen.getByRole("button", { name: "Svenska" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("link", { name: /Depressionsenkät \(PHQ.9\)/ })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("sv");
    unmount();
    render(<App />);
    expect(screen.getByRole("button", { name: "Svenska" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says when a questionnaire isn't there", async () => {
    window.location.hash = "#/q/nope";
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Lomaketta ei löytynyt.");
  });

  it("reports a failed load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500, statusText: "Server Error" })));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Lomakkeiden lataus epäonnistui: Error: 500 Server Error");
  });

  it("opens a Questionnaire from a file", async () => {
    const user = userEvent.setup();
    render(<App />);
    const questionnaire = { resourceType: "Questionnaire", id: "own", status: "draft", title: "Oma lomake", item: [] };
    const file = new File([JSON.stringify(questionnaire)], "own.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Avaa FHIR-tiedosto…"), file);
    expect(await screen.findByRole("heading", { level: 1, name: "Oma lomake" })).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("link", { name: /Oma lomake/ })).toHaveTextContent("tiedostosta");
  });

  it("explains a file without Questionnaires", async () => {
    const user = userEvent.setup();
    render(<App />);
    const file = new File([JSON.stringify({ resourceType: "Patient" })], "patient.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Avaa FHIR-tiedosto…"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tiedostoa ei voitu avata: Tiedostossa ei ole Questionnaire-resursseja.",
    );
  });
});
