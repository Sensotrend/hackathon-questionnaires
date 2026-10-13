// Survey → FHIR R4 Questionnaire (plan §5).

import type { Coding, Extension, Questionnaire, QuestionnaireItem, QuestionnaireItemAnswerOption } from "fhir/r4";
import { answerSystem, BASE, EXT, ITEM_CONTROL_SYSTEM, USAGE_CONTEXT_TYPE_SYSTEM } from "../constants.ts";
import type { Overrides } from "../overrides.ts";
import type { SourceFile } from "../source/loader.ts";
import type { Category, Question, Survey } from "../source/schema.ts";
import { answerScore, scoreItems } from "./scoring.ts";
import { localize, PRIMARY_LANGUAGE } from "./text.ts";

export interface Conversion {
  questionnaire: Questionnaire;
  /** Decisions and oddities worth a human look; they end up in the conversion report. */
  notes: string[];
}

export function convertSurvey({ slug, survey }: SourceFile, overrides: Overrides = {}): Conversion {
  const notes: string[] = [];
  const title = localize(survey.name, "name");
  const description = localize(survey.description, "description");

  const questionnaire: Questionnaire = {
    resourceType: "Questionnaire",
    id: survey.surveyGuid,
    language: PRIMARY_LANGUAGE,
    url: `${BASE}/Questionnaire/${survey.surveyGuid}`,
    identifier: [{ system: "urn:ietf:rfc:3986", value: `urn:uuid:${survey.surveyGuid}` }],
    version: survey.revisionGuid,
    name: computableName(survey.name.en, slug),
    title: title.value,
    _title: title.element,
    status: survey.draft ? "draft" : "active",
    subjectType: ["Patient"],
    date: survey.createdDt,
    description: description.value,
    _description: description.element,
    useContext:
      survey.type === "careplan"
        ? [
            {
              code: { system: USAGE_CONTEXT_TYPE_SYSTEM, code: "task" },
              valueCodeableConcept: { text: "careplan" },
            },
          ]
        : undefined,
    code: overrides.code,
    item: convertStructure(survey, overrides, notes),
  };

  return { questionnaire: withoutUndefined(questionnaire), notes };
}

/**
 * Top-level items: one group per contiguous run of a category's questions
 * (plan §5.3). A category split into several runs gives several groups with
 * the same title; the `flat` override skips groups altogether.
 */
function convertStructure(survey: Survey, overrides: Overrides, notes: string[]): QuestionnaireItem[] {
  const toItem = (question: Question) => convertQuestion(question, survey);
  const flat = overrides.structure === "flat";
  if (flat) notes.push("No groups (override `structure: flat`): the categories are scoring sub-scales, not sections.");
  const scores = scoreItems(survey, overrides.scores ?? {}, notes);

  if (flat) {
    return [...survey.questions.map(toItem), ...scores.map((score) => score.item)];
  }

  const runs: { category: Category; questions: Question[] }[] = [];
  for (const question of survey.questions) {
    const last = runs.at(-1);
    if (last?.category.categoryId === question.categoryId) {
      last.questions.push(question);
    } else {
      // The loader has checked that every categoryId exists.
      const category = survey.categories.find((candidate) => candidate.categoryId === question.categoryId)!;
      runs.push({ category, questions: [question] });
    }
  }

  const seen = new Map<string, number>();
  const groups: QuestionnaireItem[] = runs.map(({ category, questions }) => {
    const count = (seen.get(category.categoryId) ?? 0) + 1;
    seen.set(category.categoryId, count);
    const text = localize(category.name, `category ${category.categoryId}`);
    return withoutUndefined<QuestionnaireItem>({
      linkId: count === 1 ? category.categoryId : `${category.categoryId}-${count}`,
      text: text.value,
      _text: text.element,
      type: "group",
      item: questions.map(toItem),
    });
  });

  for (const [categoryId, count] of seen) {
    if (count > 1) {
      const name = survey.categories.find((category) => category.categoryId === categoryId)!.name.fi;
      notes.push(`Category "${name}" is split into ${count} runs, so it became ${count} groups with the same title.`);
    }
  }
  for (const category of survey.categories) {
    if (!seen.has(category.categoryId)) notes.push(`Category "${category.name.fi}" has no questions and was dropped.`);
  }

  // A category's score goes at the end of its (last) group, right after its
  // questions; whole-survey scores go at the end.
  const atEnd: QuestionnaireItem[] = [];
  for (const { categoryId, item } of scores) {
    const lastRun = runs.findLastIndex((run) => run.category.categoryId === categoryId);
    if (categoryId === undefined || lastRun === -1) atEnd.push(item);
    else groups[lastRun]!.item!.push(item);
  }

  return [...groups, ...atEnd];
}

