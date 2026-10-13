// Population definitions (plan §7.2): item overrides turned into SDC
// extensions. Collections of the patient's records are Questionnaire-level
// variables (x-fhir-query, then the resources out of the searchset); each
// populated item gets FHIRPath variables holding its evidence, so the
// records an answer came from are exactly those that matched.

import type { Extension, QuestionnaireItem } from "fhir/r4";
import type { Evidence, ItemOverride } from "../overrides.ts";

export const SDC = {
  launchContext: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-launchContext",
  variable: "http://hl7.org/fhir/StructureDefinition/variable",
  initialExpression: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression",
  observationLinkPeriod: "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationLinkPeriod",
} as const;

export const ICD10 = "urn:oid:1.2.246.537.6.1";
export const ATC = "urn:oid:1.2.246.537.6.32";
/** Hierarchical code systems, where a code matches its more detailed codes as a prefix. */
const PREFIX_SYSTEMS = new Set([ICD10, ATC]);

/** The searches behind each collection, and the FHIRPath that takes the resources out of them. */
const COLLECTIONS: Record<Evidence["in"], { searches: Record<string, string>; resources: string }> = {
  conditions: {
    searches: { conditionSearch: "Condition?patient={{%patient.id}}&clinical-status=active" },
    resources: "%conditionSearch.entry.resource",
  },
  allergies: {
    searches: { allergySearch: "AllergyIntolerance?patient={{%patient.id}}&clinical-status=active" },
    resources: "%allergySearch.entry.resource",
  },
  medications: {
    searches: {
      medicationStatementSearch: "MedicationStatement?patient={{%patient.id}}&status=active",
      medicationRequestSearch: "MedicationRequest?patient={{%patient.id}}&status=active",
    },
    resources: "%medicationStatementSearch.entry.resource | %medicationRequestSearch.entry.resource",
  },
  immunizations: {
    searches: { immunizationSearch: "Immunization?patient={{%patient.id}}&status=completed" },
    resources: "%immunizationSearch.entry.resource",
  },
  observations: {
    searches: { observationSearch: "Observation?patient={{%patient.id}}&status=final,amended,corrected" },
    resources: "%observationSearch.entry.resource",
  },
};

/** The coded element of each kind of record. */
const CODE = "(code | medicationCodeableConcept | vaccineCode)";

const variable = (name: string, expression: string, language = "text/fhirpath"): Extension => ({
  url: SDC.variable,
  valueExpression: { name, language, expression },
});
const initialExpression = (expression: string): Extension => ({
  url: SDC.initialExpression,
  valueExpression: { language: "text/fhirpath", expression },
});
const quote = (text: string) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The FHIRPath selecting the records that are evidence. */
export function evidenceExpression(evidence: Evidence): string {
  let expression = `%${evidence.in}`;
  if (evidence.codes) {
    const clauses = Object.entries(evidence.codes).map(([system, codes]) => {
      const test = PREFIX_SYSTEMS.has(system)
        ? codes.map((code) => `code.startsWith(${quote(code)})`)
        : codes.map((code) => `code = ${quote(code)}`);
      return `(system = ${quote(system)} and (${test.join(" or ")}))`;
    });
    expression += `.where(${CODE}.coding.where(${clauses.join(" or ")}).exists())`;
  }
  if (evidence.where) expression += `.where(${evidence.where})`;
  return expression;
}

export interface PopulationContext {
  /** The collections the questionnaire's items use; they become Questionnaire-level variables. */
  collections: Set<Evidence["in"]>;
  /** Whether any item uses %patient, so the launch context is declared. */
  usesPatient: { value: boolean };
}

/** The option code of a choice item's answer, by the option's Finnish text. */
function optionCode(item: QuestionnaireItem, display: string): string {
  const matches = (item.answerOption ?? []).filter((option) => option.valueCoding?.display === display);
  if (matches.length !== 1) {
    const known = (item.answerOption ?? []).map((option) => `"${option.valueCoding?.display}"`).join(", ");
    throw new Error(`question ${item.linkId} has ${matches.length} options "${display}"; it has ${known}`);
  }
  return matches[0]!.valueCoding!.code!;
}

