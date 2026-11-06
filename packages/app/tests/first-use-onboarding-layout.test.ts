/**
 * Real-renderer verification of the first-use card (capability `desktop-app`,
 * Requirement: *Accessible and Localised First-Use Orientation* — Scenario: Long
 * copy and enlarged text keep the next action reachable).
 *
 * It carries further obligations that only the real app can settle. Two are
 * layout facts which jsdom's lack of grid geometry hides: the conversation's ROW GEOMETRY —
 * header, optional card, transcript, notice stack, composer, non-overlapping in
 * that order with the composer at the conversation's bottom edge inside the
 * viewport, with the card hidden as well as visible (`expectChatOrder`) — and the
 * FIRST HYDRATED COMMIT of a genuinely fresh course, which must already show step
 * 1 in focus (capability `agent-harness`, Requirement: *Host-Set Initial Step
 * Focus*) before any model or tool transition. The third is the wiki-ingest
 * completion regression: a real main process, file pick, Pi atomization session
 * and filesystem write must refresh the replacement WikiBrowser that mounted
 * during the run, without course navigation.
 *
 * It drives a real Electron build over CDP under Xvfb, so it runs only where
 * that rig exists: Linux, an `xvfb-run` on PATH, and built `out/` + `dist/`
 * trees. Elsewhere it SKIPS rather than failing an ordinary `npm test`. Set
 * `CBE_ELECTRON_LAYOUT=required` (what the dedicated Linux run does) to turn a
 * missing prerequisite back into a failure, so the coverage can never be lost by
 * silently skipping everywhere.
 *
 * It is excluded from the default vitest project and run afterwards by its own
 * config (`vitest.electron.config.ts`): two Electron + Xvfb launches competing
 * with the parallel suite is what makes the repo's documented load-sensitive
 * flakes fire.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer as createHttpServer, type Server as HttpServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Cdp,
  connectCdp,
  electronPrerequisites,
  evaluate,
  freePort,
  poll,
  stopElectron,
  waitForSelector,
} from "../../../scripts/user-documentation/electron-cdp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const electron = path.join(repoRoot, "node_modules", ".bin", "electron");
const appEntry = path.join(repoRoot, "packages", "app");
const wikiIngestTestEntry = path.join(appEntry, "tests", "fixtures", "wiki-ingest-electron-entry.mjs");
/** Every prerequisite of the rig, each reported by name so a skip (or a required
 * run's failure) says which one is missing rather than timing out. */
function missingPrerequisites(): string[] {
  return electronPrerequisites({ repoRoot }).missing;
}

const missing = missingPrerequisites();
const required = process.env.CBE_ELECTRON_LAYOUT === "required";
const skipped = missing.length > 0 && !required;

let scratch = "";
let child: ChildProcessWithoutNullStreams | null = null;
// Separate from the parent's display and from concurrent test processes. Never
// reuse a number within this suite, including its restart against the same profile.
let nextDisplay = 1000 + (process.pid % 50_000);

function openAiSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function openAiChunk(choice: unknown, usage?: unknown): unknown {
  return {
    id: "electron-wiki-refresh",
    object: "chat.completion.chunk",
    created: 0,
    model: "layout-test",
    choices: [choice],
    ...(usage ? { usage } : {}),
  };
}

/** A rendered action, measured in the real renderer: its own box plus the line
 * boxes of its COMPLETE visible label. A bounding rect inside the card proves
 * nothing about the glyphs — the defect this guards against was a labelled
 * action wearing the composer's 32x32 circular icon geometry, whose label wrapped
 * and spilled above and below a button that still sat inside the card. */
type ActionMetric = { label: string; width: number; height: number; lines: number; labelInside: boolean };

async function measureActions(cdp: Cdp, scope = ""): Promise<ActionMetric[]> {
  return evaluate<ActionMetric[]>(
    cdp,
    `[...document.querySelectorAll(${JSON.stringify(`${scope}.first-use-actions button`)})].map((button) => {
        const br = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button);
        const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        return {
          label: button.textContent.trim(),
          width: br.width,
          height: br.height,
          lines: lines.length,
          labelInside:
            lines.length > 0 &&
            lines.every(
              (r) => r.left >= br.left - 1 && r.right <= br.right + 1 && r.top >= br.top - 1 && r.bottom <= br.bottom + 1
            ),
        };
      })`
  );
}

/** Both actions carry their whole label inside their own box and keep a usable
 * target. Reported with the metric attached, so a failure names the geometry. */
function expectLabelsInside(actions: ActionMetric[], where: string): void {
  expect(actions.length, where).toBeGreaterThan(0);
  for (const action of actions) {
    const detail = `${where}: ${JSON.stringify(action)}`;
    expect(action.label.length, detail).toBeGreaterThan(0);
    expect(action.labelInside, detail).toBe(true);
    expect(action.height >= 24 && action.width >= 24, detail).toBe(true);
  }
}

