import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { URL } from "node:url";

function sse(response, chunks) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function chunk(choice, usage) {
  return {
    id: "cbe-documentation-fixture",
    object: "chat.completion.chunk",
    created: 1793102400,
    model: "documentation-fixture-model",
    choices: [choice],
    ...(usage ? { usage } : {}),
  };
}

function textReply(response, text) {
  sse(response, [
    chunk({ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }),
    chunk(
      { index: 0, delta: {}, finish_reason: "stop" },
      { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 }
    ),
  ]);
}

function toolReply(response, calls) {
  sse(response, [
    chunk({
      index: 0,
      delta: {
        role: "assistant",
        content: null,
        tool_calls: calls.map((call, index) => ({
          index,
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      },
      finish_reason: null,
    }),
    chunk(
      { index: 0, delta: {}, finish_reason: "tool_calls" },
      { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 }
    ),
  ]);
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map((part) => (typeof part === "string" ? part : part?.type === "text" ? (part.text ?? "") : ""))
    .join("\n");
}

function transcriptText(body) {
  return Array.isArray(body?.messages) ? body.messages.map(messageText).join("\n") : "";
}

export function latestUserText(body) {
  if (!Array.isArray(body?.messages)) return "";
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = body.messages[index];
    if (message?.role === "user") return messageText(message);
  }
  return "";
}

function hasLatestToolResult(body, name) {
  if (!Array.isArray(body?.messages) || body.messages.length === 0) return false;
  const latest = body.messages.at(-1);
  return latest?.role === "tool" && (!name || latest.name === name);
}

export function hasToolResultForCall(body, callId) {
  if (!Array.isArray(body?.messages)) return false;
  const emitted = body.messages.some(
    (message) =>
      message?.role === "assistant" &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.some((call) => call?.id === callId)
  );
  const returned = body.messages.some((message) => message?.role === "tool" && message.tool_call_id === callId);
  return emitted && returned;
}

export function toolResultTextForCall(body, callId) {
  if (!Array.isArray(body?.messages)) return "";
  const result = body.messages.find((message) => message?.role === "tool" && message.tool_call_id === callId);
  return messageText(result);
}

export function hasUnansweredToolResultForCall(body, callId) {
  if (!hasToolResultForCall(body, callId)) return false;
  const resultIndex = body.messages.findLastIndex(
    (message) => message?.role === "tool" && message.tool_call_id === callId
  );
  return !body.messages
    .slice(resultIndex + 1)
    .some(
      (message) =>
        message?.role === "assistant" &&
        (messageText(message).trim().length > 0 || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0))
    );
}

export function isAtomizationRequest(body) {
  const toolNames = Array.isArray(body?.tools) ? body.tools.map((tool) => tool?.function?.name).filter(Boolean) : [];
  return toolNames.includes("write") && !toolNames.includes("cbe_canvas");
}

export function latestAtomizationRawPath(body) {
  const prompt = latestUserText(body);
  return /(?:^|[\s`])(?:\.\/)?(raw\/[a-z0-9._/-]+\.md)(?:[\s`]|$)/i.exec(prompt)?.[1] ?? null;
}

export function createAtomizationStateMachine() {
  return {
    classify(body) {
      if (!isAtomizationRequest(body)) return "not-atomization";
      const rawPath = latestAtomizationRawPath(body);
      // Pi 1.3 may append provider bookkeeping after the tool-result message, so
      // the actual call/result pair — not the latest role — identifies follow-up.
      if (rawPath === "raw/studio-brief.md" && hasToolResultForCall(body, "docs-write-index")) {
        return "finish-first";
      }
      if (rawPath === "raw/studio-brief.md" && hasToolResultForCall(body, "docs-write-atom")) {
        return "emit-index-write";
      }
      if (rawPath === "raw/studio-brief.md") return "emit-atom-write";
      if (rawPath === "raw/timetable.md") return "hold-independent";
      return "unknown-atomization";
    },
  };
}

const copy = {
  en: {
    pickerQuestion: "Which part should we examine next?",
    pickerOptions: [
      { id: "assessment-evidence", label: "Assessment evidence" },
      { id: "stakeholder-role", label: "Stakeholder role" },
      { id: "reflection-loop", label: "Reflection loop" },
    ],
    other: "Other — I will describe it",
    supportSaved:
      "Your lasting support preference is now concise. This changes how much guidance I offer across Courses; it does not decide or formulate course content for you.",
    citationLead: "The Engage phase turns an essential question into a concrete, actionable challenge:",
    generic:
      "This is deterministic synthetic documentation fixture content, produced by the loopback provider rather than a live model.",
  },
  de: {
    pickerQuestion: "Welchen Teil sollen wir als Nächstes prüfen?",
    pickerOptions: [
      { id: "assessment-evidence", label: "Evidenz im Assessment" },
      { id: "stakeholder-role", label: "Rolle der Stakeholder" },
      { id: "reflection-loop", label: "Reflexionsschleife" },
    ],
    other: "Andere — ich beschreibe es",
    supportSaved:
      "Ihre dauerhafte Unterstützungspräferenz ist jetzt knapp. Das verändert die angebotene Anleitung über Courses hinweg; es entscheidet oder formuliert keine Kursinhalte für Sie.",
    citationLead: "Die Engage-Phase macht aus einer wesentlichen Frage eine konkrete, handlungsorientierte Challenge:",
    generic:
      "Dies ist deterministischer synthetischer Dokumentationsinhalt des Loopback-Providers und keine Antwort eines Live-Modells.",
  },
};

export async function startScriptedProvider({ locale, port = 47891 }) {
  const language = copy[locale] ?? copy.en;
  const requests = [];
  const acceptedConnections = [];
  const unknownRoutes = [];
  const decisions = [];
  const holds = new Set();
  const atomizationState = createAtomizationStateMachine();

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    acceptedConnections.push(`${request.method} ${url.pathname}`);

    if (request.method === "GET" && url.pathname === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "documentation-fixture-model", object: "model" }] }));
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      unknownRoutes.push(`${request.method} ${url.pathname}`);
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "unknown documentation fixture route" } }));
      return;
    }

    let raw = "";
    request.on("data", (part) => {
      raw += String(part);
    });
    request.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        unknownRoutes.push("unparseable OpenAI request");
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid fixture JSON" } }));
        return;
      }
      requests.push(body);
      if (process.env.CBE_DOCS_WIRE_DUMP) {
        writeFileSync(process.env.CBE_DOCS_WIRE_DUMP, JSON.stringify(requests, null, 2) + "\n");
      }
      const text = transcriptText(body);
      const latestUser = latestUserText(body);
      const atomizationDecision = atomizationState.classify(body);

      if (atomizationDecision === "finish-first") {
        decisions.push({ request: requests.length, action: "atomization-final" });
        textReply(response, "Done.");
        return;
      }
      if (atomizationDecision !== "not-atomization") {
        if (atomizationDecision === "emit-atom-write") {
          decisions.push({ request: requests.length, action: "emit-docs-write-atom" });
          const atom = [
            "---",
            "type: concept",
            "aliases: [studio brief]",
            "sources:",
            '  - title: "Synthetic documentation material"',
            '    ingested: "2026-10-27"',
            "raw:",
            "  - raw/studio-brief.md",
            "related: []",
            "confidence: high",
            "updated: 2026-10-27",
            "---",
            "",
            "# Studio brief",
            "",
            "Synthetic fixture atom created through the production ingestion route.",
            "",
          ].join("\n");
          toolReply(response, [
            {
              id: "docs-write-atom",
              name: "write",
              arguments: { path: "wiki/concept/studio-brief.md", content: atom },
            },
          ]);
        } else if (atomizationDecision === "emit-index-write") {
          decisions.push({ request: requests.length, action: "emit-docs-write-index" });
          const index = [
            "# Course wiki",
            "",
            "## Concepts",
            "",
            "- [[concept/peak-demand-studio]]",
            "- [[concept/reflection-loop]]",
            "- [[concept/studio-brief]]",
            "",
          ].join("\n");
          toolReply(response, [
            {
              id: "docs-write-index",
              name: "write",
              arguments: { path: "wiki/index.md", content: index },
            },
          ]);
        } else if (atomizationDecision === "hold-independent") {
          decisions.push({ request: requests.length, action: "hold-timetable-atomization" });
          holds.add(response);
          response.on("close", () => holds.delete(response));
        } else {
          unknownRoutes.push(`unknown atomization fixture: ${latestAtomizationRawPath(body) ?? "no raw path"}`);
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "unknown atomization fixture" } }));
        }
        return;
      }

      if (hasUnansweredToolResultForCall(body, "docs-cite")) {
        const token =
          /\(corpus:methodology-001 § Phase 1: Engage, Nichols, M\., Cator, K\., and Torres, M\. 2016\)/.exec(
            toolResultTextForCall(body, "docs-cite")
          )?.[0];
        if (!token) {
          unknownRoutes.push("cbe_cite did not return the expected verified fixture token");
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "invalid citation fixture result" } }));
          return;
        }
        decisions.push({ request: requests.length, action: "emit-verified-citation" });
        textReply(response, `${language.citationLead} ${token}`);
        return;
      }

      if (hasLatestToolResult(body)) {
        if (text.includes("Support preference saved")) textReply(response, language.supportSaved);
        else textReply(response, "Done.");
        return;
      }

      if (
        latestUser.includes("DOCS-CITATION") ||
        latestUser.includes("verified corpus citation for the documentation example") ||
        latestUser.includes("geprüftes Corpus-Zitat für das Dokumentationsbeispiel")
      ) {
        decisions.push({ request: requests.length, action: "emit-cbe-cite" });
        toolReply(response, [
          {
            id: "docs-cite",
            name: "cbe_cite",
            arguments: {
              id: "methodology-001",
              section: "Phase 1: Engage",
              claim: "The Engage phase turns an essential question into a concrete, actionable challenge.",
            },
          },
        ]);
        return;
      }

      if (
        latestUser.includes("DOCS-WORKING") ||
        latestUser.includes("synthetic documentation answer open") ||
        latestUser.includes("synthetische Dokumentationsantwort offen")
      ) {
        decisions.push({ request: requests.length, action: "hold-working-answer" });
        holds.add(response);
        response.on("close", () => holds.delete(response));
        return;
      }

      if (
        latestUser.includes("DOCS-PICKER") ||
        latestUser.includes("closed choice for the documentation fixture") ||
        latestUser.includes("geschlossene Wahl für das Dokumentationsbeispiel")
      ) {
        decisions.push({ request: requests.length, action: "emit-cbe-picker" });
        toolReply(response, [
          {
            id: "docs-picker",
            name: "cbe_picker",
            arguments: {
              question: language.pickerQuestion,
              options: language.pickerOptions,
              multiSelect: false,
              otherEnabled: true,
              otherLabel: language.other,
              required: true,
            },
          },
        ]);
        return;
      }

      if (
        latestUser.includes("DOCS-SUPPORT") ||
        latestUser.includes("lasting support preference to concise") ||
        latestUser.includes("dauerhafte Unterstützungspräferenz auf knapp")
      ) {
        toolReply(response, [
          {
            id: "docs-support",
            name: "cbe_support",
            arguments: { operation: "set", preference: "concise", expectedRevision: 1 },
          },
        ]);
        return;
      }

      textReply(response, language.generic);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : 0;

  return {
    baseURL: `http://127.0.0.1:${boundPort}/v1`,
    requests,
    decisions,
    acceptedConnections,
    unknownRoutes,
    get heldCount() {
      return holds.size;
    },
    releaseHolds() {
      for (const response of holds) textReply(response, language.generic);
      holds.clear();
    },
    async close() {
      for (const response of holds) response.destroy();
      holds.clear();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
