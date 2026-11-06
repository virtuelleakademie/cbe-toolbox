/**
 * Judge/editor backend that delegates to the local `claude` CLI in headless
 * print mode (`claude -p --output-format json`). Lets Claude Code itself act as
 * the judge — no judge API endpoint or key required, just an authed `claude` CLI.
 *
 * The candidate (model under test) is unaffected: it is still driven by the
 * runner against its own provider. Only the scoring side runs through Claude.
 *
 * Isolation: spawned with cwd = a temp dir so the project's CLAUDE.md / skills /
 * MCP config do not leak into the judge's context. The spawn runner is injectable
 * so tests never shell out.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import { ProviderError, estimateTokens, type LlmClient, type LlmCompletion } from "./judge-client.js";

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CliRunner = (args: string[], input: string) => Promise<CliRunResult>;

export interface ClaudeCliOptions {
  /** Maps to `claude --model` (e.g. "sonnet", "opus", or a full model id). */
  model?: string;
  /** Extra args appended to the claude invocation. */
  extraArgs?: string[];
  /** Injectable spawn runner; defaults to spawning the real `claude` binary. */
  run?: CliRunner;
}

const defaultRun: CliRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: os.tmpdir() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });

export function createClaudeCliClient(opts: ClaudeCliOptions = {}): LlmClient {
  const run = opts.run ?? defaultRun;
  const modelId = opts.model ?? "claude-cli-default";
  let tokensUsed = 0;

  return {
    modelId,
    get tokensUsed() {
      return tokensUsed;
    },
    async complete(system: string, user: string): Promise<LlmCompletion> {
      const args = ["-p", "--output-format", "json"];
      if (opts.model) args.push("--model", opts.model);
      if (opts.extraArgs) args.push(...opts.extraArgs);
      const input = `${system}\n\n${user}`;

      let res: CliRunResult;
      try {
        res = await run(args, input);
      } catch (err) {
        throw new ProviderError(`claude CLI could not be spawned: ${(err as Error).message}`);
      }
      if (res.code !== 0) {
        throw new ProviderError(`claude CLI exited ${res.code}: ${res.stderr.slice(0, 300)}`, res.code);
      }

      // `--output-format json` wraps the reply: { result, usage, is_error, ... }.
      // Fall back to raw stdout if the envelope is absent (e.g. text output).
      let text = res.stdout.trim();
      let outputTokens: number | undefined;
      try {
        const env = JSON.parse(res.stdout) as {
          result?: string;
          is_error?: boolean;
          usage?: { output_tokens?: number; input_tokens?: number };
        };
        if (env.is_error) throw new ProviderError(`claude CLI reported an error: ${env.result ?? "unknown"}`);
        if (typeof env.result === "string") text = env.result;
        outputTokens = env.usage?.output_tokens;
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        // not JSON — keep raw stdout as text
      }
      tokensUsed += outputTokens ?? estimateTokens(text);
      return { text, usage: { outputTokens } };
    },
  };
}
