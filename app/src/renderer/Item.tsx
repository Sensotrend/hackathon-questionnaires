// One Questionnaire item and its children. Groups become sections, display
// items paragraphs, questions labelled controls; follow-ups (children of a
// question) are rendered right after their question.

import type { QuestionnaireItem } from "fhir/r4";
import type { ReactNode } from "react";
import { calculatedExpression, isHidden } from "../fhir/items.ts";
import { localized } from "../fhir/text.ts";
import { t } from "../i18n.ts";
import { useForm } from "./context.ts";
import {
  BooleanControl,
  ChoiceControl,
  DateControl,
  NumberControl,
  ScoreOutput,
  TextControl,
} from "./controls.tsx";
import { fieldId } from "./ids.ts";
import { IssueMessage } from "./IssueMessage.tsx";

export function Items({ items, depth }: { items: QuestionnaireItem[] | undefined; depth: number }) {
  return (
    <>
      {(items ?? []).map((item) => (
        <Item key={item.linkId} item={item} depth={depth} />
      ))}
    </>
  );
}

export function Item({ item, depth }: { item: QuestionnaireItem; depth: number }) {
  const { lang, enabled } = useForm();
  if (isHidden(item) || !enabled.has(item.linkId)) return null;
  const text = localized(item.text, item._text, lang);

  if (item.type === "group") {
    const Heading = depth === 0 ? "h2" : "h3";
    return (
      <section className="group" aria-labelledby={fieldId(item)}>
        {text && (
          <Heading id={fieldId(item)} className="text">
            {text}
          </Heading>
        )}
        <IssueMessage item={item} />
        <Items items={item.item} depth={depth + 1} />
      </section>
    );
  }

  if (item.type === "display") {
    return (
      <p className="display text" id={fieldId(item)}>
        {text}
      </p>
    );
  }

  return (
    <div className={`question question-${item.type}`} data-link-id={item.linkId}>
      {control(item, text)}
      <IssueMessage item={item} />
      {item.item && item.item.length > 0 && (
        <div className="follow-ups">
          <Items items={item.item} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

function control(item: QuestionnaireItem, text: string): ReactNode {
  if (calculatedExpression(item) !== undefined) return <ScoreOutput item={item} label={text} />;
  switch (item.type) {
    case "choice":
    case "open-choice":
      return <ChoiceControl item={item} label={text} />;
    case "string":
    case "text":
    case "url":
      return <TextControl item={item} label={text} />;
    case "integer":
    case "decimal":
      return <NumberControl item={item} label={text} />;
    case "date":
    case "dateTime":
    case "time":
      return <DateControl item={item} label={text} />;
    case "boolean":
      return <BooleanControl item={item} label={text} />;
    default:
      return <Unsupported item={item} label={text} />;
  }
}

function Unsupported({ item, label }: { item: QuestionnaireItem; label: string }) {
  const { lang } = useForm();
  return (
    <p className="unsupported">
      <span className="text">{label}</span>{" "}
      <em>
        ({t("unsupported", lang)}: {item.type})
      </em>
    </p>
  );
}
