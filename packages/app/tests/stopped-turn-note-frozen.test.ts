/**
 * A stopped turn's archive note is frozen with the turn (capability
 * `agent-harness`, Requirement: *Sessions as Local Markdown/JSON Files* —
 * "Stopped marker on an assistant turn"; capability `desktop-app`, Requirement:
 * *Every String the App Renders Is English*).
 *
 * `writeSessionMd` regenerates the WHOLE archive on every turn-boundary flush, so
 * anything it resolves at write time is re-rendered for turns recorded long
 * before. The turn's own body is already frozen — the placeholder is written into
 * `text` at the moment of the stop — and the note under it has to be frozen the
 * same way, or a turn stopped while the interface was English grows a German note
 * beneath its English body as soon as the lecturer switches language and sends
 * one more message.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeSessionMd, type SessionMeta, type SessionTurn } from "../src/main/sessions.js";
import { setActiveInterfaceLanguage } from "../src/main/interface-language.js";
import { promotedAssistantTurn } from "../src/shared/turn-stop.js";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";
import { REFERENCE_LANGUAGE } from "../src/shared/i18n/index.js";

const meta: SessionMeta = {
  sessionId: "s-frozen",
  modelId: "gemma4-31b",
  skillVersion: "1",
  environmentProfile: "app",
  createdAt: "2026-08-25T10:00:00.000Z",
  closedAt: "2026-08-25T10:05:00.000Z",
};

async function archiveOf(turns: SessionTurn[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cbe-stopped-note-"));
  try {
    return await readFile(await writeSessionMd(dir, meta, turns), "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  setActiveInterfaceLanguage(REFERENCE_LANGUAGE);
});

describe("the stopped-turn note is a record, not a re-render", () => {
  it("keeps the note the turn was recorded with after the interface language changes", async () => {
    const recorded = promotedAssistantTurn("Half a sen", true, [], {
      stoppedPlaceholder: en.chatStoppedTurnPlaceholder,
      stoppedNote: en.exportStoppedTurnNote,
    })!;
    expect(recorded.stoppedNote).toBe(en.exportStoppedTurnNote);

    // The lecturer switches language, then sends one more message — which
    // rewrites the whole archive, this turn included.
    setActiveInterfaceLanguage("de");
    const md = await archiveOf([recorded as SessionTurn]);
    expect(md).toContain(en.exportStoppedTurnNote);
    expect(md).not.toContain(de.exportStoppedTurnNote);
  });

  it("writes the note in the language the stop happened in, whichever that is", async () => {
    setActiveInterfaceLanguage("de");
    const recorded = promotedAssistantTurn("Ein halber Satz", true, [], {
      stoppedNote: de.exportStoppedTurnNote,
    })!;
    setActiveInterfaceLanguage(REFERENCE_LANGUAGE);
    const md = await archiveOf([recorded as SessionTurn]);
    expect(md).toContain(de.exportStoppedTurnNote);
    expect(md).not.toContain(en.exportStoppedTurnNote);
  });

  it("reads the reference language for a turn recorded before the note was captured", async () => {
    // An older sidecar carries the marker and no note. English was the only
    // language such a file was ever written in, so that is what it keeps —
    // never whatever happens to be active now.
    setActiveInterfaceLanguage("de");
    const md = await archiveOf([{ role: "assistant", text: "Half a sen", stopped: true }]);
    expect(md).toContain(en.exportStoppedTurnNote);
    expect(md).not.toContain(de.exportStoppedTurnNote);
  });

  it("puts no note on a turn that was not stopped", async () => {
    const md = await archiveOf([{ role: "assistant", text: "A whole answer." }]);
    expect(md).not.toContain(en.exportStoppedTurnNote);
    expect(md).not.toContain(de.exportStoppedTurnNote);
  });
});
