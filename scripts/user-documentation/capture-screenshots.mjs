#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format as formatWithPrettier } from "prettier";
import {
  assertPngBytesMatch,
  captureCanonicalPng,
  captureScrollTarget,
  electronPrerequisites,
  evaluate,
  launchElectron,
  poll,
  setViewport,
  stopElectron,
  waitForSelector,
} from "./electron-cdp.mjs";
import {
  assertBoundedMatrix,
  assertNoUnverifiedCitationResidue,
  CAPTURE_DEFINITION_FILES,
  CAPTURE_EXECUTION_ORDER,
  captureCases,
  HIGHLIGHT_STYLE,
  highlightsFor,
  VIEW_MATRIX,
  VIEWPORTS,
} from "./screenshot-matrix.mjs";
import { assertDocumentationFontCoverage } from "./font-coverage.mjs";
import { startScriptedProvider } from "./scripted-provider.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const docsRoot = path.join(repoRoot, "docs", "user");
const manifestPath = path.join(docsRoot, "screenshot-manifest.json");
const committedAssetsRoot = path.join(docsRoot, "assets", "screenshots");
const fixtureRoot = path.join(repoRoot, "packages", "app", "tests", "fixtures", "user-documentation");
const fixtureFont = path.join(fixtureRoot, "fonts", "DocumentationSans.woff2");
const electronEntry = path.join(fixtureRoot, "electron-entry.mjs");
const lockPath = path.join(os.tmpdir(), "cbe-user-docs-screenshots.lock");
const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!mode || process.argv.filter((arg) => arg === "--write" || arg === "--check").length !== 1) {
  throw new Error("Usage: node scripts/user-documentation/capture-screenshots.mjs (--write|--check)");
}

assertBoundedMatrix();
const prerequisite = electronPrerequisites({ repoRoot, fontPath: fixtureFont });
if (prerequisite.missing.length > 0) {
  throw new Error(`docs:screenshots:${mode} prerequisites missing: ${prerequisite.missing.join("; ")}`);
}
assertDocumentationFontCoverage(fixtureFont);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableFileHash = async (file) => sha256((await readFile(file)).toString("binary"));
const sourceFingerprint = async (files) => {
  const result = {};
  for (const relative of [...files].sort()) result[relative] = await stableFileHash(path.join(repoRoot, relative));
  return result;
};

async function captureDefinitionFingerprint() {
  const parts = [];
  for (const relative of CAPTURE_DEFINITION_FILES) {
    parts.push(`${relative}\0${await stableFileHash(path.join(repoRoot, relative))}`);
  }
  return sha256(parts.sort().join("\n"));
}

