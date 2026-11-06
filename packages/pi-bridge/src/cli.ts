#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { startCbeSession } from "./session.js";
import { ToolLoopDetector } from "./tool-loop-detector.js";
import { applyTruncationVerdict, TruncationDetector } from "./truncation-detector.js";

async function main(): Promise<void> {
  const baseURL = process.env.CBE_LLM_BASE_URL;
  const apiKey = process.env.CBE_LLM_API_KEY;
  const modelId = process.env.CBE_LLM_MODEL_ID ?? "gpt-oss-120b";
  const contextLengthRaw = process.env.CBE_LLM_CONTEXT_LENGTH;
  const contextLength = contextLengthRaw ? Number(contextLengthRaw) : undefined;

  if (!baseURL || !apiKey) {
    console.error(
      "cbe-headless: missing required environment variables.\n" +
        "  Set CBE_LLM_BASE_URL and CBE_LLM_API_KEY.\n" +
        "  Optional: CBE_LLM_MODEL_ID (default: gpt-oss-120b), CBE_LLM_CONTEXT_LENGTH.\n" +
        "\n" +
        "Example:\n" +
        '  CBE_LLM_BASE_URL="https://llm.example/v1" \\\n' +
        '  CBE_LLM_API_KEY="..." \\\n' +
        '  cbe-headless "Design a CBE module on water scarcity for 2nd-year engineering."\n'
    );
    process.exit(2);
  }

  const repoRoot = path.resolve(process.cwd());
  const skillDir = path.join(repoRoot, "skills", "cbe");
  const sessionsDir = path.join(repoRoot, "sessions");
  // Headless mode: keep the agent's home isolated to a project-local folder, never
  // ~/.pi/, so the CLI cannot disturb a developer's global pi-coding-agent setup.
  const agentDir = path.join(repoRoot, ".cbe-agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_PACKAGE_DIR = path.join(agentDir, "npm");
  // Headless scratch root (capability `agent-harness`, Requirement: Path-Fenced
  // File Mutation Tools): the CLI's writable area is an explicit directory under
  // its project-local agent home — the checkout it runs from is NOT writable.
  // Passed as the session `cwd` AND surfaced as `paths.workspace`, so the
  // descriptor and the effective root of a relative path agree; before this,
  // the `opts.cwd ?? process.cwd()` default made the checkout the de-facto
  // writable area of every relative `write`.
  const scratchDir = path.join(agentDir, "workspace");
  mkdirSync(scratchDir, { recursive: true });

  const promptText =
    process.argv.slice(2).join(" ") ||
    "I want to design a CBE module on water scarcity for second-year environmental engineering students.";

  const { session, env } = await startCbeSession({
    profile: "headless",
    skillDir,
    sessionsDir,
    agentDir,
    cwd: scratchDir,
    paths: { workspace: scratchDir },
    // Deny-by-default fence: the scratch dir is the CLI's ONLY writable root —
    // skills/, evaluation/, packages/ and openspec/ of the checkout stay
    // unreachable for `write`/`edit`.
    writableRoots: { dirs: [scratchDir] },
    provider: { baseURL, apiKey, modelId, contextLength },
  });

  process.stderr.write(`[cbe-headless] profile=${env.profile} model=${modelId}\n`);
  process.stderr.write(`[cbe-headless] prompt: ${promptText}\n\n`);

  // Tool-Call Loop Remediation (capability `agent-harness`) — same backstop as the
  // app, trimmed for the headless one-shot: no host transcript, so abort just stops
  // the run and prints a note to stderr. Detection accumulates across the agent run
  // and resets at its boundary.
  const loopDetector = new ToolLoopDetector();
  const toolCallArgs = new Map<string, unknown>();
  let remediating = false;

  // Truncated-Completion Detection and Remediation (capability `agent-harness`) —
  // on an assistant message that ended truncated (stopReason "length", or an
  // evidently unfinished tail on a premature "stop"), steer the still-running
  // session to continue the answer; once the per-run continue budget is spent,
  // print the clear "response was cut off" note instead of presenting the
  // partial answer as final. Public subscribe/steer surface only.
  const truncationDetector = new TruncationDetector();

  // Normalized CBE runtime events (capability `agent-harness`, Requirement: *Pi
  // Runtime Is Hidden Behind a CBE-Owned Port*): no upstream event shape is read here.
  session.subscribe((evt) => {
    if (evt.type === "text_delta") {
      process.stdout.write(evt.delta);
      return;
    }
    if (evt.type === "agent_start") {
      loopDetector.reset();
      truncationDetector.reset();
      toolCallArgs.clear();
      remediating = false;
      return;
    }
    if (evt.type === "message_end" && evt.message.role === "assistant" && !remediating) {
      const verdict = truncationDetector.record({
        role: evt.message.role,
        stopReason: evt.message.stopReason ?? "",
        text: evt.message.text,
        toolCallCount: evt.message.toolCallCount,
      });
      if (verdict.action !== "none") {
        process.stderr.write(`\n[cbe-headless] truncation: ${verdict.action} (${verdict.reason})\n`);
      }
      applyTruncationVerdict(verdict, {
        session,
        notifyCutOff: (note) => process.stdout.write(`\n\n[response cut off] ${note}\n`),
      });
      return;
    }
    if (evt.type === "tool_execution_start" && evt.toolCallId) {
      toolCallArgs.set(evt.toolCallId, evt.args);
      return;
    }
    if (evt.type === "tool_execution_end" && evt.toolCallId && evt.toolName && !remediating) {
      const verdict = loopDetector.record({
        toolName: evt.toolName,
        args: toolCallArgs.get(evt.toolCallId),
        isError: evt.isError,
      });
      toolCallArgs.delete(evt.toolCallId);
      if (verdict.action === "steer" && verdict.correction) {
        process.stderr.write(`\n[cbe-headless] loop-breaker: steering (${verdict.reason})\n`);
        void session.steer(verdict.correction).catch(() => {});
      } else if (verdict.action === "abort") {
        remediating = true;
        process.stderr.write(`\n[cbe-headless] loop-breaker: aborting run (${verdict.reason})\n`);
        void session.abort().catch(() => {});
      }
    }
  });

  try {
    await session.prompt(promptText);
    process.stdout.write("\n");
  } finally {
    session.dispose();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
