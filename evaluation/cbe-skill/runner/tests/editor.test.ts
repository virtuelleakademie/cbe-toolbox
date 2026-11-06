import { describe, it, expect } from "vitest";
import { proposeEdit, applyEdit, isAllowedTarget, checkNonNegotiables, parseEditorReply } from "../src/editor.js";
import { MemorySkillIO } from "../src/skill-io.js";
import type { LlmClient } from "../src/judge-client.js";
import type { CheckResult } from "../src/types.js";

const NN = (title: string) => `## ${title}\n\n${"rule. ".repeat(40)}\n`;
// Section names follow the rebuilt skill body (`rebuild-skill-prompt-and-eval`):
// "Didactic non-negotiables" → "Non-negotiables", "Citation grounding" → "Citing",
// "Anti-sycophancy" → "Stance".
export const SKILL_OK = `# CBE\n\n${NN("Non-negotiables")}${NN("Citing")}${NN("Stance")}`;

function io() {
  return new MemorySkillIO(
    new Map([
      ["SKILL.md", SKILL_OK],
      ["references/modes/design.md", "design mode body"],
    ])
  );
}
/** Build the editor's delimited reply (the format the prompt asks for). */
function editorReply(target: string, change: string, reasoning = "addresses the failure"): string {
  return `TARGET_FILE: ${target}\nEDITOR_REASONING: ${reasoning}\n---BEGIN FILE CONTENT---\n${change}\n---END FILE CONTENT---\n`;
}
function client(text: string): LlmClient {
  return {
    modelId: "ed",
    tokensUsed: 0,
    async complete() {
      return { text };
    },
  };
}
const failing: CheckResult[] = [{ id: "c1", type: "judge", verdict: "fail", reasoning: "did not push back" }];

describe("editor allowlist", () => {
  it("accepts SKILL.md and references/*.md, rejects escapes and out-of-bounds", () => {
    expect(isAllowedTarget("SKILL.md")).toBe(true);
    expect(isAllowedTarget("references/checks/anti-sycophancy.md")).toBe(true);
    expect(isAllowedTarget("../../../etc/passwd")).toBe(false);
    expect(isAllowedTarget("packages/app/main.ts")).toBe(false);
    expect(isAllowedTarget("references/x.txt")).toBe(false);
  });

  // spec: Editor specifies which file it changes (out-of-bounds rejected)
  it("rejects an editor proposal that targets a file outside skills/cbe/", async () => {
    const out = await proposeEdit(io(), failing, {
      client: client(editorReply("packages/app/main.ts", "x")),
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/out of bounds/);
  });

  it("accepts a well-formed in-bounds proposal", async () => {
    const out = await proposeEdit(io(), failing, {
      client: client(editorReply("SKILL.md", SKILL_OK, "strengthened")),
    });
    expect(out.ok).toBe(true);
  });

  it("rejects a reply with no BEGIN/END markers", async () => {
    const out = await proposeEdit(io(), failing, { client: client("here is my idea: change SKILL.md") });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/markers/);
  });
});

describe("editor delimited output (robust to special chars)", () => {
  // The exact failure that stopped cycle 3 live: a full file with inner quotes,
  // braces and newlines. The delimited format must round-trip it verbatim.
  it("round-trips file content containing quotes, braces and newlines", () => {
    const change = `# Title\n\nHe said "yes" and { left }.\nA line with \`(corpus:foundations-002 § X, Y 2018)\`.\n{"not":"json"}\n`;
    const parsed = parseEditorReply(editorReply("references/checks/kompetenz-check.md", change, "fix"));
    expect(parsed).not.toBeNull();
    expect(parsed!.target_file).toBe("references/checks/kompetenz-check.md");
    expect(parsed!.change).toBe(change); // content round-trips verbatim (separator newline stripped)
    expect(parsed!.editor_reasoning).toBe("fix");
  });

  it("returns null when markers are absent", () => {
    expect(parseEditorReply('{"target_file":"SKILL.md"}')).toBeNull();
  });
});

