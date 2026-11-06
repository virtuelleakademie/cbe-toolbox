/**
 * Tests for the send path of ingested documents — the payload/display split
 * (capability `desktop-app`, Requirements: Ingested Material Carries an Orientation
 * Envelope; Ingested Document Display Is Separated From Its Model Payload).
 *
 * The model prompt carries the full envelope(s); the displayed turn carries only
 * instruction + {filename, docType}. A unique sentinel body string lets us assert the
 * body reaches the model payload but never the displayed/stored turn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { uploadEntry } from "./helpers/composer.js";

const SENTINEL = "SENTINEL_BODY_DO_NOT_DISPLAY_4f3a";

function seedSession() {
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
    turns: [],
  });
}

const composer = () => screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
/** The ingestion entry point is the "+" menu's upload entry. */
const ingestBtn = () => uploadEntry();
const sendBtn = () => screen.getByRole("button", { name: en.chatSendLabel });

beforeEach(() => seedSession());
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("ingest send — payload composition", () => {
  it("places one envelope per document in ingestion order, instruction first", async () => {
    // Scenario: Each ingested document contributes its own envelope to the payload
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile")
      .mockResolvedValueOnce([{ ok: true, text: "AAA", filename: "a.pdf", docType: "pdf" }])
      .mockResolvedValueOnce([{ ok: true, text: "BBB", filename: "b.docx", docType: "docx" }]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "a.pdf" }) }));
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "b.docx" }) }));
    fireEvent.change(composer(), { target: { value: "Vergleiche beide" } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(sendSpy).toHaveBeenCalled());
    const payload = sendSpy.mock.calls[0]![1];
    expect(payload).toContain('REFERENCE MATERIAL: "a.pdf"');
    expect(payload).toContain('REFERENCE MATERIAL: "b.docx"');
    // instruction first, then a.pdf, then b.docx — ingestion (pill) order
    expect(payload.indexOf("Vergleiche beide")).toBe(0);
    expect(payload.indexOf('"a.pdf"')).toBeLessThan(payload.indexOf('"b.docx"'));
  });

  it("with an empty textarea sends the envelope alone (non-empty), no leading instruction", async () => {
    // Scenario: Instruction precedes the envelope, and an empty instruction yields the envelope alone
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: SENTINEL,
        filename: "modul.pdf",
        docType: "pdf",
      },
    ]);
    render(<ChatPanel />);
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) }));
    // Scenario: A turn with a pending attachment is sendable with an empty textarea
    expect((sendBtn() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(sendBtn());
    await waitFor(() => expect(sendSpy).toHaveBeenCalled());
    const payload = sendSpy.mock.calls[0]![1];
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.startsWith("[Lecturer-supplied reference material")).toBe(true); // envelope header, no instruction prefix
    expect(payload).toContain(SENTINEL);
  });

  it("separates the model payload (full envelope) from the displayed turn (metadata only)", async () => {
    // Scenario: The turn's model payload and its displayed record are separated
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      {
        ok: true,
        text: SENTINEL,
        filename: "modul.docx",
        docType: "docx",
      },
    ]);
    render(<ChatPanel />);
    fireEvent.change(composer(), { target: { value: "Transferiere das" } });
    fireEvent.click(ingestBtn());
    await waitFor(() => screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.docx" }) }));
    fireEvent.click(sendBtn());
    await waitFor(() => expect(sendSpy).toHaveBeenCalled());

    // Model payload: full envelope incl. the sentinel body.
    const payload = sendSpy.mock.calls[0]![1];
    expect(payload).toContain(SENTINEL);

    // Displayed/stored turn: instruction + metadata only, never the body.
    const userTurn = useCbe.getState().turns.find((t) => t.role === "user");
    expect(userTurn).toMatchObject({
      role: "user",
      text: "Transferiere das",
      attachments: [{ filename: "modul.docx", docType: "docx" }],
    });
    expect(JSON.stringify(userTurn)).not.toContain(SENTINEL);
  });
});
