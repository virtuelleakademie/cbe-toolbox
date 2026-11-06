import { createHash } from "node:crypto";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { CanvasParamsSchema } from "./canvas-tool.js";
import { CiteParamsSchema } from "./cite-tool.js";
import { MaturityParamsSchema } from "./maturity-tool.js";
import { PickerParamsSchema } from "./picker-tool.js";
import { ProfileParamsSchema } from "./profile-tool.js";
import { StepParamsSchema } from "./step-tool.js";
import { SupportParamsSchema } from "./support-tool.js";
import { WikiParamsSchema } from "./wiki-tool.js";
export { SKILL_BODY_BUDGET } from "./cbe-system-prompt.js";

/**
 * Compiled compatibility authority for the hash-era Skill OTA pointer
 * (capability `distribution`, Requirement: Hash-Era Skill Pointer
 * Compatibility Gate).
 *
 * The pointer producer and the app verifier import these facts. Tests derive
 * expectations from this module rather than transcribing values beside it.
 */
export const SKILL_BASE_APP_VERSION = "0.1.21";
export const SKILL_APP_RANGE = `>=${SKILL_BASE_APP_VERSION} <0.2.0`;
export const SKILL_MODEL_SURFACE_ABI = "cbe-skill/1";
export const SKILL_TESTED_PI_VERSION = "1.3.0";

/** The runtime's exact tool allowlist, including the CBE custom tools. */
export const CBE_TOOL_ALLOWLIST = [
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "cbe_picker",
  "cbe_cite",
  "cbe_canvas",
  "cbe_profile",
  "cbe_step",
  "cbe_maturity",
  "cbe_wiki",
  "cbe_support",
] as const;

export const CBE_CUSTOM_TOOL_NAMES = [
  "cbe_picker",
  "cbe_cite",
  "cbe_canvas",
  "cbe_profile",
  "cbe_step",
  "cbe_maturity",
  "cbe_wiki",
  "cbe_support",
] as const;

export type CbeToolName = (typeof CBE_TOOL_ALLOWLIST)[number];
export type CbeCustomToolName = (typeof CBE_CUSTOM_TOOL_NAMES)[number];

/** JSON-Schema annotation keys that change prose, not accepted input. */
const NON_STRUCTURAL_SCHEMA_KEYS = new Set(["$comment", "description", "examples", "title"]);

export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/**
 * Canonicalize a JSON-compatible value for hashing: object keys are sorted and
 * schema prose annotations are removed recursively. Structural constraints
 * (types, required fields, literals, bounds, array limits, etc.) remain.
 */
export function canonicalizeToolContractValue(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeToolContractValue);
  if (typeof value !== "object") {
    throw new TypeError(`Tool contract contains non-JSON value of type ${typeof value}`);
  }

  const out: Record<string, CanonicalJson> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (NON_STRUCTURAL_SCHEMA_KEYS.has(key)) continue;
    const member = (value as Record<string, unknown>)[key];
    if (member === undefined || typeof member === "function" || typeof member === "symbol") continue;
    out[key] = canonicalizeToolContractValue(member);
  }
  return out;
}

const BUILTIN_SCHEMA_FACTORIES = {
  read: createReadToolDefinition,
  write: createWriteToolDefinition,
  edit: createEditToolDefinition,
  grep: createGrepToolDefinition,
  find: createFindToolDefinition,
  ls: createLsToolDefinition,
} as const;

const CUSTOM_TOOL_SCHEMAS: Record<CbeCustomToolName, unknown> = {
  cbe_picker: PickerParamsSchema,
  cbe_cite: CiteParamsSchema,
  cbe_canvas: CanvasParamsSchema,
  cbe_profile: ProfileParamsSchema,
  cbe_step: StepParamsSchema,
  cbe_maturity: MaturityParamsSchema,
  cbe_wiki: WikiParamsSchema,
  cbe_support: SupportParamsSchema,
};

export interface SkillToolContractInventory {
  allowlist: readonly CbeToolName[];
  registeredCustomTools: readonly CbeCustomToolName[];
  inputSchemas: Readonly<Record<CbeToolName, unknown>>;
}

/** Build the inventory from the same schemas and tool-definition factories the runtime uses. */
export function skillToolContractInventory(): SkillToolContractInventory {
  const inputSchemas = {} as Record<CbeToolName, unknown>;
  for (const name of CBE_TOOL_ALLOWLIST) {
    inputSchemas[name] =
      name in BUILTIN_SCHEMA_FACTORIES
        ? BUILTIN_SCHEMA_FACTORIES[name as keyof typeof BUILTIN_SCHEMA_FACTORIES]("/").parameters
        : CUSTOM_TOOL_SCHEMAS[name as CbeCustomToolName];
  }
  return {
    allowlist: CBE_TOOL_ALLOWLIST,
    registeredCustomTools: CBE_CUSTOM_TOOL_NAMES,
    inputSchemas,
  };
}

export function toolContractSha256(inventory: SkillToolContractInventory = skillToolContractInventory()): string {
  const canonical = canonicalizeToolContractValue(inventory);
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export interface SkillCompatibilityContract {
  appRange: string;
  modelSurfaceAbi: string;
  toolContractSha256: string;
  testedPiVersion: string;
}

export const SKILL_COMPATIBILITY_CONTRACT: Readonly<SkillCompatibilityContract> = Object.freeze({
  appRange: SKILL_APP_RANGE,
  modelSurfaceAbi: SKILL_MODEL_SURFACE_ABI,
  toolContractSha256: toolContractSha256(),
  testedPiVersion: SKILL_TESTED_PI_VERSION,
});
