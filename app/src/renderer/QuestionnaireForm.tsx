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
import { buildResponse } from "./response.ts";
import { calculateScores } from "./scores.ts";
import { emptyForm, formReducer } from "./state.ts";
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
  });
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
          />
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

        <details className="response" open={completed || undefined}>
          <summary>
            {t("response", lang)} · {t("status", lang)}: {t(`status_${response.status as "in-progress" | "completed"}`, lang)}
          </summary>
          <button type="button" onClick={download}>
            {t("download", lang)}
          </button>
          <pre>{json}</pre>
        </details>
      </article>
    </FormContext>
  );
}

/**
 * A short label for an item in the issue summary: its text on one line,
 * shortened. (Neither the first nor the last line is reliably the question:
 * some texts start with a section heading, some end with instructions.)
 */
function itemLabel(questionnaire: Questionnaire, linkId: string, lang: Lang): string {
  const find = (items = questionnaire.item ?? []): (typeof items)[number] | undefined => {
    for (const item of items) {
      if (item.linkId === linkId) return item;
      const found = find(item.item ?? []);
      if (found) return found;
    }
    return undefined;
  };
  const item = find();
  const text = localized(item?.text, item?._text, lang);
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine === "") return linkId;
  return oneLine.length > 90 ? `${oneLine.slice(0, 89)}…` : oneLine;
}
