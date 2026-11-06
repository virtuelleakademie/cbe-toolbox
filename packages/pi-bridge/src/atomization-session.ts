/**
 * Production atomization-session factory (capability `lecturer-wiki`,
 * Requirement: Ingestion Runs in Isolated Subagent Sessions; design.md D7).
 *
 * Each raw document gets a dedicated, ephemeral `createAgentSession` — the same
 * public Pi API that powers the lecturer's main session, configured with the
 * wiki-atomization skill (skills/wiki) instead of the CBE skill. The session is
 * in-memory (no session files), FS-tools only, and disposed after the run; the
 * lecturer's running session is untouched.
 *
 * A Pi ADAPTER module (capability `agent-harness`, Requirement: *Pi Runtime Is
 * Hidden Behind a CBE-Owned Port*): it shares the model construction primitive
 * with the main session but keeps its own policy — FS tools only, in-memory
 * session manager, the single wiki writable root — and observes the session
 * through the CBE-owned run port and its normalized events.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ProviderConfig } from "./provider.js";
import { createPiModelBinding } from "./runtime/pi-model.js";
import { adaptPiRun } from "./runtime/pi-session-port.js";
import { CBE_RESOURCE_POLICY, createCbeSettingsManager } from "./runtime/pi-config.js";
import { composeLegacySystemPrompt } from "./runtime/legacy-system-prompt.js";
import { createRequestParityExtension, REQUEST_PARITY_HOOK } from "./runtime/request-parity-extension.js";
import type { AtomizationSession, AtomizationSessionFactory } from "./ingestion-runner.js";
import { createFencedFileToolsExtension, type WritableRoots } from "./write-fence.js";

/** FS-only tool surface for atomization — no bash, no generative-UI tools. */
export const ATOMIZATION_TOOLS = ["read", "write", "edit", "grep", "find", "ls"] as const;

/**
 * The atomization run's writable roots: a SINGLE root, the course's `wiki/` —
 * the atoms the run produces, and nothing else (capability `lecturer-wiki`,
 * Requirement: Ingestion Runs in Isolated Subagent Sessions). The session's cwd
 * is the course folder, which contains `sessions/`, `inbox/`, `raw/`, `canvas/`,
 * `reflections/` and `course.md` alongside the one layer the run legitimately
 * writes — and the run's context is dominated by an UNTRUSTED ingested document,
 * so it is the harness's most exposed injection surface. `raw/` is deliberately
 * NOT a root: the `raw` → `compiled` status transition is host-owned (the app
 * applies it after a successful run), so the run never needs to write there.
 */
export function atomizationWritableRoots(wikiDir: string): WritableRoots {
  return { dirs: [wikiDir] };
}

export interface AtomizationFactoryOptions {
  /** The course folder — the session's cwd; inbox/, raw/, wiki/ live below it. */
  courseDir: string;
  wikiDir: string;
  /** The adapted wiki-skill bundle (skills/wiki). Its SKILL.md body IS the
   * session's operating contract, inlined into the system prompt (a one-shot
   * batch job needs no lazy-load protocol). */
  wikiSkillDir: string;
  /** App-isolated pi home — same directory the main session uses. */
  agentDir: string;
  provider: ProviderConfig;
}

/** Read the bundle's explicit version identifier (frontmatter `version:`), for
 * the reflection log (Requirement: Reflection Logs per Atomization and Session). */
