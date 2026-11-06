import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_PACK_ORIGIN,
  corpusContentPackPolicy,
  skillContentPackPolicy,
} from "../src/main/content-pack-policy.js";
import { PORTAL_CORPUS_POINTER_URL, PORTAL_ORIGIN, PORTAL_SKILL_POINTER_URL } from "../src/main/delivery-channel.js";

const repoRoot = path.resolve(__dirname, "../../..");
const appPackage = JSON.parse(readFileSync(path.join(repoRoot, "packages/app/package.json"), "utf8"));
const updateManager = readFileSync(path.join(repoRoot, "packages/app/src/main/update-manager.ts"), "utf8");
const englishInstallation = readFileSync(path.join(repoRoot, "docs/user/en/installation-and-local-it.md"), "utf8");

const SOURCE_MIRROR_URL = "https://github.com/virtuelleakademie/cbe-toolbox";
const PUBLIC_DOWNLOAD_URL = "https://cbe-toolbox.pages.dev/#download";
const UPDATE_FEED_URL = "https://cbe-stories.pages.dev/update";
const UPDATE_NOTES_URL = "https://cbe-stories.pages.dev/build/";
const CONTENT_ORIGIN = "https://cbe-stories.pages.dev";

describe("release and signed-content route compatibility", () => {
  it("keeps the source mirror separate from public downloads and release services", () => {
    expect(englishInstallation).toContain(SOURCE_MIRROR_URL);
    expect(englishInstallation).toContain(`git clone ${SOURCE_MIRROR_URL}`);
    expect(englishInstallation).toContain(PUBLIC_DOWNLOAD_URL);
    expect(englishInstallation).toContain(
      "Official GitHub releases, release automation, OTA publication and Cloudflare operations have not moved"
    );
    expect(appPackage.build.publish).toEqual([{ provider: "generic", url: UPDATE_FEED_URL }]);
    expect(updateManager).toContain(`const NOTES_URL = "${UPDATE_NOTES_URL}"`);
  });

  it("Update and content routes remain canonical", () => {
    expect(CONTENT_PACK_ORIGIN).toBe(CONTENT_ORIGIN);
    expect(PORTAL_ORIGIN).toBe(CONTENT_ORIGIN);
    expect(skillContentPackPolicy().baseUrl).toBe(`${CONTENT_ORIGIN}/delivery/v2/skill/stable/`);
    expect(corpusContentPackPolicy().baseUrl).toBe(`${CONTENT_ORIGIN}/delivery/v2/corpus/stable/`);
    expect(PORTAL_SKILL_POINTER_URL).toBe(`${CONTENT_ORIGIN}/delivery/v2/skill/stable/latest.json`);
    expect(PORTAL_CORPUS_POINTER_URL).toBe(`${CONTENT_ORIGIN}/delivery/v2/corpus/stable/latest.json`);
  });
});
