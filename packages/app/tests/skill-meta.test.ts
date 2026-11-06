/**
 * Tests for the skill-frontmatter reader behind the settings About group
 * (capability `desktop-app`, Requirement: Settings Panel (Phase 1 scaffold)).
 *
 * This is the one parser for the loaded skill's name and version: the session's
 * `skillVersion` and the About group both go through it, so a second parser can
 * never drift from the first.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSkillIdentity } from "../src/main/skill-meta.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIPPED_SKILL = path.resolve(HERE, "../../../skills/cbe/SKILL.md");

describe("readSkillIdentity", () => {
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cbe-skill-meta-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the name and version out of the frontmatter", async () => {
    const file = path.join(dir, "plain.md");
    await writeFile(file, "---\nname: cbe\nversion: 1.2.3\n---\n\n## Purpose\n", "utf8");
    expect(await readSkillIdentity(file)).toEqual({ name: "cbe", version: "1.2.3" });
  });

  it("ignores a version line in the skill's prose", async () => {
    const file = path.join(dir, "prose.md");
    await writeFile(file, "---\nname: cbe\nversion: 1.2.3\n---\n\nversion: 9.9.9 in a sentence\n", "utf8");
    expect((await readSkillIdentity(file)).version).toBe("1.2.3");
  });

  it("reports an absent field as null rather than a substitute value", async () => {
    const file = path.join(dir, "partial.md");
    await writeFile(file, "---\nname: cbe\n---\n\nbody\n", "utf8");
    expect(await readSkillIdentity(file)).toEqual({ name: "cbe", version: null });
  });

  it("reports an unreadable file as both fields null", async () => {
    expect(await readSkillIdentity(path.join(dir, "absent.md"))).toEqual({ name: null, version: null });
  });

  // The About group is only as honest as this: the parser has to match the shape
  // of the skill file the app actually ships, or every row falls back to
  // "unavailable" while the file is right there.
  it("resolves the shipped skill's real name and version", async () => {
    const identity = await readSkillIdentity(SHIPPED_SKILL);
    expect(identity.name).toBe("cbe");
    expect(identity.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
