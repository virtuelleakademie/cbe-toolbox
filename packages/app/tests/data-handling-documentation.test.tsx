/**
 * The data-handling disclosure lives in the documentation, not in the app
 * (capability `desktop-app`, Requirement: Data-Handling Disclaimer, as amended by
 * change `move-the-data-handling-disclaimer-to-documentation`; operationalises the
 * stakeholder requirement `legal-data-info`).
 *
 * One test per Scenario:
 *   - The documentation carries all three facts
 *   - The app carries no data-handling disclaimer surface
 *   - The documentation says where to read the governing provider
 *   - The facts are reachable from where lecturers are sent
 *
 * The document half follows `closed-testing-note.test.ts`: the obligation is that
 * the FACTS are stated, so a test that only checked the file exists would let the
 * transparency obligation be dropped silently while looking green.
 */
import { readFileSync } from "node:fs";
import { en } from "../src/shared/i18n/en.js";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import { uploadEntry } from "./helpers/composer.js";

// vitest root is packages/app, so the repo-root files are two levels up.
const repoFile = (rel: string) => readFileSync(path.resolve(process.cwd(), "../..", rel), "utf8");

const DOC_PATH = "docs/data-handling.md";
const doc = repoFile(DOC_PATH);

describe("The documentation carries all three facts", () => {
  it("fact 1 — what the lecturer submits is stored locally only, on their own device", () => {
    expect(doc).toMatch(/stored locally only/i);
    expect(doc).toMatch(/your\s+own device/i);
    // "locally only" has to mean something: no server holds a copy.
    expect(doc).toMatch(/no CBE Toolbox operator server[\s\S]{0,200}third-party server/i);
  });

  it("fact 2 — the configured language model reads it in order to answer", () => {
    expect(doc).toMatch(/language model you configured reads what you submit/i);
    expect(doc).toMatch(/to answer you, the app\s+sends the model/i);
    // Both kinds of submitted material are named, as the app has both.
    expect(doc).toMatch(/your messages/i);
    expect(doc).toMatch(/files you have\s+ingested/i);
  });

  it("fact 3 — the chosen provider's data-protection terms therefore apply", () => {
    expect(doc).toMatch(/data-protection terms apply to what the model receives/i);
    expect(doc).toMatch(/it is that provider's data-protection\s+terms/i);
    expect(doc).toMatch(/read them for the provider you use/i);
  });
});

describe("The documentation says where to read the governing provider", () => {
  it("points at the settings surface's Model group rather than naming a provider it cannot know", () => {
    // The document names the group's LOCATION and contents, never its rendered
    // label: that label is catalogue text and differs in each of the four
    // shipped interface languages (AGENTS.md, § Conventions — "Documentation
    // names a control's LOCATION, never its rendered label").
    expect(doc).toMatch(/settings overlay[\s\S]{0,120}model group/i);
    expect(doc).toMatch(/endpoint, model id and key/i);
    expect(doc).not.toMatch(/Settings → Model/);
    expect(doc).toMatch(/actually\s+in force for the running session/i);
  });
});

describe("The app carries no data-handling disclaimer surface", () => {
  beforeEach(() => {
    seedConversation({ session: testSession() });
    useCbe.setState({
      providerStatus: { baseURL: "https://api.example.com/v1", modelId: "claude-opus-4-8", hasKey: true },
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useCbe.getState().reset();
  });

  it("nothing under the composer discloses data handling", () => {
    const { container } = render(<ChatPanel />);
    expect(container.querySelector(".data-disclaimer")).toBeNull();
    expect(screen.queryByRole("note", { name: "Datenschutzhinweis" })).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/Datenschutz|data-protection|stored locally/i);
  });

  it("nothing beside a pending attachment discloses data handling either", async () => {
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      { ok: true, text: "Lernziel: Stakeholder-Impact-Mapping", filename: "modul.docx", docType: "docx" },
    ]);
    const { container } = render(<ChatPanel />);
    fireEvent.click(uploadEntry());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.docx" }) })
      ).toBeTruthy()
    );

    expect(container.querySelector(".data-disclaimer")).toBeNull();
    expect(screen.queryByRole("note", { name: "Datenschutzhinweis" })).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/Datenschutz|data-protection|stored locally/i);
  });
});
