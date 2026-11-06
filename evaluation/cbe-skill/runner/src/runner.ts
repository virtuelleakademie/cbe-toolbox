/**
 * Runner: executes a probe by creating a fresh session via the injected factory,
 * replaying the probe's `turns[]` in order, and capturing the per-turn transcript
 * (assistant text + tool invocations). Each probe gets its own session, so no
 * state leaks between sub-probes.
 */

import type { EvalSessionFactory } from "./session-eval.js";
import type { Probe, Transcript, TurnTranscript } from "./types.js";

export async function runProbe(probe: Probe, factory: EvalSessionFactory, model: string): Promise<Transcript> {
  const session = await factory({
    profile: probe.setup.profile,
    affordances: probe.setup.affordances,
    lecturerProfile: probe.setup.lecturerProfile,
    lecturerIdentity: probe.setup.lecturerIdentity,
    lecturerSupport: probe.setup.lecturerSupport,
    wikiFixture: probe.setup.wikiFixture,
    courseContext: probe.setup.courseContext,
    canvasArtefacts: probe.setup.canvasArtefacts,
    stepCoverage: probe.setup.stepCoverage,
    maturity: probe.setup.maturity,
    lecturerState: probe.setup.lecturerState,
    decisionsSummary: probe.setup.decisionsSummary,
  });
  try {
    const turns: TurnTranscript[] = [];
    for (const userText of probe.turns) {
      const r = await session.sendTurn(userText);
      turns.push({ user: userText, assistant: r.assistant, tools: r.tools, ...(r.events ? { events: r.events } : {}) });
    }
    return { probe: probe.probe, model, turns };
  } finally {
    await session.close();
  }
}

/** Concatenated assistant text across all turns (used by judge / contains checks). */
export function fullAssistantText(t: Transcript): string {
  return t.turns.map((x) => x.assistant).join("\n");
}

/** Every tool name invoked across all turns. */
export function allToolNames(t: Transcript): string[] {
  return t.turns.flatMap((x) => x.tools.map((tool) => tool.name));
}

/**
 * Turn-structured rendering for the judge: user prompt, tool-call names, and
 * assistant reply per turn. Assistant-text-only rendering left the judge blind
 * to rubrics that reference the lecturer's input ("after the push-back ...")
 * or tool-mediated behaviour ("obtained by calling cbe_cite") — checkpoint 14.4
 * went partial on a run whose transcript contained eight cbe_cite calls.
 */
export function judgeTranscriptText(t: Transcript): string {
  return t.turns
    .map((turn, i) => {
      const n = i + 1;
      const tools = turn.tools.length ? turn.tools.map((x) => x.name).join(", ") : "(none)";
      return [
        `[turn ${n} | user]`,
        turn.user,
        `[turn ${n} | tool calls] ${tools}`,
        `[turn ${n} | assistant]`,
        turn.assistant,
      ].join("\n");
    })
    .join("\n\n");
}
