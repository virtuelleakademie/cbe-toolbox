import { describe, expect, it } from "vitest";
import {
  AssistantTextBoundary,
  stripTerminalAssistantControlTokens,
  TERMINAL_ASSISTANT_CONTROL_TOKENS,
} from "../src/main/assistant-text-boundary.js";

function collect(chunks: readonly string[]): { beforeFinish: string; final: string } {
  const boundary = new AssistantTextBoundary();
  let text = "";
  for (const chunk of chunks) text += boundary.push(chunk);
  return { beforeFinish: text, final: text + boundary.finish() };
}

describe("Scenario: A split terminal control marker never enters app-owned assistant text", () => {
  it.each(TERMINAL_ASSISTANT_CONTROL_TOKENS)("strips %s at every possible delta split", (token) => {
    for (let split = 0; split <= token.length; split += 1) {
      const result = collect([`Answer.${token.slice(0, split)}`, token.slice(split)]);
      expect(result.beforeFinish, `${token} leaked before finish at split ${split}`).toBe("Answer.");
      expect(result.final, `${token} survived finish at split ${split}`).toBe("Answer.");
    }
  });

  it("strips consecutive registered terminators and their trailing whitespace as one protocol suffix", () => {
    const result = collect(["Answer.<turn", "|> \n<|im_", "end|>\n"]);
    expect(result.beforeFinish).toBe("Answer.");
    expect(result.final).toBe("Answer.");
  });

  it("releases an incomplete candidate when the stream ends without message_end", () => {
    expect(collect(["Answer.<tu"]).final).toBe("Answer.<tu");
  });
});

describe("Scenario: Content-like and unknown terminal text is preserved", () => {
  it("preserves a registered marker when substantive text follows it", () => {
    expect(collect(["The token is <turn|>", " in Gemma 4."]).final).toBe("The token is <turn|> in Gemma 4.");
  });

  it("preserves unknown angle-bracket markup at the message boundary", () => {
    expect(collect(["Keep <course_summary>"]).final).toBe("Keep <course_summary>");
    expect(stripTerminalAssistantControlTokens("Keep <course_summary>")).toBe("Keep <course_summary>");
  });

  it("strips only a complete registered suffix from completed-message text", () => {
    expect(stripTerminalAssistantControlTokens("Answer.<turn|>")).toBe("Answer.");
    expect(stripTerminalAssistantControlTokens("Answer.<turn|> explanation")).toBe("Answer.<turn|> explanation");
    expect(stripTerminalAssistantControlTokens("Answer.<tu")).toBe("Answer.<tu");
  });
});
