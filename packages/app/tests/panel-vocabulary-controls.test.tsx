/**
 * The two panel controls name their own surface in the CBE vocabulary
 * (change `name-panel-surfaces-in-cbe-vocabulary`, tasks.md 3.2).
 *
 * The rename itself shipped with that change; what was carried over is the
 * POSITIVE naming in the two controls' chrome. A reason line that says only
 * "nothing to export yet" or "no conversation is open yet" leaves the lecturer
 * to guess which surface it is talking about — the panel names are the app's
 * shared vocabulary, so the controls use them.
 *
 * The retired label is asserted absent here too, in the same strings, so a
 * future edit cannot reintroduce it through the reason texts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import { seedConversation, testSession } from "./helpers/conversation.js";

const RETIRED = /Artefakte|Artefacts|Artifacts/;

beforeEach(() => {
  useCbe.getState().reset();
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("The export control names the CBE Process Canvas panel", () => {
  it("names the panel in the nothing-to-export reason, on hover and in the reason line", () => {
    seedConversation({ session: testSession("s1", "c1") });
    const { container } = render(<ArtifactsPanel />);
    const btn = screen.getByRole("button", { name: /^Export$/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toContain("CBE Process Canvas");
    const reason = container.querySelector(`#${btn.getAttribute("aria-describedby")}`)!;
    expect(reason.textContent).toContain("CBE Process Canvas");
    expect(reason.textContent).not.toMatch(RETIRED);
  });

  it("names the panel in the enabled control's own hover text", () => {
    seedConversation({ session: testSession("s1", "c1") });
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Git in the times of AI" }));

    render(<ArtifactsPanel />);
    const btn = screen.getByRole("button", { name: /^Export$/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("title")).toContain("CBE Process Canvas");
    expect(btn.getAttribute("title")).not.toMatch(RETIRED);
  });
});

describe("The Assess maturity control names the CBE Maturity panel", () => {
  it("names the panel in the no-session reason", () => {
    const { container } = render(<MaturityPanel />);
    const btn = screen.getByRole("button", { name: /Assess maturity/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toContain("CBE Maturity");
    const reason = container.querySelector(`#${btn.getAttribute("aria-describedby")}`)!;
    expect(reason.textContent).toContain("CBE Maturity");
  });

  it("names the panel in the run-lock reason, without losing the run-lock statement", () => {
    seedConversation({ session: testSession("s1", "c1") });
    useCbe.setState({ agentRunning: true });

    const { container } = render(<MaturityPanel />);
    const btn = screen.getByRole("button", { name: /Assess maturity/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/still working/i);
    expect(btn.getAttribute("title")).toContain("CBE Maturity");
    const reason = container.querySelector(`#${btn.getAttribute("aria-describedby")}`)!;
    expect(reason.textContent).toContain("CBE Maturity");
  });

  it("names the panel in the enabled control's own hover text", () => {
    seedConversation({ session: testSession("s1", "c1") });
    useCbe.setState({ agentRunning: false });

    render(<MaturityPanel />);
    const btn = screen.getByRole("button", { name: /Assess maturity/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("title")).toContain("CBE Maturity");
  });
});
