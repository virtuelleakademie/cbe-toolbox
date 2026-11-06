/**
 * `cbe_wiki` — the route, against a real wiki tree (capability `agent-harness`,
 * Requirement: *cbe_wiki Wiki-Retrieval Tool with a Forced Index-First Route*).
 *
 * One test per Scenario of that requirement. The load-bearing ones are the first two:
 * no atom body is served before the index, and the imported original is refused in an
 * atom's place. Both are properties of the ROUTE — that is the whole reason this is a
 * tool and not a sentence in an instruction channel, which the model may skip and, in
 * the failure this change answers, did.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWikiTool } from "../src/wiki-tool.js";
import {
  WikiRetrievalGate,
  atomIdsFromIndex,
  WIKI_ATOMS_PER_CALL,
  WIKI_BODY_CHARS_PER_CALL,
  WIKI_INDEX_CHARS_PER_CALL,
} from "../src/wiki-index.js";

const INDEX = `# Wiki index

## concept

- [[concept/cognitive-load]] — working-memory demand of a task
- [[concept/scaffolding]] — fading support
- [[concept/transfer]] — carrying a skill into a new situation

## method

- [[method/think-pair-share]] — three-step activation pattern
- [[method/jigsaw]] — expert groups feeding home groups
- [[method/gallery-walk]] — silent circulation with sticky notes
`;

let root: string;
let wikiDir: string;
let gate: WikiRetrievalGate;

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };

/** One call through the built tool, returning the text and the details payload. */
async function call(atoms?: string[]): Promise<{ text: string; details: Record<string, unknown> }> {
  const tool = createWikiTool(gate, wikiDir);
  const res = (await tool.execute("call-1", atoms === undefined ? {} : { atoms }, {} as never)) as ToolResult;
  return { text: res.content[0]!.text, details: res.details };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cbe-wiki-tool-"));
  wikiDir = path.join(root, "wiki");
  await mkdir(path.join(wikiDir, "concept"), { recursive: true });
  await mkdir(path.join(wikiDir, "method"), { recursive: true });
  await mkdir(path.join(root, "raw"), { recursive: true });
  await mkdir(path.join(root, "inbox"), { recursive: true });
  await writeFile(path.join(wikiDir, "index.md"), INDEX, "utf8");
  for (const [dir, name] of [
    ["concept", "cognitive-load"],
    ["concept", "scaffolding"],
    ["concept", "transfer"],
    ["method", "think-pair-share"],
    ["method", "jigsaw"],
    ["method", "gallery-walk"],
  ] as const) {
    await writeFile(path.join(wikiDir, dir, `${name}.md`), `# ${name}\n\nbody of ${name}\n`, "utf8");
  }
  await writeFile(path.join(root, "raw", "skript.md"), "THE UNDIGESTED EXTRACTION\n", "utf8");
  await writeFile(path.join(root, "inbox", "skript.pdf"), "%PDF\n", "utf8");
  gate = new WikiRetrievalGate();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Write an atom of exactly `chars` characters, with a distinctive opening and closing
 * line, and add it to the index. The closing line is what proves a served body arrived
 * WHOLE rather than merely shorter than the budget.
 */
async function seedLargeAtom(id: string, chars: number): Promise<string> {
  const [dir, name] = id.split("/") as [string, string];
  await mkdir(path.join(wikiDir, dir), { recursive: true });
  const opening = `# ${name}\n\nSTART OF ${id}\n`;
  const closing = `\nEND OF ${id}\n`;
  const body = `${opening}${"x".repeat(Math.max(0, chars - opening.length - closing.length))}${closing}`;
  await writeFile(path.join(wikiDir, dir, `${name}.md`), body, "utf8");
  await appendFile(path.join(wikiDir, "index.md"), `- [[${id}]] — a merged atom\n`, "utf8");
  return body;
}

/**
 * Overwrite the index with `count` entries, optionally with a per-entry prose note.
 * Returns the ids written, so a test can assert on the WHOLE set rather than a sample.
 */
async function seedWideIndex(count: number, withNotes: boolean): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, i) => `concept/atom-${String(i).padStart(4, "0")}`);
  const note = " — a per-entry note that exists only to make the verbatim index long";
  const text = `# Wiki index\n\n## concept\n\n${ids.map((id) => `- [[${id}]]${withNotes ? note : ""}`).join("\n")}\n`;
  await writeFile(path.join(wikiDir, "index.md"), text, "utf8");
  return ids;
}

