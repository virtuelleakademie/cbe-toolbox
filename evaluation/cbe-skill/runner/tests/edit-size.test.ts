import { describe, it, expect } from "vitest";
import { checkEditSize, applyEdit, proposeEdit } from "../src/editor.js";
import { MemorySkillIO } from "../src/skill-io.js";
import type { LlmClient } from "../src/judge-client.js";
import type { CheckResult } from "../src/types.js";
import { SKILL_OK } from "./editor.test.js";

describe("checkEditSize", () => {
  it("allows a small surgical addition", () => {
    const old = "x".repeat(3866);
    expect(checkEditSize(old, old + " one extra clause.")).toEqual([]);
  });

  it("allows an addition up to the ~1500 bound (1.5x factor not exceeded)", () => {
    const old = "x".repeat(3866);
    expect(checkEditSize(old, old + "y".repeat(1400))).toEqual([]); // +1400 < 1500, 1.36x < 1.5
  });

  it("always allows shrinking (tightening)", () => {
    const old = "x".repeat(3866);
    expect(checkEditSize(old, "x".repeat(1000))).toEqual([]);
  });

  it("rejects an edit that adds more than the absolute char budget", () => {
    const old = "x".repeat(3866);
    const v = checkEditSize(old, old + "y".repeat(1600));
    expect(v.length).toBeGreaterThan(0);
    expect(v.join(" ")).toMatch(/adds 1600 chars/);
  });

  it("rejects a wholesale rewrite that grows a real file >1.5x (the delegation-check bloat)", () => {
    const old = "x".repeat(3866);
    const bloated = "y".repeat(20143);
    const v = checkEditSize(old, bloated);
    expect(v.join(" ")).toMatch(/5\.2x/);
  });

  it("does not apply the ratio guard to tiny files (absolute budget still applies)", () => {
    const old = "x".repeat(200);
    expect(checkEditSize(old, old + "y".repeat(300))).toEqual([]); // +300 < 1500, ratio ignored for tiny base
  });
});

describe("applyEdit bloat rejection", () => {
  it("rejects a bloated change and leaves the file untouched", () => {
    const io = new MemorySkillIO(new Map([["references/checks/x.md", "z".repeat(3866)]]));
    const r = applyEdit(io, {
      target_file: "references/checks/x.md",
      change: "z".repeat(3866) + "w".repeat(16000),
      editor_reasoning: "bloat",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not surgical/);
    expect(io.read("references/checks/x.md")).toBe("z".repeat(3866));
  });

  it("accepts a surgical change", () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const r = applyEdit(io, {
      target_file: "SKILL.md",
      change: SKILL_OK + "\n\none surgical clause",
      editor_reasoning: "surgical",
    });
    expect(r.ok).toBe(true);
  });
});

describe("proposeEdit context", () => {
  function spyClient(): { client: LlmClient; seen: () => string } {
    let seenUser = "";
    const client: LlmClient = {
      modelId: "e",
      tokensUsed: 0,
      async complete(_s: string, u: string) {
        seenUser = u;
        return {
          text: `TARGET_FILE: SKILL.md\nEDITOR_REASONING: r\n---BEGIN FILE CONTENT---\n${SKILL_OK}\n---END FILE CONTENT---\n`,
        };
      },
    };
    return { client, seen: () => seenUser };
  }
  const failing: CheckResult[] = [{ id: "c1", type: "judge", verdict: "fail" }];

  it("injects the prior rejection reason into the editor prompt", async () => {
    const { client, seen } = spyClient();
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    await proposeEdit(io, failing, { client }, { priorRejection: "edit not surgical: adds 1600 chars (max 1500)" });
    expect(seen()).toMatch(/REJECTED/);
    expect(seen()).toMatch(/adds 1600 chars/);
  });

  it("includes the rubric and the failing transcript when provided", async () => {
    const { client, seen } = spyClient();
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    await proposeEdit(
      io,
      failing,
      { client },
      {
        rubric: "MUST name the three design-mode anchor moments",
        transcript: "the candidate jumped straight to a module outline",
      }
    );
    expect(seen()).toMatch(/rubric/i);
    expect(seen()).toMatch(/name the three design-mode anchor moments/);
    expect(seen()).toMatch(/jumped straight to a module outline/);
  });

  it("omits rubric/transcript/rejection sections when not provided", async () => {
    const { client, seen } = spyClient();
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    await proposeEdit(io, failing, { client });
    expect(seen()).not.toMatch(/REJECTED/);
    expect(seen()).not.toMatch(/rubric/i);
    expect(seen()).not.toMatch(/failing transcript/i);
  });
});
