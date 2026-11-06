/**
 * The consequence half of `make-eval-measure-the-product` (capability
 * `cbe-skill-eval-harness`, Requirement: *The eval session runs in an isolated
 * workspace outside the repository*): what the agent's `cwd` does to the COMPOSED
 * system prompt — the string the model actually receives.
 *
 * Pi's `loadProjectContextFiles` walks `cwd` AND EVERY ANCESTOR for `AGENTS.md` /
 * `CLAUDE.md` and inlines what it finds as `<project_instructions>`
 * (`node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js`).
 * Until the eval pinned its `cwd`, that meant the repository's own engineering
 * handbook — measured at 41,936 characters, 73.1 % of a 57,214-character prompt —
 * arrived as project guidance on every eval turn, while the desktop app (which pins
 * `cwd` to `<userData>/workspace`) never loaded it. The eval was measuring a prompt
 * surface the product does not have.
 *
 * Since `adopt-settled-pi-runtime-lifecycle` the mechanism is also closed at its
 * source: every session policy passes an explicit resource policy
 * (`runtime/pi-config.ts`, `noContextFiles`), so a context file in `cwd` or in
 * any ancestor no longer reaches the prompt at all (capability `agent-harness`,
 * Requirement: *Embedded Pi Runtime Configuration Is Explicit and Versioned*).
 * The two cases that used to DEMONSTRATE the walk now pin that it is off; the
 * eval keeps its workspace pin as defence in depth.
 *
 * No network: session construction does not call the model; only `session.prompt(...)`
 * would, and none is sent.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession } from "../src/session.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
const CORPUS_DIR = path.resolve(__dirname, "..", "..", "..", "corpus");

/** Start an offline session whose agent cwd is `<tmp>/<workspaceRel>`. */
async function promptWithWorkspace(workspaceRel: string): Promise<string> {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-eval-cwd-"));
  const cwd = path.join(tmp, workspaceRel);
  mkdirSync(cwd, { recursive: true });
  const { session } = await startCbeSession({
    profile: "app",
    skillDir: SKILL_DIR,
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd,
    paths: { corpus: CORPUS_DIR },
    provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
  });
  return piSessionOf(session).systemPrompt;
}

describe("the agent's cwd decides whether project instructions enter the prompt", () => {
  // Scenario: *The composed system prompt carries no repository project instructions*.
  it("composes no <project_instructions> block for a workspace with no AGENTS.md above it", async () => {
    const prompt = await promptWithWorkspace("workspace-1");
    expect(prompt).not.toContain("<project_instructions");
  });

  it("composes none even for a cwd whose directory carries an AGENTS.md — context-file discovery is off", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "cbe-eval-cwd-repo-"));
    const fakeRepo = path.join(tmp, "checkout");
    mkdirSync(fakeRepo, { recursive: true });
    writeFileSync(path.join(fakeRepo, "AGENTS.md"), "# Repo handbook\n\nInternal engineering rules.\n", "utf8");
    const { session } = await startCbeSession({
      profile: "app",
      skillDir: SKILL_DIR,
      sessionsDir: path.join(tmp, "sessions"),
      agentDir: path.join(tmp, "agent"),
      cwd: fakeRepo,
      paths: { corpus: CORPUS_DIR },
      provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
    });
    expect(piSessionOf(session).systemPrompt).not.toContain("<project_instructions");
    expect(piSessionOf(session).systemPrompt).not.toContain("Internal engineering rules.");
  });

  it("ignores an AGENTS.md in an ANCESTOR of cwd — the walk that made an in-checkout workspace unsafe is off", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "cbe-eval-cwd-anc-"));
    const fakeRepo = path.join(tmp, "checkout");
    const nested = path.join(fakeRepo, "evaluation", "runs", "workspace-1");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(fakeRepo, "AGENTS.md"), "# Repo handbook\n\nAncestor rules.\n", "utf8");
    const { session } = await startCbeSession({
      profile: "app",
      skillDir: SKILL_DIR,
      sessionsDir: path.join(tmp, "sessions"),
      agentDir: path.join(tmp, "agent"),
      cwd: nested,
      paths: { corpus: CORPUS_DIR },
      provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
    });
    expect(piSessionOf(session).systemPrompt).not.toContain("Ancestor rules.");
  });
});
