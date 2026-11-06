// Protocol framing that OpenAI-compatible backends may incorrectly return in
// `choice.delta.content`. These are documented terminal markers from common chat
// template families (Gemma, ChatML, Llama and Harmony), never model identifiers.
// Keep this registry explicit: an angle-bracket-shaped string is not sufficient
// evidence that lecturer-facing content is protocol.
export const TERMINAL_ASSISTANT_CONTROL_TOKENS = [
  "<turn|>",
  "<end_of_turn>",
  "<|end_of_turn|>",
  "<|eot_id|>",
  "<|eom_id|>",
  "<|im_end|>",
  "<|end|>",
  "<|return|>",
  "<|endoftext|>",
  "<eos>",
] as const;

const TOKENS = [...TERMINAL_ASSISTANT_CONTROL_TOKENS].sort((a, b) => b.length - a.length);

/**
 * True while `value` can still become a suffix made exclusively from one or
 * more registered terminal markers and whitespace. Partial markers count: they
 * must stay withheld until the next delta proves whether they are protocol or
 * ordinary content.
 */
function isPotentialTerminalSequence(value: string): boolean {
  let rest = value;
  let sawCompleteToken = false;

  while (rest.length > 0) {
    if (sawCompleteToken) {
      rest = rest.replace(/^\s+/, "");
      if (rest.length === 0) return true;
    }

    const complete = TOKENS.find((token) => rest.startsWith(token));
    if (complete) {
      sawCompleteToken = true;
      rest = rest.slice(complete.length);
      continue;
    }

    return TOKENS.some((token) => token.startsWith(rest));
  }

  return sawCompleteToken;
}

function isCompleteTerminalSequence(value: string): boolean {
  let rest = value;
  let count = 0;

  while (rest.length > 0) {
    if (count > 0) {
      rest = rest.replace(/^\s+/, "");
      if (rest.length === 0) return true;
    }

    const complete = TOKENS.find((token) => rest.startsWith(token));
    if (!complete) return false;
    count += 1;
    rest = rest.slice(complete.length);
  }

  return count > 0;
}

function splitPotentialTerminalSuffix(value: string): { text: string; pending: string } {
  let start = value.indexOf("<");
  while (start !== -1) {
    const suffix = value.slice(start);
    if (isPotentialTerminalSequence(suffix)) {
      return { text: value.slice(0, start), pending: suffix };
    }
    start = value.indexOf("<", start + 1);
  }
  return { text: value, pending: "" };
}

/** Remove only a COMPLETE registered protocol suffix from completed text. */
export function stripTerminalAssistantControlTokens(text: string): string {
  const split = splitPotentialTerminalSuffix(text);
  return isCompleteTerminalSequence(split.pending) ? split.text : text;
}

/**
 * Streaming desktop-host boundary for assistant text.
 *
 * `push()` returns text that is already safe to expose. It withholds only the
 * smallest trailing fragment that can still become a registered protocol-only
 * suffix. `finish()` is called at the assistant-message boundary: a complete
 * protocol suffix is dropped, while an incomplete candidate is released byte
 * for byte. Input strings and Pi's event objects are never mutated.
 */
export class AssistantTextBoundary {
  private pending = "";

  push(delta: string): string {
    if (delta.length === 0) return "";
    const split = splitPotentialTerminalSuffix(this.pending + delta);
    this.pending = split.pending;
    return split.text;
  }

  finish(): string {
    const pending = this.pending;
    this.pending = "";
    return isCompleteTerminalSequence(pending) ? "" : pending;
  }
}
