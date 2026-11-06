import { readFile } from "node:fs/promises";

/**
 * Frontmatter facts of the loaded skill (capability `desktop-app`, Requirement:
 * Settings Panel (Phase 1 scaffold) — the About group). Both fields are `null`
 * when the file is unreadable or the field is absent: the About group states
 * that plainly rather than rendering a literal that would rot the way the
 * hardcoded `0.1.0` did.
 */
export interface SkillIdentity {
  name: string | null;
  version: string | null;
}

/** The frontmatter block only, so a `version:` line in the skill's prose can
 * never be read as the skill version. A file without frontmatter is scanned
 * whole — that is the behaviour the session's `skillVersion` field has always
 * had. */
function frontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m?.[1] ?? raw;
}

function field(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"));
  return m?.[1] ?? null;
}

export async function readSkillIdentity(skillPath: string): Promise<SkillIdentity> {
  try {
    const block = frontmatter(await readFile(skillPath, "utf8"));
    return { name: field(block, "name"), version: field(block, "version") };
  } catch {
    return { name: null, version: null };
  }
}