/** Verify actual grid geometry, not DOM order: a hidden row is still ahead of
 * the composer in the DOM while CSS auto-placement puts the composer into it. */
async function expectChatOrder(cdp: Cdp, context: string): Promise<void> {
  const geometry = await evaluate<
    Record<
      "header" | "card" | "transcript" | "notices" | "composer" | "conversation",
      { top: number; bottom: number; height: number }
    > & { viewport: number }
  >(
    cdp,
    `(() => {
      const box = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      return { header: box('.conv-header'), card: box('.first-use-row'),
        transcript: box('.chat-scroll'), notices: box('.chat-notices'), composer: box('.composer'),
        conversation: box('.conv'), viewport: innerHeight };
    })()`
  );
  const { header, card, transcript, notices, composer, conversation, viewport } = geometry;
  const detail = `${context}: ${JSON.stringify(geometry)}`;
  expect(header.bottom, detail).toBeLessThanOrEqual(transcript.top + 1);
  if (card.height > 0) {
    expect(header.bottom, detail).toBeLessThanOrEqual(card.top + 1);
    expect(card.bottom, detail).toBeLessThanOrEqual(transcript.top + 1);
  }
  expect(transcript.height, detail).toBeGreaterThan(0);
  expect(transcript.bottom, detail).toBeLessThanOrEqual(notices.top + 1);
  expect(notices.bottom, detail).toBeLessThanOrEqual(composer.top + 1);
  expect(composer.top, detail).toBeGreaterThanOrEqual(0);
  expect(composer.bottom, detail).toBeLessThanOrEqual(viewport + 1);
  expect(Math.abs(composer.bottom - conversation.bottom), detail).toBeLessThanOrEqual(1);
}

