import type { Questionnaire } from "fhir/r4";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { loadBundledQuestionnaires, questionnairesIn } from "./data/questionnaires.ts";
import { kindOf, questionCount } from "./fhir/items.ts";
import { LANGUAGES, localized, type Lang } from "./fhir/text.ts";
import { LANGUAGE_NAMES, t } from "./i18n.ts";
import { emptyPatientData, type PatientData } from "./populate/store.ts";

// The form brings fhirpath.js and its R4 model (most of the JavaScript), so
// it loads when a questionnaire is opened, not with the list.
const QuestionnaireForm = lazy(() =>
  import("./renderer/QuestionnaireForm.tsx").then((module) => ({ default: module.QuestionnaireForm })),
);

interface Entry {
  /** The route key: the Questionnaire's id, or a generated one for files. */
  key: string;
  questionnaire: Questionnaire;
  fromFile: boolean;
}

type Bundled = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; entries: Entry[] };

const LANGUAGE_KEY = "lang";

function initialLanguage(): Lang {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (LANGUAGES.includes(stored as Lang)) return stored as Lang;
  } catch {
    // Storage may be unavailable; fall back to the browser's language.
  }
  const browser = navigator.language.slice(0, 2);
  return LANGUAGES.includes(browser as Lang) ? (browser as Lang) : "fi";
}

function useHash(): string {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("hashchange", onChange);
      return () => window.removeEventListener("hashchange", onChange);
    },
    () => window.location.hash,
  );
}

/** `#/q/<key>` opens a questionnaire; anything else is the list. */
const routeKey = (hash: string) => (hash.startsWith("#/q/") ? decodeURIComponent(hash.slice(4)) : undefined);
const routeTo = (key: string) => `#/q/${encodeURIComponent(key)}`;

export function App() {
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const [bundled, setBundled] = useState<Bundled>({ status: "loading" });
  const [fromFiles, setFromFiles] = useState<Entry[]>([]);
  // Patient data is kept across questionnaires: load once, fill in several forms.
  const [patientData, setPatientData] = useState<PatientData>(emptyPatientData);
  const [patientId, setPatientId] = useState<string>();
  const key = routeKey(useHash());

  useEffect(() => {
    loadBundledQuestionnaires().then(
      (questionnaires) =>
        setBundled({
          status: "ready",
          entries: questionnaires.map((questionnaire, index) => ({
            key: questionnaire.id ?? `bundled-${index}`,
            questionnaire,
            fromFile: false,
          })),
        }),
      (error: unknown) => setBundled({ status: "error", message: String(error) }),
    );
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("appTitle", lang);
    try {
      localStorage.setItem(LANGUAGE_KEY, lang);
    } catch {
      // Remembering the language is a convenience only.
    }
  }, [lang]);

  // A new page starts at the top, as a link to another page would.
  // (A block body: newer browsers return a Promise from scrollTo, which React would take for a cleanup.)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);

  const entries = [...fromFiles, ...(bundled.status === "ready" ? bundled.entries : [])];
  const open = key === undefined ? undefined : entries.find((entry) => entry.key === key);

  return (
    <>
      <header className="app-header">
        <a href="#/" className="app-title">
          {t("appTitle", lang)}
        </a>
        <LanguageSwitch lang={lang} onChange={setLang} />
      </header>
      <main>
        {key === undefined ? (
          <QuestionnaireList
            lang={lang}
            bundled={bundled}
            entries={entries}
            onOpenFile={(questionnaires) => {
              const added = questionnaires.map((questionnaire, index) => ({
                key: `file-${Date.now()}-${index}-${questionnaire.id ?? ""}`,
                questionnaire,
                fromFile: true,
              }));
              setFromFiles((previous) => [...added, ...previous]);
              if (added.length === 1) window.location.hash = routeTo(added[0]!.key);
            }}
          />
        ) : (
          <>
            <a href="#/" className="back">
              ← {t("back", lang)}
            </a>
            {open ? (
              <Suspense fallback={<p>{t("loading", lang)}</p>}>
                <QuestionnaireForm
                  key={open.key}
                  questionnaire={open.questionnaire}
                  lang={lang}
                  patientData={patientData}
                  onPatientDataChange={setPatientData}
                  patientId={patientId}
                  onSelectPatient={setPatientId}
                />
              </Suspense>
            ) : bundled.status === "loading" ? (
              <p>{t("loading", lang)}</p>
            ) : (
              <p role="alert">{t("notFound", lang)}</p>
            )}
          </>
        )}
      </main>
    </>
  );
}

function LanguageSwitch({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  return (
    <div className="language-switch" role="group" aria-label={t("language", lang)}>
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={option === lang}
          onClick={() => onChange(option)}
        >
          {LANGUAGE_NAMES[option]}
        </button>
      ))}
    </div>
  );
}

function QuestionnaireList(props: {
  lang: Lang;
  bundled: Bundled;
  entries: Entry[];
  onOpenFile: (questionnaires: Questionnaire[]) => void;
}) {
  const { lang, bundled, entries, onOpenFile } = props;
  const [fileError, setFileError] = useState<string>();

  return (
    <>
      <p className="intro">{t("intro", lang)}</p>
      <div className="open-file">
        <label className="button">
          {t("openFile", lang)}
          <input
            type="file"
            accept=".json,application/json,application/fhir+json"
            className="visually-hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                const questionnaires = questionnairesIn(JSON.parse(await file.text()));
                if (questionnaires.length === 0) throw new Error(t("noQuestionnaires", lang));
                setFileError(undefined);
                onOpenFile(questionnaires);
              } catch (error) {
                setFileError(`${t("fileError", lang)}: ${error instanceof Error ? error.message : String(error)}`);
              }
            }}
          />
        </label>
        <span className="hint">{t("openFileHelp", lang)}</span>
        {fileError && (
          <p role="alert" className="error">
            {fileError}
          </p>
        )}
      </div>

      {bundled.status === "loading" && <p>{t("loading", lang)}</p>}
      {bundled.status === "error" && (
        <p role="alert" className="error">
          {t("loadError", lang)}: {bundled.message}
        </p>
      )}

      <ul className="questionnaire-list">
        {entries.map(({ key, questionnaire, fromFile }) => {
          const title = localized(questionnaire.title ?? questionnaire.name, questionnaire._title, lang);
          const description = localized(questionnaire.description, questionnaire._description, lang);
          return (
            <li key={key}>
              <a href={routeTo(key)} className="card">
                <span className="card-title text">{title || key}</span>
                {description && <span className="card-description text">{description.split("\n")[0]}</span>}
                <span className="card-meta">
                  <span className={`badge badge-${kindOf(questionnaire)}`}>{t(`kind_${kindOf(questionnaire)}`, lang)}</span>
                  <span>
                    {questionCount(questionnaire)} {t("questions", lang)}
                  </span>
                  {fromFile && <span className="badge">{t("fromFile", lang)}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
