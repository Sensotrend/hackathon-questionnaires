// The local CodeSystem of a survey's answer options (plan §5.4): one concept
// per answerId, Finnish display, Swedish and English (and any other
// languages) as designations. Lets validators check the codes and displays
// the Questionnaire uses.

import type { CodeSystem, CodeSystemConcept, Questionnaire } from "fhir/r4";
import { answerSystem } from "../constants.ts";
import type { Question, Survey } from "../source/schema.ts";
import { localize } from "./text.ts";

export function answerCodeSystem(survey: Survey, questionnaire: Questionnaire): CodeSystem {
  const concepts: CodeSystemConcept[] = [];
  const visit = (questions: Question[]) => {
    for (const question of questions) {
      for (const answer of question.answers) {
        const display = localize(answer.answerText, `answer ${answer.answerId}`);
        const designation = (display.element?.extension ?? []).map((translation) => ({
          language: translation.extension!.find((part) => part.url === "lang")!.valueCode!,
          value: translation.extension!.find((part) => part.url === "content")!.valueString!,
        }));
        concepts.push({
          code: answer.answerId,
          display: display.value,
          ...(designation.length > 0 && { designation }),
        });
        visit(answer.question);
      }
    }
  };
  visit(survey.questions);

  return {
    resourceType: "CodeSystem",
    id: survey.surveyGuid,
    language: questionnaire.language,
    url: answerSystem(survey.surveyGuid),
    version: survey.revisionGuid,
    name: `${questionnaire.name}AnswerOptions`,
    status: questionnaire.status,
    date: questionnaire.date,
    description: `Answer options of the Questionnaire ${questionnaire.url}: one code per answer option, as identified in the source export.`,
    caseSensitive: true,
    content: "complete",
    count: concepts.length,
    concept: concepts,
  };
}
