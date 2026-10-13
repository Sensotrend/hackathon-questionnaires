// The app's own texts. Questionnaire texts come from the Questionnaires.

import type { Lang } from "./fhir/text.ts";

const strings = {
  appTitle: { fi: "Esitietolomakkeet", sv: "Förhandsformulär", en: "Pre-visit questionnaires" },
  intro: {
    fi: "Valitse lomake täytettäväksi. Vastauksia ei tallenneta eikä lähetetä minnekään.",
    sv: "Välj ett formulär att fylla i. Svaren sparas inte och skickas ingenstans.",
    en: "Choose a questionnaire to fill in. Answers are not saved or sent anywhere.",
  },
  language: { fi: "Kieli", sv: "Språk", en: "Language" },
  openFile: { fi: "Avaa FHIR-tiedosto…", sv: "Öppna FHIR-fil…", en: "Open a FHIR file…" },
  openFileHelp: {
    fi: "Questionnaire tai Bundle, jossa on Questionnaire-resursseja",
    sv: "Questionnaire eller Bundle med Questionnaire-resurser",
    en: "A Questionnaire, or a Bundle of them",
  },
  fileError: { fi: "Tiedostoa ei voitu avata", sv: "Filen kunde inte öppnas", en: "Could not open the file" },
  noQuestionnaires: {
    fi: "Tiedostossa ei ole Questionnaire-resursseja.",
    sv: "Filen innehåller inga Questionnaire-resurser.",
    en: "The file contains no Questionnaire resources.",
  },
  loading: { fi: "Ladataan…", sv: "Laddar…", en: "Loading…" },
  loadError: { fi: "Lomakkeiden lataus epäonnistui", sv: "Formulären kunde inte laddas", en: "Could not load the questionnaires" },
  notFound: { fi: "Lomaketta ei löytynyt.", sv: "Formuläret hittades inte.", en: "Questionnaire not found." },
  back: { fi: "Kaikki lomakkeet", sv: "Alla formulär", en: "All questionnaires" },
  questions: { fi: "kysymystä", sv: "frågor", en: "questions" },
  fromFile: { fi: "tiedostosta", sv: "från fil", en: "from file" },
  required: { fi: "pakollinen", sv: "obligatorisk", en: "required" },
  choose: { fi: "Valitse…", sv: "Välj…", en: "Choose…" },
  other: { fi: "Muu", sv: "Annat", en: "Other" },
  yes: { fi: "Kyllä", sv: "Ja", en: "Yes" },
  no: { fi: "Ei", sv: "Nej", en: "No" },
  notAnswered: { fi: "Ei vastattu", sv: "Inte besvarad", en: "Not answered" },
  clear: { fi: "Tyhjennä", sv: "Rensa", en: "Clear" },
  scale: { fi: "Asteikko", sv: "Skala", en: "Scale" },
  noScore: { fi: "–", sv: "–", en: "–" },
  unsupported: { fi: "Kysymystyyppiä ei tueta", sv: "Frågetypen stöds inte", en: "Unsupported item type" },
  kind_screening: { fi: "Seulontakysely", sv: "Screeningenkät", en: "Screening" },
  kind_previsit: { fi: "Esitietolomake", sv: "Förhandsformulär", en: "Pre-visit form" },
  kind_careplan: { fi: "Hoitosuunnitelma", sv: "Vårdplan", en: "Care plan" },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof strings;

export const t = (key: StringKey, lang: Lang) => strings[key][lang];

export const LANGUAGE_NAMES: Record<Lang, string> = { fi: "Suomi", sv: "Svenska", en: "English" };
