/**
 * Pi session → CBE port adapter — ADAPTER module (capability `agent-harness`,
 * Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*).
 *
 * Wraps one Pi `AgentSession` in the CBE-owned port of its policy: the
 * atomization policy gets `CbeAgentRunPort`, the main conversation
 * `CbeSessionPort`. Each method forwards to the Pi session's own PUBLIC method
 * of the same purpose; events pass through `normalizePiEvent` exactly once.
 *
 * The returned object is a fresh plain object holding the session in a closure,
 * so a consumer cannot reach the Pi session through it — no property, no
 * prototype, no forwarding. The one way back to the Pi session is
 * `piSessionOf`, which this package does NOT export from its entry points; it
 * exists for adapter-level tests (`tests/helpers/pi-adapter-access.ts`) that
 * must prove the adapter itself, and the boundary guard keeps every product
 * module away from it.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  CbeAgentRunPort,
  CbeRuntimeListener,
  CbeRuntimeSubscription,
  CbeSessionPort,
  CbeSlashCommand,
  ProviderConfig,
} from "./contracts.js";
import { createPiEventNormalizer } from "./pi-events.js";

const piSessions = new WeakMap<CbeAgentRunPort, AgentSession>();

/**
 * One Pi subscription per port, taken when the port is created, fanned out to
 * the port's listeners. The normalizer carries the run bracket (one start, one
 * settled end per CBE run), so it must see every Pi event of the session from
 * the start — a listener added later still receives a consistent bracket.
 */
function createNormalizedFanOut(session: AgentSession): (listener: CbeRuntimeListener) => CbeRuntimeSubscription {
  const normalize = createPiEventNormalizer();
  const listeners = new Set<CbeRuntimeListener>();
  session.subscribe((event) => {
    const normalized = normalize(event);
    for (const listener of [...listeners]) listener(normalized);
  });
  return (listener) => {
    // A distinct wrapper per call, so subscribing the same function twice yields
    // two independent subscriptions — Pi's own subscribe semantics.
    const entry: CbeRuntimeListener = (event) => listener(event);
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  };
}

/** Adapt a Pi session to the run surface every session policy offers. */
export function adaptPiRun(session: AgentSession): CbeAgentRunPort {
  const subscribe = createNormalizedFanOut(session);
  const port: CbeAgentRunPort = {
    prompt: (text) => session.prompt(text),
    abort: () => session.abort(),
    dispose: () => session.dispose(),
    subscribe,
  };
  piSessions.set(port, session);
  return port;
}

/** The main-conversation operations the bridge owns beside the Pi session. */
export interface MainSessionOperations {
  updateProvider: (provider: ProviderConfig) => Promise<void>;
  getCommands: () => CbeSlashCommand[];
}

/** Adapt a Pi session to the main CBE conversation port. */
export function adaptPiSession(session: AgentSession, operations: MainSessionOperations): CbeSessionPort {
  const subscribe = createNormalizedFanOut(session);
  const port: CbeSessionPort = {
    prompt: (text) => session.prompt(text),
    // Pi 1.x reports whether the input was queued or consumed by an extension;
    // no product caller reads it, so the port keeps its `void` contract.
    steer: async (text) => {
      await session.steer(text);
    },
    abort: () => session.abort(),
    dispose: () => session.dispose(),
    subscribe,
    // Copied field by field: the port hands out a CBE value, never Pi's object.
    getContextUsage: () => {
      const usage = session.getContextUsage();
      return usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : undefined;
    },
    updateProvider: (provider) => operations.updateProvider(provider),
    getCommands: () => operations.getCommands(),
  };
  piSessions.set(port, session);
  return port;
}

/**
 * ADAPTER-TEST ONLY: the Pi session behind a port this adapter created. Not
 * exported from any package entry point; reached through
 * `tests/helpers/pi-adapter-access.ts` only.
 */
export function piSessionOf(port: CbeAgentRunPort): AgentSession {
  const session = piSessions.get(port);
  if (!session) throw new Error("piSessionOf: not a port created by the Pi adapter");
  return session;
}
