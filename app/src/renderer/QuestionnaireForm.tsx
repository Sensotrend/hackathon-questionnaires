import type { Questionnaire } from "fhir/r4";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { localized, type Lang } from "../fhir/text.ts";
import { t } from "../i18n.ts";
import { PatientDataPanel, selectedPatient } from "../populate/PatientDataPanel.tsx";
import { emptyPatientData, patientReference, type PatientData } from "../populate/store.ts";
import { FormContext } from "./context.ts";
import { enabledAnswers, enabledItems } from "./enable.ts";
import { focusItem } from "./ids.ts";
import { issueText } from "./IssueMessage.tsx";
import { Items } from "./Item.tsx";
import { PrintSummary } from "./PrintSummary.tsx";
import { itemLabel } from "./labels.ts";
import { buildResponse } from "./response.ts";
import { calculateScores } from "./scores.ts";
import { emptyForm, formReducer, type FormState } from "./state.ts";
import { populate, type PopulateResult } from "../populate/populate.ts";
import { validate } from "./validation.ts";

export interface QuestionnaireFormProps {
  questionnaire: Questionnaire;
  lang: Lang;
  /** Patient data to fill the form in from; the panel is shown when the handlers are given. */
  patientData?: PatientData;
  onPatientDataChange?: (data: PatientData) => void;
  patientId?: string;
  onSelectPatient?: (id: string) => void;
}

