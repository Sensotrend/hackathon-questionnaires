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
import { evidenceList, loadOverrides, type AnyEvidence, type Overrides } from "./overrides.ts";
import { readdirSync, readFileSync } from "node:fs";
import { FHIR_DIR, SAMPLES_DIR } from "./paths.ts";
import { loadSources } from "./source/loader.ts";

export interface CodeUse {
  system: string;
  code: string;
  /** The display the override declares, which must match the source. */
  display?: string;
  /** Where it is used, e.g. `esitietolomake-aitiysneuvola: 68be95fd… code`. */
  usedIn: string;
  /** A code in data must exist as such; only codes in evidence rules are prefixes. */
  exact?: boolean;
}

/** Every code an override uses. */
export function codeUses(slug: string, overrides: Overrides): CodeUse[] {
  const uses: CodeUse[] = [];
  for (const coding of overrides.code ?? []) {
    uses.push({ ...coding, usedIn: `${slug}: Questionnaire.code` });
  }
  const evidenceCodes = (evidence: AnyEvidence, where: string) => {
    for (const one of evidenceList(evidence)) {
      if (one.longTerm) uses.push({ system: "urn:oid:1.2.246.537.5.40003", code: "PYS", display: "Pysyväisluonteinen", usedIn: `${where} (long-term)` });
      for (const [system, codes] of Object.entries(one.codes ?? {})) {
        for (const code of codes) uses.push({ system, code, usedIn: where });
      }
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

/** Prefix-matched systems, as in convert/population.ts: ICD-10 and ATC. */
const PREFIX_SYSTEMS = new Set(["urn:oid:1.2.246.537.6.1", "urn:oid:1.2.246.537.6.32"]);

function thlName(concept: unknown): string | undefined {
  const attributes = (concept as { attributes?: { attributeName: string; attributeValue?: string[] }[] }).attributes ?? [];
  const attribute = (name: string) => attributes.find((a) => a.attributeName === name)?.attributeValue?.[0];
  return attribute("LongName") ?? attribute("ShortName");
}

function fhirDisplay(body: unknown): string | undefined {
  const parameters = (body as { parameter?: { name: string; valueString?: string }[] }).parameter ?? [];
  return parameters.find((parameter) => parameter.name === "display")?.valueString;
}

export async function lookup(system: string, code: string, exact = false): Promise<Lookup> {
  try {
    if (system.startsWith("urn:oid:1.2.246.537.6.") || system.startsWith("urn:oid:1.2.246.537.5.")) {
      const classification = system.slice("urn:oid:".length);
      const source = "THL code server";
      if (code.includes("*")) {
        // The server refuses a * in the path (Finnish ICD-10 asterisk codes,
        // like H36.00*), so such a code is looked up by search.
        const search = await getJson(
          `${THL}/${classification}/conceptcodes?qfield=conceptCodeId&qvalue=${encodeURIComponent(code)}&pageSize=100`,
        );
        const concept = ((search.body as { conceptCodes?: { conceptCodeId: string }[] }).conceptCodes ?? []).find(
          (candidate) => candidate.conceptCodeId === code,
        );
        if (concept) return { found: true, display: thlName(concept), source };
        if (exact) return { found: false, source, error: `HTTP ${search.status}, and no code ${code} found by search` };
      }
      const { status, body } = await getJson(`${THL}/${classification}/conceptcodes/${encodeURIComponent(code)}`);
      if (status === 200) return { found: true, display: thlName(body), source };
      if (exact || !PREFIX_SYSTEMS.has(system)) return { found: false, source, error: `HTTP ${status}` };
      // A prefix (plan §7.3): the Finnish ICD-10 marks codes with # and *
      // (N03#, K77*, K77.0*B25.1), so a category may exist only as such codes.
      const search = await getJson(
        `${THL}/${classification}/conceptcodes?qfield=conceptCodeId&qvalue=${encodeURIComponent(code)}*&pageSize=100`,
      );
      const concepts = ((search.body as { conceptCodes?: { conceptCodeId: string }[] }).conceptCodes ?? []).filter(
        (concept) => concept.conceptCodeId.length > code.length && /^[#*.0-9A-Z]/.test(concept.conceptCodeId.slice(code.length)) && concept.conceptCodeId.startsWith(code),
      );
      if (concepts.length === 0) return { found: false, source, error: `HTTP ${status}, and no codes start with it` };
      const head =
        (concepts as { conceptCodeId: string }[]).find((concept) => ["#", "*"].includes(concept.conceptCodeId.slice(code.length))) ??
        concepts[0]!;
      return {
        found: true,
        display: `${thlName(head) ?? ""} (as ${head.conceptCodeId}; ${concepts.length} codes start with ${code})`.trim(),
        source,
      };
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
  "urn:oid:1.2.246.537.5.40003": "THL – Pysyvyys (permanence)",
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
    `Generated by \`npm run verify-codes\` on ${date}: every code in \`converter/overrides/\` and \`samples/bundles/\` looked up at its source. Don't edit by hand.`,
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

/** Systems whose codes the samples use and a source can confirm; WHO's ATC URI is checked as THL's ATC. */
const SAMPLE_SYSTEMS: Record<string, string> = {
  "http://loinc.org": "http://loinc.org",
  "urn:oid:1.2.246.537.6.1": "urn:oid:1.2.246.537.6.1",
  "urn:oid:1.2.246.537.6.32": "urn:oid:1.2.246.537.6.32",
  "http://www.whocc.no/atc": "urn:oid:1.2.246.537.6.32",
  "urn:oid:1.2.246.537.6.96": "urn:oid:1.2.246.537.6.96",
  "urn:oid:1.2.246.537.5.40003": "urn:oid:1.2.246.537.5.40003",
};

/** Every coding in a sample Bundle from a system above, with its display (which must match for THL's systems and LOINC). */
export function sampleCodeUses(name: string, json: unknown): CodeUse[] {
  const uses: CodeUse[] = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, path));
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    const system = typeof record.system === "string" ? SAMPLE_SYSTEMS[record.system] : undefined;
    if (system && typeof record.code === "string") {
      // Displays in WHO's ATC are English; THL's are Finnish, so only THL-coded ones are compared.
      const display = record.system === system && typeof record.display === "string" ? record.display : undefined;
      uses.push({ system, code: record.code, ...(display && { display }), usedIn: `sample ${name}: ${path}`, exact: true });
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "id" && typeof child === "string") path = child;
      else visit(child, path);
    }
  };
  visit(json, name);
  return uses;
}

async function main() {
  const samples = readdirSync(SAMPLES_DIR)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => sampleCodeUses(file.slice(0, -".json".length), JSON.parse(readFileSync(join(SAMPLES_DIR, file), "utf8"))));
  const uses = [
    ...loadSources().surveys.flatMap((source) => codeUses(source.slug, loadOverrides(source.slug))),
    ...samples,
  ];
  const key = (use: CodeUse) => `${use.system}|${use.code}|${use.exact ? "exact" : "prefix"}`;
  const unique = [...new Map(uses.map((use) => [key(use), use])).values()];
  const results = new Map<string, Lookup>();
  for (let index = 0; index < unique.length; index += 4) {
    await Promise.all(
      unique.slice(index, index + 4).map(async (use) => results.set(key(use), await lookup(use.system, use.code, use.exact))),
    );
  }
  const checked: Checked[] = uses.map((use) => {
    const result = results.get(key(use))!;
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
