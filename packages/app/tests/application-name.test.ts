import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildNativeMenuTemplate } from "../src/main/native-menu-template.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";
import type { NativeMenuAvailability } from "../src/shared/ipc-contract.js";

const available: NativeMenuAvailability = {
  settings: { enabled: true, reason: null },
  about: { enabled: true, reason: null },
  help: { enabled: true, reason: null },
};

function template(language: string, applicationName: string): MenuItemConstructorOptions[] {
  return buildNativeMenuTemplate({
    platform: "darwin",
    isPackaged: false,
    applicationName,
    strings: LANGUAGES[language]!.strings,
    availability: available,
    onCommand: vi.fn(),
    onOpenPioneerSite: vi.fn(),
  });
}

function applicationItems(menu: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const submenu = menu.find((item) => item.id === "cbe-menu-application")?.submenu;
  if (!Array.isArray(submenu)) throw new Error("macOS application menu is missing");
  return submenu as MenuItemConstructorOptions[];
}

describe("Scenario: Native menu and About consume corrected runtime identity", () => {
  it("reads application, About and Quit identity from Electron's runtime name", () => {
    const runtimeName = "Runtime Product Name";
    const menu = template("en", runtimeName);
    const items = applicationItems(menu);

    expect(menu.find((item) => item.id === "cbe-menu-application")?.label).toBe(runtimeName);
    expect(items.find((item) => item.id === "cbe-open-about")?.label).toBe(`About ${runtimeName}`);
    expect(items.find((item) => item.role === "quit")?.label).toBe(`Quit ${runtimeName}`);
  });

  it.each([
    ["en", "About Runtime Product Name"],
    ["de", "Über Runtime Product Name"],
    ["fr", "À propos de Runtime Product Name"],
    ["it", "Informazioni su Runtime Product Name"],
  ])("keeps %s About grammar catalogue-owned around the runtime name", (language, expected) => {
    const about = applicationItems(template(language, "Runtime Product Name")).find(
      (item) => item.id === "cbe-open-about"
    );
    expect(about?.label).toBe(expected);
  });
});
