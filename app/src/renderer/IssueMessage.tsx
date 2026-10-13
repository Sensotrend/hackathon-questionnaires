import type { QuestionnaireItem } from "fhir/r4";
import type { Lang } from "../fhir/text.ts";
import { t } from "../i18n.ts";
import { useForm } from "./context.ts";
import { errorId } from "./ids.ts";
import type { Issue } from "./validation.ts";

export function issueText(issue: Issue, lang: Lang): string {
  switch (issue.kind) {
    case "required":
      return t("issueRequired", lang);
    case "invalidNumber":
      return t("issueNumber", lang);
    case "invalidInteger":
      return t("issueInteger", lang);
    case "min":
      return t("issueMin", lang).replace("{limit}", String(issue.limit));
    case "max":
      return t("issueMax", lang).replace("{limit}", String(issue.limit));
  }
}

/** The ARIA attributes tying a control to its error message, when it has one. */
export function useIssueProps(item: QuestionnaireItem, describedBy?: string) {
  const { issues } = useForm();
  const issue = issues.get(item.linkId);
  const ids = [describedBy, issue && errorId(item)].filter(Boolean).join(" ");
  return { "aria-invalid": issue ? true : undefined, "aria-describedby": ids || undefined };
}

export function IssueMessage({ item }: { item: QuestionnaireItem }) {
  const { issues, lang } = useForm();
  const issue = issues.get(item.linkId);
  if (!issue) return null;
  return (
    <p id={errorId(item)} className="field-error">
      {issueText(issue, lang)}
    </p>
  );
}