export async function readWikiSkillVersion(wikiSkillDir: string): Promise<string> {
  try {
    const raw = await readFile(path.join(wikiSkillDir, "SKILL.md"), "utf8");
    return raw.match(/^version:\s*(\S+)/m)?.[1] ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function stripFrontmatter(body: string): string {
  const m = body.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? body.slice(m[0].length) : body;
}

export function createPiAtomizationSessionFactory(opts: AtomizationFactoryOptions): AtomizationSessionFactory {
  return async (doc): Promise<AtomizationSession> => {
    const skillRaw = await readFile(path.join(opts.wikiSkillDir, "SKILL.md"), "utf8");
    const systemPrompt = [
      stripFrontmatter(skillRaw).trim(),
      "",
      "--- SESSION BINDING ---",
      `course folder (your cwd): ${opts.courseDir}`,
      `wiki directory:           ${opts.wikiDir}`,
      `raw document to process:  ${doc.rawRelPath}`,
      "--- END ---",
    ].join("\n");

    const { modelRuntime, model } = await createPiModelBinding(opts.provider, opts.agentDir);
    const settingsManager = createCbeSettingsManager();
    // The prompt text the run has always received: the inlined contract, no
    // appended blocks, no skills list, then the date and cwd lines.
    const systemPromptText = composeLegacySystemPrompt({
      customPrompt: systemPrompt,
      append: [],
      skills: [],
      hasRead: true,
      cwd: opts.courseDir,
      date: new Date(),
    });

    const loader = new DefaultResourceLoader({
      cwd: opts.courseDir,
      agentDir: opts.agentDir,
      settingsManager,
      // Nothing is discovered from disk (runtime/pi-config.ts).
      ...CBE_RESOURCE_POLICY,
      systemPrompt,
      appendSystemPromptOverride: () => [],
      // No skills pointer block; the contract is inlined above and the tool
      // surface is FS-only. The ONE extension is the path fence on `write`/
      // `edit` (Requirement: Path-Fenced File Mutation Tools) with the single
      // root the run needs — the course's wiki/. The roots are fixed HERE, by
      // host code, before the untrusted document ever enters the context.
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
      extensionFactories: [
        createFencedFileToolsExtension(opts.courseDir, atomizationWritableRoots(opts.wikiDir)),
        createRequestParityExtension({ systemPrompt: () => systemPromptText }),
      ],
      extensionsOverride: (base) => ({
        ...base,
        // Keep ONLY the fenced file-mutation tools (identified by the tool
        // names they register) and the handler-only request-parity extension;
        // defence in depth on top of the disabled disk discovery.
        extensions: base.extensions.filter(
          (e) => e.tools.has("write") || e.tools.has("edit") || e.handlers.has(REQUEST_PARITY_HOOK)
        ),
      }),
    });
    await loader.reload();

    const { session: piSession } = await createAgentSession({
      cwd: opts.courseDir,
      agentDir: opts.agentDir,
      model,
      modelRuntime,
      settingsManager,
      resourceLoader: loader,
      // Ephemeral: the atomization conversation is never persisted — the
      // reflection log records the outcome, the wiki records the atoms.
      sessionManager: SessionManager.inMemory(),
      tools: [...ATOMIZATION_TOOLS],
    });
    // From here on the session is observed and driven through the CBE-owned run
    // port only; its normalized events arrive one per runtime event.
    const session = adaptPiRun(piSession);

    // Track which wiki files the session writes (write/edit tool calls whose
    // path resolves under the wiki directory) — the runner's validation gate
    // and abort-cleanup operate on this list.
    const written = new Set<string>();
    const argsByCall = new Map<string, unknown>();
    let finalText = "";
    // The session's last sign of life (capability `lecturer-wiki`, Requirement:
    // The Atomization Turn Is Bounded in Time and Endable). Stamped on EVERY
    // event, not only the three read below — a turn start is as much a sign of
    // life as a token, and the runner's silence deadline is only as good as the
    // signal it reads. Seeded here so a session that never emits anything is
    // measured from its construction.
    let lastActivity = Date.now();
    session.subscribe((e) => {
      lastActivity = Date.now();
      if (e.type === "tool_execution_start" && e.toolCallId) {
        argsByCall.set(e.toolCallId, e.args);
      } else if (e.type === "tool_execution_end" && e.toolCallId) {
        const args = argsByCall.get(e.toolCallId) as { path?: unknown } | undefined;
        argsByCall.delete(e.toolCallId);
        if (e.isError) return;
        if (e.toolName !== "write" && e.toolName !== "edit") return;
        if (typeof args?.path !== "string") return;
        const abs = path.resolve(opts.courseDir, args.path);
        const rel = path.relative(opts.wikiDir, abs);
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
          written.add(rel.split(path.sep).join("/"));
        }
      } else if (e.type === "text_delta") {
        finalText += e.delta;
      }
    });

    return {
      async run(taskPrompt) {
        await session.prompt(taskPrompt);
        return { summary: finalText.trim(), writtenWikiFiles: [...written] };
      },
      // What the session has written so far, readable even when `run` throws
      // (Requirement: Ingestion Failure Containment) — the runner's gate needs
      // the set, and a throwing run cannot deliver it through its return value.
      writtenWikiFiles() {
        return [...written];
      },
      lastActivityAt() {
        return lastActivity;
      },
      async abort() {
        await session.abort();
      },
      dispose() {
        session.dispose();
      },
    };
  };
}
