/**
 * Text selection is limited to content and input surfaces (capability
 * `desktop-app`, Requirement: Collected UX-3 Fixes (Wave 1), scenario *Text
 * selection is limited to content and input surfaces*).
 *
 * jsdom applies no stylesheet, so — like `text-size-scope.test.tsx` — the rule
 * is verified where it lives: in styles.css. Two halves:
 *   (a) the app is locked wholesale (`body { user-select: none }`), which is
 *       what makes the rule survive new controls, and
 *   (b) every content / input surface is re-opened by name, plus a render-time
 *       check that the classes in the allowlist are the ones the components
 *       actually emit — an allowlist naming a dead class protects nothing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { EndpointHintNotes } from "../src/renderer/components/EndpointHintNotes.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import type { MaturitySnapshot } from "@cbe/pi-bridge/maturity";
import { seedConversation, testSession } from "./helpers/conversation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS_PATH = resolve(__dirname, "../src/renderer/styles.css");
const RENDERER_DIR = resolve(__dirname, "../src/renderer");

/** styles.css with comments stripped — a rule must hold in the CSS, not in prose. */
function css(): string {
  return readFileSync(STYLES_CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Selectors of the rule that sets `user-select: text`. */
function selectableSelectors(): string[] {
  const rules = css().matchAll(/([^{}]+)\{([^}]*)\}/g);
  for (const [, selector, body] of rules) {
    if (/user-select:\s*text/.test(body!)) {
      return selector!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  throw new Error("no rule sets user-select: text");
}

/** Every `.tsx`/`.ts` source of the renderer, concatenated — used to prove that
 * an allowlisted class is one the renderer still emits. */
function rendererSources(dir = RENDERER_DIR): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return rendererSources(full);
      return /\.tsx?$/.test(e.name) ? readFileSync(full, "utf8") : "";
    })
    .join("\n");
}

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("Text selection is limited to content and input surfaces", () => {
  it("locks the whole app rather than each control individually", () => {
    const bodyRules = [...css().matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) =>
      sel!
        .split(",")
        .map((s) => s.trim())
        .includes("body")
    );
    expect(bodyRules.some(([, , decls]) => /user-select:\s*none/.test(decls!))).toBe(true);
  });

  it("re-opens the chat, the artefact and citation content, and every real input", () => {
    const selectors = selectableSelectors();
    for (const needed of [
      ".md", // markdown — chat turns, canvas artefacts, picker question
      ".msg-text", // the lecturer's own turns
      ".artifact-value", // artefacts the lecturer copies into their own documents
      ".cite-modal-body", // citations
      "input",
      "textarea",
    ]) {
      expect(selectors, `missing from the selectable allowlist: ${needed}`).toContain(needed);
    }
  });

  it("keeps error and status messages copyable", () => {
    const selectors = selectableSelectors();
    expect(selectors).toContain('[role="alert"]');
    expect(selectors).toContain(".chat-notice-text");
    expect(selectors).toContain(".chat-notice-hint");
    expect(selectors).toContain(".wiki-ingest-notice");
  });

  /* The general case, not the individual classes: an announced message is content
   * whichever of the two live-region roles carries it. Allowlisting `alert` alone
   * is what left the Settings connection-test result and the app-level notice
   * banner locked, and every further `role="status"` surface would have rotted the
   * same way. */
  it("re-opens announced messages by role, not one status class at a time", () => {
    const selectors = selectableSelectors();
    expect(selectors).toContain('[role="status"]');

    const sources = rendererSources();
    const statusSurfaces = [...sources.matchAll(/role="status"/g)];
    expect(statusSurfaces.length).toBeGreaterThan(0);
  });

  it("keeps the settings notes copyable — provider errors and the values they quote", () => {
    const selectors = selectableSelectors();
    for (const needed of [
      ".set-note", // connection-test result, unsaved/saved feedback, the suggested Azure endpoint URL
      ".set-val", // provider / corpus version values a lecturer quotes in a bug report
      ".set-tooltip", // the explanation behind a setting
    ]) {
      expect(selectors, `missing from the selectable allowlist: ${needed}`).toContain(needed);
    }
  });

  it("re-opens the panels' content surfaces, including text the lecturer authored", () => {
    const selectors = selectableSelectors();
    for (const needed of [
      ".annotation-note", // the lecturer's own annotation on an artefact
      ".picker-other-answer", // the lecturer's own free-text picker answer
      ".wiki-atom-row-title", // the title of the lecturer's own material
      ".wiki-atom-row-preview", // atom content in the browser list
      ".wiki-ingest-name", // the file that failed to ingest, beside its error
      ".maturity-gloss", // level descriptions
      ".maturity-hint", // agent-written gap hints, in the lecturer's language
      ".maturity-provenance", // why a reading is provisional / stale, incl. what changed
      ".maturity-assess-reason", // why the assess control is unavailable
      ".profile-evidence", // the agent's evidence for a calibration estimate
      ".artifacts-export-done", // the path the export was written to
      ".artifacts-export-reason", // why the export is unavailable
    ]) {
      expect(selectors, `missing from the selectable allowlist: ${needed}`).toContain(needed);
    }
  });

  it("names the settings classes the components actually emit", () => {
    const { container } = render(<EndpointHintNotes baseURL="https://bfh.openai.azure.com" />);
    const hint = container.querySelector(".set-note.set-note-hint");
    expect(hint?.textContent).toContain("https://bfh.openai.azure.com/openai/v1");
    expect(selectableSelectors()).toContain(".set-note");
  });

  it("carries no dead entries — every allowlisted class is one the renderer emits", () => {
    const sources = rendererSources();
    for (const selector of selectableSelectors()) {
      if (!selector.startsWith(".")) continue; // element / attribute selectors
      expect(sources, `allowlisted class is not emitted any more: ${selector}`).toContain(selector.slice(1));
    }
  });

  it("names classes the components actually emit", () => {
    seedConversation({
      session: testSession("s1", "c1"),
      turns: [
        { role: "user", text: "Ich will ein Modul zu Wasserknappheit." },
        { role: "assistant", activity: [{ kind: "text", id: "t-0", text: "Gerne — **erster Schritt**." }] },
      ],
    });
    const { container } = render(<ChatPanel />);
    const selectors = selectableSelectors();

    // The chat's own content carriers must be covered by the allowlist …
    for (const cls of [".msg-text", ".md"]) {
      expect(container.querySelector(cls), `${cls} is not rendered any more`).toBeTruthy();
      expect(selectors).toContain(cls);
    }
    // … and so must the composer the lecturer types into.
    expect(container.querySelector("textarea")).toBeTruthy();
  });

  it("names the panel classes the components actually emit", () => {
    seedConversation({ session: testSession("s1", "c1") });
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Git in the times of AI" }));
    act(() => useCbe.getState().addAnnotation("bigidea", "Git", "Bitte konkreter fassen."));
    const artifacts = render(<ArtifactsPanel />).container;
    fireEvent.click(artifacts.querySelector('[data-step="4"] .step-head') as HTMLElement);
    expect(artifacts.querySelector(".annotation-note")?.textContent).toBe("Bitte konkreter fassen.");

    const reading: MaturitySnapshot = {
      "societal-challenge": { current: 2, target: 2 },
      "stakeholder-involvement": { current: 1, target: 2, hint: "Einen Feedbackmoment einplanen." },
    };
    seedConversation({ session: testSession("s1", "c1"), maturity: reading });
    const maturity = render(<MaturityPanel />).container;
    expect(maturity.querySelector(".maturity-gloss")).toBeTruthy();
    expect(maturity.querySelector(".maturity-hint")?.textContent).toBe("Einen Feedbackmoment einplanen.");

    const selectors = selectableSelectors();
    for (const cls of [".annotation-note", ".maturity-gloss", ".maturity-hint"]) {
      expect(selectors).toContain(cls);
    }
  });
});

