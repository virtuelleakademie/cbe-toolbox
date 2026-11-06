/**
 * Resume seeding (capability `course-workspace`, Requirement: Project View Lists
 * Stored Sessions and Supports Resume — Scenario: Resume reconstructs the
 * conversation from the JSON sidecar, pi-bridge half).
 *
 * Drives the REAL `startCbeSession` against an offline test provider with
 * `resume.turns` and asserts the fresh AgentSession's conversation context
 * contains the stored turns, turn by turn, in order — seeded through pi's own
 * SessionManager (public API), not stuffed into a prompt string.
 *
 * No network: session construction does not call the model.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type ResumeTurn } from "../src/session.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function start(resumeTurns?: ResumeTurn[]) {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-resume-"));
  const skillDir = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
  return startCbeSession({
    profile: "app",
    skillDir,
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd: path.join(tmp, "workspace"),
    provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
    ...(resumeTurns ? { resume: { turns: resumeTurns } } : {}),
  });
}

function messageTexts(port: Parameters<typeof piSessionOf>[0]): Array<{ role: string; text: string }> {
  const messages = piSessionOf(port).messages as Array<{ role: string; content: unknown }>;
  return messages.map((m) => ({
    role: m.role,
    text:
      typeof m.content === "string"
        ? m.content
        : (m.content as Array<{ type?: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join(""),
  }));
}

describe("resume reconstructs the conversation from the stored turns", () => {
  it("seeds the stored turns into the fresh session's context, in order", async () => {
    const turns: ResumeTurn[] = [
      { role: "user", text: "Wie starte ich mit CBL im Modul Datenbanken?" },
      { role: "assistant", text: "Beginnen wir mit der Big Idea.\n\n## Vorschlag\nDatensouveränität." },
      { role: "user", text: "Passt — weiter mit der Essential Question." },
    ];
    const { session } = await start(turns);
    const seeded = messageTexts(session);
    expect(seeded.length).toBe(3);
    expect(seeded[0]).toEqual({ role: "user", text: turns[0]!.text });
    expect(seeded[1]!.role).toBe("assistant");
    // Lossless: content with `##` headings survives (the reason resume reads the
    // JSON sidecar, not the Markdown archive).
    expect(seeded[1]!.text).toContain("## Vorschlag");
    expect(seeded[2]).toEqual({ role: "user", text: turns[2]!.text });
  });

  it("a fresh session (no resume) starts with an empty conversation", async () => {
    const { session } = await start();
    expect(messageTexts(session).length).toBe(0);
  });
});