function convertQuestion(question: Question, survey: Survey): QuestionnaireItem {
  const text = localize(question.questionText, `question ${question.questionId}`);
  const item: QuestionnaireItem = {
    linkId: question.questionId,
    text: text.value,
    _text: text.element,
    type: "display",
  };

  switch (question.type) {
    case "heading":
      return withoutUndefined(item);
    case "select":
      Object.assign(item, { type: "choice", extension: [itemControl("radio-button")] });
      break;
    case "multiselect":
      Object.assign(item, { type: "choice", repeats: true, extension: [itemControl("check-box")] });
      break;
    case "freetext":
      item.type = "text";
      break;
    case "number":
      // The loader has checked that number questions have both bounds.
      item.type = "integer";
      item.extension = [
        { url: EXT.minValue, valueInteger: question.minValue! },
        { url: EXT.maxValue, valueInteger: question.maxValue! },
        itemControl("slider"),
        { url: EXT.sliderStepValue, valueInteger: 1 },
      ];
      break;
    case "date":
      item.type = "date";
      break;
  }

  item.required = !question.isOptional;
  if (question.answers.length > 0) {
    item.answerOption = question.answers.map((answer) => {
      const display = localize(answer.answerText, `answer ${answer.answerId}`);
      const valueCoding: Coding = withoutUndefined({
        system: answerSystem(survey.surveyGuid),
        code: answer.answerId,
        display: display.value,
        _display: display.element,
      });
      // The loader has checked that a scored question scores every answer.
      const points = question.scoringEnabled
        ? question.scores.find((score) => score.answerId === answer.answerId)!.points
        : undefined;
      if (points === undefined) return { valueCoding } satisfies QuestionnaireItemAnswerOption;
      const score = answerScore(points);
      valueCoding.extension = [score.coding];
      return { extension: [score.option], valueCoding } satisfies QuestionnaireItemAnswerOption;
    });
  }

  // Follow-up questions live under the question they follow, shown only when
  // their answer is chosen (plan §5.5). For a repeating (multiselect) parent,
  // `=` holds when any of the chosen answers matches.
  const followUps = question.answers.flatMap((answer) =>
    answer.question.map((followUp) => {
      const child = convertQuestion(followUp, survey);
      child.enableWhen = [
        {
          question: question.questionId,
          operator: "=",
          answerCoding: { system: answerSystem(survey.surveyGuid), code: answer.answerId },
        },
      ];
      return child;
    }),
  );
  if (followUps.length > 0) item.item = followUps;

  return withoutUndefined(item);
}

function itemControl(code: string): Extension {
  return {
    url: EXT.itemControl,
    valueCodeableConcept: { coding: [{ system: ITEM_CONTROL_SYSTEM, code }] },
  };
}

/**
 * A computable name (`[A-Z][A-Za-z0-9_]*`) from the English name, e.g.
 * "Nicotine Dependence Test (Fagerström)" → `NicotineDependenceTestFagerstrom`.
 */
export function computableName(english: string, fallback: string): string {
  const words = (english.trim() === "" ? fallback : english)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "");
  const name = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
  return /^[A-Z]/.test(name) ? name : `Q${name}`;
}

/** Drops keys whose value is undefined, so they don't show up as noise in tests and output. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
