import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentPackChannel, ContentPackId } from "@cbe/corpus-schema";
import type { ContentPackPaths } from "./content-pack-store.js";
import type { ContentPackUpdateResult } from "./content-pack-updater.js";

export const CONTENT_PACK_AUDIT_MAX_RECORDS = 200;
export const CONTENT_PACK_AUDIT_MAX_BYTES = 128 * 1024;

export interface ContentPackAuditRecord {
  schemaVersion: 1;
  at: string;
  packId: ContentPackId;
  channel: ContentPackChannel;
  status: ContentPackUpdateResult["status"];
  code?: string;
  field?: string;
  version?: string;
  epoch?: number;
  sequence?: number;
  manifestSha256?: string;
  signerKeyId?: string;
  sourceCommit?: string;
}

const SAFE_FIELDS = new Set([
  "appRange",
  "modelSurfaceAbi",
  "toolContractSha256",
  "testedPiVersion",
  "corpusSchema",
  "indexContractSha256",
  "packId",
]);

function safeRecord(
  packId: ContentPackId,
  channel: ContentPackChannel,
  result: ContentPackUpdateResult,
  now: Date
): ContentPackAuditRecord {
  const base: ContentPackAuditRecord = {
    schemaVersion: 1,
    at: now.toISOString(),
    packId,
    channel,
    status: result.status,
  };
  if (result.status === "updated") {
    return {
      ...base,
      version: result.identity.version,
      epoch: result.identity.epoch,
      sequence: result.identity.sequence,
      manifestSha256: result.identity.manifestSha256,
      signerKeyId: result.identity.signerKeyId,
      sourceCommit: result.identity.sourceCommit,
    };
  }
  if (result.status === "up-to-date") {
    return { ...base, version: result.version, epoch: result.epoch, sequence: result.sequence };
  }
  return {
    ...base,
    code: result.code,
    ...(result.status === "refused" && result.field && SAFE_FIELDS.has(result.field) ? { field: result.field } : {}),
  };
}

export async function appendContentPackAudit(
  paths: ContentPackPaths,
  packId: ContentPackId,
  channel: ContentPackChannel,
  result: ContentPackUpdateResult,
  now: Date,
  limits: { maxRecords?: number; maxBytes?: number } = {}
): Promise<void> {
  const maxRecords = limits.maxRecords ?? CONTENT_PACK_AUDIT_MAX_RECORDS;
  const maxBytes = limits.maxBytes ?? CONTENT_PACK_AUDIT_MAX_BYTES;
  const file = path.join(paths.packsDir, packId, channel, "audit.jsonl");
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    // First record or unreadable old audit: start a new bounded log. Audit
    // failure never blocks local fallback or a verified update.
  }
  const valid = existing
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as ContentPackAuditRecord;
        return parsed?.schemaVersion === 1 ? [parsed] : [];
      } catch {
        return [];
      }
    });
  valid.push(safeRecord(packId, channel, result, now));
  let retained = valid.slice(-maxRecords);
  let body = retained.map((record) => JSON.stringify(record)).join("\n") + "\n";
  while (retained.length > 1 && Buffer.byteLength(body, "utf8") > maxBytes) {
    retained = retained.slice(1);
    body = retained.map((record) => JSON.stringify(record)).join("\n") + "\n";
  }
  if (Buffer.byteLength(body, "utf8") > maxBytes) body = "";
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, { mode: 0o600 });
}
