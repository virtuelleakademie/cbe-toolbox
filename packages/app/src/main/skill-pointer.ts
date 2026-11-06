import { Range, satisfies, valid } from "semver";
import { SKILL_COMPATIBILITY_CONTRACT, type SkillCompatibilityContract } from "@cbe/pi-bridge/skill-compatibility";

export const SKILL_POINTER_FIELDS = [
  "version",
  "file",
  "sha256",
  "size",
  "generated",
  "appRange",
  "modelSurfaceAbi",
  "toolContractSha256",
  "testedPiVersion",
] as const;

export type SkillPointerField = (typeof SKILL_POINTER_FIELDS)[number];
export type SkillCompatibilityField = "appRange" | "modelSurfaceAbi" | "toolContractSha256" | "testedPiVersion";

export interface StrictSkillPointer {
  version: string;
  file: string;
  sha256: string;
  size: number;
  generated: string;
  appRange: string;
  modelSurfaceAbi: string;
  toolContractSha256: string;
  testedPiVersion: string;
}

export type SkillMetadataInvalidReason =
  | "malformed-json"
  | "not-object"
  | "missing-field"
  | "unknown-field"
  | "duplicate-field"
  | "field-malformed"
  | "too-large";

export type SkillMetadataInvalid = {
  status: "metadata-invalid";
  reason: SkillMetadataInvalidReason;
  field?: string;
};

export type SkillCompatibilityMismatch = {
  status: "compatibility-mismatch";
  field: SkillCompatibilityField;
};

export type SkillPointerDecodeResult =
  | { ok: true; pointer: StrictSkillPointer }
  | { ok: false; outcome: SkillMetadataInvalid };
export type SkillCompatibilityResult = { ok: true } | { ok: false; outcome: SkillCompatibilityMismatch };

export const SKILL_POINTER_MAX_BYTES = 16 * 1024;

const FIELD_SET = new Set<string>(SKILL_POINTER_FIELDS);
const SHA256 = /^[a-f0-9]{64}$/;
const ABI = /^[a-z0-9][a-z0-9./-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function skipWhitespace(raw: string, at: number): number {
  let i = at;
  while (i < raw.length && /\s/u.test(raw[i]!)) i += 1;
  return i;
}

function stringEnd(raw: string, at: number): number {
  let i = at + 1;
  while (i < raw.length) {
    if (raw[i] === "\\") {
      i += 2;
      continue;
    }
    if (raw[i] === '"') return i + 1;
    i += 1;
  }
  return raw.length;
}

function valueEnd(raw: string, at: number): number {
  if (raw[at] === '"') return stringEnd(raw, at);
  if (raw[at] === "{" || raw[at] === "[") {
    const open = raw[at]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let i = at;
    while (i < raw.length) {
      if (raw[i] === '"') {
        i = stringEnd(raw, i);
        continue;
      }
      if (raw[i] === open) depth += 1;
      if (raw[i] === close) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    return raw.length;
  }
  let i = at;
  while (i < raw.length && raw[i] !== "," && raw[i] !== "}") i += 1;
  return i;
}

/** JSON.parse validates syntax; this second pass preserves top-level duplicate keys. */
function topLevelKeys(raw: string): string[] {
  const keys: string[] = [];
  let i = skipWhitespace(raw, 0) + 1;
  for (;;) {
    i = skipWhitespace(raw, i);
    if (raw[i] === "}") return keys;
    const end = stringEnd(raw, i);
    keys.push(JSON.parse(raw.slice(i, end)) as string);
    i = skipWhitespace(raw, end) + 1; // colon
    i = skipWhitespace(raw, i);
    i = valueEnd(raw, i);
    i = skipWhitespace(raw, i);
    if (raw[i] === "}") return keys;
    i += 1; // comma
  }
}

function invalid(reason: SkillMetadataInvalidReason, field?: string): SkillPointerDecodeResult {
  return { ok: false, outcome: { status: "metadata-invalid", reason, ...(field ? { field } : {}) } };
}

function strictRange(value: string): boolean {
  if (value.length === 0 || value.length > 128 || value.trim() !== value) return false;
  try {
    const range = new Range(value, { loose: false });
    return range.raw === value && range.range === value;
  } catch {
    return false;
  }
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function decodeSkillPointer(raw: string): SkillPointerDecodeResult {
  if (Buffer.byteLength(raw, "utf8") > SKILL_POINTER_MAX_BYTES) return invalid("too-large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid("malformed-json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid("not-object");

  const keys = topLevelKeys(raw);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return invalid("duplicate-field", key);
    seen.add(key);
    if (!FIELD_SET.has(key)) return invalid("unknown-field", key);
  }
  for (const field of SKILL_POINTER_FIELDS) {
    if (!seen.has(field)) return invalid("missing-field", field);
  }

  const value = parsed as Record<string, unknown>;
  const version = value.version;
  if (typeof version !== "string" || valid(version, { loose: false }) !== version) {
    return invalid("field-malformed", "version");
  }
  if (typeof value.file !== "string" || value.file !== `v${version}.zip`) {
    return invalid("field-malformed", "file");
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    return invalid("field-malformed", "sha256");
  }
  if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size <= 0) {
    return invalid("field-malformed", "size");
  }
  if (typeof value.generated !== "string" || !validDate(value.generated)) {
    return invalid("field-malformed", "generated");
  }
  if (typeof value.appRange !== "string" || !strictRange(value.appRange)) {
    return invalid("field-malformed", "appRange");
  }
  if (typeof value.modelSurfaceAbi !== "string" || !ABI.test(value.modelSurfaceAbi)) {
    return invalid("field-malformed", "modelSurfaceAbi");
  }
  if (typeof value.toolContractSha256 !== "string" || !SHA256.test(value.toolContractSha256)) {
    return invalid("field-malformed", "toolContractSha256");
  }
  if (
    typeof value.testedPiVersion !== "string" ||
    valid(value.testedPiVersion, { loose: false }) !== value.testedPiVersion
  ) {
    return invalid("field-malformed", "testedPiVersion");
  }

  return { ok: true, pointer: value as unknown as StrictSkillPointer };
}

export function verifySkillCompatibility(
  pointer: StrictSkillPointer,
  installedAppVersion: string,
  contract: SkillCompatibilityContract = SKILL_COMPATIBILITY_CONTRACT
): SkillCompatibilityResult {
  if (!satisfies(installedAppVersion, pointer.appRange, { loose: false, includePrerelease: false })) {
    return { ok: false, outcome: { status: "compatibility-mismatch", field: "appRange" } };
  }
  for (const field of ["modelSurfaceAbi", "toolContractSha256", "testedPiVersion"] as const) {
    if (pointer[field] !== contract[field]) {
      return { ok: false, outcome: { status: "compatibility-mismatch", field } };
    }
  }
  return { ok: true };
}
