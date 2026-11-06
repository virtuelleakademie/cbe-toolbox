/**
 * Deterministic provider script for ADAPTER-LEVEL tests (change
 * `isolate-pi-behind-cbe-runtime`). Pi-aware on purpose: it lives beside the
 * adapter tests that are allowed to see Pi, never in a product test.
 *
 * It reaches the request path through Pi's PUBLIC API-provider registry only
 * (Pi 1.3, change `adopt-settled-pi-runtime-lifecycle`): `registerApiProvider`
 * from `@earendil-works/pi-ai/compat` installs the script as the stream
 * implementation of the `openai-completions` API. The production `byo-llm`
 * provider has no native implementation of its own, so its session's
 * `ModelRuntime` resolves that API from this registry — a session built by the
 * real `startCbeSession` / atomization factory, with its real provider
 * registration, routes every model call through the script, and no private
 * field (`session.agent.streamFn`) is touched. (Pi 1.x no longer lets a
 * provider registered on a throwaway registry override other runtimes, which is
 * what the 0.75.5 version of this helper relied on.)
 *
 * It is the ONE deterministic model seam of the contract harness (change
 * `guard-pi-upgrades-with-contract-tests`): scripts carry text, thinking, tool
 * calls, provider errors, usage, stop reasons and controlled delays — nothing
 * else. Real Pi stays responsible for prompts, tools, retries, compaction,
 * queues, persistence and events; the script never decides any of them.
 *
 * The override is module state of Pi's api registry, and vitest isolates module
 * state per test file, so it never leaks into another file. `uninstall()`
 * restores Pi's built-in implementations; call it in `afterEach` anyway so the
 * cases inside one file stay independent.
 */
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { registerApiProvider, resetApiProviders } from "@earendil-works/pi-ai/compat";

export type ScriptBlock =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "toolCall"; id: string; name: string; args: Record<string, unknown> };

export interface ScriptResponse {
  blocks: ScriptBlock[];
  /** Default `"stop"`, or `"toolUse"` when the response carries a tool call. */
  stopReason?: "stop" | "length" | "toolUse" | "error";
  errorMessage?: string;
  /** Usage reported for the response — drives Pi's compaction threshold. */
  inputTokens?: number;
  /** Hold the response open until the request is aborted, then end it aborted. */
  waitForAbort?: boolean;
  /** Report all-zero usage, as servers that omit streaming usage do. */
  noUsage?: boolean;
  /** Output tokens reported for the response (default 5). */
  outputTokens?: number;
  /** Wait this many milliseconds before the response's first event. */
  delayMs?: number;
  /** Hold the response open after its last content block until this promise
   * settles, then finish it normally — a controlled delay the test releases. */
  holdUntil?: Promise<unknown>;
}

export interface ScriptRequest {
  systemPrompt: string | undefined;
  /** The text of every user message in the request context, in order. */
  userTexts: string[];
  modelId: string;
  provider: string;
  /** The tool names the request offered the model, sorted. */
  toolNames: string[];
}

export interface ScriptedProvider {
  /** Requests the script has served, in order. */
  readonly requests: ScriptRequest[];
  /** Queue further responses. */
  push(...responses: ScriptResponse[]): void;
  /** Answer requests whose user text matches `predicate` from this queue first
   * (compaction summaries are requested through the same API). */
  routeWhen(predicate: (request: ScriptRequest) => boolean, response: ScriptResponse): void;
  uninstall(): void;
}

const SCRIPT_PROVIDER = "cbe-test-script";

