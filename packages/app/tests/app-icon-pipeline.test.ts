import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXPECTED_SOURCE_BYTES,
  EXPECTED_SOURCE_SHA256,
  GENERATED_PATHS,
  ICNS_REPRESENTATIONS,
  ICO_SIZES,
  LINUX_SIZES,
  checkIcons,
  generateIcons,
  inspectIcns,
  inspectIco,
  pngDimensions,
  sha256,
  validateIconSource,
  validateSvgStructure,
} from "../scripts/icon-pipeline.mjs";

const repoRoot = path.resolve(__dirname, "../../..");
const resources = path.join(repoRoot, "packages/app/buildResources");
const source = path.join(repoRoot, "packages/app/icon-source/cbe-toolbox-icon.svg");
const checkScript = path.join(repoRoot, "packages/app/scripts/icons-check.mjs");
const temporary: string[] = [];

function temp(prefix: string): string {
  const value = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(value);
  return value;
}

function intakeFixture(): string {
  const root = temp("cbe-icon-intake-");
  const iconSource = path.join(root, "packages/app/icon-source");
  cpSync(path.dirname(source), iconSource, { recursive: true });
  return root;
}

function outputFixture(): string {
  const root = temp("cbe-icon-output-");
  cpSync(resources, root, { recursive: true });
  return root;
}

function hashes(root: string): Record<string, string> {
  return Object.fromEntries(
    GENERATED_PATHS.map((relativePath) => [relativePath, sha256(readFileSync(path.join(root, relativePath)))])
  );
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Scenario: Approved SVG geometry and rendered palette stay exact", () => {
  it("validates the exact source record, bytes, geometry, inventory and six rendered colours", async () => {
    const result = await validateIconSource(repoRoot);
    expect(result.source.length).toBe(EXPECTED_SOURCE_BYTES);
    expect(result.sourceHash).toBe(EXPECTED_SOURCE_SHA256);
    expect(result.record.source).toBe("packages/app/icon-source/cbe-toolbox-icon.svg");
    expect(result.record.renderedPalette).toEqual(["#273171", "#cc3366", "#ff5e13", "#0087a9", "#4fb3cc", "#ffffff"]);
    expect(result.record.provenance.origin).toBe("Approved CBE Toolbox project artwork intake");
    expect(result.record.useAuthorization.grantedBy).toBe("CBE Toolbox project authority");
    expect(result.record.approval.approvedBy).toBe("CBE Toolbox product authority");
    const supplierBranding = new RegExp(
      `${["Bridge", "Binary"].join("\\s*&\\s*")}|${["bridge", "binary"].join("")}`,
      "iu"
    );
    expect(JSON.stringify(result.record)).not.toMatch(supplierBranding);
    expect(result.source.toString("utf8")).toContain("indigo #3e4d9c");
  });

  it.each([
    ["script", "<script>bad()</script>"],
    ["external image", '<image href="https://example.invalid/logo.png"/>'],
    ["style attribute", '<g style="fill:red"></g>'],
    ["URL paint", '<g fill="url(https://example.invalid/a)"></g>'],
  ])("refuses unsafe %s content independently of the immutable hash gate", (_label, unsafe) => {
    const svg = readFileSync(source, "utf8").replace("</svg>", `${unsafe}</svg>`);
    expect(() => validateSvgStructure(svg)).toThrow(/active|external|styled/i);
  });
});

describe("Scenario: Missing or drifted authoritative source stops without a fallback", () => {
  it.each([
    ["missing source", (root: string) => unlinkSync(path.join(root, "packages/app/icon-source/cbe-toolbox-icon.svg"))],
    [
      "renamed source",
      (root: string) =>
        renameSync(
          path.join(root, "packages/app/icon-source/cbe-toolbox-icon.svg"),
          path.join(root, "packages/app/icon-source/other.svg")
        ),
    ],
    ["missing record", (root: string) => unlinkSync(path.join(root, "packages/app/icon-source/provenance.json"))],
    [
      "changed source hash",
      (root: string) =>
        writeFileSync(
          path.join(root, "packages/app/icon-source/cbe-toolbox-icon.svg"),
          `${readFileSync(source, "utf8")}\n`
        ),
    ],
    [
      "alternate source in the record",
      (root: string) => {
        const file = path.join(root, "packages/app/icon-source/provenance.json");
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        parsed.source = "packages/app/icon-source/other.svg";
        writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
      },
    ],
    [
      "incomplete approval evidence",
      (root: string) => {
        const file = path.join(root, "packages/app/icon-source/provenance.json");
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        parsed.approval.approvedBy = "";
        writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
      },
    ],
    [
      "an artwork configuration knob",
      (root: string) => {
        const file = path.join(root, "packages/app/icon-source/provenance.json");
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        parsed.inset = 12;
        writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
      },
    ],
  ])("refuses a %s before touching an existing output", async (_label, mutate) => {
    const root = intakeFixture();
    mutate(root);
    const output = temp("cbe-icon-untouched-");
    const sentinel = path.join(output, "icon.png");
    writeFileSync(sentinel, "sentinel");

    await expect(generateIcons({ repoRoot: root, outputDir: output })).rejects.toThrow(/Icon source intake failed/);
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel");
    expect(existsSync(path.join(output, "icon.ico"))).toBe(false);
  });

  it("refuses a symlinked authoritative source", async () => {
    const root = intakeFixture();
    const fixed = path.join(root, "packages/app/icon-source/cbe-toolbox-icon.svg");
    const target = path.join(root, "packages/app/icon-source/target.svg");
    renameSync(fixed, target);
    symlinkSync(target, fixed);
    expect(lstatSync(fixed).isSymbolicLink()).toBe(true);
    await expect(validateIconSource(root)).rejects.toThrow(/symlink/);
  });
});

