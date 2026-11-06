/**
 * Design-record tool cards survive a restart (change
 * `carry-the-design-cards-through-a-restart`).
 *
 * Capability `agent-harness`, Requirement: *Sessions as Local Markdown/JSON
 * Files* — Scenarios: *A run whose only output is design-record cards is
 * persisted as a completed turn*; *A turn that streamed text keeps its text and
 * gains its cards*; *A stopped run that recorded cards keeps the stop's own
 * message*; *A resumed model is seeded with exactly what it was seeded with
 * before*; *An older sidecar without cards, and one whose cards are malformed,
 * stay readable*.
 *
 * This file walks the HOST half of the restart round-trip with the production
 * code, no doubles: the recorder that watches a run's tool events, the promotion
 * that turns a finished run into a transcript turn, both sidecar writers, and the
 * read path a relaunch comes back through. The renderer half — what a re-entered
 * conversation actually shows — is `design-cards-rehydration.test.tsx`.
 *
 * The events are shaped like the ones `wireSessionEvents` forwards: a
 * `tool_execution_start` carrying the call's args, then a `tool_execution_end`
 * carrying pi's `{ content: [{ type: "text", text }], details }` result.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  writeSessionMd,
  writeSessionJson,
  readSessionJson,
  seedableTurns,
  type SessionMeta,
  type SessionTurn,
} from "../src/main/sessions.js";
import {
  ToolCardRecorder,
  isDesignRecordTool,
  CARD_RESULT_MAX_CHARS,
  type PersistedToolCard,
} from "../src/shared/design-cards.js";
import { promotedAssistantTurn } from "../src/shared/turn-stop.js";
import { en } from "../src/shared/i18n/en.js";

const meta: SessionMeta = {
  sessionId: "cards-1",
  modelId: "gemma4-31b",
  skillVersion: "0.1.3",
  environmentProfile: "app",
  createdAt: "2026-08-25T10:00:00.000Z",
  closedAt: "2026-08-25T10:42:00.000Z",
};

const CANVAS_ARGS = { step: 3, id: "challenge-frame", label: "Challenge frame", value: "**Draft** framing." };
const STEP_ARGS = { step: 3, depth: "rough", focus: true };
const MATURITY_ARGS = { criterion: "authenticity", current: 2, note: "one real partner named" };

function piResult(text: string, details: unknown) {
  return { content: [{ type: "text", text }], details };
}

/** Play a run's tool events into a fresh recorder, mirroring `wireSessionEvents`. */
function recordRun(events: Array<{ at: number; name: string; args: unknown; text: string; details: unknown }>) {
  const recorder = new ToolCardRecorder();
  for (const e of events) {
    recorder.start(`call-${e.name}-${e.at}`, e.name, e.args, e.at);
    recorder.end(`call-${e.name}-${e.at}`, piResult(e.text, e.details), false);
  }
  return recorder;
}

const THREE_CALLS = [
  { at: 0, name: "cbe_canvas", args: CANVAS_ARGS, text: "Artefact recorded on step 3.", details: { kind: "canvas" } },
  { at: 0, name: "cbe_step", args: STEP_ARGS, text: "Step 3 is now rough.", details: { kind: "step-update" } },
  { at: 0, name: "cbe_maturity", args: MATURITY_ARGS, text: "Authenticity read at L2.", details: { kind: "maturity" } },
];

