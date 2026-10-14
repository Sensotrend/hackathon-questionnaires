// Cross-reference checks the schema can't express: unique ids, references
// between questions, answers, scores and categories, and which fields each
// question type may use. All of them hold for the known exports; the
// converter relies on them.

import { allCategories, isAnswerScore, type Question, type Survey } from "./schema.ts";

const CHOICE_TYPES = new Set(["select", "multiselect"]);
const RANGE_FIELDS = ["minValue", "maxValue", "minValueOrUnder", "maxValueOrOver"] as const;

/** Returns one message per problem found, each prefixed with the path to the offending item. */
export function checkIntegrity(survey: Survey): string[] {
  const problems: string[] = [];
  const categoryIds = new Set(allCategories(survey.categories).map((category) => category.categoryId));
  const questionIds = new Set<string>();
  const answerIds = new Set<string>();

  const checkQuestion = (question: Question, path: string, parentCategoryId?: string) => {
    const report = (message: string) => problems.push(`${path}: ${message}`);

    if (questionIds.has(question.questionId)) report(`duplicate questionId ${question.questionId}`);
    questionIds.add(question.questionId);

    if (!categoryIds.has(question.categoryId)) report(`unknown categoryId ${question.categoryId}`);
    if (parentCategoryId !== undefined && question.categoryId !== parentCategoryId) {
      report(`follow-up question is in category ${question.categoryId}, its parent in ${parentCategoryId}`);
    }

    const isChoice = CHOICE_TYPES.has(question.type);
    if (isChoice && question.answers.length === 0) report(`${question.type} question has no answers`);
    if (!isChoice && question.answers.length > 0) report(`${question.type} question has answers`);

    const rangeFields = RANGE_FIELDS.filter((field) => question[field] !== undefined);
    if (question.type === "number") {
      if (rangeFields.length !== RANGE_FIELDS.length) report("number question lacks a range field");
      if (question.minValue !== undefined && question.maxValue !== undefined && question.minValue >= question.maxValue) {
        report(`minValue ${question.minValue} is not below maxValue ${question.maxValue}`);
      }
    } else if (rangeFields.length > 0) {
      report(`${question.type} question has ${rangeFields.join(", ")}`);
    }

    const ownAnswerIds = question.answers.map((answer) => answer.answerId);
    const scoredAnswerIds = question.scores.filter(isAnswerScore).map((score) => score.answerId);
    const rangeScores = question.scores.filter((score) => !isAnswerScore(score));
    if (rangeScores.length > 0 && question.type !== "number") report(`range scores on a ${question.type} question`);
    if (question.scoringEnabled) {
      if (question.type !== "select") report(`scoring is enabled on a ${question.type} question`);
      const missing = ownAnswerIds.filter((id) => !scoredAnswerIds.includes(id));
      if (missing.length > 0) report(`answers without a score: ${missing.join(", ")}`);
    } else if (question.scores.some((score) => score.points !== 0)) {
      // Zero-point scores on an unscored question are editor leftovers, and harmless.
      report("has non-zero scores but scoringEnabled is false");
    }
    const foreign = scoredAnswerIds.filter((id) => !ownAnswerIds.includes(id));
    if (foreign.length > 0) report(`scores refer to answers of another question: ${foreign.join(", ")}`);
    if (new Set(scoredAnswerIds).size !== scoredAnswerIds.length) report("an answer is scored twice");

    question.answers.forEach((answer, answerIndex) => {
      const answerPath = `${path}.answers[${answerIndex}]`;
      if (answerIds.has(answer.answerId)) problems.push(`${answerPath}: duplicate answerId ${answer.answerId}`);
      answerIds.add(answer.answerId);
      answer.question.forEach((followUp, index) =>
        checkQuestion(followUp, `${answerPath}.question[${index}]`, question.categoryId),
      );
    });
  };

  survey.questions.forEach((question, index) => checkQuestion(question, `questions[${index}]`));

  survey.scoreCalculations.forEach((calculation, index) => {
    if (calculation.categoryId !== undefined && !categoryIds.has(calculation.categoryId)) {
      problems.push(`scoreCalculations[${index}]: unknown categoryId ${calculation.categoryId}`);
    }
  });
  if (survey.scoringEnabled !== survey.scoreCalculations.length > 0) {
    problems.push(
      `scoringEnabled is ${survey.scoringEnabled} but there are ${survey.scoreCalculations.length} score calculations`,
    );
  }

  return problems;
}
