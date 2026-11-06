/**
 * The generated app-UI reference names the chat surface's controls by the labels
 * the app actually RENDERS (capability `ui-reference-generation`, Requirement: UI
 * Element Registry; capability `desktop-app`, Requirement: Composer Control Row).
 *
 * The registry is the source and `npm run ui:reference` the generator, so a
 * regeneration that silently reintroduced the retired placement copy ("Attach
 * file", "Help me above the transcript", the in-field attach button) would ship
 * a reference describing a surface that no longer exists. This test freezes both
 * directions: the current labels are present, and the retired ones are gone.
 */
import { describe, expect, it } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chatPanelUiRegistry } from "../src/renderer/components/ChatPanel.ui-registry.js";
import { resolveUiEntryLabels } from "@cbe/corpus-schema";

/**
 * An entry's `label` is a catalogue KEY and its prose carries `{{key}}`
 * placeholders (capability `ui-reference-generation`, Requirement: *UI Element
 * Registry*), so a test about what the guide READS has to resolve them — against
 * the REFERENCE language, which is what the committed artefact is generated from.
 */
const lookup = (key: string): string | undefined =>
  typeof (en as unknown as Record<string, unknown>)[key] === "string"
    ? ((en as unknown as Record<string, unknown>)[key] as string)
    : undefined;
const resolved = chatPanelUiRegistry.map((entry) => resolveUiEntryLabels(entry, lookup));

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const GUIDE = readFileSync(resolve(REPO, "skills/cbe/references/ui-guide.md"), "utf8");

describe("the generated UI reference names the rendered chat labels", () => {
  it("carries every chat-panel registry entry under its rendered label", () => {
    for (const entry of resolved) {
      expect(GUIDE, `missing entry for ${entry.id}`).toContain(`### ${entry.label} (\`${entry.id}\`)`);
    }
  });

  it("names the two '+' menu entries by the labels the menu renders", () => {
    // The registry quotes what the app RENDERS, so the guide's headings and the
    // owning constants must agree — a lecturer sent to a button that does not
    // exist is the failure this guards (Requirement: Each Rendered Chrome String
    // Has Exactly One Owner).
    expect(GUIDE).toContain(`### ${en.chatUploadEntryLabel} (\`material-upload\`)`);
    expect(GUIDE).toContain(`### ${en.chatHelpEntryLabel} (\`help-me\`)`);
    for (const [id, label] of [
      ["material-upload", en.chatUploadEntryLabel],
      ["help-me", en.chatHelpEntryLabel],
    ] as const) {
      // The entry names the catalogue key; resolving it in the reference language
      // is what makes the guide's heading and the rendered control the same string
      // by construction rather than by transcription.
      expect(resolved.find((e) => e.id === id)!.label).toBe(label);
    }
    expect(GUIDE).toContain(`"${en.chatUploadEntryLabel}"`);
    expect(GUIDE).toContain(`"${en.chatHelpEntryLabel}"`);
    // Both howToUse sentences point at the menu rather than at the retired
    // placement.
    for (const id of ["material-upload", "help-me"]) {
      const entry = resolved.find((e) => e.id === id)!;
      expect(GUIDE).toContain(entry.howToUse);
      expect(entry.howToUse).toContain('"+" menu');
    }
  });

  it("homes New Session in the conversation header and the two triggers in the composer", () => {
    const byId = Object.fromEntries(chatPanelUiRegistry.map((e) => [e.id, e]));
    expect(byId["new-session"]!.area).toBe("Conversation header");
    expect(byId["material-upload"]!.area).toBe("Composer");
    expect(byId["help-me"]!.area).toBe("Composer");
    expect(GUIDE).toContain("Conversation header");
  });

  // Scenario: The ring is documented in the UI registry
  it("carries the context-usage ring's entry, naming what it shows and how to read it", () => {
    const entry = resolved.find((e) => e.id === "context-usage-ring")!;
    expect(entry).toBeTruthy();
    expect(entry.area).toBe("Composer");
    expect(GUIDE).toContain(`### ${entry.label} (\`context-usage-ring\`)`);
    expect(GUIDE).toContain(entry.description);
    expect(GUIDE).toContain(entry.howToUse);
    // What it shows…
    expect(entry.description).toMatch(/context window/i);
    expect(entry.description).toMatch(/circle/i);
    // …and how to read it: every state a lecturer can meet.
    for (const state of ["not yet measured", "not been re-measured", "percentage", "no context window is configured"]) {
      expect(entry.howToUse, `does not explain "${state}"`).toContain(state);
    }
  });

  it("quotes the model pill's blank-state label as the pill renders it", () => {
    const entry = resolved.find((e) => e.id === "model-pill")!;
    expect(entry.howToUse).toContain(`"${en.chatModelPillBlankLabel}"`);
    expect(GUIDE).toContain(entry.howToUse);
  });

  it("carries none of the retired placement copy, and none of the retired German labels", () => {
    for (const retired of [
      "Attach file",
      "attach button next to the message field",
      "Click Help me above the transcript",
      "Click New Session above the transcript",
      "Session controls",
      // The German-chrome exception is withdrawn: these labels no longer render
      // anywhere, so the reference must not name them either.
      "Dateien hochladen",
      "Hilfe",
      "Kein Modell konfiguriert",
      "Senden / Stoppen",
      "Iterieren",
      "+ Notiz",
    ]) {
      expect(GUIDE, `retired copy still in the guide: ${retired}`).not.toContain(retired);
    }
  });
});