export function QuestionnaireForm(props: QuestionnaireFormProps) {
  const { questionnaire, lang, patientData = emptyPatientData, onPatientDataChange, patientId, onSelectPatient } = props;
  const patient = selectedPatient(patientData, patientId);
  const [state, dispatch] = useReducer(formReducer, emptyForm);
  /** Set when the person first presses Done: issues are shown from then on. */
  const [submitted, setSubmitted] = useState(false);
  /** When the response was last completed. */
  const [authored, setAuthored] = useState<string>();
  const [confirmingReset, setConfirmingReset] = useState(false);
  /** The outcome of the last fill from patient data, and the state before it, for undo. */
  const [fill, setFill] = useState<{ result: PopulateResult; before: FormState }>();
  /** Identifies this response: one per opened form (a reset starts a new one). */
  const [responseId, setResponseId] = useState(() => crypto.randomUUID());
  const summaryRef = useRef<HTMLDivElement>(null);
  /** Counts presses of Done that found issues; each moves focus to the summary once it has rendered. */
  const [failedDone, setFailedDone] = useState(0);
  useEffect(() => {
    if (failedDone > 0) summaryRef.current?.focus();
  }, [failedDone]);

  const enabled = useMemo(() => enabledItems(questionnaire, state.answers), [questionnaire, state.answers]);
  const answers = useMemo(() => enabledAnswers(state.answers, enabled), [state.answers, enabled]);
  const scores = useMemo(
    () => calculateScores(questionnaire, buildResponse(questionnaire, answers, enabled, { status: "in-progress" })),
    [questionnaire, answers, enabled],
  );
  const issues = useMemo(() => validate(questionnaire, state, enabled), [questionnaire, state, enabled]);
  const completed = authored !== undefined && issues.length === 0;
  const response = buildResponse(questionnaire, answers, enabled, {
    status: completed ? "completed" : "in-progress",
    authored: completed ? authored : undefined,
    scores,
    id: responseId,
    subject: patient ? patientReference(patient) : undefined,
    provenance: state.provenance,
  });

  const fillIn = () => {
    if (!patient) return;
    const result = populate(questionnaire, patientData, patient, state);
    const provenance = Object.fromEntries(
      result.filled.map(({ linkId, method, sources }) => [linkId, { method, sources }]),
    );
    setFill({ result, before: state });
    dispatch({ type: "populated", state: result.state, provenance });
  };
  const shownIssues = new Map(submitted ? issues.map((issue) => [issue.linkId, issue]) : []);

  const title = localized(questionnaire.title ?? questionnaire.name, questionnaire._title, lang);
  const description = localized(questionnaire.description, questionnaire._description, lang);
  const json = JSON.stringify(response, null, 2);

  const done = () => {
    setSubmitted(true);
    if (issues.length > 0) {
      setAuthored(undefined);
      setFailedDone((count) => count + 1);
    } else {
      setAuthored(new Date().toISOString());
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: "application/fhir+json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `QuestionnaireResponse-${questionnaire.id ?? "questionnaire"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <FormContext value={{ lang, state, dispatch, enabled, issues: shownIssues, scores }}>
      <article className="questionnaire" lang={lang}>
        <header>
          <h1 className="text">{title}</h1>
          {description && <p className="description text">{description}</p>}
        </header>
        {onPatientDataChange && onSelectPatient && (
          <PatientDataPanel
            lang={lang}
            data={patientData}
            onChange={onPatientDataChange}
            patient={patient}
            onSelectPatient={onSelectPatient}
          >
            <div className="fill">
              <button type="button" className="primary" disabled={!patient} onClick={fillIn}>
                {t("fill", lang)}
              </button>
              {!patient && patientData.resources.length > 0 && <span className="hint">{t("choosePatientFirst", lang)}</span>}
              {fill && (
                <div className="fill-result" role="status">
                  <p>
                    {fill.result.filled.length > 0
                      ? t("filledCount", lang).replace("{count}", String(fill.result.filled.length))
                      : t("filledNone", lang)}{" "}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        dispatch({ type: "restore", state: fill.before });
                        setFill(undefined);
                      }}
                    >
                      {t("undoFill", lang)}
                    </button>
                  </p>
                  {fill.result.filled.length > 0 && (
                    <details>
                      <summary>{t("filledList", lang)}</summary>
                      <ul>
                        {fill.result.filled.map(({ linkId }) => (
                          <li key={linkId}>{itemLabel(questionnaire, linkId, lang)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {fill.result.skipped.length + fill.result.warnings.length > 0 && (
                    <details>
                      <summary>{t("skippedCount", lang).replace("{count}", String(fill.result.skipped.length))}</summary>
                      <ul>
                        {fill.result.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                        {fill.result.skipped.map(({ linkId, reason }) => (
                          <li key={linkId}>
                            {itemLabel(questionnaire, linkId, lang)}: <span className="hint">{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </PatientDataPanel>
        )}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            done();
          }}
        >
          <Items items={questionnaire.item} depth={0} />

          {submitted && issues.length > 0 && (
            <div className="issue-summary" role="alert" tabIndex={-1} ref={summaryRef}>
              <p>
                {issues.length === 1
                  ? t("issueSummaryOne", lang)
                  : t("issueSummary", lang).replace("{count}", String(issues.length))}
              </p>
              <ul>
                {issues.map((issue) => (
                  <li key={issue.linkId}>
                    <button type="button" className="link-button" onClick={() => focusItem(issue.linkId)}>
                      {itemLabel(questionnaire, issue.linkId, lang)}
                    </button>
                    : {issueText(issue, lang)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {completed && (
            <p className="completed" role="status">
              {t("completed", lang)}
            </p>
          )}

          <div className="form-actions">
            <button type="submit" className="primary">
              {t("done", lang)}
            </button>
            <button type="button" onClick={() => window.print()}>
              {t("print", lang)}
            </button>
            {confirmingReset ? (
              <span className="confirm" role="group" aria-label={t("confirmReset", lang)}>
                {t("confirmReset", lang)}{" "}
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: "reset" });
                    setSubmitted(false);
                    setAuthored(undefined);
                    setConfirmingReset(false);
                    setResponseId(crypto.randomUUID());
                    setFill(undefined);
                  }}
                >
                  {t("reset", lang)}
                </button>{" "}
                <button type="button" onClick={() => setConfirmingReset(false)}>
                  {t("cancel", lang)}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmingReset(true)}>
                {t("reset", lang)}
              </button>
            )}
          </div>
        </form>

        <PrintSummary
          questionnaire={questionnaire}
          response={response}
          lang={lang}
          provenance={state.provenance}
          patient={patient}
        />
        <details className="response" open={completed || undefined}>
          <summary>
            {t("response", lang)} · {t("status", lang)}: {t(`status_${response.status as "in-progress" | "completed"}`, lang)}
          </summary>
          <button type="button" onClick={download}>
            {t("download", lang)}
          </button>
          <pre tabIndex={0} role="region" aria-label={t("response", lang)}>
            {json}
          </pre>
        </details>
      </article>
    </FormContext>
  );
}
