import type { MenuItemConstructorOptions } from "electron";
import type { ChromeCatalogue } from "../shared/i18n/index.js";
import type { NativeMenuAvailability, NativeMenuCommand, NativeMenuItemAvailability } from "../shared/ipc-contract.js";

export interface NativeMenuTemplateOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  applicationName: string;
  strings: ChromeCatalogue;
  availability: NativeMenuAvailability;
  onCommand: (command: NativeMenuCommand) => void;
  onOpenPioneerSite: () => void;
}

function unavailableToolTip(strings: ChromeCatalogue, availability: NativeMenuItemAvailability): string | undefined {
  if (availability.enabled || availability.reason === null) return undefined;
  if (availability.reason === "busy") return strings.chatComposerLockedReason;
  if (availability.reason === "modal") return strings.menuModalUnavailable;
  return strings.menuWorkspaceUnavailable;
}

function withApplicationName(label: string, catalogueName: string, applicationName: string): string {
  if (!applicationName.trim()) throw new Error("The native menu requires Electron's application name");
  if (!label.includes(catalogueName)) {
    throw new Error(`Native menu label does not contain its catalogue application name: ${label}`);
  }
  return label.replace(catalogueName, applicationName);
}

function commandItem(
  id: string,
  label: string,
  command: NativeMenuCommand,
  availability: NativeMenuItemAvailability,
  strings: ChromeCatalogue,
  onCommand: (command: NativeMenuCommand) => void,
  accelerator?: string
): MenuItemConstructorOptions {
  return {
    id,
    label,
    ...(accelerator ? { accelerator } : {}),
    enabled: availability.enabled,
    ...(unavailableToolTip(strings, availability) ? { toolTip: unavailableToolTip(strings, availability) } : {}),
    click: () => onCommand(command),
  };
}

/** Pure, fixed-inventory platform template. Electron roles own all native work. */
export function buildNativeMenuTemplate(options: NativeMenuTemplateOptions): MenuItemConstructorOptions[] {
  const { platform, isPackaged, applicationName, strings: t, availability, onCommand, onOpenPioneerSite } = options;
  const mac = platform === "darwin";
  const settingsAccelerator = mac ? "Cmd+," : "Ctrl+,";
  const about = () =>
    commandItem(
      "cbe-open-about",
      withApplicationName(t.menuAbout, t.menuApplication, applicationName),
      "open-about",
      availability.about,
      t,
      onCommand
    );
  const settings = () =>
    commandItem(
      "cbe-open-settings",
      t.menuSettings,
      "open-settings",
      availability.settings,
      t,
      onCommand,
      settingsAccelerator
    );
  const help = () =>
    commandItem("cbe-request-help", t.menuCbeHelp, "request-help", availability.help, t, onCommand, "F1");

  const template: MenuItemConstructorOptions[] = [];
  if (mac) {
    template.push({
      id: "cbe-menu-application",
      label: applicationName,
      submenu: [
        about(),
        settings(),
        { type: "separator" },
        { label: withApplicationName(t.menuQuit, t.menuApplication, applicationName), role: "quit" },
      ],
    });
  }

  template.push({
    id: "cbe-menu-file",
    label: t.menuFile,
    submenu: mac
      ? [{ label: t.menuCloseWindow, role: "close" }]
      : [about(), settings(), { type: "separator" }, { label: t.menuExit, role: "quit" }],
  });

  template.push({
    id: "cbe-menu-edit",
    label: t.menuEdit,
    submenu: [
      { label: t.menuUndo, role: "undo" },
      { label: t.menuRedo, role: "redo" },
      { type: "separator" },
      { label: t.menuCut, role: "cut" },
      { label: t.menuCopy, role: "copy" },
      { label: t.menuPaste, role: "paste" },
      { label: t.menuSelectAll, role: "selectAll" },
    ],
  });

  const view: MenuItemConstructorOptions[] = [
    { label: t.menuZoomIn, role: "zoomIn" },
    { label: t.menuZoomOut, role: "zoomOut" },
    { label: t.menuResetZoom, role: "resetZoom" },
    { type: "separator" },
    { label: t.menuToggleFullScreen, role: "togglefullscreen" },
  ];
  if (!isPackaged) {
    view.push(
      { type: "separator" },
      { label: t.menuReload, role: "reload" },
      { label: t.menuToggleDeveloperTools, role: "toggleDevTools" }
    );
  }
  template.push({ id: "cbe-menu-view", label: t.menuView, submenu: view });

  template.push({
    id: "cbe-menu-window",
    label: t.menuWindow,
    submenu: mac
      ? [
          { label: t.menuMinimize, role: "minimize" },
          { label: t.menuBringAllToFront, role: "front" },
        ]
      : [
          { label: t.menuMinimize, role: "minimize" },
          { label: t.menuCloseWindow, role: "close" },
        ],
  });

  template.push({
    id: "cbe-menu-help",
    label: t.menuHelp,
    submenu: [
      help(),
      {
        id: "cbe-open-pioneer-site",
        label: t.menuPioneerWebsite,
        click: onOpenPioneerSite,
      },
    ],
  });

  return template;
}
