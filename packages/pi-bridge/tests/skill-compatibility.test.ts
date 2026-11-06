import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CBE_CUSTOM_TOOL_NAMES,
  CBE_TOOL_ALLOWLIST,
  SKILL_APP_RANGE,
  SKILL_COMPATIBILITY_CONTRACT,
  SKILL_TESTED_PI_VERSION,
  skillToolContractInventory,
  toolContractSha256,
  type SkillToolContractInventory,
} from "../src/skill-compatibility.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("compiled Skill compatibility contract", () => {
  it("is pinned to the app release and Pi dependency that ship it", async () => {
    const appPackage = JSON.parse(await readFile(path.join(repoRoot, "packages/app/package.json"), "utf8")) as {
      version: string;
    };
    const bridgePackage = JSON.parse(
      await readFile(path.join(repoRoot, "packages/pi-bridge/package.json"), "utf8")
    ) as {
      dependencies: Record<string, string>;
    };

    expect(SKILL_APP_RANGE).toBe(`>=${appPackage.version} <0.2.0`);
    expect(SKILL_TESTED_PI_VERSION).toBe(bridgePackage.dependencies["@earendil-works/pi-coding-agent"]);
  });

  it("covers the complete runtime allowlist and registered custom-tool names", () => {
    const inventory = skillToolContractInventory();
    expect(inventory.allowlist).toEqual(CBE_TOOL_ALLOWLIST);
    expect(inventory.registeredCustomTools).toEqual(CBE_CUSTOM_TOOL_NAMES);
    expect(Object.keys(inventory.inputSchemas)).toEqual([...CBE_TOOL_ALLOWLIST]);
    expect(SKILL_COMPATIBILITY_CONTRACT.toolContractSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(SKILL_COMPATIBILITY_CONTRACT.toolContractSha256).toBe(toolContractSha256(inventory));
  });

  it("Tool contract changes only for structural runtime changes", () => {
    const inventory = jsonClone(skillToolContractInventory()) as SkillToolContractInventory;
    const proseOnly = jsonClone(inventory) as SkillToolContractInventory;
    const proseSchema = proseOnly.inputSchemas.read as Record<string, unknown>;
    proseSchema.description = "Entirely different prose";
    const properties = proseSchema.properties as Record<string, Record<string, unknown>>;
    properties.path!.description = "Another parameter explanation";

    const structural = jsonClone(inventory) as SkillToolContractInventory;
    const structuralRead = structural.inputSchemas.read as Record<string, unknown>;
    const structuralProperties = structuralRead.properties as Record<string, Record<string, unknown>>;
    structuralProperties.path!.minLength = 1;

    const renamed = jsonClone(inventory) as SkillToolContractInventory;
    (renamed.allowlist as string[])[0] = "read_changed";

    expect(toolContractSha256(proseOnly)).toBe(toolContractSha256(inventory));
    expect(toolContractSha256(structural)).not.toBe(toolContractSha256(inventory));
    expect(toolContractSha256(renamed)).not.toBe(toolContractSha256(inventory));
  });
});
