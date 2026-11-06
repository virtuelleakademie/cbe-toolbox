/**
 * Export sits in the CBE Process Canvas panel's control row (capability `desktop-app`,
 * Requirement: Collected UX-3 Fixes (Wave 1), scenario *Export sits in the
 * CBE Process Canvas panel's control row*).
 *
 * UX run 2: Export sat in a row of its own BELOW the annotation area, so the
 * lecturer had to look past the annotations to find it. It belongs on the same
 * level as the iterate control. The disabled state and its stated reason are unchanged —
 * `ux2-renderer-fixes.test.tsx` keeps guarding those.
 */
import { afterEach, describe, expect, it } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { seedConversation, testSession } from "./helpers/conversation.js";

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("Export sits in the CBE Process Canvas panel's control row", () => {
  it("shares the control row with the iterate control instead of sitting below the annotation area", () => {
    seedConversation({ session: testSession("s1", "c1") });
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Git in the times of AI" }));

    const { container } = render(<ArtifactsPanel />);
    const toolbar = container.querySelector(".artifacts-toolbar")!;
    expect(toolbar).toBeTruthy();

    const exportBtn = screen.getByRole("button", { name: /^Export$/ });
    const iterate = screen.getByRole("button", { name: en.canvasIterateLabel });
    expect(toolbar.contains(iterate)).toBe(true);
    expect(toolbar.contains(exportBtn)).toBe(true);

    // …and the export block is no longer a sibling row of the toolbar.
    const exportBlock = container.querySelector(".artifacts-export")!;
    expect(exportBlock.parentElement).toBe(toolbar);
  });

  it("keeps the stated unavailability reason inside the same control row", () => {
    seedConversation({ session: testSession("s1", "c1") });
    useCbe.setState({ agentRunning: true });

    const { container } = render(<ArtifactsPanel />);
    const toolbar = container.querySelector(".artifacts-toolbar")!;
    const reason = container.querySelector(".artifacts-export-reason")!;
    expect(reason.textContent).toMatch(/still working|agent/i);
    expect(toolbar.contains(reason)).toBe(true);
  });
});