function userTextsOf(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const out: string[] = [];
  for (const m of messages as Array<{ role?: string; content?: unknown }>) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") out.push(m.content);
    else if (Array.isArray(m.content)) {
      out.push(
        (m.content as Array<{ type?: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      );
    }
  }
  return out;
}

export function installScriptedProvider(): ScriptedProvider {
  const queue: ScriptResponse[] = [];
  const routes: Array<{ predicate: (r: ScriptRequest) => boolean; response: ScriptResponse }> = [];
  const requests: ScriptRequest[] = [];

  const streamSimple = (
    model: { id: string; provider: string; api: string },
    context: { messages?: unknown; tools?: Array<{ name: string }> },
    options?: { signal?: AbortSignal }
  ) => {
    // Pi 1.x carries the system prompt and the declared tools as transcript
    // system messages; read them as the provider would.
    const messages = (Array.isArray(context.messages) ? context.messages : []) as never;
    const declared = getCurrentTools(messages);
    const request: ScriptRequest = {
      systemPrompt: getCurrentSystemPrompt(messages) || undefined,
      userTexts: userTextsOf(context.messages),
      modelId: model.id,
      provider: model.provider,
      toolNames: (declared.length > 0 ? declared : (context.tools ?? [])).map((t) => t.name).sort(),
    };
    requests.push(request);
    const routeIndex = routes.findIndex((r) => r.predicate(request));
    const response = routeIndex >= 0 ? routes.splice(routeIndex, 1)[0]!.response : queue.shift();
    if (!response) throw new Error("scripted provider: ran out of scripted responses");

    const stream = createAssistantMessageEventStream();
    const input = response.noUsage ? 0 : (response.inputTokens ?? 10);
    const output = response.noUsage ? 0 : (response.outputTokens ?? 5);
    const base = {
      role: "assistant" as const,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input,
        output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input + output,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 0,
    };
    const content: unknown[] = [];
    const partial = () => ({ ...base, content: [...content], stopReason: "stop" });

    const run = async () => {
      if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
      stream.push({ type: "start", partial: partial() } as never);
      for (const block of response.blocks) {
        const index = content.length;
        if (block.kind === "thinking") {
          content.push({ type: "thinking", thinking: "" });
          stream.push({ type: "thinking_start", contentIndex: index, partial: partial() } as never);
          content[index] = { type: "thinking", thinking: block.text };
          stream.push({ type: "thinking_delta", contentIndex: index, delta: block.text, partial: partial() } as never);
          stream.push({ type: "thinking_end", contentIndex: index, content: block.text, partial: partial() } as never);
        } else if (block.kind === "text") {
          content.push({ type: "text", text: "" });
          stream.push({ type: "text_start", contentIndex: index, partial: partial() } as never);
          content[index] = { type: "text", text: block.text };
          stream.push({ type: "text_delta", contentIndex: index, delta: block.text, partial: partial() } as never);
          stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: partial() } as never);
        } else {
          const toolCall = { type: "toolCall", id: block.id, name: block.name, arguments: block.args };
          content.push(toolCall);
          stream.push({ type: "toolcall_start", contentIndex: index, partial: partial() } as never);
          stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: partial() } as never);
        }
      }
      if (response.waitForAbort) {
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) return resolve();
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        const aborted = { ...base, content: [...content], stopReason: "aborted", errorMessage: "Request was aborted" };
        stream.push({ type: "error", reason: "aborted", error: aborted } as never);
        stream.end(aborted as never);
        return;
      }
      if (response.holdUntil) await response.holdUntil;
      const stopReason =
        response.stopReason ?? (response.blocks.some((b) => b.kind === "toolCall") ? "toolUse" : "stop");
      const final = {
        ...base,
        content: [...content],
        stopReason,
        ...(response.errorMessage ? { errorMessage: response.errorMessage } : {}),
      };
      if (stopReason === "error") stream.push({ type: "error", reason: "error", error: final } as never);
      else stream.push({ type: "done", reason: stopReason, message: final } as never);
      stream.end(final as never);
    };
    void run();
    return stream as never;
  };

  registerApiProvider(
    { api: "openai-completions", stream: streamSimple as never, streamSimple: streamSimple as never },
    SCRIPT_PROVIDER
  );

  return {
    requests,
    push: (...responses) => queue.push(...responses),
    routeWhen: (predicate, response) => routes.push({ predicate, response }),
    uninstall: () => {
      queue.length = 0;
      routes.length = 0;
      resetApiProviders();
    },
  };
}