async function fixtureFingerprint() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(path.relative(fixtureRoot, absolute));
    }
  }
  await walk(fixtureRoot);
  const parts = [];
  for (const relative of files.sort())
    parts.push(`${relative}\0${await stableFileHash(path.join(fixtureRoot, relative))}`);
  return sha256(parts.join("\n"));
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not resolve source commit: ${result.stderr}`);
  return result.stdout.trim();
}

async function prepareScratch(locale, provider) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), `cbe-user-docs-${locale}-`));
  const marker = { kind: "cbe-user-documentation-capture", runRoot: scratch, locale, runId: path.basename(scratch) };
  await writeFile(path.join(scratch, ".cbe-user-documentation-run.json"), JSON.stringify(marker, null, 2) + "\n");
  await cp(path.join(fixtureRoot, "courses"), path.join(scratch, "courses"), { recursive: true });
  for (const courseId of ["civic-energy", "mobility-lab"]) {
    for (const dir of ["sessions", "canvas", "reflections", "inbox", "raw", "wiki"]) {
      await mkdir(path.join(scratch, "courses", courseId, dir), { recursive: true });
    }
  }

  const schema = JSON.parse(await readFile(path.join(fixtureRoot, "fixture-schema.json"), "utf8"));
  const text = schema.locales[locale];
  const primaryCourse = path.join(scratch, "courses", "civic-energy");
  const secondaryCourse = path.join(scratch, "courses", "mobility-lab");
  const courseMd = await readFile(path.join(primaryCourse, "course.md"), "utf8");
  await writeFile(path.join(primaryCourse, "course.md"), courseMd.replaceAll("Civic Energy Studio", text.courseTitle));
  const secondaryMd = await readFile(path.join(secondaryCourse, "course.md"), "utf8");
  await writeFile(
    path.join(secondaryCourse, "course.md"),
    secondaryMd.replaceAll("Neighbourhood Mobility Lab", text.secondaryCourseTitle)
  );
  const sessionPath = path.join(primaryCourse, "sessions", "documentation-session.json");
  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  session.turns = [
    { role: "user", text: text.userTurn },
    { role: "assistant", text: text.assistantTurn },
  ];
  await writeFile(sessionPath, JSON.stringify(session, null, 2) + "\n");
  const sessionMd = await readFile(path.join(primaryCourse, "sessions", "documentation-session.md"), "utf8");
  await writeFile(
    path.join(primaryCourse, "sessions", "documentation-session.md"),
    sessionMd
      .replace("Help me review the challenge and its assessment connection.", text.userTurn)
      .replace(
        "We are working at the coherence check after step 3. The challenge is concrete; the assessment still needs evidence of student decision-making.",
        text.assistantTurn
      )
  );
  await cp(path.join(fixtureRoot, "lecturer-profile.json"), path.join(scratch, "lecturer-profile.json"));
  await cp(path.join(fixtureRoot, "lecturer-support.json"), path.join(scratch, "lecturer-support.json"));
  await writeFile(path.join(scratch, "workspace-state.json"), JSON.stringify({ activeCourseId: "civic-energy" }));
  await writeFile(path.join(scratch, "interface-language.json"), JSON.stringify({ interfaceLanguage: locale }));
  await writeFile(
    path.join(scratch, "cbe-config.json"),
    JSON.stringify({
      baseURL: provider.baseURL,
      modelId: schema.providerModel,
      apiKeyPlain: schema.providerKey,
      contextLength: 32768,
      reasoning: true,
      reasoningEffort: "medium",
    })
  );
  return { scratch, schema };
}

async function injectCaptureStyle(cdp) {
  const font = (await readFile(fixtureFont)).toString("base64");
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const loaded = await evaluate(
    cdp,
    `(async () => {
      document.querySelector('#documentation-capture-style')?.remove();
      const style = document.createElement('style');
      style.id = 'documentation-capture-style';
      style.textContent = ${JSON.stringify(`
        @font-face { font-family: DocumentationSans; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 400; font-style: normal; font-display: block; }
        *, *::before, *::after { font-family: DocumentationSans, sans-serif !important; animation: none !important; transition: none !important; caret-color: transparent !important; }
        html { scroll-behavior: auto !important; }
      `)};
      document.head.append(style);
      await document.fonts.load('16px DocumentationSans');
      await document.fonts.ready;
      const probe = document.querySelector('.app-header-name') ?? document.querySelector('.composer textarea') ?? document.body;
      const family = probe ? getComputedStyle(probe).fontFamily : '';
      return {
        ready: document.fonts.check('16px DocumentationSans'),
        applied: family.includes('DocumentationSans'),
        family,
      };
    })()`
  );
  if (!loaded.ready || !loaded.applied)
    throw new Error(`Capture fixture font did not render: ${JSON.stringify(loaded)}`);
}

async function click(cdp, selector, index = 0) {
  const clicked = await evaluate(
    cdp,
    `(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]; const node = nodes[${index}]; if (!node) return false; node.click(); return true; })()`
  );
  if (!clicked) throw new Error(`Could not click ${selector}[${index}]`);
}

async function closeTransient(cdp) {
  await evaluate(
    cdp,
    `(() => {
      document.querySelector('.composer-menu-anchor .composer-plus-open')?.click();
      document.querySelector('.header-language-listbox') && document.querySelector('.header-language-trigger')?.click();
      document.querySelector('.cite-modal-close')?.click();
      document.querySelector('.overlay-dismiss')?.click();
      return true;
    })()`
  );
}

async function setPanel(cdp, side, expanded) {
  const selector = side === "left" ? ".panel-left" : ".workspace > .panel:not(.panel-left)";
  const state = await evaluate(
    cdp,
    `(() => { const panel=document.querySelector(${JSON.stringify(selector)}); return panel ? panel.dataset.collapsed !== 'true' : null; })()`
  );
  if (state === null) throw new Error(`Missing ${side} panel`);
  if (state !== expanded) await click(cdp, `${selector} .panel-edge-toggle`);
}

async function setComposer(cdp, text) {
  await evaluate(
    cdp,
    `(() => {
      const field = document.querySelector('.composer textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, ${JSON.stringify(text)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
  );
  await poll(
    async () => (await evaluate(cdp, "!document.querySelector('.composer .send:not(.stop)')?.disabled")) || null,
    { label: "enabled send control" }
  );
}

/**
 * Example connection values for the Model-settings capture. Typed, never saved:
 * no Save or connection test runs, so no credential is stored and no request
 * leaves loopback. The URL host is reserved by RFC 2606.
 */
const MODEL_EXAMPLE_VALUES = Object.freeze({
  baseURL: "https://llm.example.org/v1",
  modelId: "qwen3.8-27b",
  apiKey: "sk-example-not-a-real-key",
});

async function setModelFields(cdp, { baseURL, modelId, apiKey }) {
  const typed = await evaluate(
    cdp,
    `(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const values = ${JSON.stringify({ baseurl: baseURL, modelid: modelId, apikey: apiKey })};
      for (const [field, value] of Object.entries(values)) {
        const input = document.querySelector('.llm-conn input[aria-describedby="set-explain-' + field + '"]');
        if (!input) return field;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`
  );
  if (typed !== true) throw new Error(`Model settings field missing: ${typed}`);
}

async function drawHighlights(cdp, boxes) {
  const result = await evaluate(
    cdp,
    `(() => {
      document.querySelector('#documentation-capture-highlights')?.remove();
      const boxes = ${JSON.stringify(boxes)};
      const style = ${JSON.stringify(HIGHLIGHT_STYLE)};
      const layer = document.createElement('div');
      layer.id = 'documentation-capture-highlights';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      const rects = [];
      for (const selectors of boxes) {
        const nodes = selectors.map((selector) => document.querySelector(selector));
        const missing = selectors.filter((_, index) => !nodes[index]);
        if (missing.length) return { missing };
        const bounds = nodes.map((node) => node.getBoundingClientRect());
        if (bounds.some((rect) => rect.width === 0 || rect.height === 0)) return { missing: selectors, invisible: true };
        const left = Math.max(0, Math.round(Math.min(...bounds.map((rect) => rect.left)) - style.padding));
        const top = Math.max(0, Math.round(Math.min(...bounds.map((rect) => rect.top)) - style.padding));
        const right = Math.min(innerWidth, Math.round(Math.max(...bounds.map((rect) => rect.right)) + style.padding));
        const bottom = Math.min(innerHeight, Math.round(Math.max(...bounds.map((rect) => rect.bottom)) + style.padding));
        const box = document.createElement('div');
        box.style.cssText = [
          'position:absolute',
          'box-sizing:border-box',
          'left:' + left + 'px',
          'top:' + top + 'px',
          'width:' + (right - left) + 'px',
          'height:' + (bottom - top) + 'px',
          'border:' + style.borderWidth + 'px solid ' + style.color,
          'border-radius:' + style.radius + 'px',
        ].join(';');
        layer.append(box);
        rects.push({ x: left, y: top, width: right - left, height: bottom - top });
      }
      document.body.append(layer);
      return { rects };
    })()`
  );
  if (!result.rects) throw new Error(`Highlight target missing: ${JSON.stringify(result)}`);
  return result.rects;
}

async function removeHighlights(cdp) {
  await evaluate(
    cdp,
    "(() => { document.querySelector('#documentation-capture-highlights')?.remove(); return true; })()"
  );
}

async function send(cdp, text) {
  await closeTransient(cdp);
  await setComposer(cdp, text);
  await click(cdp, ".composer .send:not(.stop)");
}

async function openCourses(cdp) {
  await closeTransient(cdp);
  await click(cdp, ".app-header-course-btn");
  await waitForSelector(cdp, ".courses-panel");
}

async function openWiki(cdp) {
  await openCourses(cdp);
  await click(cdp, ".proj-active .proj-more");
  await waitForSelector(cdp, ".pp-tabs");
  await click(cdp, '.pp-tabs [role="tab"]', 1);
  await waitForSelector(cdp, ".wiki-browser");
}

async function setupView({ cdp, provider, locale, viewId, state }) {
  const phrase = {
    working:
      locale === "de"
        ? "Halte diese synthetische Dokumentationsantwort offen, während ich den Arbeitsstatus prüfe."
        : "Keep this synthetic documentation answer open while I inspect the working state.",
    support:
      locale === "de"
        ? "Ändere meine dauerhafte Unterstützungspräferenz auf knapp."
        : "Change my lasting support preference to concise.",
    citation:
      locale === "de"
        ? "Zeige ein geprüftes Corpus-Zitat für das Dokumentationsbeispiel."
        : "Show a verified corpus citation for the documentation example.",
  };

  switch (viewId) {
    case "first-use-orientation":
      await setPanel(cdp, "left", false);
      await setPanel(cdp, "right", true);
      await waitForSelector(cdp, ".first-use-row:not([hidden])");
      return;
    case "workspace-orientation":
      await closeTransient(cdp);
      await setPanel(cdp, "left", true);
      await setPanel(cdp, "right", true);
      return;
    case "course-management":
      await openCourses(cdp);
      if (!(await evaluate(cdp, "Boolean(document.querySelector('.proj-create-input'))")))
        await click(cdp, ".proj-plus");
      await waitForSelector(cdp, ".proj-create-input");
      return;
    case "composer-plus-menu":
      await closeTransient(cdp);
      await setPanel(cdp, "left", false);
      await click(cdp, ".composer-plus");
      await waitForSelector(cdp, ".composer-menu");
      return;
    case "working-and-stop":
      await setPanel(cdp, "left", false);
      await send(cdp, phrase.working);
      await waitForSelector(cdp, ".working-disclosure-trigger");
      await waitForSelector(cdp, ".composer .send.stop");
      return;
    case "process-canvas":
      await closeTransient(cdp);
      await setPanel(cdp, "left", false);
      await setPanel(cdp, "right", true);
      await click(cdp, '.workspace > .panel:not(.panel-left) [role="tab"]', 0);
      await waitForSelector(cdp, ".artifacts-panel .artifact");
      return;
    case "maturity-reading":
      await closeTransient(cdp);
      await setPanel(cdp, "left", false);
      await setPanel(cdp, "right", true);
      await click(cdp, '.workspace > .panel:not(.panel-left) [role="tab"]', 1);
      await waitForSelector(cdp, ".maturity-row");
      return;
    case "wiki-browser":
      await openWiki(cdp);
      if (state === "graph" && !(await evaluate(cdp, "Boolean(document.querySelector('.wiki-graph'))"))) {
        await click(cdp, ".wiki-toolbar .pp-icon-btn");
      }
      if (state === "list" && (await evaluate(cdp, "Boolean(document.querySelector('.wiki-graph'))"))) {
        await click(cdp, ".wiki-toolbar .pp-icon-btn");
      }
      await waitForSelector(cdp, state === "graph" ? ".wiki-graph" : ".wiki-atom-row");
      return;
    case "wiki-ingestion-progress":
      await openWiki(cdp);
      if (await evaluate(cdp, "Boolean(document.querySelector('.wiki-graph'))")) {
        await click(cdp, ".wiki-toolbar .pp-icon-btn");
      }
      await click(cdp, ".wiki-ingest-actions .pp-action");
      try {
        await poll(
          async () => {
            const states = await evaluate(
              cdp,
              `({done: document.querySelectorAll('.wiki-ingest-done').length, running: document.querySelectorAll('.wiki-ingest-running').length})`
            );
            return states.done > 0 && states.running > 0 ? states : null;
          },
          { timeoutMs: 60_000, label: "one completed and one running Wiki ingest row" }
        );
      } catch (error) {
        if (process.env.CBE_DOCS_WIRE_DUMP) {
          await writeFile(process.env.CBE_DOCS_WIRE_DUMP, JSON.stringify(provider.requests, null, 2) + "\n");
        }
        throw error;
      }
      if (process.env.CBE_DOCS_WIRE_DUMP) {
        await writeFile(process.env.CBE_DOCS_WIRE_DUMP, JSON.stringify(provider.requests, null, 2) + "\n");
      }
      return;
    case "citation-source": {
      await closeTransient(cdp);
      await setPanel(cdp, "left", false);
      await send(cdp, phrase.citation);
      await waitForSelector(cdp, '.cite[data-citation-state="verified"]');
      const state = await evaluate(
        cdp,
        `({
          verified: document.querySelectorAll('.cite[data-citation-state="verified"]').length,
          unverified: document.querySelectorAll('.cite[data-citation-state="unverified"]').length,
          flag: Boolean(document.querySelector('.cite .cite-flag')),
        })`
      );
      if (state.verified !== 1 || state.unverified !== 0 || state.flag) {
        throw new Error(`Citation fixture did not reach one clean verified state: ${JSON.stringify(state)}`);
      }
      await click(cdp, '.cite[data-citation-state="verified"]');
      await waitForSelector(cdp, ".cite-modal .md-body");
      const detail = await evaluate(
        cdp,
        `({
          title: document.querySelector('.cite-modal-head h3')?.textContent ?? '',
          id: document.querySelector('.cite-modal-meta code')?.textContent ?? '',
          notFound: (document.querySelector('.cite-modal-head h3')?.textContent ?? '').toLowerCase().includes('not found'),
        })`
      );
      if (
        detail.title !== "The Challenge Based Learning Three-Phase Framework" ||
        detail.id !== "methodology-001" ||
        detail.notFound
      ) {
        throw new Error(`Citation fixture did not open the safe repository source: ${JSON.stringify(detail)}`);
      }
      return;
    }
    case "support-preference":
      await setPanel(cdp, "left", false);
      await send(cdp, phrase.support);
      await poll(
        async () => {
          const text = await evaluate(cdp, "document.querySelector('.chat-scroll')?.textContent ?? ''");
          return text.includes(locale === "de" ? "dauerhafte Unterstützungspräferenz" : "lasting support preference")
            ? true
            : null;
        },
        { timeoutMs: 45_000, label: "scripted support-preference confirmation" }
      );
      return;
    case "language-selector":
      await closeTransient(cdp);
      await click(cdp, ".header-language-trigger");
      await waitForSelector(cdp, ".header-language-listbox");
      return;
    case "attachment-and-wiki":
      await openWiki(cdp);
      if (await evaluate(cdp, "Boolean(document.querySelector('.wiki-graph'))")) {
        await click(cdp, ".wiki-toolbar .pp-icon-btn");
      }
      await waitForSelector(cdp, ".wiki-atom-row");
      await waitForSelector(cdp, ".composer-plus");
      return;
    case "profile":
      await closeTransient(cdp);
      await setPanel(cdp, "left", false);
      await setPanel(cdp, "right", true);
      if (state === "pane") {
        await click(cdp, ".app-header-right > .app-header-affordance:last-child");
        await waitForSelector(cdp, ".overlay-surface .profile-panel");
        await waitForSelector(cdp, ".profile-dim:has(.profile-dim-assumption)");
      }
      return;
    case "model-settings": {
      await closeTransient(cdp);
      await click(cdp, ".app-header-affordance", 1);
      await waitForSelector(cdp, ".overlay-surface .settings-panel");
      if (
        (await evaluate(
          cdp,
          `document.querySelector('[data-group="model"] > .set-acc-header')?.getAttribute('aria-expanded')`
        )) !== "true"
      ) {
        await click(cdp, '[data-group="model"] > .set-acc-header');
      }
      await waitForSelector(cdp, '[data-group="model"] .set-acc-body:not([hidden]) .llm-conn');
      await setModelFields(cdp, MODEL_EXAMPLE_VALUES);
      await waitForSelector(cdp, ".llm-conn-dirty");
      return;
    }
    default:
      throw new Error(`No setup driver for ${viewId}`);
  }
}

const OVERLAY_VIEWS = new Set(["model-settings"]);

async function normalizeCaptureScroll(cdp, viewId) {
  const metrics = await evaluate(
    cdp,
    `(() => {
      const scroll = document.querySelector('.chat-scroll');
      if (!scroll) return null;
      return { currentScrollTop: scroll.scrollTop };
    })()`
  );
  if (!metrics) throw new Error(`Missing chat scroll for ${viewId}`);
  const target = captureScrollTarget(viewId, metrics);
  if (target === null) {
    return { kind: "natural", chatScrollTop: metrics.currentScrollTop };
  }
  const state = await evaluate(
    cdp,
    `(() => {
      const scroll = document.querySelector('.chat-scroll');
      scroll.scrollTop = ${target};
      void scroll.offsetHeight;
      return {
        chatScrollTop: scroll.scrollTop,
        languageListOpen: Boolean(document.querySelector('.header-language-listbox')),
        overlayOpen: Boolean(document.querySelector('.overlay-backdrop:not([hidden]) .overlay-surface')),
      };
    })()`
  );
  if (state.chatScrollTop !== target) {
    throw new Error(`${viewId} scroll contract expected ${target}, got ${state.chatScrollTop}`);
  }
  if (viewId === "language-selector" && !state.languageListOpen) {
    throw new Error("language selector closed while normalizing its background scroll");
  }
  if (OVERLAY_VIEWS.has(viewId) && !state.overlayOpen) {
    throw new Error(`${viewId} overlay closed while normalizing its background scroll`);
  }
  return { kind: "background-top", chatScrollTop: target };
}

async function assertCaptureScrollContract(cdp, viewId, contract) {
  if (contract.kind === "natural") return;
  const current = await evaluate(
    cdp,
    `(() => ({
      chatScrollTop: document.querySelector('.chat-scroll').scrollTop,
      languageListOpen: Boolean(document.querySelector('.header-language-listbox')),
      overlayOpen: Boolean(document.querySelector('.overlay-backdrop:not([hidden]) .overlay-surface')),
    }))()`
  );
  if (current.chatScrollTop !== contract.chatScrollTop) {
    throw new Error(`${viewId} scroll moved before capture: ${current.chatScrollTop} != ${contract.chatScrollTop}`);
  }
  if (viewId === "language-selector" && !current.languageListOpen) throw new Error("language selector closed");
  if (OVERLAY_VIEWS.has(viewId) && !current.overlayOpen) throw new Error(`${viewId} overlay closed`);
}

async function captureLocale({ locale, outputRoot }) {
  const provider = await startScriptedProvider({ locale });
  const { scratch, schema } = await prepareScratch(locale, provider);
  let handle;
  const assets = [];
  const debugStates = [];
  try {
    handle = await launchElectron({
      repoRoot,
      scratchRoot: scratch,
      entry: electronEntry,
      env: {
        CBE_DOCS_PROVIDER_URL: provider.baseURL,
        CBE_DOCS_PICK_FILES: [
          path.join(fixtureRoot, "materials", "studio-brief.md"),
          path.join(fixtureRoot, "materials", "timetable.csv"),
        ].join(path.delimiter),
      },
      readySelector: ".composer textarea",
    });
    const { cdp } = handle;
    await evaluate(
      cdp,
      `(() => { localStorage.setItem('cbe-theme','light'); localStorage.setItem('cbe-accent','blue'); localStorage.setItem('cbe-chat-text-size','medium'); location.reload(); return true; })()`
    );
    await waitForSelector(cdp, ".composer textarea");
    await injectCaptureStyle(cdp);

    const byId = new Map(VIEW_MATRIX.map((view) => [view.id, view]));
    let onboardingDismissed = false;
    for (const [viewId, states] of CAPTURE_EXECUTION_ORDER) {
      const view = byId.get(viewId);
      for (const state of states) {
        const initialViewport = VIEWPORTS[view.viewports[0]];
        await setViewport(cdp, initialViewport);
        await setupView({ cdp, provider, locale, viewId, state });
        for (const viewportName of view.viewports) {
          const viewport = VIEWPORTS[viewportName];
          await setViewport(cdp, viewport);
          const selectors = view.ready.split(", ").map((selector) => selector.trim());
          for (const selector of selectors) await waitForSelector(cdp, selector);
          await poll(
            async () =>
              (await evaluate(
                cdp,
                "document.fonts.status === 'loaded' && document.fonts.check('16px DocumentationSans')"
              )) || null,
            { label: "loaded fixture font" }
          );
          const scrollContract = await normalizeCaptureScroll(cdp, viewId);
          const declaredHighlights = highlightsFor(view, state);
          const highlightRects = declaredHighlights.length ? await drawHighlights(cdp, declaredHighlights) : null;
          const filename = `${viewId}--${state}--${locale}--${viewportName}.png`;
          const debugState = await evaluate(
            cdp,
            `(() => ({
              viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
              fontStatus: document.fonts.status,
              fontApplied: getComputedStyle(document.body).fontFamily,
              activeElement: document.activeElement ? {
                tag: document.activeElement.tagName,
                id: document.activeElement.id,
                className: document.activeElement.className,
                text: document.activeElement.textContent?.slice(0, 200),
              } : null,
              open: {
                composerMenu: Boolean(document.querySelector('.composer-menu')),
                languageList: Boolean(document.querySelector('.header-language-listbox')),
                overlay: Boolean(document.querySelector('.overlay-surface:not([hidden])')),
                citation: Boolean(document.querySelector('.cite-modal')),
                highlights: document.querySelectorAll('#documentation-capture-highlights > div').length,
                wikiRunning: document.querySelectorAll('.wiki-ingest-running').length,
                wikiDone: document.querySelectorAll('.wiki-ingest-done').length,
              },
              scroll: [...document.querySelectorAll('.chat-scroll, .panel-content, .overlay-body')].map((node) => ({
                className: node.className,
                top: node.scrollTop,
                left: node.scrollLeft,
                height: node.scrollHeight,
                width: node.scrollWidth,
              })),
              citationStates: {
                verified: document.querySelectorAll('[data-citation-state="verified"]').length,
                unverified: document.querySelectorAll('[data-citation-state="unverified"]').length,
              },
              visibleText: (document.body?.innerText ?? '').slice(0, 30000),
            }))()`
          );
          assertNoUnverifiedCitationResidue(
            {
              visibleText: debugState.visibleText,
              unverifiedCitationStates: debugState.citationStates.unverified,
            },
            filename
          );
          const clearFocus = !["composer-plus-menu", "language-selector"].includes(viewId);
          const bytes = await captureCanonicalPng(cdp, viewport, { clearFocus });
          await assertCaptureScrollContract(cdp, viewId, scrollContract);
          if (highlightRects) await removeHighlights(cdp);
          if (viewId === "workspace-orientation" && viewportName === "desktop") {
            const repeated = await captureCanonicalPng(cdp, viewport, { clearFocus });
            assertPngBytesMatch(bytes, repeated, "Consecutive real-app workspace");
          }
          const destination = path.join(outputRoot, locale, filename);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, bytes);
          debugStates.push({
            path: `assets/screenshots/${locale}/${filename}`,
            state: { ...debugState, visibleTextSha256: sha256(debugState.visibleText) },
          });
          delete debugState.visibleText;
          assets.push({
            viewId,
            state,
            locale,
            viewport: viewportName,
            path: `assets/screenshots/${locale}/${filename}`,
            width: viewport.width * 2,
            height: viewport.height * 2,
            pngSha256: sha256(bytes),
            stateMetadata: {
              scroll: scrollContract,
              citationStates: debugState.citationStates,
              ...(highlightRects ? { highlights: highlightRects } : {}),
            },
            sourceFingerprints: await sourceFingerprint(view.owners),
          });
        }
      }
      if (viewId === "first-use-orientation" && !onboardingDismissed) {
        await click(cdp, ".first-use-actions button", 1);
        await waitForSelector(cdp, ".first-use-row:not([hidden])", { present: false });
        onboardingDismissed = true;
      }
      if (viewId === "working-and-stop") {
        await click(cdp, ".composer .send.stop");
        provider.releaseHolds();
        await waitForSelector(cdp, ".composer .send.stop", { present: false, timeoutMs: 30_000 });
        await poll(async () => (provider.heldCount === 0 ? true : null), {
          timeoutMs: 30_000,
          label: "no held provider response after Working/Stop",
        });
      }
      if (viewId === "model-settings") {
        // Return the form to the persisted connection so nothing is left unsaved,
        // then close the overlay before the final held Wiki-ingestion capture.
        await setModelFields(cdp, { baseURL: provider.baseURL, modelId: schema.providerModel, apiKey: "" });
        await waitForSelector(cdp, ".llm-conn-dirty", { present: false });
        await closeTransient(cdp);
        await waitForSelector(cdp, ".overlay-backdrop:not([hidden])", { present: false });
      }
      if (viewId === "wiki-ingestion-progress") {
        if (await evaluate(cdp, "Boolean(document.querySelector('.wiki-ingest-actions .pp-danger'))")) {
          await click(cdp, ".wiki-ingest-actions .pp-danger");
        }
        provider.releaseHolds();
      }
    }

    if (provider.unknownRoutes.length > 0) {
      throw new Error(`Scripted provider saw unknown routes: ${provider.unknownRoutes.join(", ")}`);
    }
    if (
      !provider.acceptedConnections.every(
        (route) => route === "GET /v1/models" || route === "POST /v1/chat/completions"
      )
    ) {
      throw new Error(`Unexpected loopback route: ${provider.acceptedConnections.join(", ")}`);
    }
    return { assets, debugStates, networkRoutes: [...new Set(provider.acceptedConnections)].sort(), schema };
  } finally {
    await stopElectron(handle).catch((error) => process.stderr.write(`${String(error)}\n`));
    await provider.close().catch((error) => process.stderr.write(`${String(error)}\n`));
    await rm(scratch, { recursive: true, force: true });
  }
}

