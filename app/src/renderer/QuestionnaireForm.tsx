import type { Questionnaire } from "fhir/r4";
import { useReducer } from "react";
import { localized, type Lang } from "../fhir/text.ts";
import { FormContext } from "./context.ts";
import { Items } from "./Item.tsx";
import { answersReducer } from "./state.ts";

export function QuestionnaireForm({ questionnaire, lang }: { questionnaire: Questionnaire; lang: Lang }) {
  const [answers, dispatch] = useReducer(answersReducer, {});
  const title = localized(questionnaire.title ?? questionnaire.name, questionnaire._title, lang);
  const description = localized(questionnaire.description, questionnaire._description, lang);

  return (
    <FormContext value={{ lang, answers, dispatch }}>
      <article className="questionnaire" lang={lang}>
        <header>
          <h1 className="text">{title}</h1>
          {description && <p className="description text">{description}</p>}
        </header>
        <form onSubmit={(event) => event.preventDefault()} noValidate>
          <Items items={questionnaire.item} depth={0} />
        </form>
      </article>
    </FormContext>
  );
}
