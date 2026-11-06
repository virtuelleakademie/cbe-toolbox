/**
 * Runtime provider re-bind on a live session (capability `agent-harness`,
 * Requirement: Bring-Your-Own-LLM Configuration — Scenarios "Running session is
 * re-bound to the new provider without losing context" and "A failed runtime
 * re-bind leaves the running session intact").
 *
 * No network: `startCbeSession` + `updateProvider` only mutate the in-memory
 * ModelRegistry and call `session.setModel`, whose auth check is offline
 * (`ModelRegistry.hasConfiguredAuth` reads the inline apiKey of the registered
 * provider). Only `session.prompt(...)` would hit the network, and we never send
 * one — so the "prior turns remain" guarantee is asserted as transcript-and-
 * session-identity preservation across the swap.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession } from "../src/session.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function start() {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-update-provider-"));
  const skillDir = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
  return startCbeSession({
    profile: "headless",
    skillDir,
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd: path.join(tmp, "workspace"),
    provider: { baseURL: "http://localhost:1/v1", apiKey: "key-a", modelId: "model-a" },
  });
}

describe("runtime provider re-bind (updateProvider)", () => {
  // Scenario: Running session is re-bound to the new provider without losing context
  it("re-binds the running session to the new provider, preserving the transcript", async () => {
    const started = await start();
    const session = piSessionOf(started.session);
    const updateProvider = started.session.updateProvider;
    expect(session.model?.id).toBe("model-a");

    const transcriptBefore = session.messages;

    await updateProvider({ baseURL: "http://localhost:2/v1", apiKey: "key-b", modelId: "model-b" });

    // Routing switched to the new model on the SAME session instance...
    expect(session.model?.id).toBe("model-b");
    // ...and the prior transcript was not reset by the swap (no session rebuild).
    expect(session.messages).toEqual(transcriptBefore);
  });

  // Scenario: A failed runtime re-bind leaves the running session intact
  it("rejects an invalid provider and leaves the session on its previous provider", async () => {
    const started = await start();
    const session = piSessionOf(started.session);
    const updateProvider = started.session.updateProvider;
    const transcriptBefore = session.messages;

    // Empty baseURL is rejected by the registry's validateProviderConfig BEFORE the
    // provider config is applied, so the swap fails without touching session state.
    await expect(updateProvider({ baseURL: "", apiKey: "key-b", modelId: "model-b" })).rejects.toThrow();

    // Previous provider/model still active; transcript intact → still promptable.
    expect(session.model?.id).toBe("model-a");
    expect(session.messages).toEqual(transcriptBefore);
  });
});