async function run() {
  const lock = await open(lockPath, "wx").catch((error) => {
    throw new Error(`Another documentation screenshot lane is active (${lockPath}): ${error.message}`);
  });
  const existing = JSON.parse(await readFile(manifestPath, "utf8"));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cbe-user-docs-output-"));
  const outputRoot = mode === "write" ? committedAssetsRoot : temporary;
  try {
    if (mode === "write") {
      await rm(committedAssetsRoot, { recursive: true, force: true });
      await mkdir(committedAssetsRoot, { recursive: true });
    }
    const results = [];
    for (const locale of ["en", "de"]) results.push(await captureLocale({ locale, outputRoot }));
    const assets = results.flatMap((result) => result.assets).sort((a, b) => a.path.localeCompare(b.path));
    const expectedCount = captureCases().length;
    if (assets.length !== expectedCount)
      throw new Error(`Expected ${expectedCount} screenshot assets, captured ${assets.length}`);
    const currentFixtureFingerprint = await fixtureFingerprint();
    const currentCaptureDefinitionFingerprint = await captureDefinitionFingerprint();
    const generated = {
      ...existing,
      capture: {
        ...existing.capture,
        lane: "linux-xvfb-real-electron-cdp",
        realApplication: true,
        liveModel: false,
        sourceCommit: mode === "check" ? existing.capture.sourceCommit : gitHead(),
        capturedAt: "2026-10-27T12:00:00.000Z",
        fixtureFingerprint: currentFixtureFingerprint,
        captureDefinitionFingerprint: currentCaptureDefinitionFingerprint,
        networkRoutes: [...new Set(results.flatMap((result) => result.networkRoutes))].sort(),
      },
      assets,
    };

    if (mode === "write") {
      await writeFile(
        manifestPath,
        await formatWithPrettier(JSON.stringify(generated), { parser: "json", printWidth: 120, tabWidth: 2 })
      );
      process.stdout.write(`Captured ${assets.length} deterministic real-Electron screenshots.\n`);
      return;
    }

    const committed = JSON.parse(await readFile(manifestPath, "utf8"));
    if (JSON.stringify(generated) !== JSON.stringify(committed)) {
      const differences = [];
      const differingPaths = [];
      if (JSON.stringify(generated.capture) !== JSON.stringify(committed.capture)) {
        differences.push(
          `capture: expected ${JSON.stringify(committed.capture)}, got ${JSON.stringify(generated.capture)}`
        );
      }
      const expectedAssets = new Map(committed.assets.map((asset) => [asset.path, asset]));
      for (const asset of generated.assets) {
        const expected = expectedAssets.get(asset.path);
        if (!expected) differences.push(`${asset.path}: not present in committed manifest`);
        else if (JSON.stringify(asset) !== JSON.stringify(expected)) {
          const fields = Object.keys({ ...expected, ...asset }).filter(
            (field) => JSON.stringify(expected[field]) !== JSON.stringify(asset[field])
          );
          differences.push(`${asset.path}: ${fields.join(", ")}`);
          differingPaths.push(asset.path);
        }
      }
      if (process.env.CBE_DOCS_DIFF_OUTPUT) {
        const diffRoot = path.resolve(process.env.CBE_DOCS_DIFF_OUTPUT);
        await rm(diffRoot, { recursive: true, force: true });
        for (const assetPath of differingPaths) {
          const asset = generated.assets.find((candidate) => candidate.path === assetPath);
          if (!asset) continue;
          const filename = path.basename(assetPath);
          await mkdir(path.join(diffRoot, "fresh", asset.locale), { recursive: true });
          await mkdir(path.join(diffRoot, "committed", asset.locale), { recursive: true });
          await cp(path.join(temporary, asset.locale, filename), path.join(diffRoot, "fresh", asset.locale, filename));
          await cp(path.join(docsRoot, assetPath), path.join(diffRoot, "committed", asset.locale, filename));
        }
        await writeFile(
          path.join(diffRoot, "state-metadata.json"),
          JSON.stringify(
            {
              differences,
              freshAssets: generated.assets.filter((asset) => differingPaths.includes(asset.path)),
              committedAssets: committed.assets.filter((asset) => differingPaths.includes(asset.path)),
              debugStates: results.flatMap((result) => result.debugStates),
            },
            null,
            2
          ) + "\n"
        );
      }
      throw new Error(
        `Screenshot manifest metadata differs from a fresh real-Electron capture:\n${differences.slice(0, 20).join("\n")}`
      );
    }
    for (const asset of assets) {
      const fresh = await readFile(path.join(temporary, asset.locale, path.basename(asset.path)));
      const expected = await readFile(path.join(docsRoot, asset.path));
      if (!fresh.equals(expected)) throw new Error(`Screenshot bytes differ: ${asset.path}`);
    }
    process.stdout.write(`Verified ${assets.length} real-Electron screenshots byte-for-byte.\n`);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}

await run();
