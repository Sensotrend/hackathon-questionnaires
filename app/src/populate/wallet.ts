// Patient data from a digital wallet: the app asks the IPS verifier service
// (github.com/FindyFi/ips-demo, ips.digicredential.eu) for an OpenID4VP
// proof request, shows it as a QR code, and polls until the wallet has
// presented its International Patient Summary credential. The credential's
// FullData claim holds the whole IPS Bundle as JSON.
//
// The service sends no CORS headers, so by default the app reaches it through
// the Vite proxy at /ips-verifier (vite.config.ts). VITE_IPS_VERIFIER_URL
// overrides that, e.g. for a deployment that proxies it elsewhere.

export const VERIFIER_URL: string = import.meta.env.VITE_IPS_VERIFIER_URL ?? "/ips-verifier";

/** What the service returns for POST /verify. */
export interface ProofRequest {
  id: string;
  /** The openid4vp:// link for the wallet; shown as a QR code. */
  url: string;
  expiresAt?: string;
}

/** Procivis One proof request states. */
export type ProofState = "CREATED" | "PENDING" | "REQUESTED" | "ACCEPTED" | "REJECTED" | "RETRACTED" | "ERROR";

/** The parts of GET /status/:id that the app reads. */
export interface ProofStatus {
  id: string;
  state: ProofState;
  proofInputs?: { claims?: { path?: string; schema?: { key?: string }; value?: unknown }[] }[];
}

/** States after which the wallet will not send anything more. */
export const FINAL_STATES: ReadonlySet<ProofState> = new Set(["ACCEPTED", "REJECTED", "RETRACTED", "ERROR"]);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${VERIFIER_URL}${path}`, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export function requestProof(signal?: AbortSignal): Promise<ProofRequest> {
  return call("/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal });
}

export function proofStatus(id: string, signal?: AbortSignal): Promise<ProofStatus> {
  return call(`/status/${encodeURIComponent(id)}`, { signal });
}

/** The IPS Bundle, as JSON text, from an accepted proof. */
export function presentedBundle(status: ProofStatus): string {
  for (const input of status.proofInputs ?? []) {
    for (const claim of input.claims ?? []) {
      if ((claim.path ?? claim.schema?.key) === "FullData" && typeof claim.value === "string" && claim.value !== "") {
        return claim.value;
      }
    }
  }
  throw new Error("the credential holds no FHIR data (FullData)");
}
