import { describe, it, expect } from "vitest";
import { shortenAgentPath } from "../src/renderer/util/paths.js";
import type { SessionPaths } from "../src/shared/ipc-contract.js";

const PATHS: SessionPaths = {
  workspace: "/Users/lecturer/Library/Application Support/CBE Toolbox/workspace",
  corpus: "/Applications/CBE Toolbox.app/Contents/Resources/corpus",
};

const PATHS_WITH_WIKI: SessionPaths = {
  ...PATHS,
  wiki: "/Users/lecturer/Documents/cbe-toolbox/courses/water/wiki",
};

describe("shortenAgentPath", () => {
  it("rewrites a corpus-relative path against the corpus anchor", () => {
    expect(shortenAgentPath(`${PATHS.corpus}/dev/foundations/abc.md`, PATHS)).toBe("corpus/dev/foundations/abc.md");
  });

  it("rewrites a workspace-relative path against the workspace anchor", () => {
    expect(shortenAgentPath(`${PATHS.workspace}/notes.md`, PATHS)).toBe("workspace/notes.md");
  });

  it("uses the wiki anchor when present", () => {
    expect(shortenAgentPath(`${PATHS_WITH_WIKI.wiki!}/atom-123.md`, PATHS_WITH_WIKI)).toBe("wiki/atom-123.md");
  });

  it("returns just the bare label for the anchor directory itself", () => {
    expect(shortenAgentPath(PATHS.corpus, PATHS)).toBe("corpus");
    expect(shortenAgentPath(PATHS.workspace, PATHS)).toBe("workspace");
  });

  it("prefers the longer anchor when one is nested under another", () => {
    const nested: SessionPaths = {
      workspace: "/home/u/work",
      corpus: "/home/u/work/corpus",
    };
    // /home/u/work/corpus/x.md must resolve to "corpus/x.md", not "workspace/corpus/x.md".
    expect(shortenAgentPath("/home/u/work/corpus/x.md", nested)).toBe("corpus/x.md");
  });

  it("falls back to last-3-segments for absolute paths outside any anchor", () => {
    expect(shortenAgentPath("/etc/very/deep/nested/somewhere/else.txt", PATHS)).toBe("…/nested/somewhere/else.txt");
  });

  it("leaves already-relative strings alone (no leading slash, no anchor match)", () => {
    expect(shortenAgentPath("./relative/path.md", PATHS)).toBe("./relative/path.md");
  });

  it("is a no-op when paths is null", () => {
    expect(shortenAgentPath("/somewhere/deep/file.md", null)).toBe("/somewhere/deep/file.md");
  });
});
