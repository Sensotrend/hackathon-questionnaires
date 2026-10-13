// Expression-based population (SDC): an item's initialExpression is a
// FHIRPath expression over the launch context (%patient) and variables,
// which may be FHIRPath or x-fhir-query run on the loaded data. Each value
// is traced back to the resource it came from, for provenance.

import fhirpath from "fhirpath";
import r4 from "fhirpath/fhir-context/r4";
import type { Coding, Expression, FhirResource, Patient, Questionnaire, QuestionnaireItem, QuestionnaireResponse } from "fhir/r4";
import { unit as itemUnit } from "../fhir/items.ts";
import { answerKey, type Answer } from "../renderer/state.ts";
import type { Attempt } from "./observation.ts";
import { localQuery } from "./query.ts";
import { answerSource, type AnswerSource } from "./sources.ts";
import type { PatientData } from "./store.ts";
import { convert } from "./units.ts";

export const INITIAL_EXPRESSION = "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression";
export const LAUNCH_CONTEXT = "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-launchContext";
export const VARIABLE = "http://hl7.org/fhir/StructureDefinition/variable";

export type Environment = Record<string, unknown>;

/** The launch context: %patient when the Questionnaire declares it. Other contexts aren't available here. */
export function launchEnvironment(questionnaire: Questionnaire, patient: Patient): { env: Environment; missing: string[] } {
  const env: Environment = {};
  const missing: string[] = [];
  for (const extension of questionnaire.extension ?? []) {
    if (extension.url !== LAUNCH_CONTEXT) continue;
    const name = extension.extension?.find((part) => part.url === "name");
    const key = name?.valueCoding?.code ?? name?.valueId;
    if (key === "patient") env.patient = patient;
    else if (key) missing.push(key);
  }
  return { env, missing };
}

/** Evaluates FHIRPath, returning plain values. */
function evaluate(expression: string, env: Environment): unknown[] {
  const result = fhirpath.evaluate({}, expression, env, r4);
  if (!Array.isArray(result)) throw new Error("asynchronous FHIRPath is not supported");
  return result;
}

/** Fills `{{expression}}` placeholders in an x-fhir-query with FHIRPath results. */
function fillQuery(query: string, env: Environment): string {
  return query.replace(/\{\{(.+?)\}\}/g, (_match, expression: string) => {
    const [value] = evaluate(expression, env);
    if (value === undefined) throw new Error(`{{${expression}}} gave no value`);
    return encodeURIComponent(String(value));
  });
}

/** Adds the variables declared on `holder` (the Questionnaire or an item) to the environment, in order. */
export function withVariables(
  holder: { extension?: { url: string; valueExpression?: Expression }[] },
  env: Environment,
  data: PatientData,
): Environment {
  const next = { ...env };
  for (const extension of holder.extension ?? []) {
    if (extension.url !== VARIABLE || !extension.valueExpression) continue;
    const { name, language, expression } = extension.valueExpression;
    if (!name || !expression) continue;
    if (language === "application/x-fhir-query") next[name] = localQuery(fillQuery(expression, next), data);
    else if (language === "text/fhirpath") next[name] = evaluate(expression, next);
    else throw new Error(`variable %${name}: unsupported language ${language}`);
  }
  return next;
}

interface Traced {
  value: unknown;
  resource?: FhirResource;
}

/** Evaluates with internal types kept, so each value can be traced to the resource around it. */
function evaluateTraced(expression: string, env: Environment): Traced[] {
  const nodes = fhirpath.evaluate({}, expression, env, r4, { resolveInternalTypes: false });
  if (!Array.isArray(nodes)) throw new Error("asynchronous FHIRPath is not supported");
  return nodes.map((node) => {
    let resource: FhirResource | undefined;
    for (let current = node; current && typeof current === "object" && "parentResNode" in current; current = current.parentResNode) {
      const data = current.data as FhirResource | undefined;
      if (data && typeof data === "object" && "resourceType" in data && data.resourceType !== "Bundle") {
        resource = data;
        break;
      }
    }
    return { value: fhirpath.resolveInternalTypes([node])[0], resource };
  });
}

const isCoding = (value: unknown): value is Coding =>
  typeof value === "object" && value !== null && "code" in value && !("resourceType" in value);