describe("non-negotiable preservation", () => {
  // spec: Post-edit validation preserves non-negotiables
  it("flags removal of a guarded SKILL.md section", () => {
    const gutted = "# CBE\n\nonly an intro, all guardrails deleted";
    const violations = checkNonNegotiables("SKILL.md", gutted, SKILL_OK);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(" ")).toMatch(/Stance|Citing|Non-negotiables/);
  });

  it("flags emptying a non-negotiable reference file", () => {
    const violations = checkNonNegotiables(
      "references/non-negotiables/traceability.md",
      "",
      "long original content ".repeat(20)
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it("applyEdit rejects a non-negotiable-deleting change and does not write", () => {
    const skill = io();
    const out = applyEdit(skill, { target_file: "SKILL.md", change: "# CBE\n\ngutted", editor_reasoning: "bad" });
    expect(out.ok).toBe(false);
    expect(skill.read("SKILL.md")).toBe(SKILL_OK); // unchanged
  });

  it("applyEdit keeps a valid change and touches only the target", () => {
    const skill = io();
    const before = skill.read("references/modes/design.md");
    const newContent = `${SKILL_OK}\n\nAdded explicit push-back guidance.`;
    const out = applyEdit(skill, { target_file: "SKILL.md", change: newContent, editor_reasoning: "ok" });
    expect(out.ok).toBe(true);
    expect(skill.read("SKILL.md")).toBe(newContent);
    expect(skill.read("references/modes/design.md")).toBe(before); // untouched
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Apply-time channel guards (change `rebuild-skill-prompt-and-eval`)
// ─────────────────────────────────────────────────────────────────────────────

import { checkChannelInvariants, SKILL_BODY_BUDGET } from "../src/editor.js";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

describe("apply-time channel guards — Requirement: Editor edits are surgical", () => {
  const body = (text: string) => `---\nname: cbe\nversion: 0.3.0\n---\n\n${text}`;

  it("the duplicated budget constant matches the harness's source of truth", () => {
    // Duplicated (not imported) so this runner never pulls the pi runtime into npm test.
    // If it drifts, this fails rather than the guard silently using a stale number.
    const src = readFileSync(resolvePath(__dirname, "../../../../packages/pi-bridge/src/cbe-system-prompt.ts"), "utf8");
    const m = /export const SKILL_BODY_BUDGET = (\d+);/.exec(src);
    expect(m, "SKILL_BODY_BUDGET not found in cbe-system-prompt.ts").not.toBeNull();
    expect(Number(m![1])).toBe(SKILL_BODY_BUDGET);
  });

  // Scenario: An edit over the body budget is rejected
  it("rejects an edit that pushes the body past its documented budget, naming the budget", () => {
    const v = checkChannelInvariants("SKILL.md", body("x".repeat(SKILL_BODY_BUDGET + 10)));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(new RegExp(`documented budget of ${SKILL_BODY_BUDGET}`));
  });

  it("accepts an edit that stays inside the budget", () => {
    expect(checkChannelInvariants("SKILL.md", body("## Stance\n\nThe weakness comes first."))).toEqual([]);
  });

  // Scenario: An edit introducing a tool name is rejected
  it("rejects an edit that introduces a cbe_* token into the body, naming the boundary", () => {
    const v = checkChannelInvariants("SKILL.md", body("Mirror it with cbe_canvas when the affordance is present."));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/cbe_canvas/);
    expect(v[0]).toMatch(/channel boundary/);
  });

  it("reports both violations at once so the next attempt sees them together", () => {
    const v = checkChannelInvariants("SKILL.md", body("cbe_step " + "x".repeat(SKILL_BODY_BUDGET)));
    expect(v).toHaveLength(2);
  });

  it("does not guard non-SKILL.md targets", () => {
    expect(checkChannelInvariants("references/ui-guide.md", body("cbe_canvas"))).toEqual([]);
  });
});
