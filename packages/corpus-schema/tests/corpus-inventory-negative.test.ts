import { mkdtemp, readFile, rm, symlink, unlink, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateCorpusInventory } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const roots: string[] = [];

async function copyCorpus(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cbe-corpus-negative-"));
  roots.push(root);
  await cp(path.join(repoRoot, "corpus"), root, { recursive: true });
  return root;
}

async function editIndex(root: string, mutate: (index: Record<string, any>) => void): Promise<void> {
  const file = path.join(root, "index.json");
  const index = JSON.parse(await readFile(file, "utf8"));
  mutate(index);
  await writeFile(file, JSON.stringify(index, null, 2) + "\n");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("strict corpus inventory", () => {
  it("Pack contains exactly the indexed corpus data", async () => {
    const result = await validateCorpusInventory(path.join(repoRoot, "corpus"), { allowSourceDocumentation: true });
    expect(result.version).toBe("2026-11");
    expect(result.contents).toHaveLength(14);
    expect(result.index.categories).not.toHaveProperty("case-study");
    expect(result.index.documents.some((document) => document.category === "case-study")).toBe(false);
    expect(result.contents.some((entry) => entry.path.startsWith("content/case-study/"))).toBe(false);
    expect(result.contents.map((entry) => entry.path)).toEqual(
      [...result.index.documents.map((document) => document.path), "index.json"].sort()
    );
  });

  it.each([
    ["document count", (index: any) => (index["document-count"] += 1)],
    ["category count", (index: any) => (index.categories.methodology += 1)],
    ["duplicate id", (index: any) => (index.documents[1].id = index.documents[0].id)],
    ["duplicate path", (index: any) => (index.documents[1].path = index.documents[0].path)],
    ["category/path mismatch", (index: any) => (index.documents[0].category = "methodology")],
    ["unknown index field", (index: any) => (index.untrusted = true)],
    ["unknown document field", (index: any) => (index.documents[0].execute = "code")],
  ])("Index and atom schema drift is refused: %s", async (_name, mutate) => {
    const root = await copyCorpus();
    await editIndex(root, mutate);
    await expect(validateCorpusInventory(root, { allowSourceDocumentation: true })).rejects.toThrow();
  });

  it("refuses duplicate JSON keys before trusting index fields", async () => {
    const root = await copyCorpus();
    const file = path.join(root, "index.json");
    const raw = await readFile(file, "utf8");
    await writeFile(
      file,
      raw.replace(
        '{\n  "corpus-version": "2026-11",',
        '{\n  "corpus-version": "2026-11",\n  "corpus-version": "2026-11",'
      )
    );
    await expect(validateCorpusInventory(root, { allowSourceDocumentation: true })).rejects.toThrow(/index-invalid/);
  });

  it("Exact index inventory and content hashes gate activation for missing extra and changed atoms", async () => {
    const missing = await copyCorpus();
    const index = JSON.parse(await readFile(path.join(missing, "index.json"), "utf8"));
    await unlink(path.join(missing, index.documents[0].path));
    await expect(validateCorpusInventory(missing, { allowSourceDocumentation: true })).rejects.toThrow(
      /inventory-mismatch/
    );

    const extra = await copyCorpus();
    await writeFile(path.join(extra, "content", "methodology", "methodology-999-extra.md"), "unexpected\n");
    await expect(validateCorpusInventory(extra, { allowSourceDocumentation: true })).rejects.toThrow(
      /inventory-mismatch/
    );

    const changed = await copyCorpus();
    const changedIndex = JSON.parse(await readFile(path.join(changed, "index.json"), "utf8"));
    const atom = path.join(changed, changedIndex.documents[0].path);
    await writeFile(atom, (await readFile(atom, "utf8")).replace(changedIndex.documents[0].title, "Different title"));
    await expect(validateCorpusInventory(changed, { allowSourceDocumentation: true })).rejects.toThrow(
      /metadata-mismatch/
    );
  });

  it("Downloaded corpus cannot expand capabilities", async () => {
    const code = await copyCorpus();
    await writeFile(path.join(code, "content", "methodology", "execute.js"), "export default () => process.exit()\n");
    await expect(validateCorpusInventory(code, { allowSourceDocumentation: true })).rejects.toThrow(/unsafe-entry/);

    const linked = await copyCorpus();
    const index = JSON.parse(await readFile(path.join(linked, "index.json"), "utf8"));
    const victim = path.join(linked, index.documents[0].path);
    await unlink(victim);
    await symlink(path.join(repoRoot, "package.json"), victim);
    await expect(validateCorpusInventory(linked, { allowSourceDocumentation: true })).rejects.toThrow(/unsafe-entry/);
  });
});
