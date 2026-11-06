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

function template(platform: NodeJS.Platform, isPackaged: boolean, availability = available, language = "en") {
  const strings = LANGUAGES[language]!.strings;
  return buildNativeMenuTemplate({
    platform,
    isPackaged,
    applicationName: strings.menuApplication,
    strings,
    availability,
    onCommand: vi.fn(),
    onOpenPioneerSite: vi.fn(),
  });
}

function items(menu: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions[] {
  const submenu = menu.find((item) => item.id === id)?.submenu;
  if (!Array.isArray(submenu)) throw new Error(`No array submenu for ${id}`);
  return submenu as MenuItemConstructorOptions[];
}

function shape(entries: MenuItemConstructorOptions[]) {
  return entries.map((entry) =>
    entry.type === "separator"
      ? { type: "separator" }
      : {
          id: entry.id,
          label: entry.label,
          role: entry.role,
          accelerator: entry.accelerator,
          enabled: entry.enabled,
        }
  );
}

function allRoles(menu: MenuItemConstructorOptions[]): string[] {
  return menu
    .flatMap((top) => (Array.isArray(top.submenu) ? top.submenu : []))
    .flatMap((item) => (item.role ? [item.role] : []));
}

describe("Scenario: macOS template follows application-menu conventions", () => {
  it("pins application/File/Window placement, command ids and accelerators in production", () => {
    const menu = template("darwin", true);
    expect(menu.map((item) => item.id)).toEqual([
      "cbe-menu-application",
      "cbe-menu-file",
      "cbe-menu-edit",
      "cbe-menu-view",
      "cbe-menu-window",
      "cbe-menu-help",
    ]);
    expect(shape(items(menu, "cbe-menu-application"))).toEqual([
      { id: "cbe-open-about", label: "About CBE Toolbox", role: undefined, accelerator: undefined, enabled: true },
      { id: "cbe-open-settings", label: "Settings…", role: undefined, accelerator: "Cmd+,", enabled: true },
      { type: "separator" },
      { id: undefined, label: "Quit CBE Toolbox", role: "quit", accelerator: undefined, enabled: undefined },
    ]);
    expect(shape(items(menu, "cbe-menu-file"))).toEqual([
      { id: undefined, label: "Close Window", role: "close", accelerator: undefined, enabled: undefined },
    ]);
    expect(shape(items(menu, "cbe-menu-window"))).toEqual([
      { id: undefined, label: "Minimize", role: "minimize", accelerator: undefined, enabled: undefined },
      { id: undefined, label: "Bring All to Front", role: "front", accelerator: undefined, enabled: undefined },
    ]);
    expect(shape(items(menu, "cbe-menu-help"))).toEqual([
      { id: "cbe-request-help", label: "CBE Toolbox Help", role: undefined, accelerator: "F1", enabled: true },
      {
        id: "cbe-open-pioneer-site",
        label: "PIONEER Alliance Website",
        role: undefined,
        accelerator: undefined,
        enabled: undefined,
      },
    ]);
  });
});

describe("Scenario: Windows and Linux templates avoid macOS semantics", () => {
  it.each(["win32", "linux"] as const)("pins the %s production File and Window inventories", (platform) => {
    const menu = template(platform, true);
    expect(menu.some((item) => item.id === "cbe-menu-application")).toBe(false);
    expect(shape(items(menu, "cbe-menu-file"))).toEqual([
      { id: "cbe-open-about", label: "About CBE Toolbox", role: undefined, accelerator: undefined, enabled: true },
      { id: "cbe-open-settings", label: "Settings…", role: undefined, accelerator: "Ctrl+,", enabled: true },
      { type: "separator" },
      { id: undefined, label: "Exit", role: "quit", accelerator: undefined, enabled: undefined },
    ]);
    expect(shape(items(menu, "cbe-menu-window"))).toEqual([
      { id: undefined, label: "Minimize", role: "minimize", accelerator: undefined, enabled: undefined },
      { id: undefined, label: "Close Window", role: "close", accelerator: undefined, enabled: undefined },
    ]);
    expect(allRoles(menu)).not.toContain("front");
  });
});

describe("Scenario: Native roles provide editing view and lifecycle behavior", () => {
  it.each(["darwin", "win32", "linux"] as const)(
    "uses only Electron roles for the %s Edit/View/Window lifecycle work",
    (platform) => {
      const menu = template(platform, true);
      expect(shape(items(menu, "cbe-menu-edit"))).toEqual([
        { id: undefined, label: "Undo", role: "undo", accelerator: undefined, enabled: undefined },
        { id: undefined, label: "Redo", role: "redo", accelerator: undefined, enabled: undefined },
        { type: "separator" },
        { id: undefined, label: "Cut", role: "cut", accelerator: undefined, enabled: undefined },
        { id: undefined, label: "Copy", role: "copy", accelerator: undefined, enabled: undefined },
        { id: undefined, label: "Paste", role: "paste", accelerator: undefined, enabled: undefined },
        { id: undefined, label: "Select All", role: "selectAll", accelerator: undefined, enabled: undefined },
      ]);
      expect(shape(items(menu, "cbe-menu-view"))).toEqual([
        { id: undefined, label: "Zoom In", role: "zoomIn", accelerator: undefined, enabled: undefined },
        { id: undefined, label: "Zoom Out", role: "zoomOut", accelerator: undefined, enabled: undefined },
        { id: undefined, label: "Actual Size", role: "resetZoom", accelerator: undefined, enabled: undefined },
        { type: "separator" },
        {
          id: undefined,
          label: "Toggle Full Screen",
          role: "togglefullscreen",
          accelerator: undefined,
          enabled: undefined,
        },
      ]);
    }
  );
});

describe("Scenario: Packaged production never exposes developer entries", () => {
  it.each(["darwin", "win32", "linux"] as const)(
    "keeps reload/devtools out of packaged %s and at the declared development tail",
    (platform) => {
      const production = items(template(platform, true), "cbe-menu-view");
      const development = items(template(platform, false), "cbe-menu-view");
      expect(production.map((item) => item.role)).not.toContain("reload");
      expect(production.map((item) => item.role)).not.toContain("toggleDevTools");
      expect(shape(development).slice(-3)).toEqual([
        { type: "separator" },
        { id: undefined, label: "Reload", role: "reload", accelerator: undefined, enabled: undefined },
        {
          id: undefined,
          label: "Toggle Developer Tools",
          role: "toggleDevTools",
          accelerator: undefined,
          enabled: undefined,
        },
      ]);
    }
  );
});

describe("Scenario: Exactly one localized application menu is active", () => {
  it.each(Object.keys(LANGUAGES))(
    "resolves every visible %s label from that catalogue without changing ids/roles",
    (language) => {
      const localized = template("linux", true, available, language);
      const reference = template("linux", true, available, "en");
      const t = LANGUAGES[language]!.strings;
      expect(localized.map((item) => item.label)).toEqual([
        t.menuFile,
        t.menuEdit,
        t.menuView,
        t.menuWindow,
        t.menuHelp,
      ]);
      expect(localized.map((item) => item.id)).toEqual(reference.map((item) => item.id));
      expect(allRoles(localized)).toEqual(allRoles(reference));
    }
  );

  it("uses real disabled state and the existing localized reason for custom items", () => {
    const unavailable: NativeMenuAvailability = {
      settings: { enabled: false, reason: "modal" },
      about: { enabled: false, reason: "not-ready" },
      help: { enabled: false, reason: "busy" },
    };
    const menu = template("linux", true, unavailable);
    const file = items(menu, "cbe-menu-file");
    const help = items(menu, "cbe-menu-help");
    expect(file[0]).toMatchObject({ enabled: false, toolTip: LANGUAGES.en.strings.menuWorkspaceUnavailable });
    expect(file[1]).toMatchObject({ enabled: false, toolTip: LANGUAGES.en.strings.menuModalUnavailable });
    expect(help[0]).toMatchObject({ enabled: false, toolTip: LANGUAGES.en.strings.chatComposerLockedReason });
  });
});

describe("Scenario: Product operations do not grow menu state", () => {
  it("contains only the closed command union and fixed PIONEER action", () => {
    const serialized = JSON.stringify(template("linux", false));
    expect(serialized).not.toMatch(/canvas|maturity|course|session|provider|model|corpus|export/i);
    const customIds = template("linux", false)
      .flatMap((top) => (Array.isArray(top.submenu) ? top.submenu : []))
      .flatMap((item) => (item.id ? [item.id] : []));
    expect(customIds).toEqual(["cbe-open-about", "cbe-open-settings", "cbe-request-help", "cbe-open-pioneer-site"]);
  });
});
