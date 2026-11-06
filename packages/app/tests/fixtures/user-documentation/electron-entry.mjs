import { app, BrowserWindow, dialog, net as electronNet } from "electron";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(fixtureDir, "../../..");
const runRoot = path.resolve(process.env.CBE_DOCS_RUN_ROOT ?? "");
const markerPath = path.resolve(process.env.CBE_DOCS_RUN_MARKER ?? "");
const tempPrefix = `${path.resolve(os.tmpdir())}${path.sep}`;
const userDataArg = process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
const provider = new URL(process.env.CBE_DOCS_PROVIDER_URL ?? "http://invalid.invalid");

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

if (!runRoot.startsWith(tempPrefix) || !path.basename(runRoot).startsWith("cbe-user-docs-")) {
  throw new Error(`Documentation capture refuses non-temporary run root: ${runRoot}`);
}
if (!userDataArg || path.resolve(userDataArg) !== runRoot) {
  throw new Error(`Documentation capture refuses mismatched user-data path: ${String(userDataArg)}`);
}
if (markerPath !== path.join(runRoot, ".cbe-user-documentation-run.json")) {
  throw new Error(`Documentation capture marker path is outside its run root: ${markerPath}`);
}
const marker = JSON.parse(await readFile(markerPath, "utf8"));
if (marker.kind !== "cbe-user-documentation-capture" || marker.runRoot !== runRoot) {
  throw new Error("Documentation capture marker does not identify this isolated run");
}
if (!isLoopback(provider.hostname)) throw new Error(`Documentation capture refuses provider ${provider.origin}`);

function assertLoopbackUrl(value, source) {
  const url = value instanceof URL ? value : new URL(typeof value === "string" ? value : (value?.url ?? String(value)));
  if (!isLoopback(url.hostname)) throw new Error(`Documentation capture blocked non-loopback ${source}: ${url.origin}`);
  return url;
}

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  assertLoopbackUrl(input, "fetch");
  return realFetch(input, init);
};

function guardRequest(original, protocol) {
  return function guardedRequest(input, options, callback) {
    let url;
    if (typeof input === "string" || input instanceof URL) url = new URL(input);
    else {
      const opts = input ?? {};
      const hostname = opts.hostname ?? opts.host ?? "localhost";
      url = new URL(`${protocol}//${hostname}${opts.path ?? "/"}`);
    }
    assertLoopbackUrl(url, `${protocol} request`);
    return original.call(this, input, options, callback);
  };
}
http.request = guardRequest(http.request, "http:");
https.request = guardRequest(https.request, "https:");
http.get = function guardedGet(input, options, callback) {
  const request = http.request(input, options, callback);
  request.end();
  return request;
};
https.get = function guardedGet(input, options, callback) {
  const request = https.request(input, options, callback);
  request.end();
  return request;
};

function hostFromConnect(args) {
  const first = args[0];
  if (typeof first === "object" && first !== null) return first.host ?? first.hostname ?? "localhost";
  if (typeof args[1] === "string") return args[1];
  return "localhost";
}
const realConnect = net.connect;
net.connect = net.createConnection = function guardedConnect(...args) {
  const host = hostFromConnect(args);
  if (!isLoopback(host)) throw new Error(`Documentation capture blocked non-loopback socket: ${host}`);
  return realConnect.apply(this, args);
};

const realElectronRequest = electronNet.request.bind(electronNet);
electronNet.request = (input) => {
  const value = typeof input === "string" ? input : input?.url;
  assertLoopbackUrl(value, "electron.net request");
  return realElectronRequest(input);
};

Object.defineProperty(app, "getAppPath", { value: () => appRoot });
const appPackage = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
app.setVersion(appPackage.version);
const picked = (process.env.CBE_DOCS_PICK_FILES ?? "").split(path.delimiter).filter(Boolean);
dialog.showOpenDialog = async () => ({ canceled: picked.length === 0, filePaths: picked });

// Fixture updater boundary: writing `.emit-update` causes the main fixture to
// send the production IPC event shape. It never injects renderer HTML.
const updateSignal = path.join(runRoot, ".emit-update");
let updateWatch;
updateWatch = fs.watch(runRoot, async (_event, filename) => {
  if (filename !== ".emit-update" || !fs.existsSync(updateSignal)) return;
  await fs.promises.rm(updateSignal, { force: true });
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("cbe:update:event", {
      type: "available",
      version: "0.1.16-fixture",
      notesUrl: `${provider.origin}/fixture-release-notes`,
    });
  }
});
app.once("will-quit", () => updateWatch?.close());

await import(pathToFileURL(path.join(appRoot, "out/main/index.js")).href);