/** One FHIRPath value as an answer to the item, or why it can't be. */
export function toAnswer(item: QuestionnaireItem, value: unknown): Answer | string {
  if (item.type === "choice" || item.type === "open-choice") {
    const codings: Coding[] = isCoding(value)
      ? [value]
      : typeof value === "object" && value !== null && "coding" in value
        ? ((value as { coding?: Coding[] }).coding ?? [])
        : [];
    const option = item.answerOption?.find((candidate) => {
      const coding = candidate.valueCoding;
      if (!coding) return candidate.valueString !== undefined && candidate.valueString === value;
      if (typeof value === "string") return coding.code === value;
      return codings.some((c) => c.code === coding.code && (c.system === undefined || c.system === coding.system));
    });
    if (option) {
      if (option.valueCoding) {
        const { system, code, display } = option.valueCoding;
        return { valueCoding: { system, code, display } };
      }
      return { valueString: option.valueString! };
    }
    if (item.type === "open-choice" && typeof value === "string") return { valueString: value };
    return `${JSON.stringify(value)} matches no answer option`;
  }
  if (item.type === "boolean" && typeof value === "boolean") return { valueBoolean: value };
  if ((item.type === "integer" || item.type === "decimal") && typeof value === "object" && value !== null && "value" in value) {
    const quantity = value as { value?: number; code?: string; unit?: string };
    const target = itemUnit(item)?.code;
    const from = quantity.code ?? quantity.unit;
    const converted =
      quantity.value === undefined ? undefined : target === undefined ? quantity.value : from ? convert(quantity.value, from, target) : undefined;
    if (converted === undefined) return `can't convert ${from ?? "a unit-less quantity"} to ${target}`;
    value = converted;
  }
  if (item.type === "integer" && typeof value === "number") {
    return Number.isInteger(value) ? { valueInteger: value } : `${value} is not a whole number`;
  }
  if (item.type === "decimal" && typeof value === "number") return { valueDecimal: value };
  if ((item.type === "string" || item.type === "text") && (typeof value === "string" || typeof value === "number")) {
    return { valueString: String(value) };
  }
  if (item.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return { valueDate: value.slice(0, 10) };
  }
  if (item.type === "dateTime" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return { valueDateTime: value };
  }
  return `${JSON.stringify(value)} doesn't fit a ${item.type} item`;
}

export function fromExpression(
  item: QuestionnaireItem,
  env: Environment,
  response: QuestionnaireResponse,
  questionnaire: Questionnaire,
): Attempt {
  const expression = item.extension?.find((extension) => extension.url === INITIAL_EXPRESSION)?.valueExpression;
  if (!expression?.expression) return undefined;
  if (expression.language && expression.language !== "text/fhirpath") {
    return { skipped: `initialExpression in ${expression.language} is not supported` };
  }

  let results: Traced[];
  try {
    results = evaluateTraced(expression.expression, { ...env, resource: response, questionnaire });
  } catch (error) {
    return { skipped: `initialExpression failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (results.length === 0) return { skipped: "initialExpression gave no value" };

  const answers: Answer[] = [];
  const sources = new Map<string, AnswerSource>();
  const problems: string[] = [];
  for (const { value, resource } of results) {
    const answer = toAnswer(item, value);
    if (typeof answer === "string") {
      problems.push(answer);
      continue;
    }
    if (!answers.some((existing) => answerKey(existing) === answerKey(answer))) answers.push(answer);
    if (resource) sources.set(`${resource.resourceType}/${resource.id}`, answerSource(resource));
  }
  if (answers.length === 0) return { skipped: problems.join("; ") };
  // A value computed from records, like yes for "any active allergies?",
  // isn't inside a resource; the records it was computed from are those in
  // the variables the expression uses.
  if (results.some((result) => result.resource === undefined)) {
    for (const resource of variableResources(expression.expression, env)) {
      if (resource.resourceType !== "Patient") sources.set(`${resource.resourceType}/${resource.id}`, answerSource(resource));
    }
  }
  if (!item.repeats && answers.length > 1) {
    return { skipped: `initialExpression gave ${answers.length} different values for a question with one answer` };
  }
  return { answers, sources: [...sources.values()] };
}

/** The resources held by the variables an expression refers to (%name), searchset Bundles opened. */
function variableResources(expression: string, env: Environment): FhirResource[] {
  const names = new Set([...expression.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]!));
  return [...names].flatMap((name) => {
    const values = ([] as unknown[]).concat(env[name] ?? []);
    return values.flatMap((value): FhirResource[] => {
      if (typeof value !== "object" || value === null || !("resourceType" in value)) return [];
      const resource = value as FhirResource;
      return resource.resourceType === "Bundle" ? (resource.entry ?? []).flatMap((entry) => (entry.resource ? [entry.resource as FhirResource] : [])) : [resource];
    });
  });
}
