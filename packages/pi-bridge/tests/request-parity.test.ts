/**
 * Model-free request-parity contract across the Pi 0.75.5 → 1.3.0 upgrade
 * (capability `agent-harness`, Requirement: *Accepted Pi 1.3 Runtime Semantics
 * Are Explicit Contracts*; change `adopt-settled-pi-runtime-lifecycle`, task 5.1).
 *
 * The golden bodies in `fixtures/pi-request-parity/` are the `/chat/completions`
 * requests the PRE-UPGRADE bridge (HEAD 71d05de built against Pi 0.75.5) sent
 * for one lecturer prompt in an app-profile session — once without and once
 * with reasoning — and for the first request of one wiki atomization run. They were captured by `helpers/request-capture.mjs`, and this
 * test runs the SAME capture against the current bridge.
 *
 * The comparison is exact except for ONE documented, accepted drift: Pi 1.3's
 * own tool serialisation. Everything else the model sees — the system message
 * (identity prompt, eager skill, environment descriptor, skills list, date and
 * cwd lines), the user message, every request parameter (no output-token cap,
 * `reasoning_effort`, `parallel_tool_calls`), the tool set, every tool's
 * description and every parameter description — must be byte-identical. A new
 * drift fails here instead of reaching a lecturer unmeasured.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startCbeSession } from "../src/session.js";
import { createPiAtomizationSessionFactory } from "../src/atomization-session.js";
import { captureAtomizationRequest, captureFirstRequest } from "./helpers/request-capture.mjs";

const REPO = path.resolve(__dirname, "..", "..", "..");
const FIXTURES = path.join(__dirname, "fixtures", "pi-request-parity");

type Json = Record<string, unknown>;
type Tool = { type: string; function: { name: string; description: string; parameters: Json; strict?: boolean } };

/**
 * The ACCEPTED Pi-owned tool-schema drift, measured 2026-10-18 and applied to
 * the golden. Exactly three facts, no more:
 *  1. Pi no longer sends `strict: false` on any tool (0.86/0.87 strict-schema
 *     handling: strict is only sent where the endpoint advertises support).
 *  2. Pi's built-in `read` description lists `bmp` among the image formats.
 *  3. Pi's built-in `edit` schema no longer carries `additionalProperties: false`
 *     (top level and per edit item).
 */
function applyAcceptedPiToolDrift(body: Json): Json {
  const next = structuredClone(body);
  for (const tool of next.tools as Tool[]) {
    delete tool.function.strict;
    if (tool.function.name === "read") {
      tool.function.description = tool.function.description.replace(
        "(jpg, png, gif, webp)",
        "(jpg, png, gif, webp, bmp)"
      );
    }
    if (tool.function.name === "edit") {
      const params = tool.function.parameters as Json & { properties: { edits: { items: Json } } };
      delete params.additionalProperties;
      delete params.properties.edits.items.additionalProperties;
    }
  }
  return next;
}

const golden = (name: string): Json => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as Json;

describe("Scenario: The model-visible request keeps its established shape", () => {
  for (const [label, file, reasoning] of [
    ["without reasoning", "request.json", false],
    ["with reasoning", "request-reasoning.json", true],
  ] as const) {
    it(`sends the pre-upgrade request ${label}, apart from the accepted Pi tool-schema drift`, async () => {
      const actual = (await captureFirstRequest({ startCbeSession, repo: REPO, reasoning })) as Json;
      expect(actual).toEqual(applyAcceptedPiToolDrift(golden(file)));
    }, 30_000);
  }

  it("sends the pre-upgrade request for a resumed conversation, apart from the accepted Pi tool-schema drift", async () => {
    // The same seeded turns the golden was captured with, including an empty
    // assistant turn: the history on the wire must be what 0.75.5 sent.
    const resume = {
      turns: [
        { role: "user", text: "Ich plane ein Modul." },
        { role: "assistant", text: "Gern — worum geht es?" },
        { role: "user", text: "Statistik." },
        { role: "assistant", text: "" },
        { role: "assistant", text: "Verstanden." },
      ],
    };
    const actual = (await captureFirstRequest({ startCbeSession, repo: REPO, resume })) as Json;
    expect(actual).toEqual(applyAcceptedPiToolDrift(golden("resume-request.json")));
  }, 30_000);

  it("sends the pre-upgrade atomization request, apart from the accepted Pi tool-schema drift", async () => {
    const actual = (await captureAtomizationRequest({ createPiAtomizationSessionFactory, repo: REPO })) as Json;
    expect(actual).toEqual(applyAcceptedPiToolDrift(golden("atomization-request.json")));
  }, 30_000);

  it("carries no output-token cap and keeps the established system text markers", async () => {
    const actual = (await captureFirstRequest({ startCbeSession, repo: REPO })) as Json;
    expect(actual).not.toHaveProperty("max_completion_tokens");
    expect(actual).not.toHaveProperty("max_tokens");
    const system = (actual.messages as Array<{ role: string; content: string }>)[0]!;
    expect(system.role).toBe("system");
    expect(system.content).toContain("\nCurrent date: <DATE>\nCurrent working directory: <ROOT>/workspace");
    for (const section of ["<addendum>", "<skills>", "<cwd>"]) expect(system.content).not.toContain(section);
  }, 30_000);

  it("the accepted drift is exactly what the golden differs by — no more, no less", () => {
    // Guard against the drift list itself rotting: every documented fact must
    // still change the golden, so a fixed-upstream drift is noticed and removed.
    const before = golden("request.json");
    const after = applyAcceptedPiToolDrift(before);
    const tools = (b: Json) => b.tools as Tool[];
    expect(tools(before).every((t) => t.function.strict === false)).toBe(true);
    expect(tools(after).some((t) => "strict" in t.function)).toBe(false);
    expect(tools(after).find((t) => t.function.name === "read")!.function.description).toContain("webp, bmp)");
    expect(JSON.stringify(tools(after).find((t) => t.function.name === "edit"))).not.toContain("additionalProperties");
    expect({ ...after, tools: [] }).toEqual({ ...before, tools: [] });
  });
});
