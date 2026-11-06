/**
 * Tests for the Artifact Annotation and Iteration Loop.
 *
 * Covers `specs/desktop-app/spec.md`, Requirement: Artifact Annotation and
 * Iteration Loop (Phase 2) — all three scenarios:
 *  - Annotation triggers a new chat turn with structured payload
 *  - The iterate button is disabled without annotations
 *  - Annotation layer resets on artifact replacement
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { fireEvent, render, screen, cleanup, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { buildIterationPayload, type ArtifactAnnotation } from "../src/renderer/util/annotations.js";

function seedSession() {
  useCbe.setState({
    session: {
      sessionId: "sess-1",
      mode: "design",
      environmentProfile: "app",
      courseId: "test-course",
      affordances: {},
      paths: { workspace: "/ws", corpus: "/c" },
    },
    annotations: [],
  });
}

beforeEach(() => seedSession());
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("buildIterationPayload", () => {
  it("renders a header with the count and one numbered line per annotation", () => {
    const anns: ArtifactAnnotation[] = [
      { id: "1", artifactId: "bigidea", excerpt: "Resilience", note: "zu breit, fokussieren" },
      { id: "2", artifactId: "eq", excerpt: "How does our region…", note: "lernerseitig formulieren" },
    ];
    const text = buildIterationPayload(anns);
    expect(text).toContain("[artifact iteration · 2 annotations]");
    expect(text).toContain('1. "Resilience" — zu breit, fokussieren');
    expect(text).toContain('2. "How does our region…" — lernerseitig formulieren');
  });

  it("uses the singular form for a single annotation", () => {
    const text = buildIterationPayload([{ id: "1", artifactId: "x", excerpt: "e", note: "n" }]);
    expect(text).toContain("[artifact iteration · 1 annotation]");
  });
});

describe("The iterate button", () => {
  it("is disabled without annotations", () => {
    render(<ArtifactsPanel />);
    const btn = screen.getByRole("button", { name: en.canvasIterateLabel }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("enables once an annotation exists and sends a structured chat turn on click", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.setState({
      annotations: [
        { id: "a1", artifactId: "bigidea", excerpt: "Resilience", note: "zu breit" },
        { id: "a2", artifactId: "eq", excerpt: "How does our region…", note: "lernerseitig" },
      ],
    });
    render(<ArtifactsPanel />);
    const btn = screen.getByRole("button", { name: en.canvasIterateLabel }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [sessionId, text] = sendSpy.mock.calls[0]!;
    expect(sessionId).toBe("sess-1");
    expect(text).toContain("[artifact iteration · 2 annotations]");
    expect(text).toContain('"Resilience" — zu breit');
    expect(text).toContain('"How does our region…" — lernerseitig');
  });

  it("does not send when there is no active session", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.setState({
      session: null,
      annotations: [{ id: "a1", artifactId: "bigidea", excerpt: "Resilience", note: "x" }],
    });
    render(<ArtifactsPanel />);
    expect((screen.getByRole("button", { name: en.canvasIterateLabel }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("adding annotations via the artifact row", () => {
  it("a note typed on an artifact becomes an annotation anchored to that artifact", () => {
    // Populate the Big Idea first (cold seed is empty) so the annotation excerpt is meaningful.
    useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" });
    const { container } = render(<ArtifactsPanel />);
    // The Big Idea lives under Step 4 (challenge ladder) — expand it.
    fireEvent.click(container.querySelector('[data-step="4"] .step-head') as HTMLElement);
    const bigIdea = document.querySelector('[data-artifact-id="bigidea"]') as HTMLElement;
    expect(bigIdea).toBeTruthy();
    fireEvent.click(within(bigIdea).getByRole("button", { name: en.canvasAnnotateToggleLabel }));
    const input = within(bigIdea).getByPlaceholderText(en.canvasAnnotationInputPlaceholder);
    fireEvent.change(input, { target: { value: "zu breit, fokussieren" } });
    fireEvent.click(within(bigIdea).getByRole("button", { name: en.canvasAnnotationAddLabel }));

    const anns = useCbe.getState().annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]).toMatchObject({ artifactId: "bigidea", excerpt: "Resilience", note: "zu breit, fokussieren" });
  });
});

describe("annotation layer resets on artifact replacement", () => {
  it("dropping the replaced artifact's annotations leaves other artifacts' annotations intact", () => {
    useCbe.setState({
      annotations: [
        { id: "a1", artifactId: "bigidea", excerpt: "Resilience", note: "note A" },
        { id: "a2", artifactId: "bigidea", excerpt: "Resilience", note: "note A2" },
        { id: "b1", artifactId: "eq", excerpt: "How does our region…", note: "note B" },
      ],
    });
    // The skill delivers a revised "bigidea" artifact that replaces the previous one.
    useCbe.getState().resetAnnotationsForArtifact("bigidea");
    const anns = useCbe.getState().annotations;
    expect(anns.map((a) => a.artifactId)).toEqual(["eq"]);
  });

  it("clears the whole layer after a successful iteration round (fresh round)", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.setState({
      annotations: [{ id: "a1", artifactId: "bigidea", excerpt: "Resilience", note: "x" }],
    });
    render(<ArtifactsPanel />);
    fireEvent.click(screen.getByRole("button", { name: en.canvasIterateLabel }));
    // sendPrompt resolves on the microtask queue; flush it.
    await Promise.resolve();
    await Promise.resolve();
    expect(useCbe.getState().annotations).toEqual([]);
  });
});
