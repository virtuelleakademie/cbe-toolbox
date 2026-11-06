/**
 * Endpoint guidance hints — see desktop-app/spec.md, Requirement: Provider
 * Configuration Input Hygiene (non-blocking endpoint guidance).
 *
 * Pure, network-free derivation from the SANITISED base URL. Rendered
 * non-blocking in BOTH provider-config surfaces (onboarding `ConfigDialog` +
 * `SettingsPanel`): the hints never block Save and never rewrite the input.
 *
 * Two heuristics:
 * - Azure shape hint — host ends with `.openai.azure.com` AND the path does not
 *   start with `/openai/v1`. The OpenAI-compatible surface for an Azure resource
 *   lives at `https://<resource>.openai.azure.com/openai/v1`; a bare resource URL
 *   fails with an opaque 404. We propose the corrected URL but never apply it
 *   (some institutions front Azure with gateways where the heuristic is wrong).
 * - Cleartext warning — scheme is `http:` AND the host is NOT loopback. The API
 *   key would travel unencrypted. Loopback (`localhost`, `127.0.0.0/8`, `[::1]`)
 *   is exempt so local Ollama / llama.cpp endpoints stay friction-free.
 */

export interface EndpointHints {
  /** Proposed OpenAI-compatible Azure URL, when the base URL looks like a bare Azure resource. */
  azureSuggestion?: string;
  /** True when the key would travel over plain http to a non-loopback host. */
  cleartextWarning: boolean;
}

/** Loopback hosts that are exempt from the cleartext warning. */
function isLoopbackHost(hostname: string): boolean {
  // URL.hostname keeps the brackets on an IPv6 literal (e.g. `[::1]`); normalise
  // them away before comparing.
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  // 127.0.0.0/8 — any 127.x.x.x address.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Derives the non-blocking hints for a sanitised base URL. An unparseable or
 * empty URL yields no hints (the required-field validation handles emptiness).
 */
export function deriveEndpointHints(baseURL: string): EndpointHints {
  const none: EndpointHints = { cleartextWarning: false };
  if (!baseURL) return none;

  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return none;
  }

  const hints: EndpointHints = { cleartextWarning: false };

  // Azure shape: <resource>.openai.azure.com without the /openai/v1 surface path.
  if (url.hostname.endsWith(".openai.azure.com") && !url.pathname.startsWith("/openai/v1")) {
    hints.azureSuggestion = `${url.origin}/openai/v1`;
  }

  // Cleartext: plain http to a non-loopback host.
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    hints.cleartextWarning = true;
  }

  return hints;
}
