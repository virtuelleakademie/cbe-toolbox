/**
 * A programmable local OpenAI-compatible `/chat/completions` server for
 * wire-level runtime contracts (change `adopt-settled-pi-runtime-lifecycle`).
 *
 * Unlike `scripted-provider.ts`, which replaces the API implementation, this
 * exercises Pi's REAL `openai-completions` client — HTTP status handling, the
 * provider retry policy, SSE parsing, tool-call argument parsing — exactly as a
 * lecturer's endpoint would. Each request takes the next queued reply.
 */
import http from "node:http";

export type MockReply =
  | { kind: "text"; text: string; finish?: string; promptTokens?: number; completionTokens?: number; noUsage?: boolean }
  | { kind: "toolCall"; id: string; name: string; rawArguments: string }
  | { kind: "status"; status: number; body: string };

export interface MockOpenAiServer {
  readonly baseURL: string;
  /** Raw request bodies received, parsed, in order. */
  readonly requests: Array<Record<string, unknown>>;
  push(...replies: MockReply[]): void;
  close(): Promise<void>;
}

function sse(res: http.ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const chunk = (choice: unknown, usage?: unknown) => ({
  id: "mock",
  object: "chat.completion.chunk",
  created: 0,
  model: "mock-model",
  choices: [choice],
  ...(usage ? { usage } : {}),
});

export async function startMockOpenAiServer(): Promise<MockOpenAiServer> {
  const queue: MockReply[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        requests.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        requests.push({ unparsable: body });
      }
      const reply = queue.shift();
      if (!reply) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock server: no reply queued" } }));
        return;
      }
      if (reply.kind === "status") {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body);
        return;
      }
      if (reply.kind === "toolCall") {
        sse(res, [
          chunk({
            index: 0,
            delta: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  index: 0,
                  id: reply.id,
                  type: "function",
                  function: { name: reply.name, arguments: reply.rawArguments },
                },
              ],
            },
            finish_reason: null,
          }),
          chunk(
            { index: 0, delta: {}, finish_reason: "tool_calls" },
            { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          ),
        ]);
        return;
      }
      const usage = reply.noUsage
        ? undefined
        : {
            prompt_tokens: reply.promptTokens ?? 10,
            completion_tokens: reply.completionTokens ?? 5,
            total_tokens: (reply.promptTokens ?? 10) + (reply.completionTokens ?? 5),
          };
      sse(res, [
        chunk({ index: 0, delta: { role: "assistant", content: reply.text }, finish_reason: null }),
        chunk({ index: 0, delta: {}, finish_reason: reply.finish ?? "stop" }, usage),
      ]);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    push: (...replies) => queue.push(...replies),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
