// Survey → FHIR R4 Questionnaire (plan §5).

import type { CodeSystem, Coding, Extension, Questionnaire, QuestionnaireItem, QuestionnaireItemAnswerOption } from "fhir/r4";
import { answerSystem, BASE, EXT, ITEM_CONTROL_SYSTEM, USAGE_CONTEXT_TYPE_SYSTEM } from "../constants.ts";
import type { ItemOverride, Overrides } from "../overrides.ts";
import { UCUM, UNITS } from "../units.ts";
import type { SourceFile } from "../source/loader.ts";
import { allCategories, isAnswerScore, type Category, type Question, type Survey } from "../source/schema.ts";
import { answerCodeSystem } from "./codesystem.ts";
import { fixSurvey } from "./fixes.ts";
import { populateItem, questionnaireExtensions, type PopulationContext } from "./population.ts";
import { answerScore, scoreItems } from "./scoring.ts";
import { localize, PRIMARY_LANGUAGE } from "./text.ts";

export interface Conversion {
  questionnaire: Questionnaire;
  /** The code system of the answer options. */
  codeSystem: CodeSystem;
  /** Decisions and oddities worth a human look; they end up in the conversion report. */
  notes: string[];
}

export function convertSurvey(source: SourceFile, overrides: Overrides = {}): Conversion {
  const notes: string[] = [];
  const { slug } = source;
  const survey = fixSurvey(source.survey, overrides.texts ?? {}, notes);
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
    item: [],
  };
  const leftovers: Question[] = [];
  const collect = (questions: Question[]) =>
    questions.forEach((question) => {
      if (!question.scoringEnabled && question.scores.length > 0) leftovers.push(question);
      question.answers.forEach((answer) => collect(answer.question));
    });
  collect(survey.questions);
  if (leftovers.length > 0) {
    notes.push(
      `Ignored zero-point scores on ${leftovers.length} questions that aren't scored (scoringEnabled false): leftovers of the form editor.`,
    );
  }
  const population: PopulationContext = { collections: new Set(), usesPatient: { value: false } };
  questionnaire.item = convertStructure(survey, overrides, notes, population);
  const extensions = questionnaireExtensions(population);
  if (extensions.length > 0) questionnaire.extension = extensions;

  const result = withoutUndefined(questionnaire);
  return { questionnaire: result, codeSystem: answerCodeSystem(survey, result), notes };
}

/**
 * Top-level items: one group per contiguous run of a category's questions
 * (plan §5.3). A category split into several runs gives several groups with
 * the same title; the `flat` override skips groups altogether.
 */
function convertStructure(
  survey: Survey,
  overrides: Overrides,
  notes: string[],
  population: PopulationContext,
): QuestionnaireItem[] {
  const context: ItemContext = { survey, items: overrides.items ?? {}, applied: new Set(), notes, population };
  const toItem = (question: Question) => convertQuestion(question, context);
  const flat = overrides.structure === "flat";
  if (flat) notes.push("No groups (override `structure: flat`): the categories are scoring sub-scales, not sections.");
  const scores = scoreItems(survey, overrides.scores ?? {}, notes);

  if (flat) {
    const items = [...survey.questions.map(toItem), ...scores.map((score) => score.item)];
    checkItemOverrides(context);
    return items;
  }

  // A subcategory (e.g. AUDIT-C) belongs to its top-level category's section,
  // as a group of its own inside it.
  const categories = allCategories(survey.categories);
  const byId = new Map(categories.map((category) => [category.categoryId, category]));
  const topOf = new Map<string, Category>();
  const index = (top: Category, category: Category) => {
    topOf.set(category.categoryId, top);
    category.subcategories.forEach((sub) => index(top, sub));
  };
  survey.categories.forEach((category) => index(category, category));

  /** Consecutive questions of one category: the unit that becomes a group. */
  const runsOf = <T,>(entries: T[], key: (entry: T) => string) => {
    const runs: { key: string; entries: T[] }[] = [];
    for (const entry of entries) {
      const last = runs.at(-1);
      if (last?.key === key(entry)) last.entries.push(entry);
      else runs.push({ key: key(entry), entries: [entry] });
    }
    return runs;
  };

  const seen = new Map<string, number>();
  // The loader has checked that every categoryId exists.
  const group = (categoryId: string, item: QuestionnaireItem[]): QuestionnaireItem => {
    const category = byId.get(categoryId)!;
    const count = (seen.get(categoryId) ?? 0) + 1;
    seen.set(categoryId, count);
    const text = localize(category.name, `category ${categoryId}`);
    return withoutUndefined<QuestionnaireItem>({
      linkId: count === 1 ? categoryId : `${categoryId}-${count}`,
      text: text.value,
      _text: text.element,
      type: "group",
      item,
    });
  };

  const groups: QuestionnaireItem[] = runsOf(survey.questions, (question) => topOf.get(question.categoryId)!.categoryId).map(
    (run) =>
      group(
        run.key,
        runsOf(run.entries, (question) => question.categoryId).flatMap((inner) =>
          inner.key === run.key ? inner.entries.map(toItem) : [group(inner.key, inner.entries.map(toItem))],
        ),
      ),
  );

  for (const [categoryId, count] of seen) {
    if (count > 1) {
      const name = byId.get(categoryId)!.name.fi;
      notes.push(`Category "${name}" is split into ${count} runs, so it became ${count} groups with the same title.`);
    }
  }
  for (const category of categories) {
    if (!seen.has(category.categoryId)) notes.push(`Category "${category.name.fi}" has no questions and was dropped.`);
  }
  for (const category of categories) {
    const parent = categories.find((candidate) => candidate.subcategories.includes(category));
    if (parent && seen.has(category.categoryId)) {
      notes.push(`Subcategory "${category.name.fi}" is a group inside "${parent.name.fi}".`);
    }
  }

  // A category's score goes at the end of its (last) group, right after its
  // questions, also when that group is a subcategory's inside a section;
  // whole-survey scores go at the end.
  const lastGroup = (categoryId: string): QuestionnaireItem | undefined => {
    let found: QuestionnaireItem | undefined;
    const visit = (items: QuestionnaireItem[] = []) =>
      items.forEach((item) => {
        if (item.type !== "group") return;
        if (item.linkId === categoryId || item.linkId.startsWith(`${categoryId}-`)) found = item;
        visit(item.item);
      });
    visit(groups);
    return found;
  };
  const atEnd: QuestionnaireItem[] = [];
  for (const { categoryId, item } of scores) {
    const target = categoryId === undefined ? undefined : lastGroup(categoryId);
    if (target) target.item!.push(item);
    else atEnd.push(item);
  }

  checkItemOverrides(context);
  return [...groups, ...atEnd];
}

