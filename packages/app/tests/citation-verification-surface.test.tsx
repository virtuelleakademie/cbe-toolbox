/**
 * The lecturer-visible citation surface (capability `desktop-app`, Requirement: *A
 * Citation Token Is Verified Against the Corpus Before It Is Linked*).
 *
 * One test per Scenario. The point of the requirement is that the lecturer can SEE the
 * difference between a checked citation and an unchecked one. Since the product authority's
 * decision of 2026-08-18 the identity prompt routes every token through `cbe_cite` and
 * licenses no self-written one, so host verification is the backstop for the tokens
 * that arrive without a call behind them anyway — not the condition that makes a second
 * route safe.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkdownView } from "../src/renderer/components/MarkdownView.js";
import { __resetCitationVerificationCache } from "../src/renderer/components/CitationLink.js";
import type { CitationVerification } from "../src/shared/ipc-contract.js";

function stubVerdict(verdict: CitationVerification | (() => Promise<CitationVerification>)) {
  __resetCitationVerificationCache();
  return vi
    .spyOn(window.cbe, "verifyCitation")
    .mockImplementation(typeof verdict === "function" ? verdict : async () => verdict);
}

const TOKEN = "(corpus:methodology-001 § Phase 1: Engage, Nichols et al. 2016)";

/** Wait for the citation to reach `state` — the verdict lands one microtask after
 * first paint, so waiting for "any citation element" would read the pending state. */
async function citationElement(state: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector(`[data-citation-state="${state}"]`);
    expect(el, `no citation in state "${state}"`).not.toBeNull();
    return el as HTMLElement;
  });
}

describe("A citation token is verified against the corpus before it is linked", () => {
  // Scenario: Verification runs in the main process over an IPC channel
  it("asks the main process to verify the token by id and section", async () => {
    const spy = stubVerdict({
      status: "verified",
      id: "methodology-001",
      section: "Phase 1: Engage",
      heading: "Phase 1: Engage",
    });
    render(<MarkdownView text={`Grounded here ${TOKEN}.`} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ id: "methodology-001", section: "Phase 1: Engage" }));
  });

  // Scenario: A verified token renders as an ordinary citation
  it("renders a verified token as an ordinary clickable citation with no marking", async () => {
    stubVerdict({
      status: "verified",
      id: "methodology-001",
      section: "Phase 1: Engage",
      heading: "Phase 1: Engage",
    });
    render(<MarkdownView text={`Grounded here ${TOKEN}.`} />);
    const el = await citationElement("verified");
    expect(el.tagName).toBe("BUTTON");
    expect(el.className).toBe("cite");
    expect(el.querySelector(".cite-flag")).toBeNull();
    expect(el.textContent).toContain("(corpus:methodology-001");
  });

  // Scenario: A token whose section matches no heading is marked, not silently linked
  it("marks a token whose section matches no heading and keeps it clickable", async () => {
    stubVerdict({
      status: "unknown-section",
      id: "methodology-001",
      section: "Resonanzstufen",
      headings: ["Phase 1: Engage", "Phase 2: Investigate"],
    });
    render(<MarkdownView text={"See (corpus:methodology-001 § Resonanzstufen)."} />);
    const el = await citationElement("unverified");
    expect(el.tagName).toBe("BUTTON");
    expect(el.className).toContain("cite-unverified");
    expect(el.querySelector(".cite-flag")!.textContent).toBe("unverified");
    expect(el.getAttribute("title")).toContain("matches no heading in methodology-001");
  });

  // Scenario: A token with no section is marked as unverified
  it("marks a token that carries no section", async () => {
    stubVerdict({ status: "missing-section", id: "methodology-002" });
    render(<MarkdownView text={"See (corpus:methodology-002)."} />);
    const el = await citationElement("unverified");
    expect(el.className).toContain("cite-unverified");
    expect(el.getAttribute("title")).toContain("no section given");
  });

  // Scenario: A token naming no corpus document is marked and not clickable
  it("marks a token whose id names no corpus document and does not render it as a link", async () => {
    stubVerdict({ status: "unknown-id", id: "assessment-991" });
    render(<MarkdownView text={"See (corpus:assessment-991 § Rubric construction)."} />);
    const el = await citationElement("unresolved");
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("cite-unresolved");
    expect(el.querySelector(".cite-flag")!.textContent).toBe("unresolved");
    expect(screen.queryByRole("button")).toBeNull();
    expect(el.getAttribute("title")).toContain('no corpus document "assessment-991"');
  });

  // Scenario: A pending verification does not change what the lecturer sees
  it("renders an ordinary citation while the verification answer is outstanding", async () => {
    let settle: (v: CitationVerification) => void = () => {};
    stubVerdict(() => new Promise<CitationVerification>((resolve) => (settle = resolve)));
    render(<MarkdownView text={`Grounded here ${TOKEN}.`} />);
    const el = await citationElement("pending");
    expect(el.className).toBe("cite");
    expect(el.querySelector(".cite-flag")).toBeNull();

    settle({ status: "missing-section", id: "methodology-001" });
    await waitFor(() =>
      expect(document.querySelector("[data-citation-state]")!.getAttribute("data-citation-state")).toBe("unverified")
    );
  });

  // Scenario: A wiki token is never verified and never marked
  it("issues no verification call for a wiki token and renders it unmarked and clickable", async () => {
    const spy = stubVerdict({ status: "unknown-id", id: "concept/cognitive-load" });
    render(<MarkdownView text={"Grounded in (wiki:concept/cognitive-load § Germane load, Sweller 1988)."} />);
    const el = await citationElement("wiki");
    // Even a verifier that WOULD answer "unknown-id" is never asked: the wiki
    // three-state machinery does not exist, cbe_cite validated at production time.
    expect(spy).not.toHaveBeenCalled();
    expect(el.tagName).toBe("BUTTON");
    expect(el.className).toBe("cite");
    expect(el.querySelector(".cite-flag")).toBeNull();
    expect(el.getAttribute("title")).toBe("Open wiki atom concept/cognitive-load");
  });

  it("still verifies a corpus token rendered alongside a wiki token", async () => {
    const spy = stubVerdict({
      status: "verified",
      id: "methodology-001",
      section: "Phase 1: Engage",
      heading: "Phase 1: Engage",
    });
    render(<MarkdownView text={`Both ${TOKEN} and (wiki:concept/cognitive-load § Sources).`} />);
    await citationElement("verified");
    await citationElement("wiki");
    // Exactly the corpus token went through the backstop.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: "methodology-001", section: "Phase 1: Engage" });
  });

  it("leaves the citation unmarked when the host lookup itself fails", async () => {
    // A host fault is not a citation defect and must not be shown to the lecturer as one.
    stubVerdict(async () => {
      throw new Error("no corpus loaded");
    });
    render(<MarkdownView text={`Grounded here ${TOKEN}.`} />);
    const el = await citationElement("pending");
    expect(el.className).toBe("cite");
  });
});