/** The ids a compact index payload advertises, parsed back out of its `type: a, b`
 * lines — so a test can assert on the WHOLE set and catch an extra id as well as a
 * dropped one. */
function idsFromCompactIndex(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^[^\s:]+: \S/.test(line))
    .flatMap((line) => line.slice(line.indexOf(": ") + 2).split(", "));
}

describe("cbe_wiki — the index-first route", () => {
  // Scenario: *No atom body is served before the index* — the load-bearing one.
  it("serves no atom body before the index, and the same call straight after succeeds", async () => {
    const early = await call(["concept/cognitive-load"]);

    expect(early.details.kind).toBe("wiki-index");
    expect(early.details.servedBodies).toBe(0);
    expect(early.text).toContain("Index first");
    expect(early.text).toContain("[[concept/cognitive-load]]");
    // The BODY is what must not have travelled.
    expect(early.text).not.toContain("body of cognitive-load");

    const second = await call(["concept/cognitive-load"]);
    expect(second.details.kind).toBe("wiki-atoms");
    expect(second.text).toContain("body of cognitive-load");
  });

  // Scenario: *The index call lists the course's atoms*.
  it("returns the index and reads no atom file when called with no ids", async () => {
    const r = await call();
    expect(r.details).toMatchObject({ kind: "wiki-index", atomCount: 6, servedBodies: 0 });
    expect(r.text).toBe(INDEX);
    expect(r.text).not.toContain("body of");
    expect(gate.requiresIndex()).toBe(false);
  });

  // Scenario: *An unknown atom id is refused with the ids that exist*.
  it("refuses an id the index does not carry and returns the ids it does", async () => {
    await call();
    const r = await call(["concept/nothing-like-this", "method/jigsaw"]);

    expect(r.text).toContain("Not in the index: concept/nothing-like-this");
    expect(r.text).toContain("The index carries: ");
    expect(r.text).toContain("concept/cognitive-load");
    // The valid id of the same call is still served — the refusal is per id.
    expect(r.text).toContain("body of jigsaw");
    expect(r.details.missing).toEqual(["concept/nothing-like-this"]);
  });

  // Scenario: *The imported original is refused in an atom's place* — load-bearing.
  it("refuses raw/, inbox/ and any escape, and points at the atoms instead", async () => {
    await call();
    for (const bad of ["raw/skript", "inbox/skript.pdf", "../raw/skript"]) {
      const r = await call([bad]);
      expect(r.details, bad).toMatchObject({ kind: "wiki-refusal", reason: "outside-wiki" });
      expect(r.text, bad).toContain("Not an atom");
      expect(r.text, bad).toContain("The index carries: ");
      expect(r.text, bad).not.toContain("THE UNDIGESTED EXTRACTION");
    }
  });

  it("refuses the whole call rather than half-serving it when an import path rides along", async () => {
    await call();
    const r = await call(["method/jigsaw", "raw/skript"]);
    expect(r.details.reason).toBe("outside-wiki");
    expect(r.text).not.toContain("body of jigsaw");
  });

  // Scenario: *A bulk request is refused rather than served*.
  it("refuses more atoms than the per-call cap and returns no body", async () => {
    await call();
    const many = [
      "concept/cognitive-load",
      "concept/scaffolding",
      "concept/transfer",
      "method/think-pair-share",
      "method/jigsaw",
      "method/gallery-walk",
    ];
    expect(many.length).toBeGreaterThan(WIKI_ATOMS_PER_CALL);
    const r = await call(many);

    expect(r.details).toMatchObject({ kind: "wiki-refusal", reason: "over-cap", cap: WIKI_ATOMS_PER_CALL });
    expect(r.text).toContain("Select the ones the question actually needs");
    expect(r.text).not.toContain("body of");
  });

  // Scenario: *A size-bounded call serves whole atoms and names the rest* — the count
  // cap alone does not bound the payload, because merge-on-re-ingest makes atom size
  // grow monotonically across a semester.
  it("serves whole atoms up to the per-call body budget and names the rest", async () => {
    await call();
    const bodies: Record<string, string> = {};
    for (const id of ["big/one", "big/two", "big/three"]) bodies[id] = await seedLargeAtom(id, 10_000);

    const r = await call(["big/one", "big/two", "big/three"]);

    // (a) + (b) whole bodies only — the CLOSING content of the last served atom is
    // present, and each served body appears in full, character for character.
    expect(r.text).toContain("END OF big/one");
    expect(r.text).toContain("END OF big/two");
    expect(r.text).toContain(bodies["big/one"]);
    expect(r.text).toContain(bodies["big/two"]);
    expect(r.details).toMatchObject({
      kind: "wiki-atoms",
      servedBodies: 2,
      served: ["big/one", "big/two"],
      servedChars: 20_000,
      bodyBudget: WIKI_BODY_CHARS_PER_CALL,
    });

    // (c) the unserved atom is NAMED, and not one character of it travelled.
    expect(r.text).toContain("Not served in this call: big/three");
    expect(r.text).toContain("ask for them in a further call");
    expect(r.text).not.toContain("START OF big/three");
    expect(r.text).not.toContain("END OF big/three");
    expect(r.details.notServed).toEqual(["big/three"]);
    expect(r.details.tooLarge).toBeUndefined();

    // (d) the following call for the named atom serves it, whole.
    const next = await call(["big/three"]);
    expect(next.details).toMatchObject({ kind: "wiki-atoms", servedBodies: 1, served: ["big/three"] });
    expect(next.text).toContain(bodies["big/three"]);
    expect(next.text).toContain("END OF big/three");
    expect(next.details.notServed).toBeUndefined();
  });

  // Same Scenario, its second half: an atom that alone exceeds the whole budget.
  it("names an atom larger than the whole budget rather than serving or truncating it", async () => {
    await call();
    await seedLargeAtom("big/huge", WIKI_BODY_CHARS_PER_CALL + 500);

    const r = await call(["big/huge", "method/jigsaw"]);

    expect(r.text).toContain("Too large for one call: big/huge");
    expect(r.text).not.toContain("START OF big/huge");
    expect(r.text).not.toContain("END OF big/huge");
    // Nothing of the body leaked as a fragment either.
    expect(r.text).not.toContain("xxxxxxxxxx");
    expect(r.details.tooLarge).toEqual(["big/huge"]);
    expect(r.details.notServed).toEqual(["big/huge"]);
    // A partial serve, not a refusal: the legal sibling in the same call is served.
    expect(r.details).toMatchObject({ kind: "wiki-atoms", servedBodies: 1, served: ["method/jigsaw"] });
    expect(r.text).toContain("body of jigsaw");
  });

  // Scenario: *The imported original is refused in an atom's place* — the `absolute`
  // half of it. A model handed the descriptor's wiki path passes a filesystem path,
  // which is a different mistake from reaching for `raw/` and gets its own correction.
  it("names the actual mistake when handed a filesystem path instead of an atom id", async () => {
    await call();
    const absolute = path.join(wikiDir, "concept", "cognitive-load.md");
    const r = await call([absolute]);

    expect(r.details).toMatchObject({ kind: "wiki-refusal", reason: "not-an-atom-id" });
    expect(r.details.refused).toEqual([absolute]);
    expect(r.text).toContain("Not an atom id:");
    expect(r.text).toContain("wiki-relative id");
    expect(r.text).toContain("never a filesystem path");
    expect(r.text).not.toContain("`raw/` holds");
    expect(r.text).toContain("The index carries: ");
    expect(r.text).not.toContain("body of cognitive-load");

    // Both kinds in one call: each is named for what it actually is.
    const mixed = await call(["/etc/passwd", "raw/skript"]);
    expect(mixed.text).toContain("Not an atom id: /etc/passwd");
    expect(mixed.text).toContain("Not an atom: raw/skript");
    expect(mixed.details).toMatchObject({ kind: "wiki-refusal", reason: "outside-wiki" });
    expect(mixed.text).not.toContain("THE UNDIGESTED EXTRACTION");
  });

  // Scenario: *An over-long index is compacted rather than cut*. The index is the one
  // payload that cannot name what it withheld — naming what is missing IS the index —
  // so it degrades in description, never in the set of reachable ids.
  it("compacts an over-long index instead of cutting it, on both stage-1 paths", async () => {
    // (a) within budget: byte-identical to the file, which the verbatim test above pins.
    const small = await call();
    expect(small.text).toBe(INDEX);
    expect(small.details.compacted).toBe(false);

    const ids = await seedWideIndex(300, true);
    const verbatim = await readFile(path.join(wikiDir, "index.md"), "utf8");
    expect(verbatim.length).toBeGreaterThan(WIKI_INDEX_CHARS_PER_CALL);

    const r = await call();

    // (b) EVERY id survives — asserted over the whole set, not a sample.
    expect(atomIdsFromIndex(verbatim)).toEqual(ids);
    for (const id of ids) expect(r.text).toContain(id);
    expect(idsFromCompactIndex(r.text).sort()).toEqual([...ids].sort());
    expect(r.details.atomCount).toBe(ids.length);

    // (c) the per-entry prose is what was dropped, and the payload did shrink.
    expect(r.text).not.toContain("a per-entry note that exists only");
    expect(r.text.length).toBeLessThan(verbatim.length);

    // (d) announced in the text and recorded in the payload.
    expect(r.text).toContain("[index compacted]");
    expect(r.text).toContain("No atom is missing from this list");
    expect(r.details).toMatchObject({ kind: "wiki-index", compacted: true, servedBodies: 0 });

    // (e) the index-first refusal renders identically — a compact index on one path
    // and a verbatim one on the other would be a silent inconsistency.
    const fresh = new WikiRetrievalGate();
    const refusal = (await createWikiTool(fresh, wikiDir).execute(
      "c",
      { atoms: ["concept/atom-0000"] },
      {} as never
    )) as ToolResult;
    expect(refusal.details).toMatchObject({ kind: "wiki-index", reason: "index-first", compacted: true });
    expect(refusal.content[0]!.text).toContain(r.text);
    expect(fresh.requiresIndex()).toBe(false);
  });

  it("serves an id-only index whole even when that still exceeds the budget", async () => {
    const ids = await seedWideIndex(900, false);
    const r = await call();

    expect(r.details.compacted).toBe(true);
    expect(r.text.length).toBeGreaterThan(WIKI_INDEX_CHARS_PER_CALL);
    // (f) the budget governs the prose, never the ids: not one was dropped.
    expect(idsFromCompactIndex(r.text).sort()).toEqual([...ids].sort());
    expect(r.details.atomCount).toBe(900);
  });

  it("serves a repeated id once and never both serves and defers it", async () => {
    await call();
    const body = await seedLargeAtom("big/one", 20_000);

    const r = await call(["big/one", "big/one.md", "big/one"]);

    expect(r.text.split("--- ATOM big/one ---").length - 1).toBe(1);
    expect(r.text).toContain(body);
    expect(r.details).toMatchObject({ servedBodies: 1, served: ["big/one"], servedChars: 20_000 });
    expect(r.details.notServed).toBeUndefined();
    expect(r.text).not.toContain("Not served in this call");

    const servedIds = r.details.served as string[];
    const notServed = (r.details.notServed ?? []) as string[];
    expect(servedIds.filter((id) => notServed.includes(id))).toEqual([]);
  });

  it("counts the ids as requested against the per-call cap, not the deduplicated ones", async () => {
    await call();
    const r = await call([
      "concept/cognitive-load",
      "concept/cognitive-load",
      "concept/cognitive-load",
      "concept/cognitive-load",
      "concept/cognitive-load",
      "concept/cognitive-load",
    ]);
    expect(r.details).toMatchObject({ kind: "wiki-refusal", reason: "over-cap", requested: 6 });
  });

  // Scenario: *A course with no atoms is reported as empty*.
  it("reports an absent wiki, an absent index and an empty index as carrying no atoms", async () => {
    const noDir = createWikiTool(new WikiRetrievalGate(), undefined);
    const a = (await noDir.execute("c", {}, {} as never)) as ToolResult;
    expect(a.details.kind).toBe("wiki-empty");
    expect(a.content[0]!.text).toContain("no wiki index");

    await rm(path.join(wikiDir, "index.md"));
    expect((await call()).details.kind).toBe("wiki-empty");

    await writeFile(path.join(wikiDir, "index.md"), "# Wiki index\n\n(nothing yet)\n", "utf8");
    const empty = await call(["concept/cognitive-load"]);
    expect(empty.details).toMatchObject({ kind: "wiki-empty", atomCount: 0 });
    expect(empty.text).not.toContain("body of cognitive-load");
  });

  it("is not a deferred-answer tool — it never terminates the batch", async () => {
    const tool = createWikiTool(gate, wikiDir);
    const res = (await tool.execute("c", {}, {} as never)) as ToolResult & { terminate?: boolean };
    expect(res.terminate).toBeUndefined();
  });

  // Requirement: *Newly Ingested Wiki Atoms Are Disclosed on the Next Lecturer Turn*,
  // Scenario: *The first atom read after an ingestion goes through the index again*.
  it("goes through the index again after atoms have landed mid-session", async () => {
    await call();
    expect((await call(["method/jigsaw"])).text).toContain("body of jigsaw");

    gate.recordIngestedAtoms(["concept/new-atom"]);

    const afterIngest = await call(["method/jigsaw"]);
    expect(afterIngest.details.kind).toBe("wiki-index");
    expect(afterIngest.text).not.toContain("body of jigsaw");
    expect((await call(["method/jigsaw"])).text).toContain("body of jigsaw");
  });

  it("re-reads the index from disk on every call, so a landed atom is reachable at once", async () => {
    await call();
    await writeFile(path.join(wikiDir, "concept", "new-atom.md"), "# new\n\nbody of new-atom\n", "utf8");
    await writeFile(path.join(wikiDir, "index.md"), `${INDEX}- [[concept/new-atom]] — just landed\n`, "utf8");
    gate.recordIngestedAtoms(["concept/new-atom"]);

    await call(["concept/new-atom"]); // the forced index re-read
    expect((await call(["concept/new-atom"])).text).toContain("body of new-atom");
  });
});

describe("cbe_wiki — the tool channel carries the operating rules", () => {
  // Requirement: *Tool Descriptions Carry Their Operating Rules*.
  it("states the route, the unit and the precedence in its own prose", () => {
    const d = createWikiTool(gate, wikiDir).description ?? "";
    expect(d).toMatch(/INDEX-FIRST AND CANNOT BE SHORT-CUT/);
    expect(d).toMatch(/THE ATOMS ARE THE UNIT/);
    expect(d).toMatch(/THEY OUTRANK THE IMPORTED ORIGINAL/);
    expect(d).toMatch(/`raw\/` and `inbox\/`/);
    expect(d).toMatch(/A REFUSAL IS AN INSTRUCTION/);
  });
});
