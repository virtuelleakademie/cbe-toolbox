import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDocumentationChecks } from "../../../scripts/user-documentation/docs-check-lib.mjs";
import { launchElectron } from "../../../scripts/user-documentation/electron-cdp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceDocs = path.join(repoRoot, "docs", "user");
const negativeRoot = path.join(repoRoot, "scripts", "user-documentation", "fixtures", "negative");
let tempRoot = "";
let docsRoot = "";

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cbe-user-docs-check-"));
  docsRoot = path.join(tempRoot, "docs", "user");
  await cp(sourceDocs, docsRoot, { recursive: true });
});

afterAll(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function check(options: { sourceOverrides?: Map<string, string>; release?: boolean } = {}) {
  return runDocumentationChecks({ repoRoot, docsRoot, ownership: false, ...options });
}

async function expectFailure(code: string, operation: () => Promise<unknown>) {
  try {
    await operation();
    throw new Error(`expected docs check failure ${code}`);
  } catch (error) {
    expect((error as { code?: string }).code, String(error)).toBe(code);
  }
}

async function mutate(relative: string, transform: (text: string) => string, code: string) {
  const file = path.join(docsRoot, relative);
  const original = await readFile(file, "utf8");
  await writeFile(file, transform(original));
  try {
    await expectFailure(code, () => check());
  } finally {
    await writeFile(file, original);
  }
}

async function injectFixture(relative: string, fixture: string, code: string) {
  const bad = await readFile(path.join(negativeRoot, fixture), "utf8");
  await mutate(relative, (text) => `${text}\n${bad}`, code);
}

async function sourceOverride(relative: string, transform: (text: string) => string, code: string) {
  const original = await readFile(path.join(repoRoot, relative), "utf8");
  await expectFailure(code, () => check({ sourceOverrides: new Map([[relative, transform(original)]]) }));
}

function text(relative: string) {
  return readFile(path.join(docsRoot, relative), "utf8");
}

describe("Repository-Owned Markdown Documentation Set", () => {
  it("A lecturer can read the documentation directly on GitHub", async () => {
    expect((await check()).pages).toBe(17);
    await injectFixture("en/quick-start.md", "broken-relative-link.md", "link");
  });

  it("The source tree has one exact bilingual shape", async () => {
    const file = path.join(docsRoot, "de/glossary-faq.md");
    const original = await readFile(file, "utf8");
    await unlink(file);
    try {
      await expectFailure("tree-shape", () => check());
    } finally {
      await writeFile(file, original);
    }
    const extra = path.join(docsRoot, "en/extra.md");
    await writeFile(extra, "# extra\n");
    try {
      await expectFailure("tree-shape", () => check());
    } finally {
      await unlink(extra);
    }
  });

  it("The current production build is linked from the documentation", async () => {
    expect(await text("en/installation-and-local-it.md")).toContain("https://cbe-toolbox.pages.dev/#download");
  });

  it("The buildable source mirror is named without moving release ownership", async () => {
    const sourceMirrorUrl = "https://github.com/virtuelleakademie/cbe-toolbox";
    const english = await text("en/installation-and-local-it.md");
    const german = await text("de/installation-and-local-it.md");
    for (const document of [english, german]) {
      expect(document).toContain(sourceMirrorUrl);
      expect(document).toContain(`git clone ${sourceMirrorUrl}`);
      expect(document).toContain("https://cbe-toolbox.pages.dev/#download");
      expect(document).not.toContain(`${["phy", "laxe"].join("")}/${["cbe", "toolbox"].join("-")}`);
    }
    expect(english).toContain("buildable generated source mirror");
    expect(english).toContain(
      "Official GitHub releases, release automation, OTA publication and Cloudflare operations"
    );
    expect(german).toContain("baubare, generierte Quellcode-Mirror");
    expect(german).toContain(
      "Offizielle GitHub-Releases, Release-Automation, OTA-Veröffentlichung und Cloudflare-Betrieb"
    );
  });

  it("documents the two-platform Windows path in both languages", async () => {
    for (const relative of ["en/installation-and-local-it.md", "de/installation-and-local-it.md"]) {
      const document = await text(relative);
      const linux = /```sh\n(COMMIT=[\s\S]*?)```/.exec(document)?.[1] ?? "";
      const windows = /```powershell\n([\s\S]*?)```/.exec(document)?.[1] ?? "";
      for (const command of [
        'git checkout --detach "$COMMIT"',
        "sha256sum package-lock.json",
        "npm ci",
        "npm run build",
        "npm test",
      ]) {
        expect(linux).toContain(command);
      }
      for (const command of [
        "git checkout --detach $Commit",
        "Get-FileHash package-lock.json -Algorithm SHA256",
        "npm ci",
        "npm run build",
        "npm run dist:win --workspace packages/app",
        "npm run checksums --workspace packages/app",
      ]) {
        expect(windows).toContain(command);
      }
      expect(windows).not.toMatch(/\bnpm (?:run )?test\b/);
      expect(windows).not.toMatch(/<[a-z-]+>/);
      expect(document).toContain("/mnt/c");
      expect(document).toContain("Get-FileHash .\\CBE-Toolbox-*-x64.exe -Algorithm SHA256");
      expect(document).toContain("MIRROR_PROVENANCE.json");
      expect(document).not.toMatch(/fsync|autocrlf/i);
    }
    expect(await text("en/installation-and-local-it.md")).toContain(
      "The full test suite is not a supported gate on native Windows"
    );
    expect(await text("de/installation-and-local-it.md")).toContain(
      "Die vollständige Testsuite ist unter nativem Windows kein unterstütztes Prüftor"
    );
    await mutate(
      "en/installation-and-local-it.md",
      (value) => value.replace("npm run checksums --workspace packages/app\nGet-Content", "npm test\nGet-Content"),
      "release-claims"
    );
    await mutate(
      "de/installation-and-local-it.md",
      (value) => value.replace("nicht unter `/mnt/c`", "auch unter `/mnt/c`"),
      "release-claims"
    );
  });
});

describe("Information Architecture Separates First Use, Didactic Work and Administration", () => {
  it("Quick Start reaches useful work without absorbing the reference", async () => {
    const quick = await text("en/quick-start.md");
    expect(quick.split(/\s+/).length).toBeLessThan(1000);
    expect(quick).toContain("<!-- topic:first-course-and-request -->");
    expect(quick).not.toMatch(/firewall|certificate|rollout/i);
  });

  it("Local IT guidance is not part of the didactic guide", async () => {
    expect(await text("en/installation-and-local-it.md")).toMatch(/Dissemination for IT departments/);
    expect(await text("en/installation-and-local-it.md")).toMatch(/Installation for end users/);
    expect(await text("en/user-guide.md")).not.toMatch(/firewall|certificate|rollout/i);
    await mutate(
      "en/user-guide.md",
      (value) => `${value}\nFirewall rollout administration.\n`,
      "information-architecture"
    );
  });
});

describe("Lecturer Guide Covers the Current Toolbox Workflow", () => {
  it("The full lecturer journey has one owned passage per topic", async () => {
    expect((await check()).topics).toBe(30);
    await mutate("de/user-guide.md", (value) => value.replace("<!-- topic:canvas -->", ""), "topic-owner");
  });

  it("Design transfer and review are explained without mode switches", async () => {
    const guide = await text("en/user-guide.md");
    expect(guide).toMatch(/\*\*Design:\*\*/);
    expect(guide).toMatch(/\*\*Transfer:\*\*/);
    expect(guide).toMatch(/\*\*Critical review:\*\*/);
    expect(guide).toContain("State the intended work in your request");
    expect(guide).not.toMatch(/(?:select|choose|switch) (?:a|the) mode/i);
  });

  it("Support and formulation preserve lecturer decisions", async () => {
    const guide = await text("en/user-guide.md");
    expect(guide).toContain("not consent to formulate course content");
    expect(guide).toMatch(/restates your decision[\s\S]*drafts that component[\s\S]*correct or accept[\s\S]*refines/);
  });

  it("Attachment and Wiki ingestion cannot be confused", async () => {
    const guide = await text("en/user-guide.md");
    expect(guide).toMatch(/attachment[\s\S]*next message/i);
    expect(guide).toMatch(/course Wiki[\s\S]*all later Chats of the Course/i);
    expect(guide).toContain("It is not added to the Wiki.");
  });

  it("Source status is legible to a lecturer", async () => {
    const guide = await text("en/user-guide.md");
    expect(guide).toMatch(/corpus[\s\S]*Course Wiki[\s\S]*takes precedence/i);
    expect(guide).toMatch(/clearly label the suggestion as unverified/i);
  });
});

describe("Installation and Release Claims Stay Evidenced", () => {
  it("The current installer route and platform signing status are clear", async () => {
    const installation = await text("en/installation-and-local-it.md");
    expect(installation).toContain("CBE Toolbox download page");
    expect(installation).toContain("macOS release is signed with an Apple Developer ID and notarized by Apple");
    expect(installation).toContain("Windows installer remains unsigned");
    await injectFixture("en/installation-and-local-it.md", "signed-installer.md", "prohibited-claim");
  });

  it("Signed Skill OTA is not presented as shipped", async () => {
    await injectFixture("en/installation-and-local-it.md", "signed-skill-ota.md", "prohibited-claim");
  });

  it("A Linux artifact is not evidence of Linux testing", async () => {
    await injectFixture("en/installation-and-local-it.md", "linux-tested.md", "prohibited-claim");
  });

  it("No live-eval claim is invented", async () => {
    await injectFixture("en/user-guide.md", "live-eval.md", "prohibited-claim");
  });
});

describe("Privacy, Storage, Diagnostics and Backup Are Explained Honestly", () => {
  it("A backup description preserves the real storage boundary", async () => {
    expect(await text("en/privacy-data-storage.md")).toMatch(
      /close the app[\s\S]*one Course[\s\S]*whole CBE Toolbox app-data folder/i
    );
    await injectFixture("en/privacy-data-storage.md", "backup-boundary.md", "prohibited-claim");
  });

  it("External-provider flow and the student-data boundary are explicit", async () => {
    const privacy = await text("en/privacy-data-storage.md");
    expect(privacy).toMatch(/external service[\s\S]*provider's retention/i);
    expect(privacy).toMatch(/Personal student data is not accepted/i);
    await injectFixture("en/privacy-data-storage.md", "provider-flow.md", "prohibited-claim");
  });

  it("Support sharing stays bounded", async () => {
    const troubleshooting = await text("en/troubleshooting-and-reference.md");
    expect(troubleshooting).toMatch(/Share neither provider keys nor personal student data/i);
    expect(troubleshooting).toMatch(/specific session Markdown, JSON sidecar or diagnostic file/i);
    await injectFixture("en/privacy-data-storage.md", "log-export.md", "prohibited-claim");
  });
});

describe("Troubleshooting, Accessibility and Glossary Stay User-Facing", () => {
  it("A common failure has a plain recovery path", async () => {
    const troubleshooting = await text("en/troubleshooting-and-reference.md");
    expect(troubleshooting).toMatch(/connection test fails[\s\S]*Course files remain safe/i);
    expect(troubleshooting).toMatch(/Wiki import is refused[\s\S]*retry/i);
    expect(troubleshooting).not.toMatch(/agent_end|tool_execution|stack trace/);
  });

  it("Keyboard documentation matches the current controls", async () => {
    expect(await text("en/accessibility-keyboard.md")).toContain("Escape does not stop an answer");
    await injectFixture("en/accessibility-keyboard.md", "keyboard-shortcut.md", "prohibited-claim");
  });

  it("The glossary contains product vocabulary only", async () => {
    expect(await text("en/glossary-faq.md")).toContain("**CBE Process Canvas:**");
    await injectFixture("en/glossary-faq.md", "glossary-internal.md", "terminology");
    await injectFixture("en/glossary-faq.md", "retired-surface.md", "terminology");
  });

  it("The licence section licenses the corpus collection while preserving individual-source rights", async () => {
    expect(await text("en/glossary-faq.md")).toContain(
      "The CBE corpus collection is distributed under CC BY 4.0 and credited to PIONEER. Individual source documents and excerpts retain their stated licences and rights."
    );
    expect(await text("de/glossary-faq.md")).toContain(
      "Die CBE-Corpus-Sammlung wird unter CC BY 4.0 verbreitet und PIONEER zugeschrieben. Einzelne Quelldokumente und Auszüge behalten ihre angegebenen Lizenzen und Rechte."
    );
  });
});

describe("Canonical Owners and Deterministic Freshness Prevent Documentation Drift", () => {
  it("Changed implementation evidence makes the documentation stale", async () => {
    await sourceOverride(
      "packages/app/tests/first-use-onboarding.test.tsx",
      (value) =>
        value.replace('it("A ready workspace explains its value without becoming a gate"', 'it("A renamed gate"'),
      "implementation-evidence"
    );
  });

  it("A moved or renamed control cannot leave a plausible old instruction", async () => {
    await mutate(
      "en/quick-start.md",
      (value) => value.replace("<!-- ui:settings-panel -->", "<!-- ui:moved-settings-panel -->"),
      "ui-registry"
    );
  });

  it("Supported formats have one authority", async () => {
    await sourceOverride(
      "packages/pi-bridge/src/ingest-formats.ts",
      (value) => value.replace('".csv"] as const', '".csv", ".rtf"] as const'),
      "formats"
    );
    await mutate(
      "en/user-guide.md",
      (value) => value.replace("PDF, DOCX, PPTX, XLSX, TXT, MD and CSV", "PDF, DOCX, PPTX, XLSX, TXT and MD"),
      "formats"
    );
  });

  it("An app release cannot retain an unreviewed documentation version", async () => {
    await sourceOverride(
      "packages/app/package.json",
      (value) => value.replace('"version": "0.1.21"', '"version": "0.1.22"'),
      "app-version"
    );
  });
});

describe("English and German Have Deterministic Structural Parity", () => {
  it("Removing a German section link or screenshot fails parity", async () => {
    await mutate("de/user-guide.md", (value) => value.replace("<!-- topic:maturity -->", ""), "topic-owner");
    await mutate(
      "de/quick-start.md",
      (value) =>
        value.replace(
          "[Installation für Endnutzer:innen](installation-and-local-it.md#install-current-build)",
          "Installation für Endnutzer:innen"
        ),
      "parity"
    );
    await mutate("de/user-guide.md", (value) => value.replace('<a id="canvas"></a>', ""), "anchor");
    await mutate(
      "de/user-guide.md",
      (value) => value.replace("<!-- screenshot:process-canvas:default:desktop -->", ""),
      "parity"
    );
  });

  it("Alt text and captions exist in both languages", async () => {
    await mutate(
      "de/quick-start.md",
      (value) => value.replace("![Die Einführung im deutschen Desktop-Arbeitsbereich]", "![]"),
      "screenshot-reference"
    );
    await mutate(
      "de/quick-start.md",
      (value) => value.replace("_Die Übersicht zeigt die wichtigsten Bereiche und die ersten Schritte._", "__"),
      "screenshot-reference"
    );
  });

  it("The first implementation claims only English and German documentation", async () => {
    const french = path.join(docsRoot, "fr");
    await mkdir(french);
    try {
      await expectFailure("locales", () => check());
    } finally {
      await rm(french, { recursive: true, force: true });
    }
  });
});

describe("Screenshot Harness Captures the Real Built App Safely and Deterministically", () => {
  it("A capture is the real application under CDP", async () => {
    const screenshotManifest = JSON.parse(await text("screenshot-manifest.json"));
    expect(screenshotManifest.capture).toMatchObject({
      lane: "linux-xvfb-real-electron-cdp",
      realApplication: true,
      liveModel: false,
    });
    const capture = await readFile(path.join(repoRoot, "scripts/user-documentation/capture-screenshots.mjs"), "utf8");
    const cdp = await readFile(path.join(repoRoot, "scripts/user-documentation/electron-cdp.mjs"), "utf8");
    expect(cdp).toContain("Page.captureScreenshot");
    expect(`${capture}\n${cdp}`).not.toMatch(/playwright|puppeteer/i);
  });

  it("Screenshot generation cannot touch real app data", async () => {
    await expect(
      launchElectron({
        repoRoot,
        scratchRoot: path.join(repoRoot, "not-a-temporary-profile"),
        entry: "unused",
      })
    ).rejects.toThrow("Refusing non-isolated user-data root");
  });

  it("Repeating the same capture is reproducible", async () => {
    const helper = await readFile(path.join(repoRoot, "scripts/user-documentation/electron-cdp.mjs"), "utf8");
    expect(helper).toMatch(/warmup[\s\S]*canonical/);
    expect((await check()).screenshots).toBe(38);
  });
});

describe("Screenshot Matrix Is Bounded, Bilingual and Fresh", () => {
  it("The committed matrix covers every required view without growing a tour", async () => {
    expect((await check()).screenshots).toBe(38);
    const screenshotManifest = JSON.parse(await text("screenshot-manifest.json"));
    expect(
      screenshotManifest.assets.every(
        (asset: { stateMetadata?: { citationStates?: { unverified?: number } } }) =>
          asset.stateMetadata?.citationStates?.unverified === 0
      )
    ).toBe(true);
    const citationAssets = screenshotManifest.assets.filter(
      (asset: { viewId: string }) => asset.viewId === "citation-source"
    );
    expect(citationAssets).toHaveLength(2);
    expect(
      citationAssets.every(
        (asset: { stateMetadata: { citationStates: { verified: number } } }) =>
          asset.stateMetadata.citationStates.verified >= 1
      )
    ).toBe(true);
    const fixtureSchema = await readFile(
      path.join(repoRoot, "packages/app/tests/fixtures/user-documentation/fixture-schema.json"),
      "utf8"
    );
    expect(fixtureSchema).not.toMatch(/\bunverified\b/i);
    expect(fixtureSchema).not.toContain("(corpus:");
    await mutate(
      "screenshot-manifest.json",
      (value) => {
        const data = JSON.parse(value);
        data.assets = data.assets.slice(1);
        return `${JSON.stringify(data, null, 2)}\n`;
      },
      "screenshot-matrix"
    );
  });

  it("The review-feedback delta retires its views and adds the requested ones", async () => {
    const screenshotManifest = JSON.parse(await text("screenshot-manifest.json"));
    const ids = screenshotManifest.views.map((view: { id: string }) => view.id);
    expect(ids).not.toContain("picker");
    expect(ids).not.toContain("settings-about-update");
    expect(ids).toEqual(expect.arrayContaining(["model-settings", "profile", "attachment-and-wiki"]));
    const narrow = screenshotManifest.views
      .filter((view: { viewports: string[] }) => view.viewports.includes("narrow"))
      .map((view: { id: string }) => view.id)
      .sort();
    expect(narrow).toEqual(["first-use-orientation", "workspace-orientation"]);
    const profile = screenshotManifest.views.find((view: { id: string }) => view.id === "profile");
    expect(profile.states).toEqual(["entry", "pane"]);
  });

  it("Highlighted views carry exactly their declared boxes", async () => {
    const screenshotManifest = JSON.parse(await text("screenshot-manifest.json"));
    const highlighted = screenshotManifest.assets.filter(
      (asset: { stateMetadata: { highlights?: unknown[] } }) => asset.stateMetadata.highlights
    );
    expect(highlighted.map((asset: { path: string }) => asset.path).sort()).toEqual(
      [
        "assets/screenshots/de/attachment-and-wiki--overview--de--desktop.png",
        "assets/screenshots/de/profile--entry--de--desktop.png",
        "assets/screenshots/de/profile--pane--de--desktop.png",
        "assets/screenshots/en/attachment-and-wiki--overview--en--desktop.png",
        "assets/screenshots/en/profile--entry--en--desktop.png",
        "assets/screenshots/en/profile--pane--en--desktop.png",
      ].sort()
    );
    // A declared highlight that was not drawn fails.
    await mutate(
      "screenshot-manifest.json",
      (value) => {
        const data = JSON.parse(value);
        const asset = data.assets.find((item: { viewId: string }) => item.viewId === "profile");
        delete asset.stateMetadata.highlights;
        return `${JSON.stringify(data, null, 2)}\n`;
      },
      "screenshot-highlight"
    );
    // A box outside the viewport fails.
    await mutate(
      "screenshot-manifest.json",
      (value) => {
        const data = JSON.parse(value);
        const asset = data.assets.find((item: { viewId: string }) => item.viewId === "attachment-and-wiki");
        asset.stateMetadata.highlights[0].width = 5000;
        return `${JSON.stringify(data, null, 2)}\n`;
      },
      "screenshot-highlight"
    );
    // An undeclared highlight on a plain view fails.
    await mutate(
      "screenshot-manifest.json",
      (value) => {
        const data = JSON.parse(value);
        const asset = data.assets.find((item: { viewId: string }) => item.viewId === "model-settings");
        asset.stateMetadata.highlights = [{ x: 1, y: 1, width: 10, height: 10 }];
        return `${JSON.stringify(data, null, 2)}\n`;
      },
      "screenshot-highlight"
    );
  });

  it("A changed capture owner marks its image stale", async () => {
    await sourceOverride(
      "packages/app/src/renderer/components/WikiBrowser.tsx",
      (value) => `${value}\n// synthetic screenshot-owner mutation\n`,
      "screenshot-source"
    );
  });

  it("Native dialogs remain manual evidence", async () => {
    const manual = await text("assets/manual/README.md");
    expect(manual).toMatch(/manual-only evidence[\s\S]*MUST NOT be generated/);
    await mutate(
      "screenshot-manifest.json",
      (value) => value.replace("assets/screenshots/de/", "assets/manual/"),
      "screenshot-matrix"
    );
  });
});

describe("Documentation Review and Release Integration Have Named Owners", () => {
  it("A release with stale documentation is refused", async () => {
    await expectFailure("review-pending", () => check({ release: true }));
  });

  it("Human review ownership is visible and complete", async () => {
    const manifest = JSON.parse(await text("manifest.json"));
    expect(manifest.reviews).toHaveLength(6);
    expect(
      manifest.reviews.every((review: { owner: string; status: string }) => review.owner && review.status === "pending")
    ).toBe(true);
    await mutate(
      "manifest.json",
      (value) => {
        const data = JSON.parse(value);
        data.reviews[1].owner = "";
        return `${JSON.stringify(data, null, 2)}\n`;
      },
      "review-owners"
    );
  });

  it("Documentation work causes no live-model evaluation", async () => {
    const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    for (const [name, command] of Object.entries(rootPackage.scripts as Record<string, string>)) {
      if (name.startsWith("docs:")) expect(command).not.toMatch(/\beval\b|evaluation\/cbe-skill/);
    }
  });
});
