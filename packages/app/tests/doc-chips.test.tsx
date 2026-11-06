/**
 * Tests for rendering ingested documents as doc chips in the transcript
 * (capability `desktop-app`, Requirement: Ingested Documents Render as Doc Chips, Not
 * Raw Text). A unique sentinel body string guards the "body absent from the DOM"
 * scenarios.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { useCbe, type Turn } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { uploadEntry } from "./helpers/composer.js";
import type { DocType } from "../src/shared/ipc-contract.js";

const SENTINEL = "SENTINEL_BODY_DO_NOT_DISPLAY_4f3a";

function seedSession(turns: Turn[] = []) {
  useCbe.setState({
    mode: "design",
    session: {
      sessionId: "test-session",
      mode: "design",
      environmentProfile: "app",
      courseId: "test-course",
      affordances: {},
      paths: { workspace: "/ws", corpus: "/c" },
    },
    turns,
  });
}

/** The ingestion entry point is the "+" menu's upload entry. */
const ingestBtn = () => uploadEntry();
const sendBtn = () => screen.getByRole("button", { name: en.chatSendLabel });
const composer = () => screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;

beforeEach(() => seedSession());
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("doc chips — transcript rendering", () => {
  it("renders an icon-plus-title chip, not the extracted text", async () => {
    // Scenario: Ingested document renders as an icon-plus-title chip, not the extracted text
    vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: SENTINEL,
        filename: "modul.pdf",
        docType: "pdf",
      },
    ]);
    render(<ChatPanel />);
    fireEvent.change(composer(), { target: { value: "Bitte transferieren" } });
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) }));
    fireEvent.click(sendBtn());

    // Chip shows in the transcript…
    await waitFor(() => expect(screen.getByRole("img", { name: /Attachment: modul\.pdf \(PDF\)/ })).toBeTruthy());
    // …and the body + envelope markers are absent from the rendered DOM.
    expect(document.body.textContent).not.toContain(SENTINEL);
    expect(document.body.textContent).not.toContain("BEGIN REFERENCE MATERIAL");
    expect(document.body.textContent).not.toContain("END REFERENCE MATERIAL");
  });

  it("renders visibly different icons for different formats", () => {
    // Scenario: The doc-type icon matches the document format. Every accepted format
    // is rendered, not just two: the pairwise assertion below is what would have
    // caught a new doc type sharing an existing glyph label — the way `.csv` could
    // have been added without one.
    const types: DocType[] = ["pdf", "docx", "pptx", "xlsx", "txt", "md", "csv"];
    seedSession([
      {
        role: "user",
        text: "mehrere Dokumente",
        attachments: types.map((docType) => ({ filename: `a.${docType}`, docType })),
      },
    ]);
    const { container } = render(<ChatPanel />);
    const labels = types.map((docType) => {
      const icon = container.querySelector(
        `.doc-chip[data-doctype="${docType}"] .doc-type-icon[data-doctype="${docType}"]`
      );
      expect(icon, `no chip icon rendered for ${docType}`).not.toBeNull();
      return icon!.textContent;
    });
    // Distinct per-format glyph label — every pair, so no two formats read alike.
    expect(new Set(labels).size).toBe(types.length);
    // The chip's ACCESSIBLE name carries the type too, from a second `Record<DocType, …>`
    // map in `DocChip.tsx`. Nothing type-checks the renderer in CI, so a new doc type
    // missing from either map is caught here or not at all.
    for (const docType of types) {
      expect(
        screen.getByRole("img", { name: new RegExp(`a\\.${docType} \\(${docType.toUpperCase()}\\)`) }),
        `no accessible chip name for ${docType}`
      ).toBeTruthy();
    }
  });

  it("is not expandable — no disclosure control and the body is absent from the DOM", async () => {
    // Scenario: The doc chip is not expandable
    vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: SENTINEL,
        filename: "modul.pdf",
        docType: "pdf",
      },
    ]);
    const { container } = render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) }));
    fireEvent.click(sendBtn());
    await waitFor(() => screen.getByRole("img", { name: /Attachment: modul\.pdf/ }));

    const chip = container.querySelector(".doc-chip")!;
    // no clickable disclosure inside the chip, no aria-expanded anywhere on it
    expect(chip.querySelector("button")).toBeNull();
    expect(chip.querySelector("[aria-expanded]")).toBeNull();
    // clicking the chip reveals nothing (body stays out of the DOM)
    fireEvent.click(chip);
    expect(document.body.textContent).not.toContain(SENTINEL);
  });

  it("exposes accessible names on the chip and on the pending-pill remove control", async () => {
    // Scenario: The doc chip and pending pill expose accessible names
    vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: "BODY",
        filename: "modul.pptx",
        docType: "pptx",
      },
    ]);
    const { container } = render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    // pending pill: the remove control carries an accessible name naming the file
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pptx" }) })
      ).toBeTruthy()
    );
    fireEvent.click(sendBtn());
    // transcript chip: single accessible name; decorative icon hidden from AT
    await waitFor(() => expect(screen.getByRole("img", { name: "Attachment: modul.pptx (PPTX)" })).toBeTruthy());
    expect(container.querySelector(".doc-chip .doc-type-icon")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders an attachment-only turn without an empty text bubble", async () => {
    // Scenario: An attachment-only turn renders chips without an empty text bubble
    vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: "BODY",
        filename: "modul.pdf",
        docType: "pdf",
      },
    ]);
    const { container } = render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) }));
    // send with an empty textarea
    fireEvent.click(sendBtn());
    await waitFor(() => screen.getByRole("img", { name: /Attachment: modul\.pdf/ }));

    const lecturerTurn = container.querySelector(".msg-lecturer")!;
    expect(lecturerTurn.querySelector(".doc-chip")).not.toBeNull();
    // no empty styled text bubble for the empty instruction
    expect(lecturerTurn.querySelector(".msg-text")).toBeNull();
  });

  it("renders the doc chip on the newest lecturer turn at the end of the flow", () => {
    // Scenario: The doc chip stays at the end of the flow, on its own lecturer turn
    seedSession([
      { role: "user", text: "erste Frage" },
      { role: "assistant", activity: [{ kind: "text", id: "1", text: "eine Antwort" }] },
      { role: "user", text: "", attachments: [{ filename: "modul.pdf", docType: "pdf" }] },
    ]);
    const { container } = render(<ChatPanel />);
    const msgs = Array.from(container.querySelectorAll(".msg"));
    const last = msgs[msgs.length - 1]!;
    // the chip lives on the last (newest) turn, which is a lecturer turn
    expect(last.classList.contains("msg-lecturer")).toBe(true);
    expect(last.querySelector(".doc-chip")).not.toBeNull();
    // earlier turns carry no chip
    expect(msgs.slice(0, -1).some((m) => m.querySelector(".doc-chip"))).toBe(false);
  });
});
