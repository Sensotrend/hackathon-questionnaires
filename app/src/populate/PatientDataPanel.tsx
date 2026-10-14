// Loading patient data (plan §7.1): files or pasted JSON, merged into one
// store; choosing the patient when the data holds several.

import type { Patient } from "fhir/r4";
import { useState, type ReactNode } from "react";
import type { Lang } from "../fhir/text.ts";
import { t } from "../i18n.ts";
import { SAMPLES } from "./samples.ts";
import { addDocument, HETU, patientName, patients, type PatientData } from "./store.ts";
import { WalletRequest } from "./WalletRequest.tsx";

export interface PatientDataProps {
  lang: Lang;
  data: PatientData;
  onChange: (data: PatientData) => void;
  patient: Patient | undefined;
  onSelectPatient: (id: string) => void;
  /** The fill action and its outcome, from milestone 9c on. */
  children?: ReactNode;
}

export function PatientDataPanel({ lang, data, onChange, patient, onSelectPatient, children }: PatientDataProps) {
  const [error, setError] = useState<string>();
  const [pasted, setPasted] = useState("");
  const [wallet, setWallet] = useState(false);
  const all = patients(data);

  const add = (texts: { name: string; text: string }[]) => {
    let next = data;
    try {
      for (const { name, text } of texts) {
        try {
          next = addDocument(next, JSON.parse(text), name);
        } catch (cause) {
          throw new Error(`${name}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        }
      }
      setError(undefined);
      onChange(next);
      return true;
    } catch (cause) {
      setError(`${t("dataError", lang)}: ${cause instanceof Error ? cause.message : String(cause)}`);
      return false;
    }
  };

  const counts = new Map<string, number>();
  for (const resource of data.resources) counts.set(resource.resourceType, (counts.get(resource.resourceType) ?? 0) + 1);

  return (
    <details className="patient-data" open>
      <summary>
        {t("patientData", lang)}
        {patient && `: ${patientName(patient)}`}
      </summary>
      <p className="hint">{t("patientDataHelp", lang)}</p>

      <div className="patient-data-load">
        <label className="button">
          {t("addFiles", lang)}
          <input
            type="file"
            multiple
            accept=".json,application/json,application/fhir+json"
            className="visually-hidden"
            onChange={async (event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              add(await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() }))));
            }}
          />
        </label>
        <label className="paste">
          <span>{t("pasteJson", lang)}</span>
          <textarea rows={2} value={pasted} onChange={(event) => setPasted(event.target.value)} spellCheck={false} />
        </label>
        <button
          type="button"
          disabled={pasted.trim() === ""}
          onClick={() => add([{ name: t("pasted", lang), text: pasted }]) && setPasted("")}
        >
          {t("add", lang)}
        </button>
        {!wallet && (
          <button type="button" onClick={() => setWallet(true)}>
            {t("fromWallet", lang)}
          </button>
        )}
      </div>
      {wallet && (
        <WalletRequest
          lang={lang}
          onData={(text) => add([{ name: t("wallet", lang), text }]) && setWallet(false)}
          onCancel={() => setWallet(false)}
        />
      )}
      <div className="samples">
        <span className="hint">{t("samples", lang)}</span>
        {SAMPLES.map((sample) => (
          <button
            key={sample.name}
            type="button"
            className="link-button"
            onClick={async () => {
              try {
                const response = await fetch(sample.url);
                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                add([{ name: `${sample.name}.json`, text: await response.text() }]);
              } catch (cause) {
                setError(`${t("dataError", lang)}: ${cause instanceof Error ? cause.message : String(cause)}`);
              }
            }}
          >
            {sample.label(lang)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {data.resources.length > 0 && (
        <div className="patient-data-summary">
          {all.length === 0 && <p className="error">{t("noPatient", lang)}</p>}
          {all.length > 1 && (
            <label className="field">
              <span className="question-text">{t("choosePatient", lang)}</span>
              <select value={patient?.id ?? ""} onChange={(event) => onSelectPatient(event.target.value)}>
                <option value="">{t("choose", lang)}</option>
                {all.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {describePatient(candidate, lang)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {all.length === 1 && patient && <p className="patient">{describePatient(patient, lang)}</p>}
          <p className="hint">
            {data.sources.map((source) => `${source.name} (${source.count})`).join(", ")} ·{" "}
            {[...counts].map(([type, count]) => `${count} ${type}`).join(", ")}
          </p>
          {children}
          <button type="button" className="link-button" onClick={() => onChange({ resources: [], sources: [], index: new Map() })}>
            {t("clearData", lang)}
          </button>
        </div>
      )}
    </details>
  );
}

function describePatient(patient: Patient, lang: Lang): string {
  const hetu = patient.identifier?.find((identifier) => identifier.system === HETU)?.value;
  return [patientName(patient), patient.birthDate && `${t("born", lang)} ${patient.birthDate}`, hetu]
    .filter(Boolean)
    .join(", ");
}

/** The selected patient: the chosen one, or the only one. */
export function selectedPatient(data: PatientData, chosenId: string | undefined): Patient | undefined {
  const all = patients(data);
  return all.find((patient) => patient.id === chosenId) ?? (all.length === 1 ? all[0] : undefined);
}

