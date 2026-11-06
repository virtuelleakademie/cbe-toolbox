import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CategoryEnum, type CorpusDocument } from "./schema.js";
import { parseStrictJson } from "./strict-json.js";
import { validateFile } from "./validate.js";
import { compareContentPaths, type ContentPackEntry } from "./signed-pack.js";

export const CORPUS_SCHEMA_ID = "cbe-corpus/1";

export const CORPUS_INDEX_CONTRACT = {
  schema: CORPUS_SCHEMA_ID,
  index: {
    required: ["corpus-version", "generated", "generator", "document-count", "categories", "documents"],
    version: "YYYY-MM",
    generated: "YYYY-MM-DD",
    categories: ["methodology", "case-study", "template", "foundations", "vocabulary"],
  },
  document: {
    required: ["id", "title", "category", "version", "path", "tags"],
    optional: ["short-description"],
    path: "content/<category>/<id>-<slug>.md",
  },
  atom: {
    required: ["id", "title", "category", "version", "sources", "license", "updated", "tags"],
    optional: ["short-description"],
    strict: true,
  },
} as const;

function canonicalStructural(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStructural).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStructural(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const CORPUS_INDEX_CONTRACT_SHA256 = createHash("sha256")
  .update(canonicalStructural(CORPUS_INDEX_CONTRACT))
  .digest("hex");

export const CORPUS_COMPATIBILITY_CONTRACT = Object.freeze({
  corpusSchema: CORPUS_SCHEMA_ID,
  indexContractSha256: CORPUS_INDEX_CONTRACT_SHA256,
});

const VERSION = /^\d{4}-\d{2}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const PATH = /^content\/(methodology|case-study|template|foundations|vocabulary)\/[a-z0-9]+(?:-[a-z0-9]+)+\.md$/u;

const IndexDocumentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    title: z.string().min(1),
    category: CategoryEnum,
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    path: z.string().regex(PATH),
    tags: z.array(z.string()),
    "short-description": z.string().min(1).max(200).optional(),
  })
  .strict();

const CategoriesSchema = z
  .object({
    methodology: z.number().int().nonnegative().optional(),
    "case-study": z.number().int().nonnegative().optional(),
    template: z.number().int().nonnegative().optional(),
    foundations: z.number().int().nonnegative().optional(),
    vocabulary: z.number().int().nonnegative().optional(),
  })
  .strict();

const CorpusIndexSchema = z
  .object({
    "corpus-version": z.string().regex(VERSION),
    generated: z.string().regex(DATE),
    generator: z.string().min(1).max(128),
    "document-count": z.number().int().nonnegative(),
    categories: CategoriesSchema,
    documents: z.array(IndexDocumentSchema).max(255),
  })
  .strict();

export type StrictCorpusIndex = z.infer<typeof CorpusIndexSchema>;

export interface CorpusInventoryValidation {
  version: string;
  index: StrictCorpusIndex;
  contents: ContentPackEntry[];
}

export class CorpusInventoryError extends Error {
  constructor(
    readonly code: "unsafe-entry" | "index-invalid" | "inventory-mismatch" | "atom-invalid" | "metadata-mismatch",
    readonly field?: string
  ) {
    super(field ? `${code}:${field}` : code);
    this.name = "CorpusInventoryError";
  }
}

async function collectRegularFiles(root: string, dir = root): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    const stat = await lstat(full);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new CorpusInventoryError("unsafe-entry", rel);
    }
    if (stat.isDirectory()) files.push(...(await collectRegularFiles(root, full)));
    else files.push(rel);
  }
  return files.sort(compareContentPaths);
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameDocument(indexed: StrictCorpusIndex["documents"][number], actual: CorpusDocument): boolean {
  return (
    indexed.id === actual.id &&
    indexed.title === actual.title &&
    indexed.category === actual.category &&
    indexed.version === actual.version
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validateCorpusInventory(
  root: string,
  options?: {
    expectedVersion?: string;
    expectedContents?: readonly ContentPackEntry[];
    allowSourceDocumentation?: boolean;
  }
): Promise<CorpusInventoryValidation> {
  const sourceFiles = await collectRegularFiles(root);
  const allFiles = options?.allowSourceDocumentation
    ? sourceFiles.filter((file) => file === "index.json" || file.startsWith("content/"))
    : sourceFiles;
  if (!allFiles.includes("index.json")) throw new CorpusInventoryError("inventory-mismatch", "index.json");
  if (allFiles.some((file) => file !== "index.json" && !PATH.test(file))) {
    throw new CorpusInventoryError(
      "unsafe-entry",
      allFiles.find((file) => file !== "index.json" && !PATH.test(file))
    );
  }

  let indexUnknown: unknown;
  try {
    indexUnknown = parseStrictJson(await readFile(path.join(root, "index.json"), "utf8"));
  } catch {
    throw new CorpusInventoryError("index-invalid", "json");
  }
  const parsed = CorpusIndexSchema.safeParse(indexUnknown);
  if (!parsed.success) {
    throw new CorpusInventoryError("index-invalid", parsed.error.issues[0]?.path.join(".") || "root");
  }
  const index = parsed.data;
  if (options?.expectedVersion && index["corpus-version"] !== options.expectedVersion) {
    throw new CorpusInventoryError("metadata-mismatch", "corpus-version");
  }
  if (index["document-count"] !== index.documents.length) {
    throw new CorpusInventoryError("index-invalid", "document-count");
  }
  const ids = new Set<string>();
  const indexedPaths = new Set<string>();
  const categoryCounts = new Map<string, number>();
  for (const document of index.documents) {
    if (ids.has(document.id)) throw new CorpusInventoryError("index-invalid", `duplicate-id:${document.id}`);
    if (indexedPaths.has(document.path))
      throw new CorpusInventoryError("index-invalid", `duplicate-path:${document.path}`);
    if (!document.path.startsWith(`content/${document.category}/`)) {
      throw new CorpusInventoryError("index-invalid", `category-path:${document.path}`);
    }
    ids.add(document.id);
    indexedPaths.add(document.path);
    categoryCounts.set(document.category, (categoryCounts.get(document.category) ?? 0) + 1);
  }
  const givenCategories = Object.entries(index.categories)
    .filter(([, count]) => count !== undefined && count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const actualCategories = [...categoryCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(givenCategories) !== JSON.stringify(actualCategories)) {
    throw new CorpusInventoryError("index-invalid", "categories");
  }

  const expectedFiles = ["index.json", ...index.documents.map((document) => document.path)].sort(compareContentPaths);
  if (!sameArray(allFiles, expectedFiles)) throw new CorpusInventoryError("inventory-mismatch");

  for (const indexed of index.documents) {
    const result = await validateFile(path.join(root, indexed.path), "corpus");
    if (!result.ok) throw new CorpusInventoryError("atom-invalid", indexed.path);
    if (!sameDocument(indexed, result.doc)) throw new CorpusInventoryError("metadata-mismatch", indexed.path);
  }

  const contents: ContentPackEntry[] = [];
  for (const rel of expectedFiles) {
    const bytes = await readFile(path.join(root, rel));
    contents.push({ path: rel, size: bytes.byteLength, sha256: sha256(bytes) });
  }
  contents.sort((a, b) => compareContentPaths(a.path, b.path));
  if (options?.expectedContents) {
    const expected = [...options.expectedContents].sort((a, b) => compareContentPaths(a.path, b.path));
    if (JSON.stringify(contents) !== JSON.stringify(expected))
      throw new CorpusInventoryError("inventory-mismatch", "contents");
  }
  return { version: index["corpus-version"], index, contents };
}
