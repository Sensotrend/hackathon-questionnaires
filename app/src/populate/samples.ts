// The synthetic sample patients in samples/bundles/ (plan §7.6), offered in
// the patient data panel. Fetched when chosen, not bundled.

import type { Lang } from "../fhir/text.ts";

const urls = import.meta.glob("../../../samples/bundles/*.json", { query: "?url", import: "default", eager: true }) as Record<
  string,
  string
>;

const LABELS: Record<string, Record<Lang, string>> = {
  "aitiysneuvola-maija": {
    fi: "Maija, raskaana (äitiysneuvola)",
    sv: "Maija, gravid (mödrarådgivning)",
    en: "Maija, pregnant (maternity clinic)",
  },
  "kouluterveys-aino": {
    fi: "Aino, 14 v (kouluterveydenhuolto)",
    sv: "Aino, 14 år (skolhälsovård)",
    en: "Aino, 14 (school health care)",
  },
  "neuvola-eetu": {
    fi: "Eetu, 2 v (lastenneuvola)",
    sv: "Eetu, 2 år (barnrådgivning)",
    en: "Eetu, 2 (child health clinic)",
  },
  "fysioterapia-pekka-ja-seppo": {
    fi: "Pekka ja Seppo (fysioterapia)",
    sv: "Pekka och Seppo (fysioterapi)",
    en: "Pekka and Seppo (physiotherapy)",
  },
  "mikko-virtanen": {
    fi: "Mikko, 50 v (IPS-potilasyhteenveto)",
    sv: "Mikko, 50 år (IPS-patientöversikt)",
    en: "Mikko, 50 (IPS patient summary)",
  },
  "terveystarkastus-jari": {
    fi: "Jari, työtön (terveystarkastus)",
    sv: "Jari, arbetslös (hälsoundersökning)",
    en: "Jari, unemployed (health check)",
  },
};

export interface Sample {
  name: string;
  url: string;
  label: (lang: Lang) => string;
}

export const SAMPLES: Sample[] = Object.entries(urls)
  .map(([path, url]) => {
    const name = path.split("/").pop()!.replace(/\.json$/, "");
    return { name, url, label: (lang: Lang) => LABELS[name]?.[lang] ?? name };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
