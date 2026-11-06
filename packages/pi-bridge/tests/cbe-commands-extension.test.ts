/**
 * Tests for the app-authored CBE slash-command extension (/cite).
 *
 * The extension is an ExtensionFactory `(pi) => void`. We drive it with a minimal
 * mock ExtensionAPI that captures registerCommand calls + records sendUserMessage,
 * then exercise each command's argument completions and handler in isolation —
 * no live Pi runtime needed.
 *
 * Covers `specs/desktop-app/spec.md`, Requirement *Slash Commands via Pi-First
 * Architecture* (the extension-command channel: /cite; /mode is retired with the
 * operation-mode model, change internalize-operation-modes).
 */
import { describe, it, expect } from "vitest";
import { createCbeCommandsExtension } from "../src/cbe-commands-extension.js";

interface CapturedCommand {
  description?: string;
  getArgumentCompletions?: (prefix: string) => unknown;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

function drive(config: Parameters<typeof createCbeCommandsExtension>[0]) {
  const commands = new Map<string, CapturedCommand>();
  const sent: string[] = [];
  const pi = {
    registerCommand: (name: string, opts: CapturedCommand) => commands.set(name, opts),
    sendUserMessage: (content: string) => sent.push(content as string),
  };
  // The factory only touches registerCommand + sendUserMessage; cast the partial mock.
  createCbeCommandsExtension(config)(pi as never);
  return { commands, sent };
}

describe("cbe commands extension", () => {
  it("registers /cite and no /mode (mode command retired)", () => {
    const { commands } = drive({ listCorpusIds: () => [] });
    expect([...commands.keys()].sort()).toEqual(["cite"]);
    expect(commands.has("mode")).toBe(false);
  });

  describe("/cite", () => {
    it("completes corpus ids filtered by prefix", async () => {
      const { commands } = drive({
        listCorpusIds: () => ["methodology-001", "foundations-002", "methodology-003"],
      });
      const m = (await commands.get("cite")!.getArgumentCompletions!("methodology")) as Array<{ value: string }>;
      expect(m.map((c) => c.value)).toEqual(["methodology-001", "methodology-003"]);
    });

    it("expands /cite <id> to a (corpus:<id>) user message", async () => {
      const { commands, sent } = drive({ listCorpusIds: () => [] });
      await commands.get("cite")!.handler("foundations-002", {});
      expect(sent).toEqual(["(corpus:foundations-002)"]);
    });

    it("does nothing on an empty /cite argument", async () => {
      const { commands, sent } = drive({ listCorpusIds: () => [] });
      await commands.get("cite")!.handler("   ", {});
      expect(sent).toEqual([]);
    });
  });
});
