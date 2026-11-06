/**
 * Signed content-pack transport configuration (capability `distribution`).
 *
 * Pages is untrusted, credential-free transport. Authenticity comes from the
 * app-pinned Ed25519 root and strict signed metadata, never an app-embedded
 * shared delivery key. Packaged production callers do not permit environment
 * overrides; unpackaged development/tests must opt in explicitly.
 */

export const PORTAL_ORIGIN = "https://cbe-stories.pages.dev";
export const PORTAL_CORPUS_POINTER_URL = `${PORTAL_ORIGIN}/delivery/v2/corpus/stable/latest.json`;
export const PORTAL_SKILL_POINTER_URL = `${PORTAL_ORIGIN}/delivery/v2/skill/stable/latest.json`;

export interface DeliveryChannel {
  pointerUrl: string;
  requestHeaders: Record<string, never>;
}

function channelFor(
  portalPointerUrl: string,
  override: string | undefined,
  allowDevelopmentOverride: boolean
): DeliveryChannel {
  return {
    pointerUrl: allowDevelopmentOverride && override ? override : portalPointerUrl,
    requestHeaders: {},
  };
}

export function corpusUpdateChannel(
  env: NodeJS.ProcessEnv = process.env,
  allowDevelopmentOverride = false
): DeliveryChannel {
  return channelFor(PORTAL_CORPUS_POINTER_URL, env.CBE_CORPUS_UPDATE_URL || undefined, allowDevelopmentOverride);
}

export function skillUpdateChannel(
  env: NodeJS.ProcessEnv = process.env,
  allowDevelopmentOverride = false
): DeliveryChannel {
  return channelFor(PORTAL_SKILL_POINTER_URL, env.CBE_SKILL_UPDATE_URL || undefined, allowDevelopmentOverride);
}
