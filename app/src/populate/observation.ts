// Observation-based population (SDC): an item with a code and an
// observationLinkPeriod takes the value of the latest final Observation
// about the patient with that code, recorded within the period.

import type { Coding, Observation, ObservationComponent, Patient, Quantity, QuestionnaireItem } from "fhir/r4";
import { unit as itemUnit } from "../fhir/items.ts";
import type { Answer } from "../renderer/state.ts";
import { answerSource, resourceDate, type AnswerSource } from "./sources.ts";
import { resourcesAbout, type PatientData } from "./store.ts";
import { convert, durationMs } from "./units.ts";

export const OBSERVATION_LINK_PERIOD =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationLinkPeriod";
const USABLE_STATUS = new Set(["final", "amended", "corrected"]);

export type Attempt =
  | { answers: Answer[]; sources: AnswerSource[] }
  | { skipped: string }
  | undefined; // the item has nothing to fill it from

const sameCoding = (a: Coding, b: Coding) => a.code === b.code && (a.system ?? "") === (b.system ?? "");

/** The value-bearing part of an Observation that has one of the codes: the Observation itself or a component. */
function matching(observation: Observation, codes: Coding[]): Observation | ObservationComponent | undefined {
  const has = (coding: Coding[] | undefined) => (coding ?? []).some((c) => codes.some((code) => sameCoding(c, code)));
  if (has(observation.code.coding)) return observation;
  return observation.component?.find((component) => has(component.code.coding));
}

/** Converts an Observation value to an answer for the item, or says why it can't. */
export function valueToAnswer(item: QuestionnaireItem, value: Observation | ObservationComponent): Answer | string {
  const quantity = (q: Quantity): Answer | string => {
    if (q.value === undefined) return "the quantity has no value";
    const target = itemUnit(item)?.code;
    const from = q.code ?? q.unit;
    const converted = target === undefined ? q.value : from === undefined ? undefined : convert(q.value, from, target);
    if (converted === undefined) return `can't convert ${from ?? "a unit-less value"} to ${target}`;
    if (item.type === "decimal") return { valueDecimal: converted };
    if (item.type === "integer") {
      return Number.isInteger(converted) ? { valueInteger: converted } : `${converted} is not a whole number`;
    }
    if (item.type === "quantity") return { valueQuantity: { ...q, value: converted } };
    return `a quantity doesn't fit a ${item.type} item`;
  };

  if (value.valueQuantity) return quantity(value.valueQuantity);
  if (value.valueInteger !== undefined) {
    if (item.type === "integer") return { valueInteger: value.valueInteger };
    if (item.type === "decimal") return { valueDecimal: value.valueInteger };
  }
  if (value.valueBoolean !== undefined && item.type === "boolean") return { valueBoolean: value.valueBoolean };
  if (value.valueString !== undefined && (item.type === "string" || item.type === "text")) {
    return { valueString: value.valueString };
  }
  if (value.valueDateTime !== undefined || value.valuePeriod?.start !== undefined) {
    const dateTime = value.valueDateTime ?? value.valuePeriod!.start!;
    if (item.type === "date") return { valueDate: dateTime.slice(0, 10) };
    if (item.type === "dateTime") return { valueDateTime: dateTime };
  }
  if (value.valueCodeableConcept && (item.type === "choice" || item.type === "open-choice")) {
    for (const coding of value.valueCodeableConcept.coding ?? []) {
      const option = item.answerOption?.find((candidate) => candidate.valueCoding && sameCoding(candidate.valueCoding, coding));
      if (option) {
        const { system, code, display } = option.valueCoding!;
        return { valueCoding: { system, code, display } };
      }
    }
    return "the coded value matches no answer option";
  }
  return `its value doesn't fit a ${item.type} item`;
}

export function fromObservation(item: QuestionnaireItem, data: PatientData, patient: Patient, now: Date): Attempt {
  const period = item.extension?.find((extension) => extension.url === OBSERVATION_LINK_PERIOD)?.valueDuration;
  const codes = item.code ?? [];
  if (!period || codes.length === 0) return undefined;

  const span = period.value === undefined ? undefined : durationMs(period.value, period.code ?? period.unit ?? "");
  if (span === undefined) return { skipped: `observationLinkPeriod ${period.value} ${period.code ?? period.unit} is not a duration` };
  const since = now.getTime() - span;

  const candidates = resourcesAbout<Observation>(data, patient, "Observation")
    .filter((observation) => USABLE_STATUS.has(observation.status))
    .map((observation) => ({ observation, part: matching(observation, codes), date: resourceDate(observation) }))
    .filter((candidate) => candidate.part !== undefined);
  if (candidates.length === 0) return { skipped: "no final Observation with the item's code" };

  const recent = candidates
    .filter((candidate) => candidate.date !== undefined && Date.parse(candidate.date) >= since)
    .sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
  if (recent.length === 0) return { skipped: `no Observation with the item's code within ${period.value} ${period.code ?? period.unit}` };

  const latest = recent[0]!;
  const answer = valueToAnswer(item, latest.part!);
  if (typeof answer === "string") return { skipped: `Observation/${latest.observation.id}: ${answer}` };
  return { answers: [answer], sources: [answerSource(latest.observation)] };
}
