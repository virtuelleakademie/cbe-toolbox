/**
 * Tests for the composer's ingestion entry point — the "+" menu's `Dateien
 * hochladen` entry — and the pending-attachment pills. The delivery half of
 * capability `desktop-app` (the extraction half is `tests/ingestion.test.ts`).
 * Covers Requirement: Ingested Documents Appear as Pending Attachments in the
 * Composer, and the entry-point presentation scenarios of Requirement: Material
 * Ingestion Stub into the Chat Context (change
 * reshape-the-composer-in-the-llama-cpp-look moved the trigger out of the text
 * field; everything downstream of the file dialog is unchanged).
 *
 * The pill model replaced the old envelope-in-the-textarea behaviour: ingesting adds a
 * removable pill and leaves the textarea clean; the envelope is built at send time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import { ANY_REMOVE_ATTACHMENT, entryDisabled, queryUploadEntry, uploadEntry } from "./helpers/composer.js";
import { SUPPORTED_EXTENSIONS } from "../src/main/ingestion.js";
import { ingestFormatNames } from "@cbe/pi-bridge/ingest-formats";

function seedSession(affordances: Record<string, boolean> = {}) {
  // Conversation state is per-session (slice + visible mirror); events routed
  // by the app-level demux only land in an existing slice.
  seedConversation({ session: { ...testSession(), affordances } });
}

const composer = () => screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
/** The ingestion entry point is the "+" menu's upload entry. */
const ingestBtn = () => uploadEntry();

beforeEach(() => seedSession());
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("ingest button — pending attachments", () => {
  it("adds a pending-attachment pill and leaves the textarea unchanged", async () => {
    // Scenario: Ingesting a document adds a pending-attachment pill, not composer text
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: "Lernziel: Stakeholder-Impact-Mapping",
        filename: "modul.docx",
        docType: "docx",
      },
    ]);
    render(<ChatPanel />);
    fireEvent.change(composer(), { target: { value: "Bitte transferiere das" } });
    fireEvent.click(ingestBtn());
    // pill appears (remove control names the file)…
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.docx" }) })
      ).toBeTruthy()
    );
    // …and the textarea content is untouched — no raw text, no envelope inserted.
    expect(composer().value).toBe("Bitte transferiere das");
    expect(composer().value).not.toContain("REFERENCE MATERIAL");
    expect(composer().value).not.toContain("Lernziel");
  });

  it("removes a pending attachment before sending so it never reaches the payload", async () => {
    // Scenario: A pending attachment can be removed before sending
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile")
      .mockResolvedValueOnce([{ ok: true, text: "AAA", filename: "a.txt", docType: "txt" }])
      .mockResolvedValueOnce([{ ok: true, text: "BBB", filename: "b.txt", docType: "txt" }]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "a.txt" }) }));
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "b.txt" }) }));
    // remove a.txt, keep b.txt
    fireEvent.click(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "a.txt" }) }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "a.txt" }) })).toBeNull()
    );
    fireEvent.click(screen.getByRole("button", { name: en.chatSendLabel }));
    await waitFor(() => expect(sendSpy).toHaveBeenCalled());
    const payload = sendSpy.mock.calls[0]![1];
    expect(payload).toContain("BBB");
    expect(payload).not.toContain("AAA");
  });

  it("stacks two same-named documents as independently removable pills", async () => {
    // Scenario: Multiple documents stack as independently removable pending attachments
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: "BODY",
        filename: "modul.pdf",
        docType: "pdf",
      },
    ]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) })
      ).toHaveLength(1)
    );
    fireEvent.click(ingestBtn());
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) })
      ).toHaveLength(2)
    );
    // removing one (by id) leaves exactly one — same filename, independent identity
    fireEvent.click(
      screen.getAllByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) })[0]!
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) })
      ).toHaveLength(1)
    );
  });

  it("preserves the pending attachments when a send fails, so the lecturer can retry", async () => {
    // Scenario: A failed send preserves the pending attachments for retry
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: "BODY",
        filename: "modul.pdf",
        docType: "pdf",
      },
    ]);
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(new Error("Agent is already processing"));
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) }));
    fireEvent.click(screen.getByRole("button", { name: en.chatSendLabel }));
    // notice surfaces (English catalog copy — Tiered Error Surfacing) AND the
    // pill is restored to the composer
    await waitFor(() => expect(screen.getByText(/assistant is still working/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) })).toBeTruthy();
  });

  it("surfaces a non-fatal notice for an unsupported file and adds no pill", async () => {
    // Scenario: An unsupported or empty ingest adds no pill (unsupported branch)
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: false,
        unsupported: true,
        filename: "bild.png",
        message: en.ingestUnsupportedFormat({ ext: ".png", supported: SUPPORTED_EXTENSIONS.join(", ") }),
      },
    ]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() =>
      expect(
        screen.getByText(en.ingestUnsupportedFormat({ ext: ".png", supported: SUPPORTED_EXTENSIONS.join(", ") }))
      ).toBeTruthy()
    );
    expect(screen.queryByRole("button", { name: ANY_REMOVE_ATTACHMENT })).toBeNull();
    expect(composer().value).toBe("");
  });

  it("surfaces a notice for an empty extraction and adds no pill", async () => {
    // Scenario: An unsupported or empty ingest adds no pill (empty-extraction branch)
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: "   \n  ",
        filename: "scan.pdf",
        docType: "pdf",
      },
    ]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() =>
      expect(
        screen.getByText(
          new RegExp(en.chatNoTextExtractedProblem({ filename: "scan.pdf" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        )
      ).toBeTruthy()
    );
    expect(screen.queryByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "scan.pdf" }) })).toBeNull();
  });

  it("does nothing when the lecturer cancels the file dialog", async () => {
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue(null);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await Promise.resolve();
    expect(composer().value).toBe("");
    expect(screen.queryByRole("button", { name: ANY_REMOVE_ATTACHMENT })).toBeNull();
  });

  it("removes the upload entry when the ingestion affordance is off", () => {
    // Scenario: Menu entry respects affordance gating and the run lock (affordance branch)
    seedSession({ ingestion: false });
    render(<ChatPanel />);
    expect(queryUploadEntry()).toBeNull();
  });
});

