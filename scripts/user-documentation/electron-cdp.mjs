import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let nextDisplay = 2000 + (process.pid % 40_000);

export function electronPrerequisites({ repoRoot, fontPath }) {
  const electron = path.join(repoRoot, "node_modules", ".bin", "electron");
  const artifacts = [
    path.join(repoRoot, "packages", "app", "out", "main", "index.js"),
    path.join(repoRoot, "packages", "app", "out", "renderer", "index.html"),
    path.join(repoRoot, "packages", "pi-bridge", "dist", "index.js"),
  ];
  const missing = [];
  if (process.platform !== "linux") missing.push(`platform is ${process.platform}, not linux`);
  if (typeof globalThis.WebSocket !== "function")
    missing.push("Node global WebSocket is unavailable (Node >=22 required)");
  if (process.platform === "linux" && spawnSync("xvfb-run", ["--help"], { stdio: "ignore" }).error) {
    missing.push("xvfb-run is not on PATH");
  }
  if (!existsSync(electron)) missing.push(`Electron binary missing: ${electron}`);
  for (const artifact of artifacts) if (!existsSync(artifact)) missing.push(`build artifact missing: ${artifact}`);
  if (fontPath && !existsSync(fontPath)) missing.push(`fixture font missing: ${fontPath}`);
  return { missing, electron, artifacts };
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

export class Cdp {
  #nextId = 0;
  #pending = new Map();

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const waiter = this.#pending.get(message.id);
      if (!waiter) return;
      this.#pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const waiter of this.#pending.values()) waiter.reject(new Error("CDP socket closed"));
      this.#pending.clear();
    });
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

export async function poll(read, options = {}) {
  const { timeoutMs = 30_000, label = "Electron renderer" } =
    typeof options === "number" ? { timeoutMs: options } : options;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ""}`);
}

export async function connectCdp(port) {
  const target = await poll(
    async () => {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json`);
      if (!response.ok) return null;
      const pages = await response.json();
      return pages.find((page) => page.type === "page" && page.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? null;
    },
    { label: "CDP page target" }
  );
  const socket = new globalThis.WebSocket(target);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")), { once: true });
  });
  return new Cdp(socket);
}

export async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (!("value" in response.result)) {
    throw new Error(response.result.description ?? "CDP evaluation returned no value");
  }
  return response.result.value;
}

export async function waitForSelector(cdp, selector, options = {}) {
  const { present = true, timeoutMs = 30_000 } = typeof options === "boolean" ? { present: options } : options;
  return poll(
    async () => {
      const match = await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      return match === present ? true : null;
    },
    { timeoutMs, label: `${present ? "presence" : "absence"} of ${selector}` }
  );
}

function assertScratchRoot(scratchRoot) {
  const resolved = path.resolve(scratchRoot);
  const tmp = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(tmp) || !path.basename(resolved).startsWith("cbe-user-docs-")) {
    throw new Error(`Refusing non-isolated user-data root: ${resolved}`);
  }
  return resolved;
}

