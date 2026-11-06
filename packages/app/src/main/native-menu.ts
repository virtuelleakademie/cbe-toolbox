import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { Channels, type NativeMenuAvailability, type NativeMenuCommand } from "../shared/ipc-contract.js";
import { chrome } from "./interface-language.js";
import { buildNativeMenuTemplate } from "./native-menu-template.js";
import { openPioneerAllianceSite } from "./pioneer-site.js";

export const NO_NATIVE_MENU_AVAILABILITY: NativeMenuAvailability = {
  settings: { enabled: false, reason: "not-ready" },
  about: { enabled: false, reason: "not-ready" },
  help: { enabled: false, reason: "not-ready" },
};

function sameAvailability(left: NativeMenuAvailability, right: NativeMenuAvailability): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isNativeMenuAvailability(value: unknown): value is NativeMenuAvailability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "about,help,settings") return false;
  for (const key of ["settings", "about", "help"] as const) {
    const item = record[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const fields = item as Record<string, unknown>;
    if (Object.keys(fields).sort().join(",") !== "enabled,reason") return false;
    if (typeof fields.enabled !== "boolean") return false;
    if (fields.reason !== null && !["not-ready", "busy", "modal"].includes(String(fields.reason))) return false;
    if (fields.enabled && fields.reason !== null) return false;
    if (!fields.enabled && fields.reason === null) return false;
  }
  return true;
}

function usable(window: BrowserWindow): boolean {
  if (window.isDestroyed()) return false;
  return !window.webContents.isDestroyed();
}

/**
 * The single owner of Electron's application menu. Rebuilding atomically replaces
 * the one active menu; no BrowserWindow receives a per-window menu.
 */
export class NativeApplicationMenu {
  private readonly availability = new Map<BrowserWindow, NativeMenuAvailability>();
  private installed = false;

  constructor(
    private readonly ownedWindows: () => readonly BrowserWindow[],
    private readonly platform: NodeJS.Platform,
    private readonly isPackaged: boolean,
    private readonly applicationName: () => string,
    private readonly menuHost: Pick<typeof Menu, "buildFromTemplate" | "setApplicationMenu"> = Menu,
    private readonly focusedWindow: () => BrowserWindow | null = () => BrowserWindow.getFocusedWindow()
  ) {}

  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.refresh();
  }

  refresh(): void {
    if (!this.installed) return;
    const template = buildNativeMenuTemplate({
      platform: this.platform,
      isPackaged: this.isPackaged,
      applicationName: this.applicationName(),
      strings: chrome(),
      availability: this.currentAvailability(),
      onCommand: (command) => this.dispatch(command),
      onOpenPioneerSite: () => void openPioneerAllianceSite(),
    });
    const menu = this.menuHost.buildFromTemplate(template as MenuItemConstructorOptions[]);
    this.menuHost.setApplicationMenu(menu);
  }

  updateAvailability(window: BrowserWindow, value: unknown): boolean {
    if (!this.ownedWindows().includes(window) || !usable(window) || !isNativeMenuAvailability(value)) return false;
    const previous = this.availability.get(window);
    if (previous && sameAvailability(previous, value)) return true;
    this.availability.set(window, value);
    this.refresh();
    return true;
  }

  forget(window: BrowserWindow): void {
    if (this.availability.delete(window)) this.refresh();
  }

  private target(): BrowserWindow | null {
    const owned = this.ownedWindows().filter(usable);
    const focused = this.focusedWindow();
    if (focused && owned.includes(focused)) return focused;
    return owned.length === 1 ? owned[0] : null;
  }

  private currentAvailability(): NativeMenuAvailability {
    const target = this.target();
    return target ? (this.availability.get(target) ?? NO_NATIVE_MENU_AVAILABILITY) : NO_NATIVE_MENU_AVAILABILITY;
  }

  private dispatch(command: NativeMenuCommand): void {
    const target = this.target();
    if (!target) return;
    const availability = this.availability.get(target) ?? NO_NATIVE_MENU_AVAILABILITY;
    const key = command === "open-settings" ? "settings" : command === "open-about" ? "about" : "help";
    if (!availability[key].enabled) return;
    target.webContents.send(Channels.nativeMenuCommand, command);
  }
}
