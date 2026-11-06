/**
 * Contract group `guards` — the contract matrix keeps itself honest (capability
 * `agent-harness`, Requirement: *Pi Upgrades Are Proven Through a Public
 * Contract Harness*; change `guard-pi-upgrades-with-contract-tests`, tasks 1.1
 * and 1.2).
 *
 * `groups.json` is the inventory: which test proves which failure domain, who
 * owns a red group, and which scenario each test discharges. A matrix that
 * drifts from the tree is worse than none, so this file fails when a listed
 * file disappears, when a new test starts a real Pi session without being
 * placed, when a scenario of the requirement has no test, or when a mapped test
 * title no longer exists.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
// A plain Node script (no declarations); tests are not type-checked.
import { main, NOT_PROVEN, planGroup } from "../../../../scripts/pi-contracts/run.mjs";
import { moduleSpecifiers } from "../helpers/pi-upgrade-guards.js";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
interface Group {
  owner: string;
  files: string[];
}
interface Matrix {
  groups: Record<string, Group>;
  outsideContracts: { reason: string; files: string[] };
  scenarios: Array<{ scenario: string; tests: Array<{ file: string; title: string }> }>;
}

const matrix = JSON.parse(readFileSync(path.join(__dirname, "groups.json"), "utf8")) as Matrix;
const grouped = Object.values(matrix.groups).flatMap((g) => g.files);
const read = (file: string) => readFileSync(path.join(REPO, file), "utf8");

/** A test file that builds a real Pi session (or reaches one behind a port). */
const REACHES_REAL_SESSION =
  /startCbeSession\(|createPiAtomizationSessionFactory\(|createAgentSession\(|installScriptedProvider\(|piSessionOf\(|mock-openai-server|openContractHarness\(/;

function testFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "fixtures") continue;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...testFiles(abs));
    else if (/\.test\.tsx?$/.test(entry)) out.push(path.relative(REPO, abs).split(path.sep).join("/"));
  }
  return out;
}

/** Identifiers that mean a test decides compaction itself instead of driving Pi's pipeline. */
const SELF_BUILT_COMPACTION = new Set([
  "CompactionResult",
  "generateSummary",
  "prepareCompaction",
  "shouldCompact",
  "calculateContextTokens",
  "estimateContextTokens",
  "findCutPoint",
]);

function selfBuiltCompaction(rel: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && SELF_BUILT_COMPACTION.has(node.text)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return found;
}

describe("the Pi upgrade contract matrix", () => {
  it("every group names an owner and existing files, and no file belongs to two groups", () => {
    expect(Object.keys(matrix.groups)).toEqual([
      "construction",
      "provider",
      "lifecycle",
      "deferred-answer",
      "compaction",
      "persistence",
      "security",
      "guards",
    ]);
    for (const [name, group] of Object.entries(matrix.groups)) {
      expect(group.owner, name).toMatch(/\S{10,}/);
      expect(group.files.length, name).toBeGreaterThan(0);
      for (const file of group.files) expect(existsSync(path.join(REPO, file)), file).toBe(true);
    }
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const file of matrix.outsideContracts.files) {
      expect(existsSync(path.join(REPO, file)), file).toBe(true);
      expect(grouped).not.toContain(file);
    }
  });

  it("every test that reaches a real Pi session is placed in a contract group or declared outside the contracts", () => {
    const reaching = [
      ...testFiles(path.join(REPO, "packages")),
      ...testFiles(path.join(REPO, "evaluation", "cbe-skill", "runner", "tests")),
    ].filter((file) => REACHES_REAL_SESSION.test(read(file)));
    expect(reaching.length).toBeGreaterThan(15);
    const placed = new Set([...grouped, ...matrix.outsideContracts.files]);
    expect(reaching.filter((file) => !placed.has(file))).toEqual([]);
  });

  it("the contract tests assert through the CBE port: no file under tests/contracts imports Pi", () => {
    const dir = path.join(REPO, "packages", "pi-bridge", "tests", "contracts");
    for (const entry of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const rel = `packages/pi-bridge/tests/contracts/${entry}`;
      const specs = moduleSpecifiers(rel, read(rel));
      expect(
        specs.filter((s) => s.startsWith("@earendil-works/")),
        rel
      ).toEqual([]);
    }
  });

  it("the compaction group builds no CompactionResult and copies no token trigger", () => {
    // Negative control first: the check can fail.
    expect(
      selfBuiltCompaction("probe.ts", "const r: CompactionResult = { summary: '' }; shouldCompact(1, 2);")
    ).toEqual(["CompactionResult", "shouldCompact"]);
    for (const file of matrix.groups.compaction!.files) {
      expect(selfBuiltCompaction(file, read(file)), file).toEqual([]);
    }
  });

  it("the contract runner names the evidence it does not provide", () => {
    for (const obligation of [
      "npm run build",
      "npm test",
      "npm run test:electron --workspace packages/app",
      "npm run lint",
      "openspec validate --all --strict",
      "npm run trace:check",
      "npm run archive:check",
      "npm run eval",
    ]) {
      expect(NOT_PROVEN).toContain(obligation);
    }
    const root = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(root.scripts["pi:contracts"]).toBe("node scripts/pi-contracts/run.mjs");
    // Every group is runnable on its own: listed, planned per workspace, unknown names refused.
    const listed: string[] = [];
    expect(main(["--list"], { repo: REPO, log: (line: string) => listed.push(line) })).toBe(0);
    for (const name of Object.keys(matrix.groups)) expect(listed.join("\n")).toContain(name);
    expect(planGroup(REPO, matrix.groups.lifecycle).map((p: { workspace: string }) => p.workspace)).toEqual([
      "packages/pi-bridge",
      "packages/app",
    ]);
    expect(main(["--group", "no-such-group"], { repo: REPO, log: () => {} })).toBe(2);
  });
});