async function roundTrip(
  turns: SessionTurn[]
): Promise<{ json: NonNullable<Awaited<ReturnType<typeof readSessionJson>>>; md: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "cbe-cards-"));
  try {
    const mdPath = await writeSessionMd(dir, meta, turns);
    await writeSessionJson(dir, meta, turns);
    const json = await readSessionJson(dir, meta.sessionId);
    if (!json) throw new Error("sidecar unreadable");
    return { json, md: await readFile(mdPath, "utf8") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("A run whose only output is design-record cards is persisted as a completed turn", () => {
  const cards = recordRun(THREE_CALLS).take();
  const turn = promotedAssistantTurn("", false, cards);

  it("promotes a turn although nothing was streamed — the run is not swallowed", () => {
    expect(turn).not.toBeNull();
    expect(turn!.role).toBe("assistant");
    expect(turn!.text).toBe("");
    expect(turn!.cards).toHaveLength(3);
  });

  it("carries each call: correlation id, tool name, args and terminal status", async () => {
    const { json } = await roundTrip([{ role: "user", text: "Record what we agreed." }, turn!]);
    const stored = json.turns[1]!.cards!;
    expect(stored.map((c) => c.toolName)).toEqual(["cbe_canvas", "cbe_step", "cbe_maturity"]);
    expect(stored.every((c) => c.status === "done")).toBe(true);
    expect(stored.every((c) => typeof c.toolCallId === "string" && c.toolCallId.length > 0)).toBe(true);
    expect(stored[0]!.args).toEqual(CANVAS_ARGS);
    expect(stored[1]!.args).toEqual(STEP_ARGS);
    expect(stored[2]!.args).toEqual(MATURITY_ARGS);
  });

  it("carries the result text each card's body shows", async () => {
    const { json } = await roundTrip([turn!]);
    expect(json.turns[0]!.cards!.map((c) => c.resultText)).toEqual([
      "Artefact recorded on step 3.",
      "Step 3 is now rough.",
      "Authenticity read at L2.",
    ]);
  });

  it("carries no `details` payload — a transcript can never re-drive design state", async () => {
    const { json } = await roundTrip([turn!]);
    for (const card of json.turns[0]!.cards!) {
      expect(JSON.stringify(card)).not.toContain("details");
      expect(JSON.stringify(card)).not.toContain("step-update");
    }
  });

  it("names the recorded actions in the Markdown archive instead of an empty section", async () => {
    const { md } = await roundTrip([turn!]);
    expect(md).toContain("Recorded: cbe_canvas, cbe_step, cbe_maturity");
  });
});

describe("A turn that streamed text keeps its text and gains its cards", () => {
  const TEXT = "Here is the framing.\n\nI have written it onto step 3.";
  const recorder = new ToolCardRecorder();
  recorder.start("c1", "cbe_canvas", CANVAS_ARGS, "Here is the framing.\n\n".length);
  recorder.end("c1", piResult("Artefact recorded on step 3.", { kind: "canvas" }), false);
  const turn = promotedAssistantTurn(TEXT, false, recorder.take());

  it("keeps the streamed text verbatim", async () => {
    const { json } = await roundTrip([turn!]);
    expect(json.turns[0]!.text).toBe(TEXT);
  });

  it("records the offset into that text at which the call started", async () => {
    const { json } = await roundTrip([turn!]);
    expect(json.turns[0]!.cards).toHaveLength(1);
    expect(json.turns[0]!.cards![0]!.at).toBe("Here is the framing.\n\n".length);
  });

  it("leaves a turn that recorded nothing exactly as it was — no field is added", async () => {
    const plain = promotedAssistantTurn("Just an answer.", false, []);
    const { json, md } = await roundTrip([{ role: "user", text: "Hi." }, plain!]);
    expect(json.turns[1]).toEqual({ role: "assistant", text: "Just an answer." });
    expect(md).toContain("## assistant\n\nJust an answer.");
    expect(md).not.toContain("Recorded:");
  });
});

describe("the recorder is bounded and scoped", () => {
  it("records only the three design-record tools", () => {
    expect(isDesignRecordTool("cbe_canvas")).toBe(true);
    expect(isDesignRecordTool("cbe_step")).toBe(true);
    expect(isDesignRecordTool("cbe_maturity")).toBe(true);
    for (const other of [
      "read",
      "grep",
      "write",
      "cbe_picker",
      "cbe_decision_checklist",
      "cbe_cite",
      "cbe_profile",
      "cbe_wiki",
    ]) {
      expect(isDesignRecordTool(other)).toBe(false);
    }
    const recorder = new ToolCardRecorder();
    recorder.start("r1", "read", { path: "corpus/index.json" }, 0);
    recorder.end("r1", piResult("…50k of corpus…", null), false);
    recorder.start("p1", "cbe_picker", { question: "Which?" }, 0);
    recorder.end("p1", piResult("placeholder", null), false);
    expect(recorder.take()).toEqual([]);
  });

  it("caps the result text rather than persisting an unbounded blob", () => {
    const recorder = new ToolCardRecorder();
    recorder.start("c1", "cbe_canvas", CANVAS_ARGS, 0);
    recorder.end("c1", piResult("x".repeat(CARD_RESULT_MAX_CHARS + 500), null), false);
    const card = recorder.take()[0]!;
    expect(card.resultText!.length).toBeLessThanOrEqual(CARD_RESULT_MAX_CHARS);
  });

  it("keeps an errored call, marked as one", () => {
    const recorder = new ToolCardRecorder();
    recorder.start("c1", "cbe_step", STEP_ARGS, 0);
    recorder.end("c1", "cbe_step: invalid payload. No step update applied.", true);
    const card = recorder.take()[0]!;
    expect(card.status).toBe("error");
    expect(card.resultText).toContain("invalid payload");
  });

  it("drops a call that never reached a terminal status — a completed turn claims nothing running", () => {
    const recorder = new ToolCardRecorder();
    recorder.start("c1", "cbe_canvas", CANVAS_ARGS, 0);
    recorder.start("c2", "cbe_step", STEP_ARGS, 0);
    recorder.end("c2", piResult("Step 3 is now rough.", null), false);
    expect(recorder.take().map((c) => c.toolName)).toEqual(["cbe_step"]);
  });

  it("is emptied by `clear`, which is what a loop abort does to the run's record", () => {
    const recorder = recordRun(THREE_CALLS);
    recorder.clear();
    expect(recorder.take()).toEqual([]);
  });
});

describe("A stopped run that recorded cards keeps the stop's own message", () => {
  /** The prompt handler's turn boundary — the ONE caller that owns the neutral
   *  message, and the one that appended it before this field existed. */
  const boundary = { stoppedPlaceholder: en.chatStoppedTurnPlaceholder };

  it("keeps the placeholder as the turn's text and hangs the cards off it", () => {
    const turn = promotedAssistantTurn("", true, recordRun(THREE_CALLS).take(), boundary);
    expect(turn!.text).toBe(en.chatStoppedTurnPlaceholder);
    expect(turn!.stopped).toBe(true);
    expect(turn!.cards).toHaveLength(3);
  });

  it("drops the recorded offsets — they index the draft, and the placeholder is not the draft", () => {
    const recorder = new ToolCardRecorder();
    recorder.start("c1", "cbe_canvas", CANVAS_ARGS, 42);
    recorder.end("c1", piResult("Artefact recorded on step 3.", { kind: "canvas" }), false);
    const turn = promotedAssistantTurn("", true, recorder.take(), boundary);
    expect(turn!.cards!.map((c) => c.at)).toEqual([undefined]);
    expect(turn!.cards![0]!.toolName).toBe("cbe_canvas");
  });

  it("still writes the placeholder for a stop that left NOTHING at all", () => {
    const turn = promotedAssistantTurn("", true, [], boundary);
    expect(turn).toEqual({ role: "assistant", text: en.chatStoppedTurnPlaceholder, stopped: true });
  });

  it("promotes nothing for a caller that owns no placeholder — the closing flush wrote none", () => {
    // Unchanged from before this field existed: `AgentManager.dump` appended no
    // turn there, and the promotion must not start synthesising one for it.
    expect(promotedAssistantTurn("", true, [])).toBeNull();
    expect(promotedAssistantTurn("", false, [])).toBeNull();
    expect(promotedAssistantTurn("", false, [], boundary)).toBeNull();
  });

  it("leaves the closing flush's cards-only turn exactly as it was — empty text, seed-neutral", () => {
    const turn = promotedAssistantTurn("", true, recordRun(THREE_CALLS).take());
    expect(turn!.text).toBe("");
    expect(turn!.stopped).toBe(true);
    expect(turn!.cards).toHaveLength(3);
  });

  it("marks a stopped run's streamed text and keeps its cards", () => {
    const turn = promotedAssistantTurn("Half an answ", true, recordRun(THREE_CALLS).take(), boundary);
    expect(turn!.text).toBe("Half an answ");
    expect(turn!.stopped).toBe(true);
    expect(turn!.cards).toHaveLength(3);
    expect(turn!.cards!.every((c) => typeof c.at === "number")).toBe(true);
  });
});

describe("A resumed model is seeded with exactly what it was seeded with before", () => {
  const toolOnly = promotedAssistantTurn("", false, recordRun(THREE_CALLS).take())!;
  const stored: SessionTurn[] = [
    { role: "user", text: "Record what we agreed." },
    toolOnly,
    { role: "user", text: "And now?" },
    promotedAssistantTurn("Next, step 4.", false, recordRun(THREE_CALLS).take())!,
  ];

  it("leaves the tool-only turn out of the seed", () => {
    expect(seedableTurns(stored)).toEqual([
      { role: "user", text: "Record what we agreed." },
      { role: "user", text: "And now?" },
      expect.objectContaining({ role: "assistant", text: "Next, step 4." }),
    ]);
  });

  it("seeds a legacy transcript unchanged", () => {
    const legacy: SessionTurn[] = [
      { role: "user", text: "Hello." },
      { role: "assistant", text: "Hi." },
    ];
    expect(seedableTurns(legacy)).toEqual(legacy);
  });

  /** The stopped shapes are the ones that could silently shorten the seed, so
   *  each is pinned against what its own flush path produced BEFORE the field
   *  existed — the turn boundary appended the placeholder, the closing flush
   *  appended nothing. */
  it("keeps the turn-boundary stop's placeholder in the seed, cards or no cards", () => {
    const withCards = promotedAssistantTurn("", true, recordRun(THREE_CALLS).take(), {
      stoppedPlaceholder: en.chatStoppedTurnPlaceholder,
    })!;
    const withoutCards = promotedAssistantTurn("", true, [], { stoppedPlaceholder: en.chatStoppedTurnPlaceholder })!;
    const transcript: SessionTurn[] = [
      { role: "user", text: "Erklär mir Schritt 4." },
      withCards,
      { role: "user", text: "Und weiter?" },
      withoutCards,
    ];
    expect(seedableTurns(transcript).map((t) => t.text)).toEqual([
      "Erklär mir Schritt 4.",
      en.chatStoppedTurnPlaceholder,
      "Und weiter?",
      en.chatStoppedTurnPlaceholder,
    ]);
  });

  it("leaves the closing flush's stopped cards-only turn out, exactly as that path seeded nothing before", () => {
    const closing = promotedAssistantTurn("", true, recordRun(THREE_CALLS).take())!;
    const transcript: SessionTurn[] = [{ role: "user", text: "Halt." }, closing];
    expect(seedableTurns(transcript)).toEqual([{ role: "user", text: "Halt." }]);
  });

  it("never lets a card reach the seed on a turn that IS seeded", () => {
    const seeded = seedableTurns([
      promotedAssistantTurn("Next, step 4.", false, recordRun(THREE_CALLS).take())!,
      promotedAssistantTurn("", true, recordRun(THREE_CALLS).take(), {
        stoppedPlaceholder: en.chatStoppedTurnPlaceholder,
      })!,
    ]);
    // `cards` is not part of the resume turn shape — the seed reads `text` — so
    // what matters is that no card content appears in any seeded text.
    for (const turn of seeded) {
      expect(turn.text).not.toContain("cbe_canvas");
      expect(turn.text).not.toContain(CANVAS_ARGS.value);
    }
  });
});

describe("An older sidecar without cards, and one whose cards are malformed, stay readable", () => {
  it("loads a sidecar written before the field existed, with its turns intact", async () => {
    const { json } = await roundTrip([
      { role: "user", text: "Hello." },
      { role: "assistant", text: "Hi." },
    ]);
    expect(json.turns).toEqual([
      { role: "user", text: "Hello." },
      { role: "assistant", text: "Hi." },
    ]);
  });

  /** A corrupt record arrives ON DISK, not as live host state — so these cases
   *  write the sidecar by hand rather than through the writer. */
  async function readCorrupt(cards: unknown) {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-cards-"));
    try {
      const payload = { meta, turns: [{ role: "assistant", text: "Recorded.", cards }] };
      await writeFile(path.join(dir, `${meta.sessionId}.json`), JSON.stringify(payload, null, 2), "utf8");
      return await readSessionJson(dir, meta.sessionId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("drops malformed entries and keeps the readable ones", async () => {
    const good = recordRun(THREE_CALLS).take()[0]!;
    const json = await readCorrupt([
      good,
      { toolName: "cbe_canvas" },
      { toolCallId: "x", toolName: "read", status: "done" },
      null,
    ]);
    expect(json!.turns[0]!.text).toBe("Recorded.");
    expect(json!.turns[0]!.cards).toEqual([good]);
  });

  it("treats a wholly unreadable field as absent without invalidating the sidecar", async () => {
    const json = await readCorrupt("not an array");
    expect(json!.turns[0]!.text).toBe("Recorded.");
    expect(json!.turns[0]!.cards).toBeUndefined();
  });

  it("never invalidates the sidecar over a card, unlike a malformed didacticChecks", async () => {
    const json = await readCorrupt([{ nonsense: true }]);
    expect(json).not.toBeNull();
    expect(json!.meta.sessionId).toBe(meta.sessionId);
    expect(json!.turns).toHaveLength(1);
  });
});

describe("the persisted shape stays a projection of the call", () => {
  it("carries no rendered chrome — no action label, no argument summary", async () => {
    const { json } = await roundTrip([promotedAssistantTurn("", false, recordRun(THREE_CALLS).take())!]);
    const card = json.turns[0]!.cards![0] as PersistedToolCard & Record<string, unknown>;
    expect(Object.keys(card).sort()).toEqual(["args", "at", "resultText", "status", "toolCallId", "toolName"]);
    expect(JSON.stringify(card)).not.toContain("Updating canvas");
  });
});
