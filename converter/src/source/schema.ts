// Schema of the Lunna survey exports (schemaVersion 1.2.0), as observed in
// Esitieto_lomakkeet_hackathon_json/ (§2.1 of the plan).
//
// Objects are strict: an unknown key fails loading instead of being dropped.
// Fields that are always empty in the data set (printText, question
// descriptions, tags, …) must stay empty: the converter has no mapping for
// them, so a future export that uses them fails loudly rather than losing
// content.

import { z } from "zod";

const unsupported = (field: string) =>
  `${field} is always empty in the known exports and the converter has no mapping for it`;

/** Text in Finnish, Swedish and English, plus optional extra languages (e.g. `ar`, `ru`). */
export const LocalizedText = z
  .object({ fi: z.string(), sv: z.string(), en: z.string() })
  .catchall(z.string());
export type LocalizedText = z.infer<typeof LocalizedText>;

const allEmpty = (text: Record<string, string>) => Object.values(text).every((value) => value === "");

/** Localized text that must be empty in every language. */
const EmptyLocalizedText = (field: string) => LocalizedText.refine(allEmpty, { message: unsupported(field) });

/** Like EmptyLocalizedText, but languages may be missing too (one question's description is `{}`). */
const EmptyText = (field: string) =>
  z.record(z.string(), z.string()).refine(allEmpty, { message: unsupported(field) });

const EmptyArray = (field: string) => z.array(z.unknown()).max(0, unsupported(field));

export const QuestionType = z.enum(["heading", "select", "multiselect", "freetext", "number", "date"]);
export type QuestionType = z.infer<typeof QuestionType>;

export interface Answer {
  answerId: string;
  answerText: LocalizedText;
  printText: LocalizedText;
  /** Follow-up questions, shown when this answer is chosen. */
  question: Question[];
  tags: unknown[];
}

export interface Question {
  questionId: string;
  questionText: LocalizedText;
  /** Always empty in the known exports. */
  description?: Record<string, string>;
  printText: LocalizedText;
  type: QuestionType;
  categoryId: string;
  isOptional: boolean;
  scoringEnabled: boolean;
  scores: Score[];
  answers: Answer[];
  tags: unknown[];
  numericTagConditions: unknown[];
  /** Only on `number` questions. */
  minValue?: number;
  maxValue?: number;
  minValueOrUnder?: false;
  maxValueOrOver?: false;
}

export const Score = z.strictObject({
  answerId: z.guid(),
  points: z.number(),
});
export type Score = z.infer<typeof Score>;

export const Answer: z.ZodType<Answer> = z.strictObject({
  answerId: z.guid(),
  answerText: LocalizedText,
  printText: EmptyLocalizedText("printText"),
  get question() {
    return z.array(Question);
  },
  tags: EmptyArray("tags"),
});

export const Question: z.ZodType<Question> = z.strictObject({
  questionId: z.guid(),
  questionText: LocalizedText,
  description: EmptyText("description").optional(),
  printText: EmptyLocalizedText("printText"),
  type: QuestionType,
  categoryId: z.guid(),
  isOptional: z.boolean(),
  scoringEnabled: z.boolean(),
  scores: z.array(Score),
  answers: z.array(Answer),
  tags: EmptyArray("tags"),
  numericTagConditions: EmptyArray("numericTagConditions"),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  minValueOrUnder: z.literal(false, unsupported("minValueOrUnder: true")).optional(),
  maxValueOrOver: z.literal(false, unsupported("maxValueOrOver: true")).optional(),
});

export const Category = z.strictObject({
  categoryId: z.guid(),
  name: LocalizedText,
  subcategories: EmptyArray("subcategories"),
});
export type Category = z.infer<typeof Category>;

export const ScoreSummary = z.strictObject({
  min: z.number(),
  max: z.number(),
  title: LocalizedText,
  description: LocalizedText,
});
export type ScoreSummary = z.infer<typeof ScoreSummary>;

export const ScoreCalculation = z.strictObject({
  calculationFunction: z.literal("sum"),
  /** Present when the calculation covers one category only (a sub-scale). */
  categoryId: z.guid().optional(),
  min: z.number(),
  max: z.number(),
  title: LocalizedText,
  summaries: z.array(ScoreSummary),
});
export type ScoreCalculation = z.infer<typeof ScoreCalculation>;

export const Survey = z.strictObject({
  surveyGuid: z.guid(),
  revisionGuid: z.guid(),
  schemaVersion: z.literal("1.2.0"),
  type: z.enum(["form", "careplan"]),
  draft: z.boolean(),
  name: LocalizedText,
  description: LocalizedText,
  createdDt: z.iso.datetime(),
  createdBy: z.strictObject({ upn: z.string(), name: z.string(), practitionerId: z.number() }),
  tenant: z.guid(),
  meta: z.strictObject({ owners: z.array(z.unknown()) }),
  restrictions: z
    .strictObject({
      type: z.string(),
      companies: z.array(
        z.strictObject({ companyId: z.number(), companyPayerType: z.string(), internalName: z.string() }),
      ),
    })
    .optional(),
  showOnTasks: z.boolean(),
  categories: z.array(Category),
  questions: z.array(Question),
  scoringEnabled: z.boolean(),
  scoreCalculations: z.array(ScoreCalculation),
});
export type Survey = z.infer<typeof Survey>;
