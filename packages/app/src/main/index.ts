import { app, BrowserWindow, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerIpc,
  teardownIpc,
  corpusStartupRefresh,
  skillStartupRefresh,
  seedDefaultConnection,
  initInterfaceLanguage,
} from "./ipc.js";
import { registerUpdateManager } from "./update-manager.js";
import { WINDOW_BOUNDS } from "./window.js";
import { APPLICATION_NAME, runtimeAppIconPath, setDevelopmentDockIcon } from "./app-identity.js";
import { NativeApplicationMenu } from "./native-menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ownedWindows = new Set<BrowserWindow>();
const applicationMenu = new NativeApplicationMenu(
  () => [...ownedWindows],
  process.platform,
  app.isPackaged,
  () => APPLICATION_NAME
);

function appIconPath(): string {
  return runtimeAppIconPath({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
}

function configureApplicationIdentity(): void {
  const iconPath = appIconPath();
  const dock = app.dock;
  // Package-owned values only: no second hand-authored About facts dataset.
  app.setAboutPanelOptions({
    applicationName: APPLICATION_NAME,
    applicationVersion: app.getVersion(),
    iconPath,
  });
  // Packaged macOS takes Dock/Finder identity from the bundle ICNS. Development
  // has no bundle, so it explicitly reuses the generated runtime PNG.
  setDevelopmentDockIcon({
    platform: process.platform,
    isPackaged: app.isPackaged,
    isReady: app.isReady(),
    iconPath,
    createImage: (imagePath) => nativeImage.createFromPath(imagePath),
    setDockIcon: dock ? (image) => dock.setIcon(image) : undefined,
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...WINDOW_BOUNDS,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  ownedWindows.add(win);
  win.once("closed", () => {
    ownedWindows.delete(win);
    applicationMenu.forget(win);
  });
  registerIpc(win, {
    updateNativeMenuAvailability: (window, availability) => applicationMenu.updateAvailability(window, availability),
    refreshNativeMenu: () => applicationMenu.refresh(),
  });
  registerUpdateManager(win);
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  // Build-time default connection: seed a fresh install's provider record
  // before the renderer asks whether the app is configured.
  await seedDefaultConnection();
  // Resolve the interface language BEFORE the window exists: the preload reads it
  // synchronously while the window loads, so the first frame is already in the
  // right language (capability `desktop-app`, Requirement: *Every String the App
  // Renders Is English* — no intermediate English flash on an OS-locale default).
  await initInterfaceLanguage();
  configureApplicationIdentity();
  applicationMenu.install();
  createWindow();
  // Corpus bundle startup check (distribution spec, Scenario: App fetches a new
  // corpus version on startup) — pointer-first, silent on every failure mode.
  void corpusStartupRefresh();
  // Skill bundle startup check (distribution spec, Requirement: Skill
  // Distribution as Versioned Bundle) — an adopted state applies to new
  // sessions; offline, the last known state keeps working.
  void skillStartupRefresh();
});
app.on("window-all-closed", () => {
  void teardownIpc().finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});
