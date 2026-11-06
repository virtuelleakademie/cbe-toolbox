import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createCitationResolver } from "@cbe/pi-bridge";
import { activeCorpusDir, refreshCorpus, type CorpusUpdaterPaths } from "../src/main/corpus-updater";

// pioneer-corpus, Requirement: Corpus delivery via a swappable source provider
// — the portal provider must satisfy the same versioning and citation logic as
// the bundled provider; switching providers changes no content, schema,
// citation, or skill surface.

const INDEX = {
  "corpus-version": "2026-08",
  documents: [
    {
      id: "methodology-001",
      title: "CBL Three-Phase Framework",
      path: "content/methodology/cbl-three-phase-framework.md",
      category: "methodology",
      version: "1.0",
      tags: ["cbl", "framework"],
    },
  ],
};

const DOC_BODY = `---
id: methodology-001
sources:
  - author: "Nichols, M."
    year: 2016
    title: "Challenge Based Learning Guide"
---

# CBL Three-Phase Framework

## Phase 1: Engage

Body text.
`;

async function writeCorpusTree(dir: string): Promise<void> {
  await mkdir(path.join(dir, "content", "methodology"), { recursive: true });
  await writeFile(path.join(dir, "index.json"), JSON.stringify(INDEX));
  await writeFile(path.join(dir, "content", "methodology", "cbl-three-phase-framework.md"), DOC_BODY);
}

describe("provider swap leaves the manifest and citation surface unchanged", () => {
  let root: string;
  let referenceDir: string;
  let paths: CorpusUpdaterPaths;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cbe-provider-swap-"));
    // The bundled-provider leg reads this tree directly, as the packaged app
    // reads its resource directory. The updater's own bundled fallback is an
    // OLDER tree, so the portal leg actually downloads (version diff).
    referenceDir = path.join(root, "reference");
    await writeCorpusTree(referenceDir);
    const bundledDir = path.join(root, "bundled");
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      path.join(bundledDir, "index.json"),
      JSON.stringify({ "corpus-version": "2026-07", documents: [] })
    );
    paths = { cacheRoot: path.join(root, "cache"), bundledDir };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Scenarios: Index lets the app list available documents / Skill loads
  // documents selectively, not in bulk / Provider swap leaves skill behaviour
  // unchanged. The same corpus content is loaded once from the bundled
  // resource directory and once through the portal fetch path (keyed request,
  // digest verification, cache swap); the resolver surface the skill runtime
  // and the citation pipeline consume must be indistinguishable.
  it("resolves the identical manifest and citation surface from the bundled and the portal provider", async () => {
    const bundledResolver = await createCitationResolver(referenceDir);

    // Portal leg: pack the same tree into a bundle and adopt it via the keyed
    // delivery channel.
    const zip = new JSZip();
    zip.file("index.json", JSON.stringify(INDEX));
    zip.file("content/methodology/cbl-three-phase-framework.md", DOC_BODY);
    const bundle = new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
    const sha256 = createHash("sha256").update(bundle).digest("hex");
    const pointerUrl = "https://portal.example/delivery/corpus/latest.json";
    const result = await refreshCorpus({
      paths,
      pointerUrl,
      requestHeaders: { "x-cbe-delivery-key": "test-key" },
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url === pointerUrl) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: "2026-08", file: "v2026-08.zip", sha256 }),
          } as Response;
        }
        if (url === "https://portal.example/delivery/corpus/v2026-08.zip") {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }) as typeof fetch,
    });
    expect(result.status).toBe("updated");

    const portalDir = activeCorpusDir(paths);
    expect(portalDir).not.toBe(paths.bundledDir);
    const portalResolver = await createCitationResolver(portalDir);

    // Index surface: same version, same document list with metadata.
    expect(portalResolver.getVersion()).toBe(bundledResolver.getVersion());
    expect(portalResolver.listIds()).toEqual(bundledResolver.listIds());
    expect(portalResolver.resolve("methodology-001")).toEqual(bundledResolver.resolve("methodology-001"));

    // Selective loading: one document's body is loaded by id, and it is
    // byte-identical across providers — only the fetch/cache mechanics differ.
    expect(await portalResolver.loadBody("methodology-001")).toBe(await bundledResolver.loadBody("methodology-001"));

    // Citation surface: sources and headings — what `cbe_cite` gates on — are
    // identical too.
    expect(await portalResolver.resolveSources("methodology-001")).toEqual(
      await bundledResolver.resolveSources("methodology-001")
    );
    expect(await portalResolver.resolveHeadings("methodology-001")).toEqual(
      await bundledResolver.resolveHeadings("methodology-001")
    );
  });
});