describe("Scenario: Every platform checkout preserves the approved source bytes", () => {
  it("uses a path-scoped -text Git attribute and preserves the approved hash", () => {
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    expect(attributes).toContain("packages/app/icon-source/cbe-toolbox-icon.svg -text");
    const result = execFileSync("git", ["check-attr", "text", "--", "packages/app/icon-source/cbe-toolbox-icon.svg"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.trim()).toBe("packages/app/icon-source/cbe-toolbox-icon.svg: text: unset");
    expect(readFileSync(source).length).toBe(EXPECTED_SOURCE_BYTES);
    expect(sha256(readFileSync(source))).toBe(EXPECTED_SOURCE_SHA256);
  });
});

describe("Scenario: One approved master deterministically produces every asset", () => {
  it("generates two byte-identical complete output sets", async () => {
    const first = temp("cbe-icons-first-");
    const second = temp("cbe-icons-second-");
    await generateIcons({ repoRoot, outputDir: first });
    await generateIcons({ repoRoot, outputDir: second });
    expect(hashes(first)).toEqual(hashes(second));
    expect(Object.keys(hashes(first)).sort()).toEqual(GENERATED_PATHS);
  });

  it("commits valid PNG, ICO and ICNS representations bound by the generated manifest", () => {
    for (const size of LINUX_SIZES) {
      expect(pngDimensions(readFileSync(path.join(resources, `icons/${size}x${size}.png`)))).toEqual({
        width: size,
        height: size,
      });
    }
    expect(pngDimensions(readFileSync(path.join(resources, "icon.png")))).toEqual({ width: 1024, height: 1024 });
    expect(inspectIco(readFileSync(path.join(resources, "icon.ico")))).toEqual(ICO_SIZES);
    expect(inspectIcns(readFileSync(path.join(resources, "icon.icns")))).toEqual(ICNS_REPRESENTATIONS);

    const manifest = JSON.parse(readFileSync(path.join(resources, "icon-manifest.json"), "utf8"));
    expect(manifest.source).toEqual({
      path: "packages/app/icon-source/cbe-toolbox-icon.svg",
      sha256: EXPECTED_SOURCE_SHA256,
      byteSize: EXPECTED_SOURCE_BYTES,
    });
    expect(manifest.tools.sharp.version).toBe("0.35.5");
    expect(manifest.tools.sharp.integrity).toMatch(/^sha512-/);
    expect(manifest.tools.prettier.version).toBe("3.8.3");
    expect(manifest.tools.prettier.integrity).toMatch(/^sha512-/);
    expect(manifest.recipe.path).toBe("packages/app/scripts/icon-pipeline.mjs");
    for (const output of manifest.outputs) {
      expect(output.sha256).toBe(sha256(readFileSync(path.join(resources, output.path))));
    }
  });
});

describe("Scenario: Freshness check has stale and missing negative controls", () => {
  it("passes without rewriting the committed tree", async () => {
    const before = hashes(resources);
    await checkIcons({ repoRoot });
    expect(hashes(resources)).toEqual(before);
    execFileSync(process.execPath, [checkScript], { cwd: repoRoot, stdio: "pipe" });
    expect(hashes(resources)).toEqual(before);
  });

  it("fails on a changed source hash before rewriting any committed output", async () => {
    const root = intakeFixture();
    writeFileSync(
      path.join(root, "packages/app/icon-source/cbe-toolbox-icon.svg"),
      `${readFileSync(source, "utf8")}\n`
    );
    const before = hashes(resources);
    await expect(checkIcons({ repoRoot: root, committedDir: resources })).rejects.toThrow(/SHA256|bytes/);
    expect(hashes(resources)).toEqual(before);
  });

  it.each([
    ["removed output", (root: string) => unlinkSync(path.join(root, "icon.ico"))],
    ["extra output", (root: string) => writeFileSync(path.join(root, "obsolete-64x64.png"), "obsolete")],
  ])("fails on a %s", async (_label, mutate) => {
    const committed = outputFixture();
    mutate(committed);
    await expect(checkIcons({ repoRoot, committedDir: committed })).rejects.toThrow(/inventory differs/);
  });

  it.each([
    ["malformed output", (root: string) => writeFileSync(path.join(root, "icon.ico"), "not-ico")],
    [
      "wrong-dimension output",
      (root: string) => {
        const file = path.join(root, "icons/32x32.png");
        const wrong = Buffer.from(readFileSync(file));
        wrong.writeUInt32BE(31, 16);
        writeFileSync(file, wrong);
      },
    ],
  ])("refuses a %s without repairing it", async (_label, mutate) => {
    const committed = outputFixture();
    mutate(committed);
    const before = readFileSync(path.join(committed, "icon-manifest.json"));
    await expect(checkIcons({ repoRoot, committedDir: committed })).rejects.toThrow(/stale|malformed/);
    expect(readFileSync(path.join(committed, "icon-manifest.json"))).toEqual(before);
  });

  it("rejects malformed and wrong-dimension payloads at the format boundary", () => {
    expect(() => pngDimensions(Buffer.from("not-png"))).toThrow(/not a PNG/);
    const wrong = Buffer.from(readFileSync(path.join(resources, "icons/32x32.png")));
    wrong.writeUInt32BE(31, 16);
    expect(pngDimensions(wrong)).toEqual({ width: 31, height: 32 });
    expect(() => inspectIco(Buffer.from("not-ico"))).toThrow(/ICO header/);
    expect(() => inspectIcns(Buffer.from("not-icns"))).toThrow(/ICNS header/);
  });
});
