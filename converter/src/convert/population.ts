// Population definitions (plan §7.2): item overrides turned into SDC
// extensions. Collections of the patient's records are Questionnaire-level
// variables (x-fhir-query, then the resources out of the searchset); each
// populated item gets FHIRPath variables holding its evidence, so the
// records an answer came from are exactly those that matched.

import type { Extension, QuestionnaireItem } from "fhir/r4";
import { evidenceList, type AnyEvidence, type Evidence, type ItemOverride } from "../overrides.ts";

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
/**
 * Other URIs data uses for the same codes: FinnishCore's own examples code
 * ATC as the THL OID (Immunization) and as WHO's URI (MedicationStatement);
 * international data codes ICD-10 categories with HL7's URI.
 */
const ALIASES: Record<string, string[]> = {
  [ATC]: ["http://www.whocc.no/atc"],
  [ICD10]: ["http://hl7.org/fhir/sid/icd-10"],
};
export const PERMANENCE = "https://hl7.fi/fhir/finnish-base-profiles/StructureDefinition/condition-permanence";
export const PERMANENCE_SYSTEM = "urn:oid:1.2.246.537.5.40003";

/** The searches behind each collection, and the FHIRPath that takes the resources out of them. */
const COLLECTIONS: Record<Evidence["in"], { searches: Record<string, string>; resources: string }> = {
  conditions: {
    searches: { conditionSearch: "Condition?patient={{%patient.id}}&clinical-status=active" },
    resources: "%conditionSearch.entry.resource",
  },
  conditionHistory: {
    searches: { conditionHistorySearch: "Condition?patient={{%patient.id}}" },
    resources:
      "%conditionHistorySearch.entry.resource.where(verificationStatus.coding.where(code = 'refuted' or code = 'entered-in-error').empty())",
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

/** The FHIRPath selecting the records that are evidence, of one kind or of several. */
export function anyEvidenceExpression(evidence: AnyEvidence): string {
  const parts = evidenceList(evidence).map(evidenceExpression);
  return parts.length === 1 ? parts[0]! : parts.map((part) => `(${part})`).join(" | ");
}

/** The FHIRPath selecting the records that are evidence of one kind. */
export function evidenceExpression(evidence: Evidence): string {
  let expression = `%${evidence.in}`;
  if (evidence.codes) {
    const clauses = Object.entries(evidence.codes).map(([system, codes]) => {
      const test = PREFIX_SYSTEMS.has(system)
        ? codes.map((code) => `code.startsWith(${quote(code)})`)
        : codes.map((code) => `code = ${quote(code)}`);
      const systems = [system, ...(ALIASES[system] ?? [])].map((uri) => `system = ${quote(uri)}`);
      return `((${systems.join(" or ")}) and (${test.join(" or ")}))`;
    });
    expression += `.where(${CODE}.coding.where(${clauses.join(" or ")}).exists())`;
  }
  if (evidence.longTerm) {
    const permanence = `extension.where(url = ${quote(PERMANENCE)})`;
    expression +=
      `.where(${permanence}.value.code = 'PYS' or ` +
      `(${permanence}.empty() and category.coding.where(code = 'problem-list-item').exists()))`;
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

/**
 * FHIRPath giving the Coding of a choice item's option, taken from the
 * Questionnaire itself: an initialExpression must give a value of the
 * item's type (SDC), which for a choice is a Coding, not the code alone.
 */
function optionCoding(item: QuestionnaireItem, display: string): string {
  return `%questionnaire.repeat(item).where(linkId = ${quote(item.linkId)}).answerOption.valueCoding.where(code = ${quote(optionCode(item, display))})`;
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
    const use = (evidence: AnyEvidence) => evidenceList(evidence).forEach((one) => context.collections.add(one.in));
    context.usesPatient.value = true;
    if ("answer" in rule) {
      if (item.type !== "choice" || item.repeats) throw new Error(`question ${item.linkId}: "answer" needs a single-choice question`);
      use(rule.when);
      added.push(variable("evidence", anyEvidenceExpression(rule.when)));
      added.push(initialExpression(`iif(%evidence.exists(), ${optionCoding(item, rule.answer)})`));
      described.push(`"${rule.answer}" when there are ${evidenceList(rule.when).map((one) => one.in).join(" or ")} as evidence`);
    } else if ("list" in rule) {
      if (item.type !== "text" && item.type !== "string") throw new Error(`question ${item.linkId}: "list" needs a text question`);
      use(rule.list);
      added.push(variable("evidence", anyEvidenceExpression(rule.list)));
      added.push(
        initialExpression(
          `iif(%evidence.exists(), %evidence.select((${CODE}.text | ${CODE}.coding.display).first()).join(', '))`,
        ),
      );
      described.push(`the names of the ${evidenceList(rule.list).map((one) => one.in).join(" and ")}`);
    } else if ("options" in rule) {
      if (item.type !== "choice" || !item.repeats) throw new Error(`question ${item.linkId}: "options" needs a repeating choice question`);
      const parts = Object.entries(rule.options).map(([display, evidence], index) => {
        use(evidence);
        added.push(variable(`evidence${index + 1}`, anyEvidenceExpression(evidence)));
        return `iif(%evidence${index + 1}.exists(), ${optionCoding(item, display)})`;
      });
      added.push(initialExpression(parts.join(" | ")));
      described.push(`options ${Object.keys(rule.options).map((display) => `"${display}"`).join(", ")} by evidence`);
    } else {
      const options = (text: string) => text.replace(/\{\{option:([^}]+)\}\}/g, (_, display: string) => optionCoding(item, display));
      const expressions = [rule.expression];
      for (const [name, value] of Object.entries(rule.variables ?? {})) {
        if (typeof value === "string") {
          expressions.push(value);
          added.push(variable(name, options(value)));
        } else {
          use(value);
          added.push(variable(name, anyEvidenceExpression(value)));
        }
      }
      for (const name of Object.keys(COLLECTIONS) as Evidence["in"][]) {
        if (expressions.some((expression) => new RegExp(`%${name}\\b`).test(expression))) use({ in: name });
      }
      added.push(initialExpression(options(rule.expression)));
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

