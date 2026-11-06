/**
 * Abstraction over the `skills/cbe/` file tree. A real implementation reads/writes
 * disk; an in-memory implementation backs tests and keeps the improvement loop
 * fully exercisable without touching the real skill.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface SkillIO {
  /** Relative paths under the skill root (e.g. "SKILL.md", "references/checks/x.md"). */
  list(): string[];
  read(rel: string): string;
  write(rel: string, content: string): void;
  snapshot(): Map<string, string>;
  restore(snap: Map<string, string>): void;
}

export class MemorySkillIO implements SkillIO {
  constructor(private files: Map<string, string>) {}
  list(): string[] {
    return [...this.files.keys()].sort();
  }
  read(rel: string): string {
    return this.files.get(rel) ?? "";
  }
  write(rel: string, content: string): void {
    this.files.set(rel, content);
  }
  snapshot(): Map<string, string> {
    return new Map(this.files);
  }
  restore(snap: Map<string, string>): void {
    this.files = new Map(snap);
  }
}

function walkMd(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) walkMd(root, abs, out);
    else if (entry.endsWith(".md")) out.push(path.relative(root, abs));
  }
  return out;
}

export class FsSkillIO implements SkillIO {
  constructor(private readonly root: string) {}
  list(): string[] {
    return walkMd(this.root).sort();
  }
  read(rel: string): string {
    return readFileSync(path.join(this.root, rel), "utf8");
  }
  write(rel: string, content: string): void {
    writeFileSync(path.join(this.root, rel), content, "utf8");
  }
  snapshot(): Map<string, string> {
    return new Map(this.list().map((rel) => [rel, this.read(rel)]));
  }
  restore(snap: Map<string, string>): void {
    for (const [rel, content] of snap) this.write(rel, content);
  }
}
