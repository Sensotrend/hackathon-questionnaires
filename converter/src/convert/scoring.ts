// Scores (plan §5.5): points on the answer options, and one read-only,
// calculated item per score calculation.

import type { Extension, QuestionnaireItem } from "fhir/r4";
import { EXT } from "../constants.ts";
import type { LocalizedText, Question, ScoreCalculation, Survey } from "../source/schema.ts";
import { localize } from "./text.ts";

export const TOTAL_SCORE_LINK_ID = "score-total";
export const scoreLinkId = (calculation: ScoreCalculation) =>
  calculation.categoryId === undefined ? TOTAL_SCORE_LINK_ID : `score-${calculation.categoryId}`;

/**
 * The score of an answer option, in both places tools look for it: R4's
 * `ordinalValue` on the Coding, and SDC's `itemWeight` on the answerOption
 * (which is where fhirpath.js's `weight()` reads it).
 */
export function answerScore(points: number): { coding: Extension; option: Extension } {
  return {
    coding: { url: EXT.ordinalValue, valueDecimal: points },
    option: { url: EXT.itemWeight, valueDecimal: points },
  };
}

/** Scored questions, including follow-ups, in document order. */
function scoredQuestions(questions: Question[]): Question[] {
  return questions.flatMap((question) => [
    ...(question.scoringEnabled ? [question] : []),
    ...question.answers.flatMap((answer) => scoredQuestions(answer.question)),
  ]);
}

/**
 * The FHIRPath that sums the weights of the answers to `linkIds` in the
 * QuestionnaireResponse being filled in. Evaluating `weight()` needs
 * `%questionnaire`. An unanswered question adds nothing, so a partly filled
 * form gives a partial sum; with nothing answered the result is empty, not 0.
 */
export function sumExpression(linkIds: string[]): string {
  const list = linkIds.map((linkId) => `'${linkId}'`).join(" | ");
  return `%resource.repeat(item | answer.item).where(linkId in (${list})).answer.value.weight().sum()`;
}

export interface ScoreTitleFix {
  title: LocalizedText;
}

export interface ScoreItem {
  /** The category whose (last) group the item goes in; undefined for whole-survey scores. */
  categoryId: string | undefined;
  item: QuestionnaireItem;
}

export function scoreItems(survey: Survey, titleFixes: Record<string, ScoreTitleFix>, notes: string[]): ScoreItem[] {
  const scored = scoredQuestions(survey.questions);
  const linkIds = survey.scoreCalculations.map(scoreLinkId);
  const duplicate = linkIds.find((linkId, index) => linkIds.indexOf(linkId) !== index);
  if (duplicate !== undefined) throw new Error(`two score calculations would both be ${duplicate}`);
  const unknown = Object.keys(titleFixes).filter((linkId) => !linkIds.includes(linkId));
  if (unknown.length > 0) throw new Error(`score overrides for unknown scores: ${unknown.join(", ")}`);

  const uninterpreted: string[] = [];
  const items = survey.scoreCalculations.map((calculation) => {
    const linkId = scoreLinkId(calculation);
    const inScope = scored.filter(
      (question) => calculation.categoryId === undefined || question.categoryId === calculation.categoryId,
    );
    const fix = titleFixes[linkId];
    const title = localize(fix?.title ?? calculation.title, `score ${linkId}`);
    const name = title.value;

    if (fix !== undefined) notes.push(`Score "${name}": title corrected by override (the source has ${describe(calculation.title)}).`);
    if (inScope.length === 0) notes.push(`Score "${name}" covers no scored questions.`);
    const sumOf = (pick: (points: number[]) => number) =>
      inScope.reduce((sum, question) => sum + pick(question.scores.map((score) => score.points)), 0);
    const [min, max] = [sumOf((points) => Math.min(...points)), sumOf((points) => Math.max(...points))];
    if (min !== calculation.min || max !== calculation.max) {
      notes.push(`Score "${name}": the source range is ${calculation.min}–${calculation.max}, the questions give ${min}–${max}.`);
    }
    const fullRange = calculation.summaries.filter(
      (summary) => summary.min <= calculation.min && summary.max >= calculation.max,
    );
    if (fullRange.length > 0) uninterpreted.push(name);

    const item: QuestionnaireItem = {
      linkId,
      text: title.value,
      type: "decimal",
      readOnly: true,
      extension: [
        {
          url: EXT.calculatedExpression,
          valueExpression: { language: "text/fhirpath", expression: sumExpression(inScope.map((q) => q.questionId)) },
        },
        { url: EXT.minValue, valueDecimal: calculation.min },
        { url: EXT.maxValue, valueDecimal: calculation.max },
        ...calculation.summaries.map((summary) => interpretation(summary, linkId)),
      ],
    };
    if (title.element !== undefined) item._text = title.element;
    return { categoryId: calculation.categoryId, item };
  });

  if (uninterpreted.length > 0) {
    notes.push(
      `Score bands that cover the whole range, so they don't interpret the score: ${uninterpreted.map((name) => `"${name}"`).join(", ")}.`,
    );
  }
  return items;
}

/** A score band as the project's `score-interpretation` extension: core FHIR has none for this. */
function interpretation(summary: ScoreCalculation["summaries"][number], linkId: string): Extension {
  const title = localize(summary.title, `${linkId} band title`);
  const description = localize(summary.description, `${linkId} band description`);
  return {
    url: EXT.scoreInterpretation,
    extension: [
      { url: "min", valueDecimal: summary.min },
      { url: "max", valueDecimal: summary.max },
      { url: "title", valueString: title.value, ...(title.element && { _valueString: title.element }) },
      {
        url: "description",
        valueString: description.value,
        ...(description.element && { _valueString: description.element }),
      },
    ],
  };
}

const describe = (text: LocalizedText) =>
  Object.entries(text)
    .map(([lang, value]) => `${lang} "${value}"`)
    .join(", ");
