import { describe, it, expect, vi } from "vitest";
import { createClaudeCliClient, type CliRunResult } from "../src/judge-claude-cli.js";
import { ProviderError } from "../src/judge-client.js";

function runner(result: Partial<CliRunResult>) {
  return vi.fn(
    async (_args: string[], _input: string): Promise<CliRunResult> => ({
      code: 0,
      stdout: "",
      stderr: "",
      ...result,
    })
  );
}

describe("claude CLI judge client", () => {
  it("parses the --output-format json envelope into text + token usage", async () => {
    const run = runner({ stdout: JSON.stringify({ result: '{"verdict":"pass"}', usage: { output_tokens: 42 } }) });
    const client = createClaudeCliClient({ model: "sonnet", run });
    const out = await client.complete("SYS", "USER");
    expect(out.text).toBe('{"verdict":"pass"}');
    expect(client.tokensUsed).toBe(42);
  });

  it("passes -p --output-format json and --model, and pipes system+user via stdin", async () => {
    const run = runner({ stdout: JSON.stringify({ result: "ok" }) });
    const client = createClaudeCliClient({ model: "opus", run });
    await client.complete("SYS", "USER");
    const [args, input] = run.mock.calls[0]!;
    expect(args).toEqual(["-p", "--output-format", "json", "--model", "opus"]);
    expect(input).toBe("SYS\n\nUSER");
  });

  it("falls back to raw stdout when the reply is not the JSON envelope", async () => {
    const run = runner({ stdout: "plain text verdict" });
    const client = createClaudeCliClient({ run });
    const out = await client.complete("S", "U");
    expect(out.text).toBe("plain text verdict");
    expect(client.tokensUsed).toBeGreaterThan(0); // estimated from text length
  });

  it("throws ProviderError on a non-zero exit", async () => {
    const run = runner({ code: 1, stderr: "not logged in" });
    const client = createClaudeCliClient({ run });
    await expect(client.complete("S", "U")).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws ProviderError when the envelope reports is_error", async () => {
    const run = runner({ stdout: JSON.stringify({ is_error: true, result: "model overloaded" }) });
    const client = createClaudeCliClient({ run });
    await expect(client.complete("S", "U")).rejects.toThrow(/model overloaded/);
  });

  it("throws ProviderError when the binary cannot be spawned", async () => {
    const run = vi.fn(async () => {
      throw new Error("spawn claude ENOENT");
    });
    const client = createClaudeCliClient({ run });
    await expect(client.complete("S", "U")).rejects.toBeInstanceOf(ProviderError);
  });
});
