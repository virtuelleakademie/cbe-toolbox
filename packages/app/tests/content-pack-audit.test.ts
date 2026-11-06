import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendContentPackAudit } from "../src/main/content-pack-audit.js";
import type { ContentPackPaths } from "../src/main/content-pack-store.js";

describe("content pack audit redaction and retention", () => {
  let root: string;
  let paths: ContentPackPaths;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "cbe-pack-audit-"));
    paths = {
      trustDir: path.join(root, "trust"),
      packsDir: path.join(root, "packs"),
      bundledDir: path.join(root, "embedded"),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("omits hostile secret, signature, body, prompt and user-content values", async () => {
    const sentinel = "SECRET_SIGNATURE_BODY_PROMPT_LECTURER_SENTINEL";
    await appendContentPackAudit(
      paths,
      "cbe-corpus",
      "stable",
      { status: "refused", code: "metadata-schema-invalid", field: sentinel },
      new Date("2026-10-20T12:00:00Z")
    );
    const file = path.join(paths.packsDir, "cbe-corpus", "stable", "audit.jsonl");
    const body = await readFile(file, "utf8");
    expect(body).not.toContain(sentinel);
    expect(body).toContain('"code":"metadata-schema-invalid"');
    expect(body).not.toMatch(/signature|prompt|lecturer/iu);
  });

  it("retains a bounded newest suffix by record count and bytes", async () => {
    for (let index = 0; index < 12; index += 1) {
      await appendContentPackAudit(
        paths,
        "cbe-skill",
        "stable",
        { status: "up-to-date", version: `0.4.${index}`, epoch: 1, sequence: index + 1 },
        new Date(Date.UTC(2026, 9, 20, 12, index)),
        { maxRecords: 4, maxBytes: 900 }
      );
    }
    const file = path.join(paths.packsDir, "cbe-skill", "stable", "audit.jsonl");
    const body = await readFile(file, "utf8");
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(body).toContain('"sequence":12');
    expect(body).not.toContain('"sequence":1,');
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(900);
  });
});
