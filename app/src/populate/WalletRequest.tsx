// Asking a digital wallet for the patient's IPS credential: a QR code to scan
// (or a link to open on the same device), then polling until the wallet
// answers. See wallet.ts.

import { useEffect, useState } from "react";
import { encode } from "uqr";
import type { Lang } from "../fhir/text.ts";
import { t } from "../i18n.ts";
import { FINAL_STATES, presentedBundle, proofStatus, requestProof, type ProofRequest, type ProofState } from "./wallet.ts";

const POLL_MS = 2000;

export interface WalletRequestProps {
  lang: Lang;
  /** The presented IPS Bundle as JSON text. */
  onData: (text: string) => void;
  onCancel: () => void;
}

export function WalletRequest({ lang, onData, onCancel }: WalletRequestProps) {
  const [request, setRequest] = useState<ProofRequest>();
  const [state, setState] = useState<ProofState>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fail = (cause: unknown) => {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    };

    const poll = async (proof: ProofRequest) => {
      try {
        if (proof.expiresAt && Date.now() > Date.parse(proof.expiresAt)) throw new Error(t("walletExpired", lang));
        const status = await proofStatus(proof.id, signal);
        if (signal.aborted) return;
        setState(status.state);
        if (status.state === "ACCEPTED") onData(presentedBundle(status));
        else if (FINAL_STATES.has(status.state)) setError(t("walletDeclined", lang));
        else timer = setTimeout(() => void poll(proof), POLL_MS);
      } catch (cause) {
        fail(cause);
      }
    };

    requestProof(signal).then((proof) => {
      if (signal.aborted) return;
      setRequest(proof);
      timer = setTimeout(() => void poll(proof), POLL_MS);
    }, fail);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // A new proof request only on mount and on retry; lang and onData don't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const status = error
    ? undefined
    : !request
      ? t("walletCreating", lang)
      : state === "REQUESTED"
        ? t("walletScanned", lang)
        : state === "ACCEPTED"
          ? t("walletReceived", lang)
          : t("walletWaiting", lang);

  return (
    <div className="wallet-request">
      <p className="hint">{t("walletHelp", lang)}</p>
      {request && !error && (
        <>
          <QrCode text={request.url} label={t("walletQr", lang)} />
          <a href={request.url}>{t("walletOpenApp", lang)}</a>
        </>
      )}
      <p role="status" className="hint">
        {status}
      </p>
      {error && (
        <p role="alert" className="error">
          {t("walletError", lang)}: {error}
        </p>
      )}
      <div className="wallet-actions">
        {error && (
          <button
            type="button"
            onClick={() => {
              setRequest(undefined);
              setState(undefined);
              setError(undefined);
              setAttempt((n) => n + 1);
            }}
          >
            {t("walletRetry", lang)}
          </button>
        )}
        <button type="button" className="link-button" onClick={onCancel}>
          {t("cancel", lang)}
        </button>
      </div>
    </div>
  );
}

/** A QR code as SVG; dark modules on a light quiet zone, whatever the theme, so wallets can read it. */
function QrCode({ text, label }: { text: string; label: string }) {
  const { size, data } = encode(text, { ecc: "M", border: 2 });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg className="qr-code" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