interface ItemContext {
  survey: Survey;
  /** Item overrides by linkId. */
  items: Record<string, ItemOverride>;
  /** linkIds of the item overrides applied, to catch overrides that match nothing. */
  applied: Set<string>;
  notes: string[];
  population: PopulationContext;
}

function convertQuestion(question: Question, context: ItemContext): QuestionnaireItem {
  const { survey } = context;
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
      retype(item, context);
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
        ? question.scores.filter(isAnswerScore).find((score) => score.answerId === answer.answerId)!.points
        : undefined;
      if (points === undefined) return { valueCoding } satisfies QuestionnaireItemAnswerOption;
      const score = answerScore(points);
      valueCoding.extension = [score.coding];
      return { extension: [score.option], valueCoding } satisfies QuestionnaireItemAnswerOption;
    });
  }

  applyItemOverride(item, question, context);

  // Follow-up questions live under the question they follow, shown only when
  // their answer is chosen (plan §5.5). For a repeating (multiselect) parent,
  // `=` holds when any of the chosen answers matches.
  const followUps = question.answers.flatMap((answer) =>
    answer.question.map((followUp) => {
      const child = convertQuestion(followUp, context);
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

/** Applies the item override of a free-text question, if there is one (plan §5.6). */
function retype(item: QuestionnaireItem, { items, notes }: ItemContext) {
  const override = items[item.linkId];
  if (override?.type === undefined) return;
  item.type = override.type;

  const number = (value: number): Extension =>
    override.type === "integer" ? { url: "", valueInteger: value } : { url: "", valueDecimal: value };
  const extension: Extension[] = [];
  if (override.minValue !== undefined) extension.push({ ...number(override.minValue), url: EXT.minValue });
  if (override.maxValue !== undefined) extension.push({ ...number(override.maxValue), url: EXT.maxValue });
  if (override.unit !== undefined) {
    // The display must be UCUM's own (the code); the words shown next to the
    // field go in translations, Finnish included.
    const labels = Object.entries(UNITS[override.unit]).map(([lang, label]) => ({
      url: EXT.translation,
      extension: [
        { url: "lang", valueCode: lang },
        { url: "content", valueString: label },
      ],
    }));
    extension.push({
      url: EXT.unit,
      valueCoding: { system: UCUM, code: override.unit, display: override.unit, _display: { extension: labels } },
    });
  }
  if (extension.length > 0) item.extension = extension;

  const range =
    override.minValue !== undefined || override.maxValue !== undefined
      ? `, ${override.minValue ?? ""}–${override.maxValue ?? ""}`
      : "";
  const text = item.text!.replace(/\s+/g, " ");
  notes.push(
    `Retyped "${text.length > 60 ? `${text.slice(0, 59)}…` : text}" from free text to ${override.type}${override.unit ? ` in ${override.unit}` : ""}${range}.`,
  );
}

/** Applies the population part of an item override, and checks the retyping part fit the question. */
function applyItemOverride(item: QuestionnaireItem, question: Question, context: ItemContext) {
  const override = context.items[item.linkId];
  if (override === undefined) return;
  context.applied.add(item.linkId);
  if (override.type !== undefined && question.type !== "freetext") {
    throw new Error(`question ${item.linkId} is ${question.type}, not free text, so it can't be retyped`);
  }
  for (const description of populateItem(item, override, context.population)) {
    const text = item.text!.replace(/\s+/g, " ");
    context.notes.push(`Filled in from patient data: "${text.length > 60 ? `${text.slice(0, 59)}…` : text}" ← ${description}.`);
  }
}

function checkItemOverrides({ items, applied }: ItemContext) {
  const unused = Object.keys(items).filter((linkId) => !applied.has(linkId));
  if (unused.length > 0) {
    throw new Error(`item overrides for questions that don't exist or are headings: ${unused.join(", ")}`);
  }
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
