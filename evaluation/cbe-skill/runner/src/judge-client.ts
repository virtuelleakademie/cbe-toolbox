/**
 * Minimal LLM client for the judge and editor calls. A thin fetch wrapper over
 * any OpenAI-compatible `/chat/completions` endpoint — no SDK dependency, mirrors
 * the BYO-LLM pattern the runner uses. Injectable so tests never hit the network.
 */

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmCompletion {
  text: string;
  usage?: LlmUsage;
}

export interface LlmClient {
  readonly modelId: string;
  /** Running total of output tokens seen (used for budget tracking). */
  readonly tokensUsed: number;
  complete(system: string, user: string): Promise<LlmCompletion>;
}

export interface LlmClientConfig {
  baseURL: string;
  apiKey: string;
  modelId: string;
  maxTokens?: number;
  temperature?: number;
}

export function createOpenAiClient(cfg: LlmClientConfig): LlmClient {
  let tokensUsed = 0;
  return {
    modelId: cfg.modelId,
    get tokensUsed() {
      return tokensUsed;
    },
    async complete(system: string, user: string): Promise<LlmCompletion> {
      const url = cfg.baseURL.replace(/\/$/, "") + "/chat/completions";
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.modelId,
          temperature: cfg.temperature ?? 0,
          max_tokens: cfg.maxTokens ?? 1024,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(`judge/editor provider returned ${res.status}: ${body.slice(0, 300)}`, res.status);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      const usage: LlmUsage = {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      };
      tokensUsed += usage.outputTokens ?? estimateTokens(text);
      return { text, usage };
    },
  };
}

/** Character-count heuristic when the provider omits a usage block. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
