/**
 * Integration check for EAGER skill-body inclusion (change
 * `rebuild-skill-prompt-and-eval`; capability `agent-harness`, Requirement: *Eager
 * Skill-Body Instruction Budget*). Drives the REAL `startCbeSession` against an offline
 * test provider and inspects the AgentSession's COMPOSED `systemPrompt` — the string the
 * model actually receives, not the file on disk.
 *
 * WHY THIS TEST EXISTS IN THIS SHAPE. Under the lazy load it replaces, the body reached
 * the model only through a `read`, and pi truncates a `read` at 50 KB: a
 * 79,977-character body arrived as lines 1–291 of 458 (62.3 %), with citation
 * discipline, anti-sycophancy and the student-data refusal all BEHIND the cut, while the
 * prompt simultaneously forbade the continuation. So the load-bearing assertion here is
 * a marker from the LAST section of the body — the part that used to be unreachable —
 * asserted against the composed prompt.
 *
 * No network: session construction (registerProvider → loader.reload → SessionManager)
 * does not call the model; only `session.prompt(...)` would, and we never send one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession } from "../src/session.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";
import { stripFrontmatter } from "../src/cbe-system-prompt.js";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");

async function start(profile: "app" | "headless" = "headless") {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-eager-skill-"));
  const { session, skillBody } = await startCbeSession({
    profile,
    skillDir: SKILL_DIR,
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd: path.join(tmp, "workspace"),
    paths: { corpus: path.resolve(__dirname, "..", "..", "..", "corpus") },
    provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
  });
  return { session: piSessionOf(session), skillBody };
}

describe("eager skill-body inclusion — composed system prompt (integration)", () => {
  // Scenario: *The body is present in every prompt without a tool call*.
  it("inlines the frontmatter-stripped SKILL.md body in the composed system prompt", async () => {
    const { session, skillBody } = await start();
    const prompt = session.systemPrompt;
    const body = stripFrontmatter(skillBody).trim();

    expect(prompt).toContain('<skill name="cbe"');
    expect(prompt).toContain(body);
  });

  it("carries a marker from the LAST section of the body — the part the 50 KB read truncation cut", async () => {
    // Task 1.3. Asserted against the COMPOSED STRING, never against the file: reading
    // the file would pass even under a load path that never delivers it.
    const { session, skillBody } = await start();
    const body = stripFrontmatter(skillBody).trim();

    // Derive the marker from the body's final section rather than hardcoding a
    // sentence, so a re-cut cannot make the assertion vacuous while leaving it green.
    const lastHeading = body.lastIndexOf("\n## ");
    expect(lastHeading, "skill body has no sectioned tail to sample").toBeGreaterThan(-1);
    const tail = body.slice(lastHeading).trim();
    expect(tail.length).toBeGreaterThan(100);
    const marker = tail.slice(tail.length - 120);

    expect(prompt_of(session)).toContain(marker);
  });

  // Scenario: *The protocol requires the corpus read and not a skill read* (task 1.4).
  it("contains no instruction to read the skill body, and no session depends on one", async () => {
    const { session } = await start();
    const prompt = prompt_of(session);

    expect(prompt).not.toMatch(/MANDATORY OPENING PROTOCOL/);
    expect(prompt).not.toMatch(/`read` the `cbe` skill/i);
    expect(prompt).not.toMatch(/read[^.]{0,60}skill body/i);
    // The retired read-once absolutism that a compaction turned into data loss.
    expect(prompt).not.toMatch(/repeating a successful read/i);
  });

  it("keeps the corpus half of the opening protocol", async () => {
    // Eager inclusion is only safe BECAUSE this stays: the last time the body was
    // eager it removed the model's reason to touch the filesystem at all and corpus
    // retrieval collapsed board-wide (~2/20 probes read anything).
    const { session } = await start();
    const prompt = prompt_of(session);
    expect(prompt).toMatch(/<paths\.corpus>\/index\.json/);
    expect(prompt).toMatch(/an unread citation is a fabrication/i);
  });

  it("keeps the skill REGISTERED so /skill:cbe and baseDir resolution keep working", async () => {
    const { session } = await start();
    expect(prompt_of(session)).toContain("<name>cbe</name>");
  });

  it("orders the prompt identity → skill body → environment descriptor", async () => {
    const { session } = await start("app");
    const prompt = prompt_of(session);
    const identity = prompt.indexOf("You are the CBE Toolbox");
    const skill = prompt.indexOf('<skill name="cbe"');
    const descriptor = prompt.indexOf("--- ENVIRONMENT DESCRIPTOR ---");
    expect(identity).toBeGreaterThan(-1);
    expect(skill).toBeGreaterThan(identity);
    expect(descriptor).toBeGreaterThan(skill);
  });

  it("exposes no shell on any platform", async () => {
    // Requirement: *Tool Allowlist Excluding Shell Execution*, Scenario: *No shell on
    // any platform*. The descriptor carries no `bash` key at all — a flag that is
    // constant `false` steers nothing.
    const { session } = await start("app");
    const env = (await startCbeSessionEnv()) as Record<string, unknown>;
    expect(Object.keys(env)).not.toContain("bash");
    expect(prompt_of(session)).toMatch(/There is no shell and no command execution/i);
  });
});

function prompt_of(session: { systemPrompt: string }): string {
  return session.systemPrompt;
}

/** Affordance map of a fresh app-profile session, for the descriptor assertions. */
async function startCbeSessionEnv(): Promise<Record<string, boolean>> {
  const dir = mkdtempSync(path.join(tmpdir(), "cbe-eager-env-"));
  try {
    const { env } = await startCbeSession({
      profile: "app",
      skillDir: SKILL_DIR,
      sessionsDir: path.join(dir, "sessions"),
      agentDir: path.join(dir, "agent"),
      cwd: path.join(dir, "workspace"),
      provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
    });
    return env.affordances as unknown as Record<string, boolean>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
