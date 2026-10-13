// The "from patient data" badge of a filled-in answer, with its sources.

import type { QuestionnaireItem } from "fhir/r4";
import { useState } from "react";
import { t } from "../i18n.ts";
import { useForm } from "../renderer/context.ts";

export function FromRecord({ item }: { item: QuestionnaireItem }) {
  const { state, lang } = useForm();
  const [open, setOpen] = useState(false);
  const provenance = state.provenance[item.linkId];
  if (!provenance) return null;

  const sources = provenance.sources.map((source) =>
    [source.display ?? source.resourceType, source.date?.slice(0, 10)].filter(Boolean).join(", "),
  );
  return (
    <div className="from-record">
      <span className="badge badge-record">{t("fromRecord", lang)}</span>{" "}
      <span className="hint">{sources.length > 0 ? sources.join("; ") : t("derived", lang)}</span>
      {provenance.sources.length > 0 && (
        <>
          {" "}
          <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t("showSource", lang)}
          </button>
          {open && <pre className="source-json">{JSON.stringify(provenance.sources.map((source) => source.resource), null, 2)}</pre>}
        </>
      )}
    </div>
  );
}
