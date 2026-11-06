import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { __resetActiveLanguage, setActiveLanguage } from "../src/renderer/chrome.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";

const mismatchFields = [
  ["appRange", "settingsAboutSkillUpdateAppMismatch"],
  ["modelSurfaceAbi", "settingsAboutSkillUpdateAbiMismatch"],
  ["toolContractSha256", "settingsAboutSkillUpdateToolMismatch"],
  ["testedPiVersion", "settingsAboutSkillUpdatePiMismatch"],
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetActiveLanguage();
});

describe("Compatibility refusal is visible without displacing the active Skill", () => {
  it("renders every typed mismatch through every shipped interface-language catalogue", async () => {
    for (const language of Object.values(LANGUAGES)) {
      for (const [field, stringKey] of mismatchFields) {
        cleanup();
        setActiveLanguage(language.code);
        Object.assign(window.cbe, {
          getAboutInfo: async () => ({
            appVersion: "0.1.18",
            skillName: "cbe",
            skillVersion: "0.4.2",
            skillUpdate: { status: "compatibility-mismatch", field },
          }),
        });

        render(<SettingsPanel />);
        fireEvent.click(screen.getByRole("button", { name: language.strings.settingsGroupAbout }));

        expect(await screen.findByText("0.4.2")).toBeTruthy();
        expect(screen.getByText(language.strings[stringKey])).toBeTruthy();
      }
    }
  }, 10_000);

  it("Information surface identifies the effective pack and signed outcome in every language", async () => {
    for (const language of Object.values(LANGUAGES)) {
      for (const skillUpdate of [
        { status: "signed-refused" as const, code: "key-revoked" as const, field: "" },
        { status: "signed-unavailable" as const, code: "redirect-refused" as const },
      ]) {
        cleanup();
        setActiveLanguage(language.code);
        Object.assign(window.cbe, {
          getAboutInfo: async () => ({
            appVersion: "0.1.18",
            skillName: "cbe",
            skillVersion: "0.4.2",
            skillUpdate,
            skillPack: {
              packId: "cbe-skill",
              channel: "stable",
              epoch: 2,
              sequence: 9,
              version: "0.4.2",
              source: "downloaded",
              sourceCommit: "a".repeat(40),
              manifestSha256: "b".repeat(64),
              signerKeyId: "skill-stable-2",
              installedAt: "2026-10-20T12:00:00.000Z",
            },
          }),
        });
        render(<SettingsPanel />);
        fireEvent.click(screen.getByRole("button", { name: language.strings.settingsGroupAbout }));
        expect(await screen.findByText(language.strings.settingsAboutSkillPackIdentity)).toBeTruthy();
        expect(
          screen.getByText(
            language.strings.settingsAboutSkillPackIdentityValue({
              channel: "stable",
              epoch: 2,
              sequence: 9,
              keyId: "skill-stable-2",
            })
          )
        ).toBeTruthy();
        const outcome =
          skillUpdate.status === "signed-refused"
            ? language.strings.settingsAboutSkillUpdateSignedRefused({ code: skillUpdate.code, field: "" })
            : language.strings.settingsAboutSkillUpdateSignedUnavailable({ code: skillUpdate.code });
        expect(screen.getByText(outcome)).toBeTruthy();
      }
    }
  });

  it("renders strict metadata refusal in every language and retains the effective version", async () => {
    for (const language of Object.values(LANGUAGES)) {
      cleanup();
      setActiveLanguage(language.code);
      Object.assign(window.cbe, {
        getAboutInfo: async () => ({
          appVersion: "0.1.18",
          skillName: "cbe",
          skillVersion: "0.4.1",
          skillUpdate: { status: "metadata-invalid", reason: "duplicate-field", field: "appRange" },
        }),
      });

      render(<SettingsPanel />);
      fireEvent.click(screen.getByRole("button", { name: language.strings.settingsGroupAbout }));

      expect(await screen.findByText("0.4.1")).toBeTruthy();
      expect(
        screen.getByText(language.strings.settingsAboutSkillUpdateMetadataInvalid({ field: "appRange" }))
      ).toBeTruthy();
    }
  });
});
