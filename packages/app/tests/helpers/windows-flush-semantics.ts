// Emulates the Windows flush boundary on any host, so the content-pack store's
// durability path can be proven against it from Linux and macOS CI too.
//
// Node implements `FileHandle.sync()` with `FlushFileBuffers` on Windows, and
// that call needs a handle opened with write access: a read-only handle fails
// with `EPERM` (the failure the signed Skill/corpus updater reported as
// `unavailable` on Windows). POSIX `fsync` accepts a read-only descriptor, which
// is why the defect stayed invisible on a Linux host.
//
// Wire it in a test file with
//
//   vi.mock("node:fs/promises", async (importOriginal) =>
//     (await import("./helpers/windows-flush-semantics.js")).mockFsPromises(
//       await importOriginal<typeof import("node:fs/promises")>()
//     )
//   );
//
// The wrapper is a pass-through until `emulateWindowsFlush(true)` is called.
import type * as FsPromises from "node:fs/promises";

export interface FlushCall {
  path: string;
  flags: string;
  writable: boolean;
  outcome: "flushed" | "EPERM" | "injected";
}

const state = {
  windows: false,
  calls: [] as FlushCall[],
  // Optional injected failure for a write-capable handle, to prove a genuine
  // durability error is never swallowed.
  injectWritable: null as null | ((file: string) => NodeJS.ErrnoException | null),
  platform: undefined as PropertyDescriptor | undefined,
};

function errno(code: string, syscall: string, file: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: operation not permitted, ${syscall}`) as NodeJS.ErrnoException;
  error.code = code;
  error.syscall = syscall;
  error.path = file;
  return error;
}

export function isWritableFlag(flags: string): boolean {
  return flags.includes("+") || flags.startsWith("w") || flags.startsWith("a");
}

/**
 * Turn Windows flush semantics on or off. While on, `process.platform` reads
 * `win32` as well, so the store's deliberate win32 directory-sync tolerance is
 * exercised exactly as it is on a real Windows host.
 */
export function emulateWindowsFlush(on: boolean): void {
  if (on && !state.windows) {
    state.platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  } else if (!on && state.windows && state.platform) {
    Object.defineProperty(process, "platform", state.platform);
  }
  state.windows = on;
}

export function injectWritableFlushFailure(fn: typeof state.injectWritable): void {
  state.injectWritable = fn;
}

export function flushCalls(): FlushCall[] {
  return state.calls;
}

export function resetFlushSemantics(): void {
  emulateWindowsFlush(false);
  state.calls = [];
  state.injectWritable = null;
}

export function mockFsPromises(actual: typeof FsPromises): typeof FsPromises {
  const open = (async (file: Parameters<typeof actual.open>[0], flags?: string | number, mode?: number) => {
    const handle = await actual.open(file, flags, mode);
    const flagText = typeof flags === "string" ? flags : flags === undefined ? "r" : String(flags);
    const writable = typeof flags === "number" ? true : isWritableFlag(flagText);
    const filePath = String(file);
    const flush = (syscall: "fsync" | "fdatasync", real: () => Promise<void>) => async () => {
      if (writable && state.injectWritable) {
        const injected = state.injectWritable(filePath);
        if (injected) {
          state.calls.push({ path: filePath, flags: flagText, writable, outcome: "injected" });
          throw injected;
        }
      }
      if (state.windows && !writable) {
        state.calls.push({ path: filePath, flags: flagText, writable, outcome: "EPERM" });
        throw errno("EPERM", syscall, filePath);
      }
      await real();
      state.calls.push({ path: filePath, flags: flagText, writable, outcome: "flushed" });
    };
    const sync = flush("fsync", () => handle.sync());
    const datasync = flush("fdatasync", () => handle.datasync());
    return new Proxy(handle, {
      get(target, property, receiver) {
        if (property === "sync") return sync;
        if (property === "datasync") return datasync;
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }) as typeof actual.open;
  return { ...actual, open, default: { ...actual, open } } as typeof FsPromises;
}
