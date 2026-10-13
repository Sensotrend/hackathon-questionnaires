// The human-readable narrative of a QuestionnaireResponse: every answered
// question and its answers, as the Kanta PHR QuestionnaireResponse profile
// asks (plan §7.3). In the questionnaire's own language, like the answers.

import type { Narrative, QuestionnaireResponseItem, QuestionnaireResponseItemAnswer } from "fhir/r4";

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function answerText(answer: QuestionnaireResponseItemAnswer): string {
  if (answer.valueCoding) return answer.valueCoding.display ?? answer.valueCoding.code ?? "";
  if (answer.valueBoolean !== undefined) return answer.valueBoolean ? "true" : "false";
  if (answer.valueQuantity) return `${answer.valueQuantity.value ?? ""} ${answer.valueQuantity.unit ?? ""}`.trim();
  for (const [key, value] of Object.entries(answer)) {
    if (key.startsWith("value") && (typeof value === "string" || typeof value === "number")) return String(value);
  }
  return "";
}

function list(items: QuestionnaireResponseItem[]): string {
  if (items.length === 0) return "";
  const entries = items.map((item) => {
    const text = escape((item.text ?? item.linkId).replace(/\s+/g, " ").trim());
    const answers = (item.answer ?? []).map((answer) => escape(answerText(answer))).join("; ");
    const nested = [...(item.item ?? []), ...(item.answer ?? []).flatMap((answer) => answer.item ?? [])];
    return `<li>${answers ? `<b>${text}</b>: ${answers}` : `<b>${text}</b>`}${list(nested)}</li>`;
  });
  return `<ul>${entries.join("")}</ul>`;
}

export function responseNarrative(title: string | undefined, items: QuestionnaireResponseItem[], language: string): Narrative {
  const heading = title ? `<p><b>${escape(title)}</b></p>` : "";
  return {
    status: "generated",
    div: `<div xmlns="http://www.w3.org/1999/xhtml" lang="${escape(language)}" xml:lang="${escape(language)}">${heading}${list(items)}</div>`,
  };
}
