/**
 * Real-Electron test entry for the wiki-ingest completion regression.
 *
 * The product uses Electron's native file picker, which CDP cannot drive. This
 * entry replaces only that native boundary with the fixed file named by the
 * test, then imports the ordinary built main process unchanged. It is launched
 * only by `first-use-onboarding-layout.test.ts`; production never imports it.
 */
import { app, dialog } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(fixtureDir, "../..");
const picked = process.env.CBE_ELECTRON_WIKI_PICK;
if (!picked) throw new Error("CBE_ELECTRON_WIKI_PICK is required");

// Launching a file makes Electron derive appPath from this fixture directory.
// Keep the built app's development resource resolution identical to an ordinary
// `electron packages/app` launch.
Object.defineProperty(app, "getAppPath", { value: () => appRoot });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });

await import(pathToFileURL(path.join(appRoot, "out/main/index.js")).href);
