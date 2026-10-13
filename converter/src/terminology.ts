// `npm run verify-codes`: looks up every code the overrides use at its
// source, so no code rests on memory (plan §7.3), and writes the result to
// fhir/terminology-check.md. Fails when a code isn't found, or when a
// declared display differs from the source's.
//
// Sources: LOINC at tx.fhir.org; THL's code systems (urn:oid:1.2.246.537.6.*:
// ICD-10, ATC, FinLOINC, …) at THL's code server; SNOMED CT at the Nordic
// terminology server, in the Finnish edition.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOverrides, type Evidence, type Overrides } from "./overrides.ts";
import { FHIR_DIR } from "./paths.ts";
import { loadSources } from "./source/loader.ts";

export interface CodeUse {
  system: string;
  code: string;
  /** The display the override declares, which must match the source. */
  display?: string;
  /** Where it is used, e.g. `esitietolomake-aitiysneuvola: 68be95fd… code`. */
  usedIn: string;
}

/** Every code an override uses. */
export function codeUses(slug: string, overrides: Overrides): CodeUse[] {
  const uses: CodeUse[] = [];
  for (const coding of overrides.code ?? []) {
    uses.push({ ...coding, usedIn: `${slug}: Questionnaire.code` });
  }
  const evidenceCodes = (evidence: Evidence, where: string) => {
    for (const [system, codes] of Object.entries(evidence.codes ?? {})) {
      for (const code of codes) uses.push({ system, code, usedIn: where });
    }
  };
  for (const [linkId, item] of Object.entries(overrides.items ?? {})) {
    const where = `${slug}: ${linkId.slice(0, 8)}`;
    for (const coding of item.code ?? []) uses.push({ ...coding, usedIn: `${where} code` });
    const rule = item.populate;
    if (!rule) continue;
    if ("when" in rule) evidenceCodes(rule.when, `${where} "${rule.answer}"`);
    if ("list" in rule) evidenceCodes(rule.list, `${where} list`);
    if ("options" in rule) {
      for (const [option, evidence] of Object.entries(rule.options)) evidenceCodes(evidence, `${where} "${option}"`);
    }
  }
  return uses;
}

export interface Lookup {
  found: boolean;
  /** The source's name for the code (Finnish where the source has it). */
  display?: string;
  source: string;
  error?: string;
}

const THL = "https://koodistopalvelu.kanta.fi/codeserver/csapi/v8/classifications";
const TX = "https://tx.fhir.org/r4";
const NORDICS = "https://tx-nordics.fhir.org/fhir/r4";
const SNOMED_FI = "http://snomed.info/sct/11000229106";

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { headers: { Accept: "application/fhir+json, application/json" } });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

function fhirDisplay(body: unknown): string | undefined {
  const parameters = (body as { parameter?: { name: string; valueString?: string }[] }).parameter ?? [];
  return parameters.find((parameter) => parameter.name === "display")?.valueString;
}

export async function lookup(system: string, code: string): Promise<Lookup> {
  try {
    if (system.startsWith("urn:oid:1.2.246.537.6.")) {
      const classification = system.slice("urn:oid:".length);
      const { status, body } = await getJson(`${THL}/${classification}/conceptcodes/${encodeURIComponent(code)}`);
      const source = "THL code server";
      if (status !== 200) return { found: false, source, error: `HTTP ${status}` };
      const attributes = (body as { attributes?: { attributeName: string; attributeValue?: string[] }[] }).attributes ?? [];
      const attribute = (name: string) => attributes.find((a) => a.attributeName === name)?.attributeValue?.[0];
      return { found: true, display: attribute("LongName") ?? attribute("ShortName"), source };
    }
    if (system === "http://loinc.org") {
      const url = `${TX}/CodeSystem/$lookup?system=${encodeURIComponent(system)}&code=${encodeURIComponent(code)}`;
      const { status, body } = await getJson(url);
      return status === 200
        ? { found: true, display: fhirDisplay(body), source: "tx.fhir.org" }
        : { found: false, source: "tx.fhir.org", error: `HTTP ${status}` };
    }
    if (system === "http://snomed.info/sct") {
      const url = `${NORDICS}/CodeSystem/$lookup?system=${encodeURIComponent(system)}&version=${encodeURIComponent(SNOMED_FI)}&code=${encodeURIComponent(code)}&displayLanguage=fi`;
      const { status, body } = await getJson(url);
      return status === 200
        ? { found: true, display: fhirDisplay(body), source: "tx-nordics.fhir.org (Finnish edition)" }
        : { found: false, source: "tx-nordics.fhir.org", error: `HTTP ${status}` };
    }
    return { found: false, source: "none", error: `no source known for ${system}` };
  } catch (error) {
    return { found: false, source: "network", error: error instanceof Error ? error.message : String(error) };
  }
}

