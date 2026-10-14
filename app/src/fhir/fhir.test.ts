import { describe, expect, it } from "vitest";
import { realQuestionnaires } from "../test/questionnaires.ts";
import { kindOf, questionCount } from "./items.ts";
import { localized } from "./text.ts";

const translations = {
  extension: [
    {
      url: "http://hl7.org/fhir/StructureDefinition/translation",
      extension: [
        { url: "lang", valueCode: "sv" },
        { url: "content", valueString: "Ja" },
      ],
    },
  ],
};

describe("localized", () => {
  it("picks the translation, and falls back to the element's own text", () => {
    expect(localized("Kyllä", translations, "sv")).toBe("Ja");
    expect(localized("Kyllä", translations, "en")).toBe("Kyllä");
    expect(localized("Kyllä", undefined, "fi")).toBe("Kyllä");
    expect(localized(undefined, undefined, "fi")).toBe("");
  });
});

describe("the real questionnaires", () => {
  it("are classified for the list as in the source", () => {
    expect(Object.fromEntries(realQuestionnaires.map(({ slug, questionnaire }) => [slug, kindOf(questionnaire)]))).toEqual({
      "ahdistuneisuuskysely-gad-7": "screening",
      "alkoholin-kayton-riskit-kysely-audit": "screening",
      "esitietolomake-aitiysneuvola": "previsit",
      "esitietolomake-toisen-asteen-terveystarkastukseen-opiskeluterveydenhuolto": "previsit",
      // Embeds AUDIT-C (3 scored questions of 51), but is a pre-visit form.
      "esitietolomake-tyottoman-terveystarkastus": "previsit",
      "fysioterapia-alaselkakysely-lahtotilanne": "careplan",
      "kouluterveydenhuolto-esitietolomake-5-luokkalaisten-vanhemmille": "previsit",
      "kouluterveydenhuolto-esitietolomake-8-luokan-oppilaille": "previsit",
      "lapsen-tai-nuoren-adhd-oirekysely-adhd-rs": "screening",
      "masennuskysely-bdi-21": "screening",
      "masennuskysely-phq-9": "screening",
      "mielialakysely-epds-neuvolapalvelut-ja-psykologit": "screening",
      "neuvolapalvelut-esitietolomake-2-v-ikaisen-lapsen-vanhemmille": "previsit",
      "neuvolapalvelut-esitietolomake-5-v-ikaisen-lapsen-vanhemmille": "previsit",
      "nikotiiniriippuvuustesti-fagerstrom": "screening",
    });
  });

  it("count questions as the conversion report does", () => {
    const counts = Object.fromEntries(realQuestionnaires.map(({ slug, questionnaire }) => [slug, questionCount(questionnaire)]));
    expect(counts["masennuskysely-phq-9"]).toBe(10);
    expect(counts["esitietolomake-aitiysneuvola"]).toBe(83);
    expect(counts["kouluterveydenhuolto-esitietolomake-5-luokkalaisten-vanhemmille"]).toBe(127);
  });
});
