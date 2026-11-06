/**
 * Best-effort model-capability probe.
 *
 * Queries `GET {baseURL}/models` and reports whether the configured `modelId`
 * advertises a reasoning parameter — the OpenRouter `supported_parameters` array
 * includes `"reasoning"`. This is the metadata-driven default for OpenRouter-class
 * endpoints (capability `desktop-app`, Requirement: Provider Reasoning
 * Configuration).
 *
 * Hard constraints:
 * - NEVER inspects the model NAME / id substring — only the structured
 *   `supported_parameters` array, which is a behavioural capability declaration.
 * - Non-fatal: any failure (network, timeout, non-2xx, malformed JSON, missing
 *   field) resolves to `false` ("unknown → conservative default OFF"), and MUST
 *   NOT throw — the save path stays unblocked.
 * - Result is cached per `(baseURL, modelId)` so repeated saves of the same model
 *   do not re-hit the endpoint.
 *
 * Absence of `supported_parameters` means "unknown", not "unsupported" — local
 * Ollama / llama.cpp / vLLM / LM Studio expose only the minimal OpenAI shape and
 * fall through to the conservative default + the runtime reasoning remediation.
 */

const PROBE_TIMEOUT_MS = 4_000;

/** Cache of probe results keyed by `${baseURL}\0${modelId}`. */
const cache = new Map<string, boolean>();

function cacheKey(baseURL: string, modelId: string): string {
  return `${baseURL}\0${modelId}`;
}

/** Joins a base URL and the `/models` path without doubling slashes. */
function modelsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/models`;
}

/**
 * The minimal `/models` row shape we read. Only `id` and the OpenRouter
 * `supported_parameters` extension are consulted.
 */
interface ModelsRow {
  id?: unknown;
  supported_parameters?: unknown;
}

interface ModelsResponse {
  data?: unknown;
}

/**
 * @returns `true` only when the endpoint's `/models` entry for `modelId`
 * explicitly lists `"reasoning"` in `supported_parameters`. Any other outcome
 * (unknown, failure, no such field) → `false`.
 */
export async function probeReasoningSupport(
  baseURL: string,
  modelId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const key = cacheKey(baseURL, modelId);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const result = await runProbe(baseURL, modelId, apiKey, fetchImpl);
  cache.set(key, result);
  return result;
}

async function runProbe(baseURL: string, modelId: string, apiKey: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(modelsUrl(baseURL), {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as ModelsResponse;
    const rows = Array.isArray(body?.data) ? (body.data as ModelsRow[]) : [];
    const row = rows.find((r) => r && typeof r.id === "string" && r.id === modelId);
    if (!row) return false;
    const params = row.supported_parameters;
    return Array.isArray(params) && params.includes("reasoning");
  } catch {
    // Network error, timeout/abort, or malformed JSON — all non-fatal.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: clear the per-`(baseURL, modelId)` cache between cases. */
export function __clearProbeCache(): void {
  cache.clear();
}

/**
 * Node error codes that are a DEFINITE NEGATIVE about the endpoint.
 *
 * **The principle, of which this list is only an instance: an answer was
 * received and the answer is no — as against no answer yet.** A refused
 * connection, a name that does not resolve, an unroutable host or network are
 * all the stack reporting a result, and no amount of warm-up turns any of them
 * into a working endpoint. Anything else an unreachable verdict can rest on — a
 * socket reset, a stalled read, this probe's own `PROBE_TIMEOUT_MS` abort — says
 * only that nothing has answered YET, which is not the same fact (see
 * `definiteNegative`). Classify a new code by that question alone.
 */
const DEFINITE_NEGATIVE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * Whether a rejected `fetch` proves the endpoint is not there. `fetch` wraps the
 * transport error, so the code sits on `err.cause` (and on the members of an
 * `AggregateError` when several addresses were tried) rather than on the thrown
 * error itself; the walk is bounded so a self-referencing chain cannot spin.
 *
 * An `AbortError` is deliberately NOT a definite negative however it arose, and
 * that exclusion is what the whole rule turns on: the probe's window elapsing is
 * no answer YET, not an answer of no, and a slow endpoint is a live one.
 */
function definiteNegative(err: unknown, depth = 0): boolean {
  if (depth > 4 || typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
  if (e.name === "AbortError" || e.name === "TimeoutError") return false;
  if (typeof e.code === "string" && DEFINITE_NEGATIVE_CODES.has(e.code)) return true;
  if (Array.isArray(e.errors) && e.errors.some((inner) => definiteNegative(inner, depth + 1))) return true;
  return definiteNegative(e.cause, depth + 1);
}

/**
 * Classified test-connection probe (capability `desktop-app`, Requirement:
 * Credential Presence Indicator and Connection Verifiability). Runs the same
 * `GET {baseURL}/models` request as the reasoning probe but reports the OUTCOME
 * at a debugging-useful granularity instead of a capability flag:
 *
 * - 2xx → `{ ok: true }` (endpoint reachable, key accepted)
 * - 401/403 → `unauthorized` (key rejected)
 * - other non-2xx → `http-error` with the status code
 * - network error / timeout → `unreachable`
 *
 * The four `cause` values are the whole contract of the settings surface and do
 * not change. `definiteNegative` is an ADDITIONAL fact carried beside them, for
 * the one caller that may not treat "nothing answered yet" as "nothing is there"
 * — the wiki ingest's pre-flight (capability `lecturer-wiki`, Requirement: An
 * Ingest That Cannot Reach the Model Fails Visibly and Stays Retryable). It is
 * set only where an answer was received and the answer is no (see
 * `DEFINITE_NEGATIVE_CODES`); an endpoint that is merely slower than
 * `PROBE_TIMEOUT_MS` has not answered yet, still reports `unreachable` to the
 * settings surface, and is NOT a definite negative.
 *
 * Deliberately NOT cached (a test must reflect the endpoint's state NOW), never
 * throws, and the result never carries the key.
 */
export async function probeConnection(
  baseURL: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<
  | { ok: true }
  | {
      ok: false;
      cause: "unauthorized" | "unreachable" | "http-error";
      status?: number;
      /** Present only on `unreachable`, and only when the endpoint provably is not there. */
      definiteNegative?: true;
    }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(modelsUrl(baseURL), {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return { ok: false, cause: "unauthorized", status: res.status };
    if (!res.ok) return { ok: false, cause: "http-error", status: res.status };
    return { ok: true };
  } catch (err) {
    // Network error or timeout/abort — the host never answered.
    return definiteNegative(err)
      ? { ok: false, cause: "unreachable", definiteNegative: true }
      : { ok: false, cause: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
