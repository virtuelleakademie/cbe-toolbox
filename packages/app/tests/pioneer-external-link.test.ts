import { beforeEach, describe, expect, it, vi } from "vitest";
import { Channels } from "../src/shared/ipc-contract.js";

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  openExternal: vi.fn(async () => {}),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => Promise<any>) => h.handlers.set(channel, handler) },
  shell: { openExternal: h.openExternal },
}));

import {
  PIONEER_ALLIANCE_URL,
  handlePioneerSiteRequest,
  openPioneerAllianceSite,
  registerPioneerSiteIpc,
} from "../src/main/pioneer-site.js";

beforeEach(() => {
  h.handlers.clear();
  h.openExternal.mockClear();
});

describe("Scenario: The host opens the fixed URL and the renderer never navigates", () => {
  it("calls the system browser with exactly the one main-owned HTTPS origin", async () => {
    const openExternal = vi.fn(async () => {});
    await expect(openPioneerAllianceSite(openExternal)).resolves.toEqual({ ok: true });
    expect(PIONEER_ALLIANCE_URL).toBe("https://pioneer-alliance.eu");
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://pioneer-alliance.eu");
  });
});

describe("Scenario: Arbitrary external destinations are refused", () => {
  it.each([
    "https://pioneer-alliance.eu",
    "http://pioneer-alliance.eu",
    "https://pioneer-alliance.eu.evil.example",
    "https://pioneer-alliance.eu/about",
    "https://pioneer-alliance.eu?tracking=1",
    "https://pioneer-alliance.eu#fragment",
    "javascript:alert(1)",
    { url: "https://pioneer-alliance.eu" },
  ])("refuses the unexpected renderer-supplied argument %j before shell.openExternal", async (argument) => {
    const openExternal = vi.fn(async () => {});
    await expect(handlePioneerSiteRequest([argument], openExternal)).resolves.toEqual({
      ok: false,
      reason: "refused",
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("accepts only an empty argument list and still supplies the URL host-side", async () => {
    const openExternal = vi.fn(async () => {});
    await expect(handlePioneerSiteRequest([], openExternal)).resolves.toEqual({ ok: true });
    expect(openExternal).toHaveBeenCalledWith(PIONEER_ALLIANCE_URL);
  });

  it("registers a parameterless IPC handler that refuses arguments and foreign renderer senders", async () => {
    const webContents = {};
    registerPioneerSiteIpc({ webContents } as never);
    const handler = h.handlers.get(Channels.pioneerSiteOpen)!;
    await expect(handler({ sender: webContents }, "https://pioneer-alliance.eu")).resolves.toEqual({
      ok: false,
      reason: "refused",
    });
    await expect(handler({ sender: {} })).resolves.toEqual({ ok: false, reason: "refused" });
    expect(h.openExternal).not.toHaveBeenCalled();

    await expect(handler({ sender: webContents })).resolves.toEqual({ ok: true });
    expect(h.openExternal).toHaveBeenCalledWith(PIONEER_ALLIANCE_URL);
  });
});

describe("Scenario: External-open failure is local and retryable", () => {
  it("returns the closed failure result instead of throwing", async () => {
    const openExternal = vi.fn(async () => {
      throw new Error("no browser");
    });
    await expect(openPioneerAllianceSite(openExternal)).resolves.toEqual({ ok: false, reason: "open-failed" });
    expect(openExternal).toHaveBeenCalledWith(PIONEER_ALLIANCE_URL);
  });
});
