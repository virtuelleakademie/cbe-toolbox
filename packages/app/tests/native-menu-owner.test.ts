import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeMenuAvailability } from "../src/shared/ipc-contract.js";
import { Channels } from "../src/shared/ipc-contract.js";
import { setActiveInterfaceLanguage } from "../src/main/interface-language.js";

const h = vi.hoisted(() => ({
  focused: null as unknown,
  buildFromTemplate: vi.fn((template: unknown) => template),
  setApplicationMenu: vi.fn(),
  openExternal: vi.fn(async () => {}),
}));

vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => h.focused },
  Menu: { buildFromTemplate: h.buildFromTemplate, setApplicationMenu: h.setApplicationMenu },
  shell: { openExternal: h.openExternal },
}));

import { NativeApplicationMenu } from "../src/main/native-menu.js";

type FakeWindow = {
  destroyed: boolean;
  contentsDestroyed: boolean;
  isDestroyed: () => boolean;
  webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> };
};

function fakeWindow(): FakeWindow {
  const value: FakeWindow = {
    destroyed: false,
    contentsDestroyed: false,
    isDestroyed: () => value.destroyed,
    webContents: { isDestroyed: () => value.contentsDestroyed, send: vi.fn() },
  };
  return value;
}

const ready: NativeMenuAvailability = {
  settings: { enabled: true, reason: null },
  about: { enabled: true, reason: null },
  help: { enabled: true, reason: null },
};

function submenu(template: any[], id: string): any[] {
  return template.find((item) => item.id === id).submenu;
}

beforeEach(() => {
  h.focused = null;
  h.buildFromTemplate.mockClear();
  h.setApplicationMenu.mockClear();
  h.openExternal.mockClear();
  setActiveInterfaceLanguage("en");
});
afterEach(() => setActiveInterfaceLanguage("en"));

describe("Scenario: Exactly one localized application menu is active", () => {
  it("installs through Menu.setApplicationMenu once and ignores a second install call", () => {
    const windows: FakeWindow[] = [];
    const owner = new NativeApplicationMenu(
      () => windows as never[],
      "linux",
      true,
      () => "CBE Toolbox",
      h as never,
      () => null
    );
    owner.install();
    owner.install();
    expect(h.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(h.setApplicationMenu).toHaveBeenCalledTimes(1);
  });

  it("atomically replaces that one menu on language change without changing command ids or roles", () => {
    const win = fakeWindow();
    h.focused = win;
    const owner = new NativeApplicationMenu(
      () => [win] as never[],
      "linux",
      true,
      () => "CBE Toolbox",
      h as never,
      () => win as never
    );
    owner.install();
    owner.updateAvailability(win as never, ready);
    const english = h.setApplicationMenu.mock.calls.at(-1)?.[0] as any[];

    setActiveInterfaceLanguage("de");
    owner.refresh();
    const german = h.setApplicationMenu.mock.calls.at(-1)?.[0] as any[];
    expect(english[0].label).toBe("File");
    expect(german[0].label).toBe("Ablage");
    expect(submenu(german, "cbe-menu-file").map((item) => item.id)).toEqual(
      submenu(english, "cbe-menu-file").map((item) => item.id)
    );
    expect(submenu(german, "cbe-menu-edit").map((item) => item.role)).toEqual(
      submenu(english, "cbe-menu-edit").map((item) => item.role)
    );
    expect(h.setApplicationMenu.mock.calls.every((call) => Array.isArray(call[0]))).toBe(true);
  });
});

describe("Scenario: Commands no-op safely without an eligible renderer", () => {
  it("does not send before readiness, then sends the closed command to the one ready owned window", () => {
    const win = fakeWindow();
    const owner = new NativeApplicationMenu(
      () => [win] as never[],
      "linux",
      true,
      () => "CBE Toolbox",
      h as never,
      () => win as never
    );
    owner.install();
    let menu = h.setApplicationMenu.mock.calls.at(-1)?.[0] as any[];
    submenu(menu, "cbe-menu-file")[0].click();
    expect(win.webContents.send).not.toHaveBeenCalled();

    expect(owner.updateAvailability(win as never, ready)).toBe(true);
    menu = h.setApplicationMenu.mock.calls.at(-1)?.[0] as any[];
    submenu(menu, "cbe-menu-file")[1].click();
    expect(win.webContents.send).toHaveBeenCalledWith(Channels.nativeMenuCommand, "open-settings");
  });

  it("does not queue or send after the owned window or its webContents is destroyed", () => {
    const win = fakeWindow();
    const owner = new NativeApplicationMenu(
      () => [win] as never[],
      "linux",
      true,
      () => "CBE Toolbox",
      h as never,
      () => win as never
    );
    owner.install();
    owner.updateAvailability(win as never, ready);
    const click = submenu(h.setApplicationMenu.mock.calls.at(-1)?.[0] as any[], "cbe-menu-help")[0].click;

    win.destroyed = true;
    click();
    expect(win.webContents.send).not.toHaveBeenCalled();

    win.destroyed = false;
    win.contentsDestroyed = true;
    click();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("never targets an arbitrary focused window and only falls back when exactly one owned window is live", () => {
    const owned = fakeWindow();
    const arbitrary = fakeWindow();
    const owner = new NativeApplicationMenu(
      () => [owned] as never[],
      "linux",
      true,
      () => "CBE Toolbox",
      h as never,
      () => arbitrary as never
    );
    owner.install();
    owner.updateAvailability(owned as never, ready);
    const menu = h.setApplicationMenu.mock.calls.at(-1)?.[0] as any[];
    submenu(menu, "cbe-menu-file")[0].click();
    expect(owned.webContents.send).toHaveBeenCalledWith(Channels.nativeMenuCommand, "open-about");
    expect(arbitrary.webContents.send).not.toHaveBeenCalled();
  });

  it("refuses malformed or unowned availability reports", () => {
    const owned = fakeWindow();
    const arbitrary = fakeWindow();
    const owner = new NativeApplicationMenu(
      () => [owned] as never[],
      "linux",
      true,
      () => "CBE Toolbox",
      h as never,
      () => owned as never
    );
    owner.install();
    expect(owner.updateAvailability(arbitrary as never, ready)).toBe(false);
    expect(owner.updateAvailability(owned as never, { settings: true })).toBe(false);
  });
});