/** Adds the population extensions of an item override to the item. Returns a description for the notes. */
export function populateItem(item: QuestionnaireItem, override: ItemOverride, context: PopulationContext): string[] {
  const added: Extension[] = [];
  const described: string[] = [];

  if (override.code && override.observationLinkPeriod) {
    item.code = override.code;
    const { value, unit } = override.observationLinkPeriod;
    added.push({
      url: SDC.observationLinkPeriod,
      valueDuration: { value, unit, system: "http://unitsofmeasure.org", code: unit },
    });
    described.push(`from Observations ${override.code.map((code) => code.code).join("/")} within ${value} ${unit}`);
  }

  const rule = override.populate;
  if (rule) {
    const use = (evidence: Evidence) => context.collections.add(evidence.in);
    context.usesPatient.value = true;
    if ("answer" in rule) {
      if (item.type !== "choice" || item.repeats) throw new Error(`question ${item.linkId}: "answer" needs a single-choice question`);
      use(rule.when);
      added.push(variable("evidence", evidenceExpression(rule.when)));
      added.push(initialExpression(`iif(%evidence.exists(), ${quote(optionCode(item, rule.answer))})`));
      described.push(`"${rule.answer}" when there are ${rule.when.in} as evidence`);
    } else if ("list" in rule) {
      if (item.type !== "text" && item.type !== "string") throw new Error(`question ${item.linkId}: "list" needs a text question`);
      use(rule.list);
      added.push(variable("evidence", evidenceExpression(rule.list)));
      added.push(
        initialExpression(
          `iif(%evidence.exists(), %evidence.select((${CODE}.text | ${CODE}.coding.display).first()).join(', '))`,
        ),
      );
      described.push(`the names of the ${rule.list.in}`);
    } else if ("options" in rule) {
      if (item.type !== "choice" || !item.repeats) throw new Error(`question ${item.linkId}: "options" needs a repeating choice question`);
      const parts = Object.entries(rule.options).map(([display, evidence], index) => {
        use(evidence);
        added.push(variable(`evidence${index + 1}`, evidenceExpression(evidence)));
        return `iif(%evidence${index + 1}.exists(), ${quote(optionCode(item, display))})`;
      });
      added.push(initialExpression(parts.join(" | ")));
      described.push(`options ${Object.keys(rule.options).map((display) => `"${display}"`).join(", ")} by evidence`);
    } else {
      for (const name of Object.keys(COLLECTIONS) as Evidence["in"][]) {
        if (rule.expression.includes(`%${name}`)) use({ in: name });
      }
      added.push(initialExpression(rule.expression));
      described.push(`the expression ${rule.expression}`);
    }
  }

  if (added.length > 0) item.extension = [...(item.extension ?? []), ...added];
  return described;
}

/** The Questionnaire-level launch context and collection variables. */
export function questionnaireExtensions(context: PopulationContext): Extension[] {
  if (!context.usesPatient.value && context.collections.size === 0) return [];
  const extensions: Extension[] = [
    {
      url: SDC.launchContext,
      extension: [
        { url: "name", valueCoding: { system: "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", code: "patient" } },
        { url: "type", valueCode: "Patient" },
        { url: "description", valueString: "The person the questionnaire is about" },
      ],
    },
  ];
  for (const name of Object.keys(COLLECTIONS) as Evidence["in"][]) {
    if (!context.collections.has(name)) continue;
    const { searches, resources } = COLLECTIONS[name];
    for (const [search, query] of Object.entries(searches)) {
      extensions.push(variable(search, query, "application/x-fhir-query"));
    }
    extensions.push(variable(name, resources));
  }
  return extensions;
}