export async function launchElectron({ repoRoot, scratchRoot, entry, env = {}, readySelector = ".composer textarea" }) {
  const isolatedRoot = assertScratchRoot(scratchRoot);
  const marker = path.join(isolatedRoot, ".cbe-user-documentation-run.json");
  if (!existsSync(marker)) throw new Error(`Capture marker is missing: ${marker}`);
  const { missing, electron } = electronPrerequisites({ repoRoot });
  if (missing.length > 0) throw new Error(`Documentation screenshot prerequisites missing: ${missing.join("; ")}`);

  const port = await freePort();
  while (existsSync(`/tmp/.X${nextDisplay}-lock`)) nextDisplay += 1;
  const display = nextDisplay++;
  const authFile = path.join(isolatedRoot, `xvfb-${display}.auth`);
  const errorFile = path.join(isolatedRoot, `xvfb-${display}.log`);
  await writeFile(authFile, "", { mode: 0o600 });
  const childEnv = {
    ...process.env,
    ...env,
    TZ: "UTC",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    CBE_DOCS_RUN_ROOT: isolatedRoot,
    CBE_DOCS_RUN_MARKER: marker,
  };
  delete childEnv.DISPLAY;
  delete childEnv.XAUTHORITY;

  const child = spawn(
    "xvfb-run",
    [
      "--server-num",
      String(display),
      "--auth-file",
      authFile,
      "--error-file",
      errorFile,
      electron,
      entry,
      `--user-data-dir=${isolatedRoot}`,
      `--remote-debugging-port=${port}`,
      "--no-sandbox",
    ],
    { cwd: repoRoot, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    const cdp = await connectCdp(port);
    await cdp.send("Page.enable");
    await cdp.send("Accessibility.enable");
    await waitForSelector(cdp, readySelector);
    return { child, cdp, display, port, errorFile, stdout: () => stdout, stderr: () => stderr };
  } catch (error) {
    await stopElectron({ child }).catch(() => undefined);
    const xvfb = await readFile(errorFile, "utf8").catch(() => "");
    throw new Error(`${String(error)}\nElectron stderr:\n${stderr.slice(-4000)}\nXvfb:\n${xvfb.slice(-2000)}`);
  }
}

export async function stopElectron(handle) {
  handle?.cdp?.close();
  const child = handle?.child;
  if (!child?.pid) return;
  const processGroup = child.pid;
  const signal = (value) => {
    try {
      process.kill(-processGroup, value);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  };
  const waitForExit = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (signal(0)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
    }
    return true;
  };
  signal("SIGTERM");
  if (!(await waitForExit(3000))) {
    signal("SIGKILL");
    if (!(await waitForExit(5000))) throw new Error(`Electron process group ${processGroup} did not exit`);
  }
}

export function captureScrollTarget(viewId) {
  // Views whose subject sits above the conversation (an open listbox or the
  // overlay) pin the background chat to the top, so auto-scroll residue from
  // earlier states cannot leak into their pixels.
  if (viewId === "language-selector" || viewId === "model-settings") return 0;
  return null;
}

export async function setViewport(cdp, { width, height }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

export async function deterministicPaintFence(cdp, { clearFocus = true } = {}) {
  return evaluate(
    cdp,
    `(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.complete ? image.decode().catch(() => undefined) : new Promise((resolve) => {
        image.addEventListener('load', () => image.decode().catch(() => undefined).finally(resolve), { once: true });
        image.addEventListener('error', resolve, { once: true });
      })));
      if (${clearFocus ? "true" : "false"}) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) active.blur();
      }
      const forceLayout = () => {
        void document.documentElement.offsetHeight;
        for (const node of document.querySelectorAll('.app-header, .workspace, .chat-scroll, .panel-content, .overlay-surface, .composer-menu, .header-language-listbox')) {
          void node.getBoundingClientRect().width;
          void node.scrollHeight;
        }
      };
      forceLayout();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      forceLayout();
      return {
        fonts: document.fonts.status,
        width: innerWidth,
        height: innerHeight,
        activeTag: document.activeElement?.tagName ?? null,
      };
    })()`
  );
}

export async function capturePng(cdp, { width, height, clip }, { setMetrics = true } = {}) {
  if (setMetrics) await setViewport(cdp, { width, height });
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: clip ?? { x: 0, y: 0, width, height, scale: 2 },
  });
  return Buffer.from(result.data, "base64");
}

export async function captureCanonicalPng(cdp, viewport, { clearFocus = true, onStage } = {}) {
  await setViewport(cdp, viewport);
  await deterministicPaintFence(cdp, { clearFocus });
  const warmup = await capturePng(cdp, viewport, { setMetrics: false });
  onStage?.("warmup", warmup);
  await deterministicPaintFence(cdp, { clearFocus });
  const canonical = await capturePng(cdp, viewport, { setMetrics: false });
  onStage?.("canonical", canonical);
  return canonical;
}

export function assertPngBytesMatch(first, second, label = "canonical screenshot") {
  if (!first.equals(second)) throw new Error(`${label} captures are not byte-identical`);
  return true;
}
