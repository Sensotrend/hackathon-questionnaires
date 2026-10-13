// Pre-population (plan §7): fills the empty, enabled questions of a form
// from patient data, observation-based first, then expression-based.
// Filling an answer may enable follow-ups, so it repeats until nothing more
// can be filled. Pure: the caller decides what to do with the result.

import type { Patient, Questionnaire, QuestionnaireItem } from "fhir/r4";
import { allItems, calculatedExpression } from "../fhir/items.ts";
import { enabledAnswers, enabledItems } from "../renderer/enable.ts";
import { buildResponse } from "../renderer/response.ts";
import { formReducer, type Answer, type FormState } from "../renderer/state.ts";
import { fromExpression, launchEnvironment, withVariables, type Environment } from "./expression.ts";
import { fromObservation } from "./observation.ts";
import type { AnswerSource } from "./sources.ts";
import type { PatientData } from "./store.ts";

export interface Filled {
  linkId: string;
  answers: Answer[];
  method: "observation" | "expression";
  sources: AnswerSource[];
}

export interface PopulateResult {
  /** The form state with the filled answers added. */
  state: FormState;
  filled: Filled[];
  /** Items that could have been filled but weren't, and why. */
  skipped: { linkId: string; reason: string }[];
  /** Problems that concern the whole questionnaire, e.g. a launch context that isn't available. */
  warnings: string[];
}

export function populate(
  questionnaire: Questionnaire,
  data: PatientData,
  patient: Patient,
  initial: FormState,
  now: Date = new Date(),
): PopulateResult {
  const parents = new Map<string, QuestionnaireItem>();
  const index = (items: QuestionnaireItem[] = []) =>
    items.forEach((item) => item.item?.forEach((child) => (parents.set(child.linkId, item), index([child]))));
  index(questionnaire.item);
  const ancestors = (item: QuestionnaireItem): QuestionnaireItem[] => {
    const parent = parents.get(item.linkId);
    return parent ? [...ancestors(parent), parent] : [];
  };

  const { env: launch, missing } = launchEnvironment(questionnaire, patient);
  const warnings = missing.map((name) => `launch context %${name} is not available`);

  let state = initial;
  const filled: Filled[] = [];
  const skipped = new Map<string, string>();

  for (let round = 0; round < 20; round++) {
    const enabled = enabledItems(questionnaire, state.answers);
    const response = buildResponse(questionnaire, enabledAnswers(state.answers, enabled), enabled, { status: "in-progress" });
    let base: Environment;
    try {
      base = withVariables(questionnaire, launch, data);
    } catch (error) {
      warnings.push(`questionnaire variables: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }

    let progress = false;
    for (const item of allItems(questionnaire.item)) {
      const { linkId } = item;
      if (!enabled.has(linkId) || item.type === "group" || item.type === "display" || calculatedExpression(item)) continue;
      if ((state.answers[linkId]?.length ?? 0) > 0 || state.invalid[linkId]) continue;

      let attempt = fromObservation(item, data, patient, now);
      let method: Filled["method"] = "observation";
      if (attempt === undefined || "skipped" in attempt) {
        let env = base;
        try {
          for (const holder of [...ancestors(item), item]) env = withVariables(holder, env, data);
        } catch (error) {
          skipped.set(linkId, `variables: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const byExpression = fromExpression(item, env, response, questionnaire);
        // An expression that fills the item wins over an observation that couldn't; otherwise keep the first reason.
        if (byExpression !== undefined && ("answers" in byExpression || attempt === undefined)) {
          attempt = byExpression;
          method = "expression";
        }
      }
      if (attempt === undefined) continue;
      if ("skipped" in attempt) {
        skipped.set(linkId, attempt.skipped);
        continue;
      }

      state = formReducer(state, { type: "set", linkId, answers: attempt.answers });
      filled.push({ linkId, answers: attempt.answers, method, sources: attempt.sources });
      skipped.delete(linkId);
      progress = true;
    }
    if (!progress) break;
  }

  return { state, filled, skipped: [...skipped].map(([linkId, reason]) => ({ linkId, reason })), warnings };
}