const SYSTEM_NAMES: Record<string, string> = {
  "http://loinc.org": "LOINC",
  "http://snomed.info/sct": "SNOMED CT",
  "urn:oid:1.2.246.537.6.1": "THL – ICD-10",
  "urn:oid:1.2.246.537.6.32": "Fimea – ATC",
  "urn:oid:1.2.246.537.6.96": "FinLOINC – physiological measurements",
};

export interface Checked extends CodeUse {
  result: Lookup;
  ok: boolean;
}

export function report(checked: Checked[], date: string): string {
  const failures = checked.filter((entry) => !entry.ok);
  const lines = [
    "# Terminology check",
    "",
    `Generated by \`npm run verify-codes\` on ${date}: every code in \`converter/overrides/\` looked up at its source. Don't edit by hand.`,
    "",
    `${checked.length} uses of ${new Set(checked.map((entry) => `${entry.system}|${entry.code}`)).size} codes: ${failures.length === 0 ? "all found" : `**${failures.length} problems**`}.`,
  ];
  const systems = [...new Set(checked.map((entry) => entry.system))].sort();
  for (const system of systems) {
    lines.push("", `## ${SYSTEM_NAMES[system] ?? system}`, "", `\`${system}\``, "", "| Code | Name at the source | Used in | Check |", "|---|---|---|---|");
    for (const entry of checked.filter((candidate) => candidate.system === system)) {
      const status = entry.ok
        ? "✓"
        : `**${entry.result.error ?? `display "${entry.display}" differs`}**`;
      lines.push(`| ${entry.code} | ${(entry.result.display ?? "").replace(/\|/g, "\\|")} | ${entry.usedIn.replace(/\|/g, "\\|")} | ${status} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const uses = loadSources().surveys.flatMap((source) => codeUses(source.slug, loadOverrides(source.slug)));
  const unique = [...new Map(uses.map((use) => [`${use.system}|${use.code}`, use])).values()];
  const results = new Map<string, Lookup>();
  for (let index = 0; index < unique.length; index += 4) {
    await Promise.all(
      unique.slice(index, index + 4).map(async ({ system, code }) => results.set(`${system}|${code}`, await lookup(system, code))),
    );
  }
  const checked: Checked[] = uses.map((use) => {
    const result = results.get(`${use.system}|${use.code}`)!;
    const ok = result.found && (use.display === undefined || use.display === result.display);
    return { ...use, result, ok };
  });
  writeFileSync(join(FHIR_DIR, "terminology-check.md"), report(checked, new Date().toISOString().slice(0, 10)));
  const failures = checked.filter((entry) => !entry.ok);
  console.log(`${checked.length} code uses checked; ${failures.length} problems. See fhir/terminology-check.md.`);
  for (const failure of failures) {
    console.log(`  ${failure.system}|${failure.code} (${failure.usedIn}): ${failure.result.error ?? `display "${failure.display}", source says "${failure.result.display}"`}`);
  }
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
