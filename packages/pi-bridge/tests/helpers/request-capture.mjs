/**
 * Wire-level request capture for the request-parity contract (capability
 * `agent-harness`, Requirement: *Accepted Pi 1.3 Runtime Semantics Are Explicit
 * Contracts*; change `adopt-settled-pi-runtime-lifecycle`).
 *
 * Starts a REAL `startCbeSession` against a local OpenAI-compatible mock server,
 * sends one lecturer prompt and returns the `/chat/completions` request body the
 * provider actually received, normalized so it can be compared across runs:
 * temporary directories become `<ROOT>`, the repository becomes `<REPO>`, the
 * prompt's date becomes `<DATE>`.
 *
 * Plain ESM on purpose: the SAME module generated the golden in
 * `tests/fixtures/pi-request-parity/` from the pre-upgrade bridge (HEAD built
 * against Pi 0.75.5, `startCbeSession` passed in), and the parity test runs it
 * against the current bridge. One capture, two runtimes.
 */
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** One canned SSE completion: a short assistant answer with usage. */
function answer(res) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  chunk({
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "parity-model",
    choices: [{ index: 0, delta: { role: "assistant", content: "Ok." }, finish_reason: null }],
  });
  chunk({
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "parity-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

function localDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Start the mock provider; returns its port, the captured bodies and a close. */
async function startMock() {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      bodies.push(body);
      answer(res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, bodies, close: () => server.close() };
}

function normalize(body, root, repo) {
  const date = localDate(new Date());
  return JSON.parse(
    body
      .split(root)
      .join("<ROOT>")
      .split(repo)
      .join("<REPO>")
      .split(`Current date: ${date}`)
      .join("Current date: <DATE>")
  );
}

/**
 * The first request of one wiki atomization run (the isolated ingest policy).
 * @param {{ createPiAtomizationSessionFactory: Function, repo: string }} opts
 */
export async function captureAtomizationRequest(opts) {
  const mock = await startMock();
  const root = mkdtempSync(path.join(tmpdir(), "cbe-parity-"));
  const courseDir = path.join(root, "course");
  const wikiDir = path.join(courseDir, "wiki");
  mkdirSync(wikiDir, { recursive: true });
  try {
    const factory = opts.createPiAtomizationSessionFactory({
      courseDir,
      wikiDir,
      wikiSkillDir: path.join(opts.repo, "skills", "wiki"),
      agentDir: path.join(root, "agent"),
      provider: { baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: "parity-key", modelId: "parity-model" },
    });
    const session = await factory({ rawRelPath: "raw/doc.md" });
    await session.run("Atomize raw/doc.md");
    session.dispose();
    if (mock.bodies.length === 0) throw new Error("request capture: the provider received no request");
    return normalize(mock.bodies[0], root, opts.repo);
  } finally {
    mock.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * @param {{ startCbeSession: Function, repo: string, reasoning?: boolean, resume?: { turns: Array<{ role: string, text: string }> }, prepare?: (dirs: { root: string, cwd: string, agentDir: string }) => void }} opts
 * @returns {Promise<Record<string, unknown>>} the normalized request body
 */
export async function captureFirstRequest(opts) {
  const mock = await startMock();
  const root = mkdtempSync(path.join(tmpdir(), "cbe-parity-"));
  const cwd = path.join(root, "workspace");
  mkdirSync(cwd, { recursive: true });
  opts.prepare?.({ root, cwd, agentDir: path.join(root, "agent") });
  try {
    const started = await opts.startCbeSession({
      profile: "app",
      skillDir: path.join(opts.repo, "skills", "cbe"),
      sessionsDir: path.join(root, "sessions"),
      sessionId: "parity-session",
      agentDir: path.join(root, "agent"),
      cwd,
      writableRoots: { dirs: [cwd] },
      ...(opts.resume ? { resume: opts.resume } : {}),
      provider: {
        baseURL: `http://127.0.0.1:${mock.port}/v1`,
        apiKey: "parity-key",
        modelId: "parity-model",
        ...(opts.reasoning ? { reasoning: true, reasoningEffort: "medium" } : {}),
      },
    });
    await started.session.prompt("Hallo");
    started.session.dispose();
    if (mock.bodies.length === 0) throw new Error("request capture: the provider received no request");
    return normalize(mock.bodies[0], root, opts.repo);
  } finally {
    mock.close();
    rmSync(root, { recursive: true, force: true });
  }
}