async function launch(
  expectAutomaticCard = true,
  options: { entry?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ cdp: Cdp; port: number }> {
  if (child) throw new Error("Previous Electron process group has not stopped");
  const port = await freePort();
  while (existsSync(`/tmp/.X${nextDisplay}-lock`)) nextDisplay++;
  const display = nextDisplay++;
  const authFile = path.join(scratch, `xvfb-${display}.auth`);
  const errorFile = path.join(scratch, `xvfb-${display}.log`);
  await writeFile(authFile, "", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
  delete env.DISPLAY;
  delete env.XAUTHORITY;
  child = spawn(
    "xvfb-run",
    [
      "--server-num",
      String(display),
      "--auth-file",
      authFile,
      "--error-file",
      errorFile,
      electron,
      options.entry ?? appEntry,
      `--user-data-dir=${scratch}`,
      `--remote-debugging-port=${port}`,
      "--no-sandbox",
    ],
    {
      cwd: repoRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.once("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(`[onboarding-layout electron exit ${code}] ${stderr.slice(-2000)}\n`);
      void readFile(errorFile, "utf8").then(
        (text) => process.stderr.write(text),
        () => {}
      );
    }
  });
  const cdp = await connectCdp(port);
  await cdp.send("Page.enable");
  await cdp.send("Accessibility.enable");
  await waitForSelector(cdp, expectAutomaticCard ? ".first-use-row:not([hidden])" : ".composer textarea");
  return { cdp, port };
}

async function stop(cdp?: { close(): void }): Promise<void> {
  const running = child;
  if (!running) return;
  await stopElectron({ child: running, cdp });
  child = null;
}

async function key(cdp: Cdp, keyValue: string, modifiers = 0, code?: string): Promise<void> {
  const virtualKey =
    keyValue === "Enter" ? 13 : keyValue === "Tab" ? 9 : keyValue === "0" ? 48 : keyValue === "," ? 188 : undefined;
  const event = {
    key: keyValue,
    code: code ?? keyValue,
    modifiers,
    ...(virtualKey ? { windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey } : {}),
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

beforeAll(async () => {
  if (skipped) return;
  // In required mode this is the assertion that keeps the dedicated Linux run
  // honest: an absent rig fails loudly instead of quietly covering nothing.
  expect(missing, `first-use layout rig incomplete: ${missing.join("; ")}`).toEqual([]);
  scratch = await mkdtemp(path.join(os.tmpdir(), "cbe-onboarding-layout-"));
  await writeFile(
    path.join(scratch, "cbe-config.json"),
    JSON.stringify({ baseURL: "http://127.0.0.1:9/v1", modelId: "layout-test", apiKeyPlain: "test-key" }),
    "utf8"
  );
  await writeFile(path.join(scratch, "interface-language.json"), JSON.stringify({ interfaceLanguage: "it" }), "utf8");
}, 30_000);

afterAll(async () => {
  await stop();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe.skipIf(skipped)("Long copy and enlarged text keep the next action reachable", () => {
  it("verifies the real Electron renderer at narrow widths, both themes, enlarged text and 200% zoom", async () => {
    let cdp: Cdp | undefined;
    try {
      ({ cdp } = await launch());
      expect(await evaluate<string>(cdp, "document.querySelector('.first-use-overview h2')?.textContent ?? ''")).toBe(
        "Benvenuti in CBE Toolbox"
      );
      expect(await evaluate<number>(cdp, "document.querySelectorAll('.first-use-row:not([hidden])').length")).toBe(1);
      expect(
        await evaluate<boolean>(
          cdp,
          "document.querySelector('.first-use-row')?.contains(document.activeElement) ?? false"
        )
      ).toBe(false);

      // Observe the FIRST hydrated commit of a genuinely fresh course, before
      // any prompt or tool transition. Disabled cold-seed controls are not a
      // hydrated frame. The MutationObserver runs before the browser paints.
      await evaluate(cdp, "document.querySelector('.panel-left .panel-edge-toggle')?.click(); true");
      await waitForSelector(cdp, ".proj-plus");
      await evaluate(cdp, "document.querySelector('.proj-plus').click(); true");
      await waitForSelector(cdp, ".proj-create-input");
      await evaluate(
        cdp,
        `(() => {
        const field = document.querySelector('.proj-create-input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Fresh focus probe');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        window.__firstCanvasFrame = null;
        const observer = new MutationObserver(() => {
          if (!document.querySelector('.app-header')?.textContent.includes('Fresh focus probe') ||
              !document.querySelector('.step-select:not(:disabled)')) return;
          window.__firstCanvasFrame = {
            focus: [...document.querySelectorAll('.step-group[data-focus=true]')].map(e => e.dataset.step),
            depths: [...document.querySelectorAll('.step-coverage')].map(e => e.dataset.depth),
            turns: document.querySelectorAll('.msg').length,
          };
          observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        return true;
      })()`
      );
      await evaluate(cdp, "document.querySelector('.proj-create').requestSubmit(); true");
      const firstFrame = await poll(async () =>
        evaluate<{ focus: string[]; depths: string[]; turns: number } | null>(cdp!, "window.__firstCanvasFrame")
      );
      expect(firstFrame).toEqual({ focus: ["1"], depths: Array(10).fill("open"), turns: 0 });
      await evaluate(cdp, "document.querySelector('.panel-left .panel-edge-toggle')?.click(); true");

      for (const width of [775, 900]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 700,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const theme of ["dark", "light"]) {
          await evaluate(cdp, `localStorage.setItem('cbe-theme', ${JSON.stringify(theme)}); location.reload(); true`);
          await waitForSelector(cdp, ".first-use-row:not([hidden])");
          await poll(async () =>
            (await evaluate<string>(cdp!, "document.documentElement.dataset.theme ?? ''")) === theme ? true : null
          );
          // Chromium-backed 200% browser zoom: halve the CSS viewport while
          // doubling the device scale, then enlarge the root text preference.
          // This exercises the real renderer at the effective viewport a 200%
          // desktop zoom produces, rather than asserting on CSS strings.
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: Math.floor(width / 2),
            height: 350,
            deviceScaleFactor: 2,
            mobile: false,
          });
          await evaluate(cdp, "document.documentElement.style.fontSize='20px'; true");
          expect(await evaluate<number>(cdp, "window.devicePixelRatio")).toBe(2);

          const layout = await evaluate<{
            horizontal: boolean;
            composerVisible: boolean;
            transcriptVisible: boolean;
            actionsReachable: boolean;
            panelWidths: number[];
            hiddenPanelWidths: number[];
            metrics: Record<string, number>;
          }>(
            cdp,
            `(() => {
                const card = document.querySelector('.first-use-overview');
                const composer = document.querySelector('.composer');
                const transcript = document.querySelector('.chat-scroll');
                const row = document.querySelector('.first-use-row');
                const panels = [...document.querySelectorAll('.workspace > .panel')];
                card.scrollTop = card.scrollHeight;
                const cr = card.getBoundingClientRect();
                const ar = [...card.querySelectorAll('.first-use-actions button')].map((button) => button.getBoundingClientRect());
                const mr = composer.getBoundingClientRect();
                const tr = transcript.getBoundingClientRect();
                const panelWidths = panels.map((panel) => panel.getBoundingClientRect().width);
                row.hidden = true;
                const hiddenPanelWidths = panels.map((panel) => panel.getBoundingClientRect().width);
                row.hidden = false;
                return {
                  horizontal: card.scrollWidth <= card.clientWidth + 1 && ar.every((r) => r.left >= cr.left - 1 && r.right <= cr.right + 1),
                  composerVisible: mr.top >= 0 && mr.bottom <= innerHeight + 1 && cr.bottom <= mr.top + 1,
                  transcriptVisible: tr.height > 0 && tr.width > 0,
                  actionsReachable: ar.every((r) => r.bottom <= cr.bottom + 1),
                  panelWidths,
                  hiddenPanelWidths,
                  metrics: { innerWidth, innerHeight, cardTop: cr.top, cardBottom: cr.bottom, composerTop: mr.top, composerBottom: mr.bottom, transcriptHeight: tr.height },
                };
              })()`
          );
          await expectChatOrder(cdp, `visible onboarding, ${width}, ${theme}, enlarged text and 200% zoom`);
          expect(layout.horizontal).toBe(true);
          expect(layout.composerVisible, JSON.stringify(layout.metrics)).toBe(true);
          expect(layout.transcriptVisible).toBe(true);
          expect(layout.actionsReachable).toBe(true);
          expect(layout.panelWidths).toEqual(layout.hiddenPanelWidths);
          expectLabelsInside(await measureActions(cdp), `width ${width}, ${theme} theme, 200% zoom, enlarged text`);

          const ax = await cdp.send<{
            nodes: Array<{
              role?: { value?: string };
              name?: { value?: string };
              properties?: Array<{ name: string; value?: { value?: unknown } }>;
            }>;
          }>("Accessibility.getFullAXTree");
          expect(
            ax.nodes.some((node) => node.role?.value === "region" && node.name?.value === "Benvenuti in CBE Toolbox")
          ).toBe(true);
          expect(
            ax.nodes.some((node) =>
              node.properties?.some((property) => property.name === "live" && property.value?.value === "polite")
            )
          ).toBe(true);

          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 700,
            deviceScaleFactor: 1,
            mobile: false,
          });
        }
      }

      // Every SHIPPED language, measured in the real renderer at the narrow
      // supported width with the enlarged root text still in force: which
      // catalogue overflows a labelled action first is a property of the words,
      // not of the code. The codes come from the registry-derived dropdown, so
      // a further language is covered without this test naming it.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 775,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const appliedCode = async () =>
        (
          await evaluate<string>(
            cdp!,
            "document.querySelector('.header-language-trigger span')?.textContent?.trim() ?? ''"
          )
        ).toLowerCase();
      await evaluate(cdp, "document.querySelector('.header-language-trigger')?.click(); true");
      await waitForSelector(cdp, ".header-language-listbox [data-language]");
      const codes = await evaluate<string[]>(
        cdp,
        "[...document.querySelectorAll('.header-language-listbox [data-language]')].map((option) => option.dataset.language)"
      );
      const configured = await appliedCode();
      expect(codes).toContain(configured);
      expect(codes.length).toBeGreaterThan(1);
      await key(cdp, "Escape");
      for (const code of [...codes.filter((candidate) => candidate !== configured), configured]) {
        await evaluate(cdp, "document.querySelector('.header-language-trigger')?.click(); true");
        await waitForSelector(cdp, `.header-language-listbox [data-language="${code}"]`);
        await evaluate(
          cdp,
          `document.querySelector('.header-language-listbox [data-language="${code}"]').click(); true`
        );
        await poll(async () => ((await appliedCode()) === code ? true : null));
        expectLabelsInside(await measureActions(cdp), `language ${code}, width 775, enlarged text`);
      }
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 900,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false,
      });

      // Orthogonal layout stress matrix. The long transcript is an inert DOM
      // fixture in the REAL scrollport, not fabricated model output. No product
      // state or first-use ownership changes; remove it before continuing.
      for (const width of [775, 1100]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 700,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const fontSize of ["16px", "20px"]) {
          for (const hidden of [false, true]) {
            for (const long of [false, true]) {
              for (const [left, right] of [
                [false, false],
                [true, false],
                [false, true],
                [true, true],
              ]) {
                await evaluate(
                  cdp,
                  `(async () => {
                  document.documentElement.style.fontSize = ${JSON.stringify(fontSize)};
                  for (const [selector, collapsed] of [['.panel-left', ${left}], ['.panel:not(.panel-left)', ${right}]]) {
                    const panel = document.querySelector(selector);
                    if ((panel.dataset.collapsed === 'true') !== collapsed) panel.querySelector('.panel-edge-toggle').click();
                  }
                  await new Promise(requestAnimationFrame);
                  document.querySelector('.first-use-row').hidden = ${hidden};
                  document.querySelector('#layout-long-transcript')?.remove();
                  document.querySelector('#layout-notices')?.remove();
                  if (${long}) {
                    const notices = document.createElement('div');
                    notices.id = 'layout-notices';
                    notices.textContent = 'Notice layout fixture';
                    notices.style.height = '70px';
                    document.querySelector('.chat-notices').append(notices);
                    const fixture = document.createElement('div');
                    fixture.id = 'layout-long-transcript';
                    fixture.textContent = 'Long transcript layout fixture. '.repeat(600);
                    document.querySelector('.chat-column').append(fixture);
                  }
                  return true;
                })()`
                );
                await expectChatOrder(cdp, JSON.stringify({ width, fontSize, hidden, long, left, right }));
              }
            }
          }
        }
      }
      await evaluate(
        cdp,
        `(() => {
        document.querySelector('#layout-long-transcript')?.remove();
        document.querySelector('#layout-notices')?.remove();
        document.querySelector('.first-use-row').hidden = false;
        for (const selector of ['.panel-left', '.panel:not(.panel-left)']) {
          const panel = document.querySelector(selector);
          const collapsed = selector === '.panel-left';
          if ((panel.dataset.collapsed === 'true') !== collapsed) panel.querySelector('.panel-edge-toggle').click();
        }
        return true;
      })()`
      );
      // The matrix left the viewport at its last loop value. Everything below was
      // written for the narrow supported width set before it, so restore that
      // width here — the enlarged root text stays in force deliberately.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 900,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false,
      });

      // Normal keyboard order reaches both actions; activation acknowledges,
      // dismisses, and hands focus to the unchanged composer.
      await evaluate(cdp, "document.querySelector('.new-session-btn').focus(); true");
      await key(cdp, "Tab");
      expect(await evaluate<string>(cdp, "document.activeElement?.textContent?.trim() ?? ''")).toBe("Inizia");
      await key(cdp, "Tab");
      expect(await evaluate<string>(cdp, "document.activeElement?.textContent?.trim() ?? ''")).toBe("Salta");
      expect(await evaluate<boolean>(cdp, "document.activeElement?.matches(':focus-visible') ?? false")).toBe(true);
      // CDP has already proved normal keyboard reach; activate the focused
      // native button through its browser click so this test does not depend
      // on platform-specific virtual-key translation under Xvfb.
      await evaluate(cdp, "document.activeElement?.click(); true");
      await waitForSelector(cdp, ".first-use-row:not([hidden])", false);
      await expectChatOrder(cdp, "acknowledged onboarding through the real Skip action");
      expect(await evaluate<string>(cdp, "document.activeElement?.getAttribute('aria-label') ?? ''")).toBe("Messaggio");
      expect(
        await poll(async () => {
          try {
            return JSON.parse(await readFile(path.join(scratch, "onboarding.json"), "utf8")) as {
              schemaVersion: number;
              acknowledged: boolean;
            };
          } catch {
            return null;
          }
        })
      ).toEqual({ schemaVersion: 1, acknowledged: true });

      // Voluntary rereading uses the existing settings dialog and returns
      // focus locally; it creates no nested overlay.
      await evaluate(cdp, "document.querySelector('[data-tab=settings]')?.closest('button')?.click(); true");
      await waitForSelector(cdp, '[data-group="about"]');
      await evaluate(cdp, "document.querySelector('[data-group=about] > .set-acc-header')?.click(); true");
      await evaluate(cdp, "document.querySelector('.set-about-overview-trigger')?.click(); true");
      await waitForSelector(cdp, "#settings-first-use-overview");
      expect(await evaluate<number>(cdp, "document.querySelectorAll('[role=dialog][aria-modal=true]').length")).toBe(1);
      expectLabelsInside(await measureActions(cdp, "#settings-first-use-overview "), "voluntary reread");
      await evaluate(
        cdp,
        "document.querySelector('#settings-first-use-overview .first-use-actions button')?.click(); true"
      );
      await poll(async () =>
        (await evaluate<boolean>(
          cdp!,
          "document.activeElement?.classList.contains('set-about-overview-trigger') ?? false"
        ))
          ? true
          : null
      );

      await stop(cdp);
      cdp = undefined;

      // A real main-process restart against the same local profile keeps the
      // automatic card suppressed while the manual route remains available.
      ({ cdp } = await launch(false));
      await waitForSelector(cdp, ".composer textarea");
      await expectChatOrder(cdp, "restart with persisted acknowledgment");
      expect(await evaluate<boolean>(cdp, "Boolean(document.querySelector('.first-use-row:not([hidden])'))")).toBe(
        false
      );
    } finally {
      await stop(cdp);
    }
  }, 120_000);

  it("opens the real overlay through the native accelerator and exposes the generated About identity accessibly", async () => {
    let cdp: Cdp | undefined;
    try {
      ({ cdp } = await launch(false));
      await evaluate(cdp, "document.querySelector('.composer textarea')?.focus(); true");
      expect(await evaluate<string>(cdp, "document.activeElement?.getAttribute('aria-label') ?? ''")).toBe("Messaggio");

      // Linux/Windows platform convention from the native menu: Ctrl+, routes
      // main → preload → the existing renderer Settings action.
      await key(cdp, ",", 2, "Comma");
      await waitForSelector(cdp, '.overlay-backdrop:not([hidden]) [role="dialog"]');
      expect(
        await evaluate<string>(cdp, "document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? ''")
      ).toBe("Impostazioni");
      expect(
        await evaluate<string>(
          cdp,
          "document.querySelector('[data-group=appearance] > .set-acc-header')?.getAttribute('aria-expanded') ?? ''"
        )
      ).toBe("true");

      await evaluate(cdp, "document.querySelector('[data-group=about] > .set-acc-header')?.click(); true");
      await waitForSelector(cdp, '.set-about-pioneer-link[role="link"]');
      const about = await evaluate<{
        role: string | null;
        describedBy: string[];
        icon: { complete: boolean; width: number; alt: string | null; hidden: string | null };
      }>(
        cdp,
        `(() => {
          const link = document.querySelector('.set-about-pioneer-link');
          const image = document.querySelector('.set-about-identity img');
          return {
            role: link?.getAttribute('role') ?? null,
            describedBy: (link?.getAttribute('aria-describedby') ?? '').split(/\\s+/).filter(Boolean)
              .map(id => document.getElementById(id)?.textContent ?? ''),
            icon: {
              complete: Boolean(image?.complete),
              width: image?.naturalWidth ?? 0,
              alt: image?.getAttribute('alt') ?? null,
              hidden: image?.getAttribute('aria-hidden') ?? null,
            },
          };
        })()`
      );
      expect(about.role).toBe("link");
      expect(about.describedBy).toEqual([
        "Scopra di più su PIONEER Alliance, l'alleanza universitaria europea associata a questo strumento.",
        "Si apre nel browser di sistema.",
      ]);
      expect(about.icon).toEqual({ complete: true, width: 1024, alt: "", hidden: "true" });

      await evaluate(cdp, "document.querySelector('.set-about-pioneer-link')?.focus(); true");
      expect(
        await evaluate<boolean>(cdp, "document.activeElement?.classList.contains('set-about-pioneer-link') ?? false")
      ).toBe(true);
      await evaluate(cdp, "document.querySelector('.overlay-dismiss')?.click(); true");
      await poll(async () =>
        (await evaluate<boolean>(cdp!, "document.activeElement?.matches('.composer textarea') ?? false")) ? true : null
      );
    } finally {
      await stop(cdp);
    }
  }, 120_000);

  it("refreshes a remounted Wiki surface from 0 to 1 atom when the real ingest reaches Done", async () => {
    let cdp: Cdp | undefined;
    let provider: HttpServer | undefined;
    let heldAtomizationResponse: ServerResponse | undefined;
    let postCount = 0;
    const courseId = "electron-wiki-refresh";
    const courseTitle = "Electron Wiki Refresh";
    const picked = path.join(scratch, "electron-wiki-source.md");
    const atomContent = [
      "---",
      "type: concept",
      "aliases: []",
      "sources:",
      '  - title: "electron-wiki-source.md"',
      '    ingested: "2026-08-27"',
      "raw:",
      "  - raw/electron-wiki-source.md",
      "related: []",
      "confidence: high",
      "updated: 2026-08-27",
      "---",
      "",
      "# electron-refresh",
      "",
      "The atom landed before the run reported Done.",
      "",
    ].join("\n");

    const releaseAtomization = () => {
      if (!heldAtomizationResponse) throw new Error("No atomization request is waiting");
      openAiSse(heldAtomizationResponse, [
        openAiChunk({
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                index: 0,
                id: "write-atom",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ path: "wiki/concept/electron-refresh.md", content: atomContent }),
                },
              },
              {
                index: 1,
                id: "write-index",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    path: "wiki/index.md",
                    content: "# Course wiki\\n\\n## Concepts\\n\\n- [[concept/electron-refresh]]\\n",
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        }),
        openAiChunk(
          { index: 0, delta: {}, finish_reason: "tool_calls" },
          { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        ),
      ]);
      heldAtomizationResponse = undefined;
    };

    try {
      provider = createHttpServer((request, response) => {
        if (request.method === "GET") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: [{ id: "layout-test", object: "model" }] }));
          return;
        }
        let body = "";
        request.on("data", (chunk) => (body += String(chunk)));
        request.on("end", () => {
          // Parsing proves the built Pi client sent a real OpenAI request rather
          // than the test manufacturing a renderer-only completion.
          JSON.parse(body);
          postCount += 1;
          if (postCount === 1) {
            heldAtomizationResponse = response;
            return;
          }
          openAiSse(response, [
            openAiChunk({ index: 0, delta: { role: "assistant", content: "Done." }, finish_reason: null }),
            openAiChunk(
              { index: 0, delta: {}, finish_reason: "stop" },
              { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
            ),
          ]);
        });
      });
      await new Promise<void>((resolve, reject) => {
        provider!.once("error", reject);
        provider!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = provider.address();
      const providerPort = typeof address === "object" && address ? address.port : 0;

      await writeFile(
        path.join(scratch, "cbe-config.json"),
        JSON.stringify({
          baseURL: `http://127.0.0.1:${providerPort}/v1`,
          modelId: "layout-test",
          apiKeyPlain: "test-key",
        }),
        "utf8"
      );
      await writeFile(path.join(scratch, "interface-language.json"), JSON.stringify({ interfaceLanguage: "en" }));
      await writeFile(
        path.join(scratch, "onboarding.json"),
        JSON.stringify({ schemaVersion: 1, acknowledged: true }),
        "utf8"
      );
      const course = path.join(scratch, "courses", courseId);
      for (const folder of ["sessions", "canvas", "reflections", "inbox", "raw", "wiki"]) {
        await mkdir(path.join(course, folder), { recursive: true });
      }
      await writeFile(
        path.join(course, "course.md"),
        `---\ntitle: ${JSON.stringify(courseTitle)}\ncreated: "2026-08-27T00:00:00.000Z"\n---\n\n# ${courseTitle}\n`,
        "utf8"
      );
      await writeFile(path.join(course, "lecturer-state.md"), "", "utf8");
      await writeFile(path.join(scratch, "workspace-state.json"), JSON.stringify({ activeCourseId: courseId }), "utf8");
      await writeFile(picked, "# One source concept\n", "utf8");

      ({ cdp } = await launch(false, {
        entry: wikiIngestTestEntry,
        env: { CBE_ELECTRON_WIKI_PICK: picked },
      }));
      await evaluate(
        cdp,
        `(() => {
          const panel = document.querySelector('.panel-left');
          if (panel?.dataset.collapsed === 'true') panel.querySelector('.panel-edge-toggle')?.click();
          return true;
        })()`
      );
      await waitForSelector(cdp, ".proj");
      await poll(async () =>
        (await evaluate<boolean>(
          cdp!,
          `Boolean([...document.querySelectorAll('.proj')].find((row) => row.textContent.includes(${JSON.stringify(courseTitle)})))`
        ))
          ? true
          : null
      );
      await evaluate(
        cdp,
        `(() => {
          const row = [...document.querySelectorAll('.proj')].find((item) => item.textContent.includes(${JSON.stringify(courseTitle)}));
          row.querySelector('button[aria-label="Course details"]').click();
          return true;
        })()`
      );
      await waitForSelector(cdp, '[role="tab"]');
      await evaluate(
        cdp,
        `([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.trim() === 'Wiki'))?.click(); true`
      );
      await waitForSelector(cdp, ".wiki-browser");
      const before = await evaluate<number>(cdp, "document.querySelectorAll('.wiki-atom-row').length");
      expect(before).toBe(0);

      await evaluate(cdp, "document.querySelector('.wiki-ingest-actions .pp-action')?.click(); true");
      await poll(async () => (heldAtomizationResponse ? true : null), 30_000);

      // Replace the starter instance while its real main-process run is waiting
      // on the provider, then return to a fresh WikiBrowser without changing
      // course. This is the human-test sequence that formerly stayed stale.
      await evaluate(
        cdp,
        `([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.trim() === 'Chats'))?.click(); true`
      );
      await waitForSelector(cdp, ".wiki-browser", false);
      await evaluate(
        cdp,
        `([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.trim() === 'Wiki'))?.click(); true`
      );
      await waitForSelector(cdp, ".wiki-browser");
      expect(await evaluate<number>(cdp, "document.querySelectorAll('.wiki-atom-row').length")).toBe(0);
      expect(await evaluate<string>(cdp, "document.querySelector('.pp-title')?.textContent?.trim() ?? ''")).toBe(
        courseTitle
      );

      releaseAtomization();
      const after = await poll(async () => {
        const state = await evaluate<{ atoms: number; done: boolean; title: string }>(
          cdp!,
          `({
            atoms: document.querySelectorAll('.wiki-atom-row').length,
            done: Boolean(document.querySelector('.wiki-ingest-done')) && Boolean(document.querySelector('.wiki-ingest-notice')),
            title: document.querySelector('.pp-title')?.textContent?.trim() ?? '',
          })`
        );
        return state.atoms === 1 && state.done ? state : null;
      }, 60_000);
      expect(after).toEqual({ atoms: 1, done: true, title: courseTitle });
      expect(postCount).toBe(2);
    } finally {
      await stop(cdp);
      provider?.closeAllConnections();
      await new Promise<void>((resolve) => (provider ? provider.close(() => resolve()) : resolve()));
    }
  }, 120_000);

  it("keeps the real Working disclosure within the chat and returns focus on Escape", async () => {
    let cdp: Cdp | undefined;
    let provider: HttpServer | undefined;
    try {
      provider = createHttpServer((request, response) => {
        if (request.method === "GET") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: [{ id: "layout-test", object: "model" }] }));
          return;
        }
        // Hold the inference request open so the renderer remains in its real
        // active-turn lifecycle while CDP inspects geometry and focus.
      });
      await new Promise<void>((resolve, reject) => {
        provider!.once("error", reject);
        provider!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = provider.address();
      const providerPort = typeof address === "object" && address ? address.port : 0;
      await writeFile(
        path.join(scratch, "cbe-config.json"),
        JSON.stringify({
          baseURL: `http://127.0.0.1:${providerPort}/v1`,
          modelId: "layout-test",
          apiKeyPlain: "test-key",
        }),
        "utf8"
      );
      await writeFile(
        path.join(scratch, "onboarding.json"),
        JSON.stringify({ schemaVersion: 1, acknowledged: true }),
        "utf8"
      );

      ({ cdp } = await launch(false));
      await waitForSelector(cdp, ".composer textarea");
      await evaluate(
        cdp,
        `(() => {
          const field = document.querySelector('.composer textarea');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(field, 'Focus verification');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`
      );
      await poll(async () =>
        (await evaluate<boolean>(cdp!, "!document.querySelector('.composer .send:not(.stop)')?.disabled")) ? true : null
      );
      await evaluate(cdp, "document.querySelector('.composer .send:not(.stop)')?.click(); true");
      await waitForSelector(cdp, ".working-disclosure-trigger");

      const closed = await evaluate<{
        width: number;
        height: number;
        insideChat: boolean;
        expanded: string | null;
        panelAbsent: boolean;
      }>(
        cdp,
        `(() => {
          const trigger = document.querySelector('.working-disclosure-trigger');
          const chat = document.querySelector('.chat-column');
          const tr = trigger.getBoundingClientRect();
          const cr = chat.getBoundingClientRect();
          return {
            width: tr.width,
            height: tr.height,
            insideChat: tr.left >= cr.left - 1 && tr.right <= cr.right + 1,
            expanded: trigger.getAttribute('aria-expanded'),
            panelAbsent: !document.querySelector('.working-disclosure-panel'),
          };
        })()`
      );
      expect(closed.expanded).toBe("false");
      expect(closed.panelAbsent).toBe(true);
      expect(closed.insideChat).toBe(true);
      expect(closed.width).toBeGreaterThan(100);
      expect(closed.height).toBeGreaterThanOrEqual(24);

      await evaluate(cdp, "document.querySelector('.working-disclosure-trigger')?.click(); true");
      await waitForSelector(cdp, ".working-disclosure-panel");
      const open = await evaluate<{ panelVisible: boolean; expanded: string | null }>(
        cdp,
        `(() => {
          const trigger = document.querySelector('.working-disclosure-trigger');
          const panel = document.querySelector('.working-disclosure-panel');
          const rect = panel.getBoundingClientRect();
          panel.tabIndex = -1;
          panel.focus();
          return {
            panelVisible: rect.width > 0 && rect.height > 0 && getComputedStyle(panel).display !== 'none',
            expanded: trigger.getAttribute('aria-expanded'),
          };
        })()`
      );
      expect(open).toEqual({ panelVisible: true, expanded: "true" });
      await key(cdp, "Escape");
      await waitForSelector(cdp, ".working-disclosure-panel", false);
      await poll(async () =>
        (await evaluate<boolean>(
          cdp!,
          "document.activeElement?.classList.contains('working-disclosure-trigger') ?? false"
        ))
          ? true
          : null
      );
      expect(
        await evaluate<string | null>(
          cdp,
          "document.querySelector('.working-disclosure-trigger')?.getAttribute('aria-expanded') ?? null"
        )
      ).toBe("false");
    } finally {
      await stop(cdp);
      provider?.closeAllConnections();
      await new Promise<void>((resolve) => (provider ? provider.close(() => resolve()) : resolve()));
    }
  }, 120_000);
});
