// What prints (milestone 11): the answered questions and their answers in
// the chosen language, the scores, and which answers came from patient data.
// Hidden on screen; the interactive form is hidden in print instead.

import type { Patient, Questionnaire, QuestionnaireItem, QuestionnaireResponse, QuestionnaireResponseItem, QuestionnaireResponseItemAnswer } from "fhir/r4";
import { allItems, bands, unit } from "../fhir/items.ts";
import { localized, type Lang } from "../fhir/text.ts";
import { t } from "../i18n.ts";
import { HETU, patientName } from "../populate/store.ts";
import { optionAnswer, optionLabel } from "./options.ts";
import { answerKey, type Provenance } from "./state.ts";

interface Props {
  questionnaire: Questionnaire;
  response: QuestionnaireResponse;
  lang: Lang;
  provenance: Readonly<Record<string, Provenance>>;
  patient?: Patient;
}

export function PrintSummary({ questionnaire, response, lang, provenance, patient }: Props) {
  const definitions = new Map(allItems(questionnaire.item).map((item) => [item.linkId, item]));
  const title = localized(questionnaire.title ?? questionnaire.name, questionnaire._title, lang);
  const hetu = patient?.identifier?.find((identifier) => identifier.system === HETU)?.value;
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeStyle: "short" }).format(
    response.authored ? new Date(response.authored) : new Date(),
  );

  const answerText = (item: QuestionnaireItem | undefined, answer: QuestionnaireResponseItemAnswer): string => {
    const option = item?.answerOption?.find((candidate) => answerKey(optionAnswer(candidate)) === answerKey(answer));
    if (option) return optionLabel(option, lang);
    if (answer.valueBoolean !== undefined) return t(answer.valueBoolean ? "yes" : "no", lang);
    const number = answer.valueDecimal ?? answer.valueInteger;
    if (number !== undefined) {
      const coding = item ? unit(item) : undefined;
      const unitText = coding ? localized(coding.display ?? coding.code, coding._display, lang) : "";
      const band = item && answer.valueDecimal !== undefined ? bands(item).find((b) => number >= b.min && number <= b.max) : undefined;
      const bandText = band?.title ? ` (${localized(band.title.valueString, band.title._valueString, lang)})` : "";
      return `${number.toLocaleString(lang)}${unitText ? ` ${unitText}` : ""}${bandText}`;
    }
    return String(answer.valueString ?? answer.valueDate ?? answer.valueDateTime ?? answer.valueTime ?? answer.valueUri ?? "");
  };

  const renderItems = (items: QuestionnaireResponseItem[] = [], depth: number) =>
    items.map((responseItem) => {
      const item = definitions.get(responseItem.linkId);
      const text = localized(item?.text ?? responseItem.text, item?._text, lang);
      if (!responseItem.answer) {
        const Heading = depth === 0 ? "h2" : "h3";
        return (
          <section key={responseItem.linkId}>
            {text && <Heading className="text">{text}</Heading>}
            {renderItems(responseItem.item, depth + 1)}
          </section>
        );
      }
      const fromRecord = provenance[responseItem.linkId];
      return (
        <div key={responseItem.linkId} className="print-answer">
          <p className="print-question text">{text}</p>
          <p className="print-value">
            {responseItem.answer.map((answer) => answerText(item, answer)).join("; ")}
            {fromRecord && (
              <span className="print-source">
                {" "}
                ({t("fromRecord", lang).toLowerCase()}
                {fromRecord.sources.length > 0 &&
                  `: ${fromRecord.sources.map((source) => [source.display ?? source.resourceType, source.date?.slice(0, 10)].filter(Boolean).join(", ")).join("; ")}`}
                )
              </span>
            )}
          </p>
          {responseItem.answer.flatMap((answer) => renderItems(answer.item, depth + 1))}
        </div>
      );
    });

  return (
    // Hidden for everyone on screen, assistive technology included; the print
    // styles show it (author CSS overrides the browser's display: none for [hidden]).
    <section className="print-summary" hidden>
      <h1>{title}</h1>
      <p>
        {patient && (
          <>
            {patientName(patient)}
            {patient.birthDate && `, ${t("born", lang)} ${patient.birthDate}`}
            {hetu && `, ${hetu}`}
            <br />
          </>
        )}
        {date} · {t("status", lang)}: {t(`status_${response.status as "in-progress" | "completed"}`, lang)}
      </p>
      {(response.item ?? []).length > 0 ? renderItems(response.item, 0) : <p>{t("nothingAnswered", lang)}</p>}
    </section>
  );
}
