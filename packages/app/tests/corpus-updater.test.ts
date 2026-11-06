import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { activeCorpusDir, corpusInfo, refreshCorpus, type CorpusUpdaterPaths } from "../src/main/corpus-updater";

// Distribution spec, Requirement: Corpus Distribution as Downloadable Bundle.

async function makeBundle(version: string, extra?: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("index.json", JSON.stringify({ "corpus-version": version, documents: [] }));
  zip.file("content/foundations/atom.md", `---\nid: foundations-001\n---\n\nBody for ${version}\n`);
  for (const [name, body] of Object.entries(extra ?? {})) zip.file(name, body);
  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** fetch stub serving latest.json + the bundle from memory. */
function fakeFetch(routes: Record<string, { status?: number; body: Uint8Array | object }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return { ok: false, status: 404 } as Response;
    return {
      ok: (route.status ?? 200) < 300,
      status: route.status ?? 200,
      json: async () => route.body,
      arrayBuffer: async () => {
        const bytes = route.body as Uint8Array;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    } as Response;
  }) as typeof fetch;
}

const POINTER_URL = "https://cdn.example/corpus-dist/latest.json";
const BUNDLE_URL = "https://cdn.example/corpus-dist/v2026-08.zip";

describe("corpus bundle updater", () => {
  let root: string;
  let paths: CorpusUpdaterPaths;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cbe-corpus-updater-"));
    const bundledDir = path.join(root, "bundled");
    await mkdir(bundledDir, { recursive: true });
    await writeFile(path.join(bundledDir, "index.json"), JSON.stringify({ "corpus-version": "2026-07" }));
    paths = { cacheRoot: path.join(root, "cache"), bundledDir };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Scenario: App fetches a new corpus version on startup — pointer first,
  // download on version diff, verify, unpack, replace; no restart required.
  it("downloads, verifies and unpacks a newer bundle into the user-data corpus path", async () => {
    const bundle = await makeBundle("2026-08");
    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: fakeFetch({
        [POINTER_URL]: { body: { version: "2026-08", file: "v2026-08.zip", sha256: sha256(bundle) } },
        [BUNDLE_URL]: { body: bundle },
      }),
      now: () => new Date("2026-07-09T12:00:00Z"),
    });

    expect(result).toEqual({ status: "updated", version: "2026-08" });
    const active = activeCorpusDir(paths);
    expect(active).toBe(path.join(paths.cacheRoot, "corpus"));
    const index = JSON.parse(await readFile(path.join(active, "index.json"), "utf8"));
    expect(index["corpus-version"]).toBe("2026-08");
    expect(existsSync(path.join(active, "content", "foundations", "atom.md"))).toBe(true);
  });

  it("reports up-to-date without downloading when the pointer matches the local version", async () => {
    let bundleFetches = 0;
    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: (async (input: string | URL | Request) => {
        if (String(input) === POINTER_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: "2026-07", file: "v2026-07.zip", sha256: "x" }),
          } as Response;
        }
        bundleFetches += 1;
        return { ok: false, status: 404 } as Response;
      }) as typeof fetch,
    });
    expect(result).toEqual({ status: "up-to-date", version: "2026-07" });
    expect(bundleFetches).toBe(0);
  });

  // Only a STRICTLY NEWER pointer is adopted: a portal still advertising an
  // older bundle than the app already runs on must not downgrade it (and must
  // not announce the stale version as the current one).
  it("refuses an older pointer version as up-to-date and never downloads it", async () => {
    let bundleFetches = 0;
    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: (async (input: string | URL | Request) => {
        if (String(input) === POINTER_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: "2026-06", file: "v2026-06.zip", sha256: "x" }),
          } as Response;
        }
        bundleFetches += 1;
        return { ok: false, status: 404 } as Response;
      }) as typeof fetch,
    });
    expect(result).toEqual({ status: "up-to-date", version: "2026-07" });
    expect(bundleFetches).toBe(0);
    expect(activeCorpusDir(paths)).toBe(paths.bundledDir);
    expect((await corpusInfo(paths)).version).toBe("2026-07");
  });

  it("keeps an adopted corpus when the pointer later falls back to an older version", async () => {
    const bundle = await makeBundle("2026-08");
    expect(
      (
        await refreshCorpus({
          paths,
          pointerUrl: POINTER_URL,
          fetchImpl: fakeFetch({
            [POINTER_URL]: { body: { version: "2026-08", file: "v2026-08.zip", sha256: sha256(bundle) } },
            [BUNDLE_URL]: { body: bundle },
          }),
        })
      ).status
    ).toBe("updated");

    const stale = await makeBundle("2026-07");
    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: fakeFetch({
        [POINTER_URL]: { body: { version: "2026-07", file: "v2026-07.zip", sha256: sha256(stale) } },
        ["https://cdn.example/corpus-dist/v2026-07.zip"]: { body: stale },
      }),
    });

    expect(result).toEqual({ status: "up-to-date", version: "2026-08" });
    const info = await corpusInfo(paths);
    expect(info.version).toBe("2026-08");
    expect(info.source).toBe("downloaded");
  });

  // Scenario: Corrupt or tampered bundle is rejected — SHA mismatch discards
  // the download and the previously loaded corpus stays active.
  it("rejects a bundle whose SHA256 does not match the pointer and keeps the existing corpus", async () => {
    const bundle = await makeBundle("2026-08");
    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: fakeFetch({
        [POINTER_URL]: { body: { version: "2026-08", file: "v2026-08.zip", sha256: "0".repeat(64) } },
        [BUNDLE_URL]: { body: bundle },
      }),
    });

    expect(result.status).toBe("integrity-mismatch");
    expect(activeCorpusDir(paths)).toBe(paths.bundledDir);
    expect(existsSync(path.join(paths.cacheRoot, "corpus"))).toBe(false);
    const info = await corpusInfo(paths);
    expect(info).toEqual({ version: "2026-07", cacheDate: null, source: "bundled" });
  });

  it("keeps the previously downloaded corpus when a later bundle is malformed", async () => {
    const good = await makeBundle("2026-08");
    const goodRoutes = {
      [POINTER_URL]: { body: { version: "2026-08", file: "v2026-08.zip", sha256: sha256(good) } },
      [BUNDLE_URL]: { body: good },
    };
    expect((await refreshCorpus({ paths, pointerUrl: POINTER_URL, fetchImpl: fakeFetch(goodRoutes) })).status).toBe(
      "updated"
    );

    // Next bundle verifies (correct hash) but carries no index.json → unpack refused.
    const zip = new JSZip();
    zip.file("content/only.md", "no manifest");
    const broken = new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: fakeFetch({
        [POINTER_URL]: { body: { version: "2026-09", file: "v2026-09.zip", sha256: sha256(broken) } },
        ["https://cdn.example/corpus-dist/v2026-09.zip"]: { body: broken },
      }),
    });

    expect(result.status).toBe("unavailable");
    const info = await corpusInfo(paths);
    expect(info.version).toBe("2026-08");
    expect(info.source).toBe("downloaded");
  });

  // Scenario: Corpus version auditable from the app — version + cache date.
  it("reports version, cache date and source for a downloaded corpus", async () => {
    const bundle = await makeBundle("2026-08");
    await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: fakeFetch({
        [POINTER_URL]: { body: { version: "2026-08", file: "v2026-08.zip", sha256: sha256(bundle) } },
        [BUNDLE_URL]: { body: bundle },
      }),
      now: () => new Date("2026-07-09T12:00:00Z"),
    });
    const info = await corpusInfo(paths);
    expect(info).toEqual({ version: "2026-08", cacheDate: "2026-07-09T12:00:00.000Z", source: "downloaded" });
  });

  it("returns unavailable when no update URL is configured", async () => {
    const result = await refreshCorpus({ paths, pointerUrl: undefined });
    expect(result.status).toBe("unavailable");
  });

  describe("typed unavailable reasons", () => {
    const pointer = (overrides: Partial<{ version: string; file: string; sha256: string }> = {}) => ({
      version: "2026-08",
      file: "v2026-08.zip",
      sha256: "0".repeat(64),
      ...overrides,
    });

    it("classifies an unconfigured channel", async () => {
      await expect(refreshCorpus({ paths, pointerUrl: undefined })).resolves.toEqual({
        status: "unavailable",
        reason: { code: "not-configured" },
      });
    });

    it("classifies a pointer HTTP refusal and preserves its status code", async () => {
      await expect(
        refreshCorpus({
          paths,
          pointerUrl: POINTER_URL,
          fetchImpl: fakeFetch({ [POINTER_URL]: { status: 503, body: {} } }),
        })
      ).resolves.toEqual({ status: "unavailable", reason: { code: "pointer-http", httpStatus: 503 } });
    });

    it.each([
      ["transport", async () => Promise.reject(new Error("raw pointer transport detail"))],
      [
        "JSON read",
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => Promise.reject(new Error("raw pointer JSON detail")),
          }) as Response,
      ],
    ])("classifies a pointer %s failure without its exception", async (_kind, response) => {
      const result = await refreshCorpus({
        paths,
        pointerUrl: POINTER_URL,
        fetchImpl: response as typeof fetch,
      });
      expect(result).toEqual({ status: "unavailable", reason: { code: "pointer-read" } });
      expect(JSON.stringify(result)).not.toContain("raw pointer");
    });

    it("classifies an incomplete pointer", async () => {
      await expect(
        refreshCorpus({
          paths,
          pointerUrl: POINTER_URL,
          fetchImpl: fakeFetch({ [POINTER_URL]: { body: { version: "2026-08" } } }),
        })
      ).resolves.toEqual({ status: "unavailable", reason: { code: "pointer-invalid" } });
    });

    it("classifies a bundle HTTP refusal and preserves its status code", async () => {
      await expect(
        refreshCorpus({
          paths,
          pointerUrl: POINTER_URL,
          fetchImpl: fakeFetch({
            [POINTER_URL]: { body: pointer() },
            [BUNDLE_URL]: { status: 429, body: new Uint8Array() },
          }),
        })
      ).resolves.toEqual({ status: "unavailable", reason: { code: "download-http", httpStatus: 429 } });
    });

    it.each([
      ["URL construction", pointer({ file: "http://[" }), null],
      ["transport", pointer(), new Error("raw bundle transport detail")],
      ["body read", pointer(), new Error("raw bundle body detail")],
    ])("classifies a bundle %s failure without its exception", async (kind, advertised, failure) => {
      const fetchImpl = (async (input: string | URL | Request) => {
        if (String(input) === POINTER_URL) {
          return { ok: true, status: 200, json: async () => advertised } as Response;
        }
        if (kind === "transport") throw failure;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Promise.reject(failure),
        } as Response;
      }) as typeof fetch;
      const result = await refreshCorpus({ paths, pointerUrl: POINTER_URL, fetchImpl });
      expect(result).toEqual({ status: "unavailable", reason: { code: "download-read" } });
      expect(JSON.stringify(result)).not.toContain("raw bundle");
    });

    it("classifies a verified archive with no top-level marker", async () => {
      const zip = new JSZip();
      zip.file("content/only.md", "no manifest");
      const bundle = new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
      const result = await refreshCorpus({
        paths,
        pointerUrl: POINTER_URL,
        fetchImpl: fakeFetch({
          [POINTER_URL]: { body: pointer({ sha256: sha256(bundle) }) },
          [BUNDLE_URL]: { body: bundle },
        }),
      });
      expect(result).toEqual({
        status: "unavailable",
        reason: { code: "missing-marker", markerFile: "index.json" },
      });
    });

    it("classifies an archive entry refused by the containment guard", async () => {
      const zip = new JSZip();
      zip.file("index.json", JSON.stringify({ "corpus-version": "2026-08" }));
      zip.file("../outside.txt", "must not escape");
      const bundle = new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
      const result = await refreshCorpus({
        paths,
        pointerUrl: POINTER_URL,
        fetchImpl: fakeFetch({
          [POINTER_URL]: { body: pointer({ sha256: sha256(bundle) }) },
          [BUNDLE_URL]: { body: bundle },
        }),
      });
      expect(result).toEqual({
        status: "unavailable",
        reason: { code: "unsafe-entry", entryName: "../outside.txt" },
      });
      expect(existsSync(path.join(root, "outside.txt"))).toBe(false);
    });

    it("classifies an unrecognized install failure without exposing its exception", async () => {
      const bundle = await makeBundle("2026-08");
      const blockedCacheRoot = path.join(root, "cache-file");
      await writeFile(blockedCacheRoot, "not a directory");
      const result = await refreshCorpus({
        paths: { ...paths, cacheRoot: blockedCacheRoot },
        pointerUrl: POINTER_URL,
        fetchImpl: fakeFetch({
          [POINTER_URL]: { body: pointer({ sha256: sha256(bundle) }) },
          [BUNDLE_URL]: { body: bundle },
        }),
      });
      expect(result).toEqual({ status: "unavailable", reason: { code: "install-failed" } });
      expect(JSON.stringify(result)).not.toMatch(/ENOTDIR|not a directory/);
    });
  });

  // ——— Portal provider (pioneer-corpus, Requirement: Corpus delivery via a
  // swappable source provider / Requirement: CDN-served corpus integrity binds
  // content to its version; distribution, Requirement: Delivery-Channel Access
  // Key with Non-Technical Rotation) ———

  // The app sends the delivery key on EVERY delivery-channel request — the
  // pointer fetch and the bundle fetch alike.
  it("sends the delivery-key request header on both the pointer and the bundle fetch", async () => {
    const bundle = await makeBundle("2026-08");
    const seenHeaders: Array<Record<string, string> | undefined> = [];
    const withHeaderCapture = (inner: typeof fetch): typeof fetch =>
      (async (input: string | URL | Request, init?: RequestInit) => {
        seenHeaders.push(init?.headers as Record<string, string> | undefined);
        return inner(input as string, init);
      }) as typeof fetch;

    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      requestHeaders: { "x-cbe-delivery-key": "test-key" },
      fetchImpl: withHeaderCapture(
        fakeFetch({
          [POINTER_URL]: { body: { version: "2026-08", file: "v2026-08.zip", sha256: sha256(bundle) } },
          [BUNDLE_URL]: { body: bundle },
        })
      ),
    });

    expect(result.status).toBe("updated");
    expect(seenHeaders).toHaveLength(2);
    for (const headers of seenHeaders) {
      expect(headers?.["x-cbe-delivery-key"]).toBe("test-key");
    }
  });

  // Scenario: Portal content failing the integrity check is not trusted — with
  // a previously verified download in place, a later mismatching bundle keeps
  // the LAST VERIFIED state (the cache, not merely the bundled fallback)
  // loaded, and the unverified version is never announced as current.
  it("keeps the last verified downloaded corpus when a later portal bundle fails the digest", async () => {
    const good = await makeBundle("2026-08");
    expect(
      (
        await refreshCorpus({
          paths,
          pointerUrl: POINTER_URL,
          fetchImpl: fakeFetch({
            [POINTER_URL]: { body: { version: "2026-08", file: "v2026-08.zip", sha256: sha256(good) } },
            [BUNDLE_URL]: { body: good },
          }),
        })
      ).status
    ).toBe("updated");

    const tampered = await makeBundle("2026-09");
    const result = await refreshCorpus({
      paths,
      pointerUrl: POINTER_URL,
      fetchImpl: fakeFetch({
        [POINTER_URL]: { body: { version: "2026-09", file: "v2026-09.zip", sha256: "0".repeat(64) } },
        ["https://cdn.example/corpus-dist/v2026-09.zip"]: { body: tampered },
      }),
    });

    expect(result.status).toBe("integrity-mismatch");
    const info = await corpusInfo(paths);
    expect(info.version).toBe("2026-08");
    expect(info.source).toBe("downloaded");
  });

  // Scenario: Bundled provider needs no separate integrity check — the bundled
  // resource directory is active without any digest or cache metadata, because
  // its content ships inside the code-signed application artifact.
  it("loads the bundled corpus without any integrity metadata", async () => {
    expect(activeCorpusDir(paths)).toBe(paths.bundledDir);
    expect(await corpusInfo(paths)).toEqual({ version: "2026-07", cacheDate: null, source: "bundled" });
  });
});