/**
 * The live-region allowance must not widen the rule (review finding
 * `role-status-opens-container-chrome`). `user-select` is inherited, so
 * allowlisting `[role="status"]` opens the whole container — every control and
 * every purely-announced state nested inside it — unless the allowance is
 * narrowed again.
 */
describe("The live-region allowance opens message text, not container chrome", () => {
  /** Selectors of every rule that sets `user-select: none`. */
  function lockedSelectors(): string[] {
    return [...css().matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , decls]) => /user-select:\s*none/.test(decls!))
      .flatMap(([, sel]) =>
        sel!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
  }

  /** CSS specificity of a single compound selector, as one comparable number.
   * `:not(x)` counts as the specificity of `x`, which is what makes an exemption
   * like `.hydration-pane:not([role="alert"])` outrank the bare `[role]` entry. */
  function specificity(selector: string): number {
    const flat = selector.replace(/:not\(([^)]*)\)/g, " $1 ");
    const ids = (flat.match(/#[\w-]+/g) ?? []).length;
    const classish = (flat.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
    const elements = (flat.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, " ").match(/[\w-]+/g) ?? []).length;
    return ids * 10_000 + classish * 100 + elements;
  }

  /** What styles.css actually resolves to for an element: the winning rule that
   * matches the element itself, else the value inherited from its ancestors
   * (`user-select` is an inherited property). This asks the MEANING of the
   * cascade rather than the spelling of a selector, so a later rename or
   * re-narrowing cannot quietly break the guarantee the assertions pin. */
  function userSelect(el: Element): "text" | "none" {
    const rules = [...css().matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map(([, sel, decls]) => ({
        selectors: sel!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        value: /(?:^|[;\s])user-select:\s*(text|none)/.exec(decls!)?.[1],
      }))
      .filter((r): r is { selectors: string[]; value: "text" | "none" } => r.value === "text" || r.value === "none");

    for (let node: Element | null = el; node; node = node.parentElement) {
      let winner: "text" | "none" | undefined;
      let best = -1;
      for (const rule of rules) {
        for (const selector of rule.selectors) {
          let matches = false;
          try {
            matches = node.matches(selector);
          } catch {
            matches = false; // vendor pseudo-elements etc. — never carry user-select
          }
          if (!matches) continue;
          const spec = specificity(selector);
          if (spec >= best) {
            best = spec;
            winner = rule.value;
          }
        }
      }
      if (winner) return winner;
    }
    return "text";
  }

  it("keeps the role pair that carries the message text", () => {
    const selectors = selectableSelectors();
    expect(selectors).toContain('[role="alert"]');
    expect(selectors).toContain('[role="status"]');
  });

  it("re-locks controls, so a dismiss button inside a notice stays chrome", () => {
    const locked = lockedSelectors();
    for (const control of ["button", '[role="button"]', "select", "summary"]) {
      expect(locked, `control not re-locked: ${control}`).toContain(control);
    }
  });

  it("re-locks the live regions that carry no lecturer message", () => {
    const locked = lockedSelectors();
    // Transient loading pane, the Working disclosure's visually-hidden announcement,
    // API-key state badge — announced state, not text the lecturer reuses. The
    // disclosure's trigger is a real button and re-locked above, but its hidden
    // `role="status"` span is not: without its own entry, dragging a selection
    // across a streaming answer copies an invisible stray "Working…". Each entry
    // exempts `role="alert"`: the same class may also carry a failure message.
    for (const cls of [".hydration-pane", ".working-disclosure-status", ".set-keystate"]) {
      const entry = locked.find((s) => s.startsWith(`${cls}:`) || s === cls);
      expect(entry, `announced-state container not re-locked: ${cls}`).toBeTruthy();
      expect(entry, `announced-state lock must not swallow a failure message: ${cls}`).toContain(
        ':not([role="alert"])'
      );
      expect(rendererSources()).toContain(cls.slice(1));
    }
  });

  it("keeps a failure message copyable while its own loading variant stays locked", () => {
    // `.hydration-pane` is BOTH panes in App.tsx — the transient `role="status"`
    // loading pane and the `role="alert"` boot failure whose message the
    // lecturer has to copy and pass on when the app will not start.
    const appSource = readFileSync(resolve(RENDERER_DIR, "App.tsx"), "utf8");
    expect(appSource).toMatch(/hydration-pane"\s+role="status"/);
    expect(appSource).toMatch(/hydration-pane"\s+role="alert"/);

    const { container } = render(
      <>
        <section className="conv hydration-pane" role="status" aria-busy="true" aria-label="Opening conversation">
          <div className="hydration-pane-inner">
            <div className="hydration-pane-title">Opening your conversation…</div>
            <div className="hydration-pane-sub">First run installs the agent runtime.</div>
          </div>
        </section>
        <section className="conv hydration-pane" role="alert" aria-label="Conversation could not be opened">
          <div className="hydration-pane-inner">
            <div className="hydration-pane-title">Could not open the conversation</div>
            <div className="hydration-pane-sub">ENOENT: agent runtime not found at pi-agent/bin/pi</div>
            <button type="button" className="send">
              Retry
            </button>
          </div>
        </section>
      </>
    );
    const [pending, failure] = [...container.querySelectorAll(".hydration-pane")];

    expect(userSelect(failure!.querySelector(".hydration-pane-sub")!)).toBe("text");
    expect(userSelect(pending!.querySelector(".hydration-pane-sub")!)).toBe("none");
    // The retry affordance is chrome wherever it sits — the exemption opens the
    // message, not the control beside it.
    expect(userSelect(failure!.querySelector("button")!)).toBe("none");
  });

  it("locks a control rendered inside an allowlisted live region", () => {
    // The concrete case from the finding: the chat notice is role="status", its
    // action buttons must not become selectable through inheritance.
    const { container } = render(
      <div role="status" className="chat-notice">
        <div className="chat-notice-text">Reasoning is off for this model.</div>
        <button type="button">Not now</button>
      </div>
    );
    const button = container.querySelector("button")!;
    expect(button).toBeTruthy();
    // The CSS rule that matches the element itself wins over the inherited
    // value, so a bare `button` selector is enough — no specificity bump needed.
    expect(lockedSelectors()).toContain("button");
    expect(selectableSelectors()).toContain(".chat-notice-text");
  });
});
