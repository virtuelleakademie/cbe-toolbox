/**
 * Stage-1 wiki retrieval: index reading, atom-path resolution, and the per-session
 * gate that makes the index-first order a fact rather than a request (capability
 * `agent-harness`, Requirements: *cbe_wiki Wiki-Retrieval Tool with a Forced
 * Index-First Route* and *Newly Ingested Wiki Atoms Are Disclosed on the Next
 * Lecturer Turn*; capability `lecturer-wiki`, Requirement: *Wiki Index for Stage-1
 * Retrieval*).
 *
 * This file covers the module in isolation — the ROUTE those pieces add up to is
 * asserted against a real wiki tree in `wiki-tool.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  atomIdsFromIndex,
  composePayloadWithWikiAtomsNotice,
  normaliseAtomId,
  readAtomBody,
  readWikiIndex,
  resolveAtomPath,
  wikiAtomsNoticeLine,
  WikiRetrievalGate,
  WIKI_ATOMS_PER_CALL,
} from "../src/wiki-index.js";

const INDEX = `# Wiki index

## concept

- [[concept/cognitive-load]] — working-memory demand of a task
- [[concept/scaffolding|Scaffolding]] — fading support

## method

- [[method/think-pair-share]] — three-step activation pattern
`;

let root: string;
let wikiDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cbe-wiki-index-"));
  wikiDir = path.join(root, "wiki");
  await mkdir(path.join(wikiDir, "concept"), { recursive: true });
  await mkdir(path.join(wikiDir, "method"), { recursive: true });
  await mkdir(path.join(root, "raw"), { recursive: true });
  await writeFile(path.join(wikiDir, "index.md"), INDEX, "utf8");
  await writeFile(path.join(wikiDir, "concept", "cognitive-load.md"), "# Cognitive load\n", "utf8");
  await writeFile(path.join(root, "raw", "skript.md"), "the undigested extraction\n", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the index is read, not guessed", () => {
  it("lists the atom ids the index carries", async () => {
    const read = await readWikiIndex(wikiDir);
    expect(read.present).toBe(true);
    expect(read.text).toBe(INDEX);
    expect(read.atomIds.sort()).toEqual(["concept/cognitive-load", "concept/scaffolding", "method/think-pair-share"]);
  });

  it("reports an absent wiki and an absent index as absent rather than empty", async () => {
    expect(await readWikiIndex(undefined)).toEqual({ present: false, text: "", atomIds: [] });
    expect(await readWikiIndex(path.join(root, "nowhere"))).toEqual({ present: false, text: "", atomIds: [] });
  });

  it("accepts the bare-path index form the lint layer also accepts", () => {
    expect(atomIdsFromIndex("- concept/cognitive-load.md — a note").sort()).toEqual(["concept/cognitive-load"]);
  });

  it("never advertises an id it cannot serve — index prose naming the import layers", async () => {
    await writeFile(
      path.join(wikiDir, "index.md"),
      `${INDEX}\nCompiled from raw/skript.md and inbox/skript.pdf.md; see also ../other/atom.md.\n`,
      "utf8"
    );
    const read = await readWikiIndex(wikiDir);

    expect(read.atomIds).not.toContain("raw/skript");
    expect(read.atomIds).not.toContain("inbox/skript.pdf");
    expect(read.atomIds).not.toContain("../other/atom");
    // The advertised set and the servable set are the same set — a refusal that offers
    // an id the very next call refuses is a self-contradicting correction.
    expect(read.atomIds.every((id) => resolveAtomPath(wikiDir, id).ok)).toBe(true);
    // The wikilink form is filtered by the same policy, not only the bare-path one.
    expect(atomIdsFromIndex("- [[raw/skript]] — the import")).toEqual([]);
  });

  it("normalises a reference to its wiki-relative stem", () => {
    expect(normaliseAtomId(" [[concept/cognitive-load]] ")).toBe("concept/cognitive-load");
    expect(normaliseAtomId("./concept/cognitive-load.md")).toBe("concept/cognitive-load");
  });
});

describe("resolution stays inside the wiki", () => {
  it("resolves an atom id to a file under the wiki directory", () => {
    const r = resolveAtomPath(wikiDir, "concept/cognitive-load");
    expect(r.ok && r.path).toBe(path.join(wikiDir, "concept", "cognitive-load.md"));
  });

  it("refuses the import layers and any escape from the wiki", () => {
    for (const bad of ["raw/skript", "inbox/skript.pdf", "../raw/skript", "../../etc/passwd"]) {
      expect(resolveAtomPath(wikiDir, bad).ok, bad).toBe(false);
    }
    expect(resolveAtomPath(wikiDir, "/etc/passwd").ok).toBe(false);
  });

  it("reads an atom body and reports a missing one as null", async () => {
    const hit = resolveAtomPath(wikiDir, "concept/cognitive-load");
    expect(hit.ok && (await readAtomBody(hit.path))).toContain("Cognitive load");
    const gone = resolveAtomPath(wikiDir, "concept/nothing");
    expect(gone.ok && (await readAtomBody(gone.path))).toBeNull();
  });
});

describe("the gate holds the index-first order", () => {
  it("requires the index until one has been delivered", () => {
    const gate = new WikiRetrievalGate();
    expect(gate.requiresIndex()).toBe(true);
    gate.markIndexDelivered();
    expect(gate.requiresIndex()).toBe(false);
  });

  // Requirement: *Newly Ingested Wiki Atoms Are Disclosed on the Next Lecturer Turn*,
  // Scenario: *The first atom read after an ingestion goes through the index again*.
  it("invalidates a delivered index when atoms land", () => {
    const gate = new WikiRetrievalGate();
    gate.markIndexDelivered();
    gate.recordIngestedAtoms(["concept/cognitive-load"]);
    expect(gate.requiresIndex()).toBe(true);
  });

  // Scenario: *An ingestion that lands no atoms says nothing*.
  it("is untouched by a run that landed no atom", () => {
    const gate = new WikiRetrievalGate();
    gate.markIndexDelivered();
    gate.recordIngestedAtoms([]);
    expect(gate.requiresIndex()).toBe(false);
    expect(gate.pendingAtoms()).toBeNull();
  });

  it("caps a call at the documented number of atoms", () => {
    expect(WIKI_ATOMS_PER_CALL).toBe(5);
  });
});

describe("the notice the host arms", () => {
  it("accumulates the atoms of several runs, deduplicated and in order", () => {
    const gate = new WikiRetrievalGate();
    gate.recordIngestedAtoms(["concept/a", "concept/b"]);
    gate.recordIngestedAtoms(["concept/b.md", "method/c"]);
    expect(gate.pendingAtoms()).toEqual({ atoms: ["concept/a", "concept/b", "method/c"] });
  });

  it("names the count, names the atoms and directs a re-read", () => {
    const line = wikiAtomsNoticeLine({ atoms: ["concept/a", "concept/b"] });
    expect(line.startsWith("[wiki-atoms]")).toBe(true);
    expect(line).toContain("2 atoms");
    expect(line).toContain("concept/a, concept/b");
    expect(line).toMatch(/out of date/);
    // The route belongs to the tool description; the notice reports a fact.
    expect(line).not.toMatch(/cbe_wiki/);
  });

  it("summarises beyond the fifth atom rather than listing a wiki", () => {
    const line = wikiAtomsNoticeLine({ atoms: ["a", "b", "c", "d", "e", "f", "g"] });
    expect(line).toContain("and 2 more");
    expect(line).not.toContain(", g");
  });

  it("prefixes the notice ahead of the lecturer's own text, and nothing when none is armed", () => {
    const composed = composePayloadWithWikiAtomsNotice({ atoms: ["concept/a"] }, "Wie weiter?");
    expect(composed.startsWith("[wiki-atoms]")).toBe(true);
    expect(composed.endsWith("\n\nWie weiter?")).toBe(true);
    expect(composePayloadWithWikiAtomsNotice(null, "Guten Morgen.")).toBe("Guten Morgen.");
    expect(composePayloadWithWikiAtomsNotice({ atoms: [] }, "Guten Morgen.")).toBe("Guten Morgen.");
  });

  // Scenario: *A notice drained into a refused payload is given back*.
  it("drains once and takes a lost notice back without dropping newer atoms", () => {
    const gate = new WikiRetrievalGate();
    gate.recordIngestedAtoms(["concept/a"]);
    const drained = gate.drainAtomsNotice();
    expect(drained).toEqual({ atoms: ["concept/a"] });
    expect(gate.pendingAtoms()).toBeNull();

    gate.recordIngestedAtoms(["concept/b"]);
    gate.requeueAtomsNotice(drained);
    expect(gate.pendingAtoms()).toEqual({ atoms: ["concept/a", "concept/b"] });
    expect(gate.drainAtomsNotice()).toEqual({ atoms: ["concept/a", "concept/b"] });
  });
});