describe("ingest entry point — the menu entry, not an in-field icon", () => {
  // Scenario: The ingestion entry point is a menu entry, not an in-field icon
  it("is the '+' menu's upload entry, with no control inside the text field", async () => {
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: "BODY",
        filename: "modul.pdf",
        docType: "pdf",
      },
    ]);
    const { container } = render(<ChatPanel />);
    // Nothing is anchored inside the text field any more: the textarea is a
    // direct child of the card, with no positioning wrapper around it.
    expect(container.querySelector(".composer-input")).toBeNull();
    const field = composer();
    expect(field.parentElement?.className).toContain("composer-box");
    // The card is the frame; the textarea has no positioning wrapper of its own
    // that a control could be anchored inside.
    expect(field.querySelector("button")).toBeNull();

    const entry = ingestBtn();
    // The entry's label doubles as its accessible name; the tooltip names the
    // supported formats.
    expect(entry.textContent?.trim()).toBe(en.chatUploadEntryLabel);
    // Derived, never spelled out: a hand-written list here goes red for the wrong reason
    // the next time a format is added, which is exactly the drift the single-owner rule
    // exists to prevent (see `ingest-format-authority.test.ts`).
    expect(entry.getAttribute("title")).toBe(en.chatIngestFormatsHint({ formats: ingestFormatNames() }));
    expect(entry.closest(".composer-menu")).not.toBeNull();

    // Same ingestion flow as before: activate → file dialog → pending pill.
    fireEvent.click(entry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) })).toBeTruthy()
    );
  });

  it("is disabled — with aria-disabled, staying focusable — while an agent run is in flight", () => {
    // Scenario: Menu entry respects affordance gating and the run lock (lock branch)
    const dialog = vi.spyOn(window.cbe, "ingestFile").mockResolvedValue(null);
    render(<ChatPanel />);
    expect(entryDisabled(uploadEntry())).toBe(false);
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    const locked = uploadEntry();
    expect(entryDisabled(locked)).toBe(true);
    // `aria-disabled`, never the `disabled` attribute — it stays focusable and
    // announced, and it carries its reason as its accessible description.
    expect(locked.hasAttribute("disabled")).toBe(false);
    locked.focus();
    expect(document.activeElement).toBe(locked);
    const reason = document.getElementById(locked.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(en.chatComposerLockedReason);
    // Activating it dispatches nothing.
    fireEvent.click(locked);
    expect(dialog).not.toHaveBeenCalled();
    emitAgentEvent({ type: "agent_end", data: { sessionId: "test-session" } });
    expect(entryDisabled(uploadEntry())).toBe(false);
  });
});

describe("ingest button — multiselect file dialog", () => {
  it("turns three files from one dialog pass into independent pills in selection order", async () => {
    // Scenario: Multiple files selected in one dialog pass become independent pending attachments
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      { ok: true, text: "AAA", filename: "a.pdf", docType: "pdf" },
      { ok: true, text: "BBB", filename: "b.docx", docType: "docx" },
      { ok: true, text: "CCC", filename: "c.md", docType: "md" },
    ]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() => expect(screen.getAllByRole("button", { name: ANY_REMOVE_ATTACHMENT })).toHaveLength(3));
    // selection order is preserved in the pill list
    const names = screen
      .getAllByRole("button", { name: ANY_REMOVE_ATTACHMENT })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      en.chatRemoveAttachmentLabel({ filename: "a.pdf" }),
      en.chatRemoveAttachmentLabel({ filename: "b.docx" }),
      en.chatRemoveAttachmentLabel({ filename: "c.md" }),
    ]);
    // each pill is independently removable, exactly as with sequential single ingests
    fireEvent.click(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "b.docx" }) }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: ANY_REMOVE_ATTACHMENT })).toHaveLength(2));
    expect(screen.queryByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "b.docx" }) })).toBeNull();
  });

  it("keeps the good files of a mixed batch and names the failed ones in one notice", async () => {
    // Scenario: A failing file in a multiselect batch does not discard the others
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      { ok: true, text: "AAA", filename: "a.pdf", docType: "pdf" },
      {
        ok: false,
        unsupported: true,
        filename: "bild.png",
        message: en.ingestUnsupportedFormat({ ext: ".png", supported: SUPPORTED_EXTENSIONS.join(", ") }),
      },
      { ok: true, text: "   \n  ", filename: "scan.pdf", docType: "pdf" },
      { ok: true, text: "BBB", filename: "b.md", docType: "md" },
    ]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    // both good files become pills…
    await waitFor(() =>
      expect(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "a.pdf" }) })).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "b.md" }) })).toBeTruthy();
    // …the failed and the empty file do not…
    expect(screen.queryByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "scan.pdf" }) })).toBeNull();
    // …and one combined notice names both problems.
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(
      en.ingestUnsupportedFormat({ ext: ".png", supported: SUPPORTED_EXTENSIONS.join(", ") })
    );
    expect(notice.textContent).toContain("scan.pdf");
    expect(notice.textContent).toContain(en.chatNoTextExtractedProblem({ filename: "scan.pdf" }));
  });
});
