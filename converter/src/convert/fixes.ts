// Data-quality fixes applied to a survey before conversion: control
// characters are stripped, and the `texts` overrides correct texts that are
// wrong in the source (untranslated copies, shifted translations, filler
// languages). Every change becomes a conversion note.

import type { TextFix } from "../overrides.ts";
import type { LocalizedText, Question, Survey } from "../source/schema.ts";

interface TextSlot {
  /** What `texts` overrides are keyed by: `name`, `description`, or a category, question or answer id. */
  key: string | undefined;
  /** For notes, e.g. `question 3b936a15-…`. */
  label: string;
  text: LocalizedText;
}

/** Every localized text of the survey, in a stable order. The texts are the survey's own objects. */
function textSlots(survey: Survey): TextSlot[] {
  const slots: TextSlot[] = [
    { key: "name", label: "name", text: survey.name },
    { key: "description", label: "description", text: survey.description },
    ...survey.categories.map((category) => ({
      key: category.categoryId,
      label: `category ${category.categoryId}`,
      text: category.name,
    })),
  ];
  const visit = (questions: Question[]) => {
    for (const question of questions) {
      slots.push({ key: question.questionId, label: `question ${question.questionId}`, text: question.questionText });
      for (const answer of question.answers) {
        slots.push({ key: answer.answerId, label: `answer ${answer.answerId}`, text: answer.answerText });
        visit(answer.question);
      }
    }
  };
  visit(survey.questions);
  survey.scoreCalculations.forEach((calculation, index) => {
    slots.push({ key: undefined, label: `score calculation ${index} title`, text: calculation.title });
    calculation.summaries.forEach((summary, summaryIndex) => {
      slots.push({ key: undefined, label: `score calculation ${index} band ${summaryIndex} title`, text: summary.title });
      slots.push({
        key: undefined,
        label: `score calculation ${index} band ${summaryIndex} description`,
        text: summary.description,
      });
    });
  });
  return slots;
}

// C0 controls except tab, line feed and carriage return, and DEL.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const quote = (text: string) => JSON.stringify(text.length > 80 ? `${text.slice(0, 77)}…` : text);

/** Returns a corrected copy of the survey; the original is left untouched. */
export function fixSurvey(original: Survey, textFixes: Record<string, TextFix>, notes: string[]): Survey {
  const survey = structuredClone(original);
  const slots = textSlots(survey);

  for (const { label, text } of slots) {
    for (const [lang, value] of Object.entries(text)) {
      const cleaned = value.replace(CONTROL, "");
      if (cleaned !== value) {
        const codes = [...new Set(value.match(CONTROL))].map((char) => `U+${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
        notes.push(`Removed control character ${codes.join(", ")} from the ${lang} text of ${label}: ${quote(cleaned)}.`);
        text[lang] = cleaned;
      }
    }
  }

  for (const [key, fix] of Object.entries(textFixes)) {
    const slot = slots.find((candidate) => candidate.key === key);
    if (slot === undefined) throw new Error(`text override for ${key}, which is no name, description, category, question or answer`);
    const { $comment, remove = [], ...replacements } = fix;
    void $comment;

    for (const [lang, value] of Object.entries(replacements)) {
      if (typeof value !== "string") continue; // The schema allows only strings here.
      if (slot.text[lang] === value) throw new Error(`text override for ${slot.label} sets ${lang} to the text it already has`);
      notes.push(`Corrected the ${lang} text of ${slot.label}: ${quote(slot.text[lang] ?? "")} → ${quote(value)}.`);
      slot.text[lang] = value;
    }
    for (const lang of remove) {
      if (!(lang in slot.text)) throw new Error(`text override for ${slot.label} removes ${lang}, which it doesn't have`);
      if (["fi", "sv", "en"].includes(lang)) throw new Error(`text override for ${slot.label} can't remove ${lang}`);
      notes.push(`Removed the ${lang} text of ${slot.label}: ${quote(slot.text[lang]!)}.`);
      delete slot.text[lang];
    }
  }

  return survey;
}
