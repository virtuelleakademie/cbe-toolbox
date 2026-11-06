/**
 * Judge checker: scores a `judge`-type checkpoint with a fixed configured LLM.
 * The transcript is wrapped in an untrusted-data delimiter (prompt-injection
 * defence). The judge returns structured JSON; a non-JSON reply is retried once
 * with a stricter instruction, then marked `error` (judge_error).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Checkpoint, CheckResult, Probe, Transcript, Verdict } from "./types.js";
import { JUDGE_VERDICTS } from "./types.js";
import { fullAssistantText, judgeTranscriptText } from "./runner.js";
import { notAssessableReason } from "./checker-deterministic.js";
import type { LlmClient } from "./judge-client.js";

const SYSTEM = "You are a meticulous, skeptical evaluator. You output only the requested JSON object.";

let cachedTemplate: string | undefined;

export function loadJudgeTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/checker-judge.js -> ../templates/judge-prompt.md
  cachedTemplate = readFileSync(path.join(here, "..", "templates", "judge-prompt.md"), "utf8");
  return cachedTemplate;
}

export interface JudgeDeps {
  client: LlmClient;
  /** Override the prompt template (tests). Defaults to templates/judge-prompt.md. */
  template?: string;
}

function buildPrompt(template: string, rubric: string, transcript: string): string {
  return template.replace("{{rubric}}", rubric).replace("{{transcript}}", transcript);
}

/** Extract the first balanced-looking JSON object from a model reply. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(text.slice(start, end + 1));
}

function coerceVerdict(v: unknown): Verdict | null {
  return typeof v === "string" && (JUDGE_VERDICTS as readonly string[]).includes(v) ? (v as Verdict) : null;
}

/**
 * Recover the verdict from a malformed reply. A verbatim transcript quote with an
 * inner `"` breaks JSON.parse, but the verdict token (a fixed enum) is still
 * regex-recoverable. Verdict is the load-bearing field; evidence/reasoning are
 * sacrificed in this path. Returns null only when even the verdict is absent.
 */
export function salvageVerdict(text: string): Verdict | null {
  const m = /"verdict"\s*:\s*"(pass|fail|partial|not-assessable)"/.exec(text);
  return m ? (m[1] as Verdict) : null;
}

function finalizeVerdict(
  cp: Checkpoint,
  verdict: Verdict,
  evidence: string | undefined,
  reasoning: string | undefined,
  assistantText: string
): CheckResult {
  // Evidence-grounding: a pass MUST quote the assistant's response verbatim, else
  // drop the quote (spec: Verdict evidence is rooted in the transcript). Grounded
  // against assistant text only — a quote from the user turn or a tool-call line
  // is not evidence of assistant behaviour.
  if (verdict === "pass" && evidence && !assistantText.includes(evidence)) {
    return {
      id: cp.id,
      type: "judge",
      verdict: "pass",
      reasoning: `${reasoning ?? ""} (warning: judge evidence not found verbatim in transcript)`.trim(),
    };
  }
  return { id: cp.id, type: "judge", verdict, evidence, reasoning, rubric: cp.rubric };
}

export async function checkJudge(
  cp: Checkpoint,
  transcript: Transcript,
  probe: Probe,
  deps: JudgeDeps
): Promise<CheckResult> {
  const na = notAssessableReason(cp, probe);
  if (na) return { id: cp.id, type: "judge", verdict: "not-assessable", reasoning: na };

  const template = deps.template ?? loadJudgeTemplate();
  const transcriptText = judgeTranscriptText(transcript);
  const assistantText = fullAssistantText(transcript);
  const user = buildPrompt(template, cp.rubric ?? "(no rubric)", transcriptText);

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = attempt === 0 ? "" : "\n\nYour previous reply was not valid JSON. Reply with the JSON object ONLY.";
    let reply: string;
    try {
      reply = (await deps.client.complete(SYSTEM, user + suffix)).text;
    } catch (err) {
      return { id: cp.id, type: "judge", verdict: "error", reasoning: `judge call failed: ${(err as Error).message}` };
    }

    // Happy path: clean JSON with a valid verdict.
    try {
      const parsed = extractJson(reply) as { verdict?: unknown; evidence?: unknown; reasoning?: unknown };
      const verdict = coerceVerdict(parsed.verdict);
      if (verdict) {
        const evidence = typeof parsed.evidence === "string" ? parsed.evidence : undefined;
        const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
        return finalizeVerdict(cp, verdict, evidence, reasoning, assistantText);
      }
      lastErr = `invalid verdict ${JSON.stringify(parsed.verdict)}`;
    } catch (err) {
      lastErr = (err as Error).message;
    }

    // Salvage path: recover the verdict from malformed JSON (e.g. an inner quote in
    // the evidence string). Only retry if even the verdict is unrecoverable.
    const salvaged = salvageVerdict(reply);
    if (salvaged) {
      return finalizeVerdict(
        cp,
        salvaged,
        undefined,
        "(recovered from malformed JSON; evidence dropped)",
        assistantText
      );
    }
  }
  return { id: cp.id, type: "judge", verdict: "error", reasoning: `judge_error: unparseable reply (${lastErr})` };
}
