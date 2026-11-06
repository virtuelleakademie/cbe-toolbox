/**
 * The CBE system-prompt text, in the shape the model has always received
 * (capability `agent-harness`, Requirement: *Accepted Pi 1.3 Runtime Semantics
 * Are Explicit Contracts* — the neutralized prompt shape).
 *
 * Pi 1.x renders a custom prompt as structured sections (`<addendum>`,
 * `<skills>`, `<cwd>`) and no longer appends the current date. The CBE prompt
 * the eval and the lecturer's sessions were measured against is the 0.75.5
 * rendering: custom prompt, the appended blocks joined by blank lines, the
 * available-skills list, then `Current date:` and `Current working directory:`
 * lines. This module reproduces exactly that text from CBE's own inputs, and the
 * adapter forces it onto every request through Pi's public `before_agent_start`
 * `systemPrompt` override, so the prompt text no longer depends on how a Pi
 * release composes sections.
 *
 * Pi-free on purpose: the format is CBE's contract now, not Pi's. A request-
 * parity golden (`tests/fixtures/pi-request-parity/`) pins the result byte for
 * byte against what Pi 0.75.5 actually sent.
 */

/** The skill fields the available-skills list renders. */
export interface LegacyPromptSkill {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

export interface LegacySystemPromptInput {
  /** The identity prompt (replaces Pi's default prompt). */
  customPrompt: string;
  /** Appended blocks, in order (skill body, environment descriptor). */
  append: readonly string[];
  /** Registered skills; listed only while the `read` tool is active. */
  skills: readonly LegacyPromptSkill[];
  /** Whether the session's tool selection includes `read`. */
  hasRead: boolean;
  /** The session's working directory. */
  cwd: string;
  /** The date the prompt carries, fixed when the session is composed. */
  date: Date;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatSkills(skills: readonly LegacyPromptSkill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return "";
  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];
  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

/** `YYYY-MM-DD` in local time, as the prompt has always carried it. */
export function legacyPromptDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Compose the CBE system-prompt text in its established shape. */
export function composeLegacySystemPrompt(input: LegacySystemPromptInput): string {
  let prompt = input.customPrompt;
  const append = input.append.join("\n\n");
  if (append) prompt += `\n\n${append}`;
  if (input.hasRead) prompt += formatSkills(input.skills);
  prompt += `\nCurrent date: ${legacyPromptDate(input.date)}`;
  prompt += `\nCurrent working directory: ${input.cwd.replace(/\\/g, "/")}`;
  return prompt;
}
