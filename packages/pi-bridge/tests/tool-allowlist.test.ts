/**
 * Tests for the agent tool allowlist wiring.
 *
 * Capability `agent-harness`, Requirement: Tool Allowlist Excluding Shell
 * Execution. The allowlist `CBE_TOOL_ALLOWLIST` is a single profile-independent
 * constant fed to `createAgentSession({ tools })` in session.ts, so the app and
 * headless profiles see an identical tool surface (eval reproducibility).
 */
import { describe, it, expect } from "vitest";
import { CBE_TOOL_ALLOWLIST } from "../src/session.js";
import { createCiteTool } from "../src/cite-tool.js";
import { pickerTool } from "../src/picker-tool.js";
import { canvasTool } from "../src/canvas-tool.js";
import { stepTool } from "../src/step-tool.js";

describe("CBE tool allowlist", () => {
  it("Bash is not in the active tool set (still holds)", () => {
    // The file-system tools are present; bash is intentionally absent.
    for (const fs of ["read", "write", "edit", "grep", "find", "ls"]) {
      expect(CBE_TOOL_ALLOWLIST).toContain(fs);
    }
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).not.toContain("bash");
  });

  it("citation tool is exposed uniformly across profiles", () => {
    // The allowlist is one shared constant — there is no per-profile branch, so
    // app and headless necessarily expose the same set. It carries cbe_cite
    // alongside the generative-UI picker and the FS tools.
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_cite");
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_picker");

    // The customTools array carries the citation tool's definition (a resolver
    // is injected at session start; a null resolver still yields a registered
    // tool named cbe_cite).
    expect(createCiteTool(null).name).toBe("cbe_cite");
    expect(pickerTool.name).toBe("cbe_picker");
  });

  // capability `citation-tool`, Requirement: *Deterministic Citation Tool Emits the
  // Canonical Token*, Scenario: *The store is carried by the id, not by a second tool*
  // (change `cite-the-lecturers-wiki`). The wiki route was deliberately NOT given a tool
  // of its own: a second registered tool costs its own prose in the tightest instruction
  // channel, and two citation routes are two places the token grammar can drift apart.
  it("the store is carried by the id, not by a second tool", () => {
    const citationTools = CBE_TOOL_ALLOWLIST.filter((t) => /^cbe_.*cit/.test(t));
    expect(citationTools).toEqual(["cbe_cite"]);
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).not.toContain("cbe_wiki_cite");
    // The wiki route is reachable through the one tool's `id` parameter.
    expect(JSON.stringify(createCiteTool(null).parameters)).toContain("wiki:");
  });

  it("cbe_cite adds no filesystem or shell affordance beyond its read-only lookup", () => {
    // The tool name is corpus-scoped; it is not an FS tool name and not bash.
    expect(["read", "write", "edit", "grep", "find", "ls", "bash"]).not.toContain(createCiteTool(null).name);
  });

  // Scenario (agent-harness, cbe_canvas Generative-UI Tool): registered and allowlisted.
  it("cbe_canvas is in the allowlist and registered as a customTool", () => {
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_canvas");
    expect(canvasTool.name).toBe("cbe_canvas");
    expect(["read", "write", "edit", "grep", "find", "ls", "bash"]).not.toContain(canvasTool.name);
  });

  // Scenario (agent-harness): cbe_set_mode is retired with the operation-mode
  // model (change internalize-operation-modes) — the single shared allowlist
  // covers both profiles, so its absence here proves it for app AND headless.
  it("cbe_set_mode is NOT in the allowlist (mode tool retired)", () => {
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).not.toContain("cbe_set_mode");
    // Exactly fourteen tools: 6 FS + 8 cbe customTools — the seventh is `cbe_wiki`
    // (change `give-the-wiki-a-reading-route`), the eighth `cbe_support` (change
    // `recalibrate-tutor-support`). `bash` and `cbe_decision_checklist` are both
    // de-registered (product decision, 2026-08-06; Requirement: Tool Allowlist
    // Excluding Shell Execution).
    expect(CBE_TOOL_ALLOWLIST).toHaveLength(14);
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).toContain("cbe_wiki");
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).toContain("cbe_support");
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).not.toContain("cbe_decision_checklist");
  });

  // Scenario (agent-harness, cbe_step Generative-UI Tool): cbe_step is registered and
  // allowlisted in both profiles (the allowlist is profile-independent).
  it("cbe_step is registered and allowlisted in both profiles", () => {
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_step");
    expect(stepTool.name).toBe("cbe_step");
    expect(["read", "write", "edit", "grep", "find", "ls", "bash"]).not.toContain(stepTool.name);
    // bash stays excluded from the base allowlist.
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).not.toContain("bash");
  });
});
