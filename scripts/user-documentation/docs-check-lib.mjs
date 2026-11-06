import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assertDocumentationFontCoverage } from "./font-coverage.mjs";
import {
  assertNoUnverifiedCitationResidue,
  BOUNDED_VIEW_COUNT,
  CAPTURE_DEFINITION_FILES,
  captureCases,
  highlightsFor,
  VIEW_MATRIX,
  VIEWPORTS,
} from "./screenshot-matrix.mjs";

const LOCALES = ["en", "de"];
const PAGES = [
  "README.md",
  "installation-and-local-it.md",
  "quick-start.md",
  "user-guide.md",
  "privacy-data-storage.md",
  "accessibility-keyboard.md",
  "troubleshooting-and-reference.md",
  "glossary-faq.md",
];
const REVIEW_ROLES = [
  "english-product-content",
  "german-language",
  "app-ux-screenshots",
  "installation-it-privacy-security",
  "accessibility-keyboard",
  "release-integration",
];

export class DocsCheckError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = "DocsCheckError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new DocsCheckError(code, message);
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalize = (value) =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n*$/, "\n");
const normalizedHash = (value) => sha256(normalize(value));
const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function json(text, relative) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("json", `${relative} is not valid JSON: ${error.message}`);
  }
}

function frontmatter(text, relative) {
  if (!text.startsWith("---\n")) fail("frontmatter", `${relative} has no frontmatter`);
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) fail("frontmatter", `${relative} has unterminated frontmatter`);
  const values = {};
  for (const line of text.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function markers(text, name) {
  return [...text.matchAll(new RegExp(`<!-- ${name}:([a-z0-9-]+) -->`, "g"))].map((match) => match[1]);
}

function screenshotMarkers(text) {
  return [...text.matchAll(/<!-- screenshot:([a-z0-9-]+):([a-z0-9-]+):(desktop|narrow) -->/g)].map(
    (match) => `${match[1]}:${match[2]}:${match[3]}`
  );
}

function anchors(text) {
  return [...text.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)].map((match) => match[1]);
}

function links(text) {
  return [...text.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}

function normalizeLink(target) {
  const [file, anchor = ""] = target.split("#");
  if (/^[a-z]+:/i.test(file)) return `external:${file}`;
  const clean = file.replaceAll("\\", "/");
  if (/^\.\.\/(en|de)\//.test(clean) || clean === "README.md") {
    const basename = path.posix.basename(clean);
    if (basename === "README.md") return `language-index#${anchor}`;
  }
  if (clean === "../README.md") return `language-entry#${anchor}`;
  return `${path.posix.basename(clean)}#${anchor}`;
}

function extractRequirement(text, heading, relative) {
  const re = new RegExp(`^### Requirement: ${regexEscape(heading)}\\s*$`, "m");
  const match = re.exec(text);
  if (!match) fail("source-owner", `${relative} no longer has Requirement: ${heading}`);
  const next = /^### Requirement: /gm;
  next.lastIndex = match.index + match[0].length;
  const following = next.exec(text);
  return text.slice(match.index, following?.index ?? text.length);
}

function extractExport(text, name, relative) {
  const re = new RegExp(`^export const ${regexEscape(name)}\\s*=`, "m");
  const match = re.exec(text);
  if (!match) fail("source-owner", `${relative} no longer exports ${name}`);
  const end = text.indexOf(";", match.index);
  if (end < 0) fail("source-owner", `${relative} has an unterminated ${name} export`);
  return text.slice(match.index, end + 1);
}

function extractTest(text, name, relative) {
  const quoted = JSON.stringify(name);
  const re = new RegExp(`^([ \\t]*)(?:it|test)\\(${regexEscape(quoted)}`, "m");
  const match = re.exec(text);
  if (!match) fail("implementation-evidence", `${relative} no longer has passing test “${name}”`);
  const next = new RegExp(`^${regexEscape(match[1])}(?:it|test)\\(`, "gm");
  next.lastIndex = match.index + match[0].length;
  const following = next.exec(text);
  return text.slice(match.index, following?.index ?? text.length);
}

export function documentationTestEvidenceHash(text, name, relative) {
  return normalizedHash(extractTest(text, name, relative));
}

async function walkFiles(root) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(absolute);
    }
  }
  await walk(root);
  return files;
}

async function oddFileHash(file) {
  return sha256((await readFile(file)).toString("binary"));
}

async function aggregateHash(root, files) {
  const parts = [];
  for (const relative of [...files].sort()) parts.push(`${relative}\0${await oddFileHash(path.join(root, relative))}`);
  return sha256(parts.join("\n"));
}

function pngDimensions(buffer, relative) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) fail("screenshot-png", `${relative} is not PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function assertContains(text, patterns, code, relative) {
  for (const pattern of patterns) {
    if (!pattern.test(text)) fail(code, `${relative} is missing ${pattern}`);
  }
}

function assertNoPlaceholders(text, relative) {
  if (/\b(?:TODO|TBD|TRANSLATE(?:D| ME)?)\b/i.test(text)) fail("placeholder", `${relative} contains a placeholder`);
}

function assertCurrentClaims(localeTexts) {
  const all = [...localeTexts.values()].join("\n");
  const prohibited = [
    [/\b(?:installer|build) is signed\b/i, "current signed installer"],
    [/\b(?:installer|build) is notarized\b/i, "current notarized installer"],
    [/\bSkill updates automatically through a signed channel\b/i, "current signed Skill OTA"],
    [/\bLinux (?:is|has been) (?:tested|supported)\b/i, "unsupported Linux validation"],
    [/\blive-model evaluation (?:confirms|proved|shows)\b/i, "invented live evaluation"],
    [/\bcopying one Course reproduces (?:the )?entire installation\b/i, "false course-only backup"],
    [/\beverything always stays local\b/i, "false provider locality"],
    [/\bdesign export is (?:the )?support log\b/i, "conflated design export and log"],
    [/\bEscape stops (?:an|the) answer\b/i, "unsupported Escape-to-Stop shortcut"],
  ];
  for (const [pattern, label] of prohibited) if (pattern.test(all)) fail("prohibited-claim", `${label}: ${pattern}`);

  const enInstall = localeTexts.get("en/installation-and-local-it.md");
  const deInstall = localeTexts.get("de/installation-and-local-it.md");
  assertContains(
    enInstall,
    [
      /current public release/i,
      /macOS release is signed with an Apple Developer ID and notarized by Apple/i,
      /Windows installer remains unsigned/i,
      /https:\/\/github\.com\/virtuelleakademie\/cbe-toolbox/,
      /buildable generated source mirror/i,
      /Official GitHub releases, release automation, OTA publication and Cloudflare operations have not moved/i,
      /npm run dist:mac/i,
      /OpenAI-compatible HTTPS base URL/i,
      /Full code verification on Linux, a Linux VM or WSL/,
      /not under `\/mnt\/c`/,
      /The full test suite is not a supported gate on native Windows/,
      /Compile and package on native Windows/,
      /Install and smoke-check on a clean Windows VM or device/,
      /Compare the records/,
      /POSIX file modes and permissions, symbolic links/,
    ],
    "release-claims",
    "en installation"
  );
  assertContains(
    deInstall,
    [
      /aktuelle öffentliche Release/i,
      /macOS-Release ist mit einer Apple Developer ID signiert und von Apple notarisiert/i,
      /Windows-Installer bleibt unsigniert/i,
      /https:\/\/github\.com\/virtuelleakademie\/cbe-toolbox/,
      /baubare, generierte Quellcode-Mirror/i,
      /Offizielle GitHub-Releases, Release-Automation, OTA-Veröffentlichung und Cloudflare-Betrieb sind nicht/i,
      /npm run dist:mac/i,
      /OpenAI-kompatible HTTPS-Basis-URL/i,
      /Vollständige Codeprüfung unter Linux, in einer Linux-VM oder unter WSL/,
      /nicht unter `\/mnt\/c`/,
      /Die vollständige Testsuite ist unter nativem Windows kein unterstütztes Prüftor/,
      /Unter nativem Windows kompilieren und paketieren/,
      /Auf einer sauberen Windows-VM oder einem sauberen Gerät installieren und prüfen/,
      /Protokolle vergleichen/,
      /POSIX-Dateimodi und -Berechtigungen, symbolische Links/,
    ],
    "release-claims",
    "de installation"
  );
  for (const [label, install] of [
    ["en installation", enInstall],
    ["de installation", deInstall],
  ]) {
    const windowsBlocks = [...install.matchAll(/```powershell\n([\s\S]*?)```/g)].map((match) => match[1]);
    if (windowsBlocks.length === 0) fail("release-claims", `${label} has no native Windows build commands`);
    for (const block of windowsBlocks) {
      if (!/npm run dist:win --workspace packages\/app/.test(block) || !/npm run checksums/.test(block))
        fail("release-claims", `${label} native Windows block does not package and checksum`);
      if (/\bnpm (?:run )?test\b/.test(block))
        fail("release-claims", `${label} runs the POSIX test suite as a native Windows gate`);
    }
  }
  assertContains(
    localeTexts.get("en/privacy-data-storage.md"),
    [/close the app/i, /external service/i],
    "privacy-content",
    "en privacy"
  );
  assertContains(
    localeTexts.get("de/privacy-data-storage.md"),
    [/schliessen Sie die App/i, /externer Dienst/i],
    "privacy-content",
    "de privacy"
  );
  assertContains(
    localeTexts.get("en/accessibility-keyboard.md"),
    [/Enter.*sends/is, /Shift\+Enter/i, /Escape does not stop an answer/i, /200%/],
    "keyboard-content",
    "en accessibility"
  );
  assertContains(
    localeTexts.get("de/accessibility-keyboard.md"),
    [/Enter.*sendet/is, /Shift\+Enter/i, /Escape stoppt keine Antwort/i, /200%/],
    "keyboard-content",
    "de accessibility"
  );
}

export async function runDocumentationChecks({
  repoRoot,
  docsRoot = path.join(repoRoot, "docs", "user"),
  sourceOverrides = new Map(),
  release = false,
  ownership = true,
} = {}) {
  if (!repoRoot) fail("config", "repoRoot is required");
  try {
    assertDocumentationFontCoverage(
      path.join(
        repoRoot,
        "packages",
        "app",
        "tests",
        "fixtures",
        "user-documentation",
        "fonts",
        "DocumentationSans.woff2"
      )
    );
  } catch (error) {
    fail("font-coverage", error instanceof Error ? error.message : String(error));
  }
  const readSource = async (relative) =>
    sourceOverrides.has(relative)
      ? sourceOverrides.get(relative)
      : readFile(path.join(repoRoot, relative), "utf8").catch(() => fail("source-owner", `${relative} is missing`));
  const oddSourceHash = async (relative) =>
    sourceOverrides.has(relative)
      ? sha256(Buffer.from(sourceOverrides.get(relative), "utf8").toString("binary"))
      : oddFileHash(path.join(repoRoot, relative));
  const readDocs = async (relative) =>
    readFile(path.join(docsRoot, relative), "utf8").catch(() => fail("tree-shape", `${relative} is missing`));

  const manifest = json(await readDocs("manifest.json"), "manifest.json");
  const productEvidence = json(await readDocs("product-evidence.json"), "product-evidence.json");
  const behavior = ownership ? json(await readDocs("behavior-sources.json"), "behavior-sources.json") : null;
  const screenshotManifest = json(await readDocs("screenshot-manifest.json"), "screenshot-manifest.json");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.sourceManifestVersion !== 1 ||
    manifest.screenshotManifestVersion !== 1
  ) {
    fail("manifest-version", "documentation manifest schema versions must all be 1");
  }
  if (JSON.stringify(manifest.locales) !== JSON.stringify(LOCALES) || manifest.canonicalLocale !== "en") {
    fail("locales", "first implementation must list exactly en,de with English canonical");
  }
  if (JSON.stringify(manifest.pages.map((page) => page.path)) !== JSON.stringify(PAGES)) {
    fail("tree-shape", "manifest page order/shape differs from the eight declared Markdown paths");
  }

  const rootEntries = await readdir(docsRoot, { withFileTypes: true });
  for (const forbidden of ["fr", "it"]) {
    if (rootEntries.some((entry) => entry.name === forbidden))
      fail("locales", `${forbidden} documentation tree is out of scope`);
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && /\.(?:html?|pdf|js|tsx?)$/i.test(entry.name)) {
      fail("distribution", `user documentation contains distribution artifact ${entry.name}`);
    }
  }

  const localeTexts = new Map();
  for (const locale of LOCALES) {
    const localeRoot = path.join(docsRoot, locale);
    const localeFiles = (await readdir(localeRoot)).filter((name) => name.endsWith(".md")).sort();
    if (JSON.stringify(localeFiles) !== JSON.stringify([...PAGES].sort())) {
      fail("tree-shape", `${locale} does not contain exactly the eight Markdown pages`);
    }
    for (const page of manifest.pages) {
      const relative = `${locale}/${page.path}`;
      const text = await readDocs(relative);
      localeTexts.set(relative, text);
      assertNoPlaceholders(text, relative);
      const fm = frontmatter(text, relative);
      if (fm.pageId !== page.id || fm.locale !== locale || fm.appVersion !== manifest.reviewedAppVersion) {
        fail("frontmatter", `${relative} frontmatter does not match manifest`);
      }
    }
  }

  const rootIndex = await readDocs("README.md");
  if (
    !rootIndex.includes("en/README.md") ||
    !rootIndex.includes("de/README.md") ||
    /(?:fr|it)\/README\.md/.test(rootIndex)
  ) {
    fail("locales", "root language entry must offer only complete English and German sets");
  }

  const seenTopics = new Map();
  const linkGraph = new Map();
  for (const locale of LOCALES) {
    for (const page of manifest.pages) {
      const relative = `${locale}/${page.path}`;
      const absolute = path.join(docsRoot, relative);
      const text = localeTexts.get(relative);
      for (const topic of markers(text, "topic")) {
        const key = `${locale}:${topic}`;
        if (seenTopics.has(key)) fail("topic-owner", `${topic} occurs twice in ${locale}`);
        seenTopics.set(key, page.id);
      }
      const outgoing = [];
      for (const target of links(text)) {
        const [filePart, anchor] = target.split("#");
        if (/^[a-z]+:/i.test(filePart)) {
          outgoing.push(normalizeLink(target));
          continue;
        }
        let resolved = path.resolve(path.dirname(absolute), filePart || page.path);
        if (!existsSync(resolved) && !resolved.startsWith(path.resolve(docsRoot))) {
          resolved = path.resolve(path.dirname(path.join(repoRoot, "docs", "user", relative)), filePart || page.path);
        }
        const insideDocs = resolved.startsWith(path.resolve(docsRoot));
        const insideRepo = resolved.startsWith(path.resolve(repoRoot));
        if ((!insideDocs && !insideRepo) || !existsSync(resolved)) {
          fail("link", `${relative} has broken relative link ${target}`);
        }
        if (anchor) {
          const targetText = await readFile(resolved, "utf8");
          if (!targetText.includes(`<a id="${anchor}"></a>`)) fail("anchor", `${relative} links missing #${anchor}`);
        }
        outgoing.push(normalizeLink(target));
      }
      linkGraph.set(relative, outgoing);
    }
  }
  for (const [topic, pageId] of Object.entries(manifest.topics)) {
    for (const locale of LOCALES) {
      if (seenTopics.get(`${locale}:${topic}`) !== pageId)
        fail("topic-owner", `${topic} is not owned once by ${pageId} in ${locale}`);
    }
  }
  if (seenTopics.size !== Object.keys(manifest.topics).length * LOCALES.length) {
    fail("topic-owner", "unmanifested topic marker found");
  }

  for (const page of manifest.pages) {
    const en = localeTexts.get(`en/${page.path}`);
    const de = localeTexts.get(`de/${page.path}`);
    for (const [name, left, right] of [
      ["topic", markers(en, "topic"), markers(de, "topic")],
      ["anchor", anchors(en), anchors(de)],
      ["screenshot", screenshotMarkers(en), screenshotMarkers(de)],
      ["link", linkGraph.get(`en/${page.path}`), linkGraph.get(`de/${page.path}`)],
    ]) {
      if (JSON.stringify(left) !== JSON.stringify(right))
        fail("parity", `${page.path} ${name} graph differs between en/de`);
    }
  }

  const quickEn = localeTexts.get("en/quick-start.md");
  const quickDe = localeTexts.get("de/quick-start.md");
  if (quickEn.split(/\s+/).length > 1000 || quickDe.split(/\s+/).length > 1100)
    fail("quick-start", "Quick Start absorbed reference detail");
  if (markers(quickEn, "topic").join() !== "first-course-and-request")
    fail("quick-start", "Quick Start owns more than its bounded route");
  if (/firewall|certificate|rollout/i.test(localeTexts.get("en/user-guide.md")))
    fail("information-architecture", "User Guide contains local-IT rollout administration");

  assertCurrentClaims(localeTexts);
  for (const [relative, text] of localeTexts) {
    if (/\b(?:Artifacts|Artefacts|Artefakte)\b/.test(text))
      fail("terminology", `${relative} renders a retired surface term`);
    for (const forbidden of manifest.terminology.internalTermsForbidden) {
      if (new RegExp(`\\b${regexEscape(forbidden)}\\b`, "i").test(text))
        fail("terminology", `${relative} renders internal term ${forbidden}`);
    }
  }
  const glossaryEn = localeTexts.get("en/glossary-faq.md");
  for (const term of [
    "Course",
    "New Session",
    "CBE Process Canvas",
    "CBE Maturity",
    "course Wiki",
    "attachment",
    "citation",
    "support preference",
    "reasoning",
  ]) {
    if (!glossaryEn.includes(`**${term}:**`) && !glossaryEn.includes(`**${term}**`))
      fail("glossary", `English glossary lacks ${term}`);
  }

  const registryFiles = (await walkFiles(path.join(repoRoot, "packages", "app", "src", "renderer"))).filter((file) =>
    file.endsWith(".ui-registry.ts")
  );
  const registryIds = new Set();
  for (const file of registryFiles) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)) registryIds.add(match[1]);
  }
  for (const [relative, text] of localeTexts) {
    for (const id of markers(text, "ui"))
      if (!registryIds.has(id)) fail("ui-registry", `${relative} names missing UI registry id ${id}`);
  }

  const formatsSource = await readSource("packages/pi-bridge/src/ingest-formats.ts");
  const formatsUnit = extractExport(formatsSource, "SUPPORTED_EXTENSIONS", "packages/pi-bridge/src/ingest-formats.ts");
  const extensions = [...formatsUnit.matchAll(/"(\.[a-z0-9]+)"/g)].map((match) => match[1].slice(1).toUpperCase());
  for (const [relative, text] of localeTexts) {
    const count = [...text.matchAll(/<!-- formats:SUPPORTED_EXTENSIONS -->/g)].length;
    if (count === 0) continue;
    const expected = extensions.join(", ");
    for (const match of text.matchAll(/<!-- formats:SUPPORTED_EXTENSIONS -->([\s\S]{0,600})/g)) {
      const bold =
        [...match[1].matchAll(/\*\*([^*]+)\*\*/g)]
          .map((candidate) => candidate[1])
          .find((candidate) => candidate.includes("PDF")) ?? "";
      const rendered = bold
        .replace(/\s+(?:and|und)\s+/i, ", ")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (JSON.stringify(rendered) !== JSON.stringify(extensions)) {
        fail("formats", `${relative} does not render exact ${expected}`);
      }
    }
  }
  if (![...localeTexts.values()].some((text) => text.includes("<!-- formats:SUPPORTED_EXTENSIONS -->")))
    fail("formats", "no governed format block found");

  if (productEvidence.schemaVersion !== 1) fail("source-manifest", "product evidence schema must be 1");
  for (const topic of Object.keys(manifest.topics))
    if (!productEvidence.entries[topic]) fail("source-manifest", `topic ${topic} has no product evidence`);
  for (const [id, evidence] of Object.entries(productEvidence.entries)) {
    const evidenceSource = await readSource(evidence.path);
    const evidenceUnit = extractTest(evidenceSource, evidence.name, evidence.path);
    if (normalizedHash(evidenceUnit) !== evidence.sha256)
      fail("evidence-stale", `${id} evidence changed: ${evidence.path}#${evidence.name}`);
  }

  if (ownership) {
    if (behavior.schemaVersion !== 1) fail("source-manifest", "behavior source schema must be 1");
    for (const topic of Object.keys(manifest.topics))
      if (!behavior.entries[topic]) fail("source-manifest", `topic ${topic} has no owner/evidence`);
    for (const [id, entry] of Object.entries(behavior.entries)) {
      if (JSON.stringify(entry.evidence) !== JSON.stringify(productEvidence.entries[id]))
        fail("source-manifest", `${id} canonical evidence differs from product-evidence.json`);
      const owner = entry.owner;
      if (/openspec\/(?:changes|archive)\//.test(owner.path))
        fail("source-owner", `${id} points to non-canonical ${owner.path}`);
      const source = await readSource(owner.path);
      let unit = source;
      if (owner.type === "requirement") unit = extractRequirement(source, owner.heading, owner.path);
      else if (owner.type === "exported-constant") unit = extractExport(source, owner.name, owner.path);
      if (normalizedHash(unit) !== owner.sha256)
        fail("source-stale", `${id} owner changed: ${owner.path}${owner.heading ? `#${owner.heading}` : ""}`);
    }
  }

  const appPackage = json(await readSource("packages/app/package.json"), "packages/app/package.json");
  const skill = await readSource("skills/cbe/SKILL.md");
  const skillVersion = /^version:\s*([^\s]+)$/m.exec(skill)?.[1];
  if (manifest.reviewedAppVersion !== appPackage.version)
    fail("app-version", `docs ${manifest.reviewedAppVersion} != app ${appPackage.version}`);
  if (manifest.reviewedSkillVersion !== skillVersion)
    fail("skill-version", `docs ${manifest.reviewedSkillVersion} != Skill ${skillVersion}`);

  if (screenshotManifest.schemaVersion !== 1 || screenshotManifest.fixtureSchemaVersion !== 1)
    fail("screenshot-manifest", "screenshot schema versions must be 1");
  if (screenshotManifest.views.length !== BOUNDED_VIEW_COUNT)
    fail("screenshot-matrix", "matrix must contain exactly fifteen views");
  for (const declared of VIEW_MATRIX) {
    const stored = screenshotManifest.views.find((view) => view.id === declared.id);
    if (
      !stored ||
      JSON.stringify(stored.states) !== JSON.stringify(declared.states) ||
      JSON.stringify(stored.viewports) !== JSON.stringify(declared.viewports) ||
      JSON.stringify(stored.owners) !== JSON.stringify(declared.owners)
    ) {
      fail("screenshot-matrix", `${declared.id} declaration drifted`);
    }
  }
  const expectedCases = captureCases();
  const expectedAssetPaths = expectedCases.map((item) => `assets/screenshots/${item.locale}/${item.filename}`).sort();
  const storedPaths = screenshotManifest.assets.map((asset) => asset.path).sort();
  if (JSON.stringify(expectedAssetPaths) !== JSON.stringify(storedPaths))
    fail("screenshot-matrix", "missing, extra, locale, state or narrow screenshot asset");
  const diskPngs = (await walkFiles(path.join(docsRoot, "assets", "screenshots")))
    .filter((file) => file.endsWith(".png"))
    .map((file) => path.relative(docsRoot, file).replaceAll(path.sep, "/"))
    .sort();
  if (JSON.stringify(diskPngs) !== JSON.stringify(expectedAssetPaths))
    fail("screenshot-matrix", "unmanifested or missing PNG on disk");

  for (const asset of screenshotManifest.assets) {
    const absolute = path.join(docsRoot, asset.path);
    const bytes = await readFile(absolute);
    if (sha256(bytes) !== asset.pngSha256) fail("screenshot-hash", `${asset.path} bytes are stale`);
    const viewport = VIEWPORTS[asset.viewport];
    const scrollState = asset.stateMetadata?.scroll;
    const citationStates = asset.stateMetadata?.citationStates;
    if (!scrollState || !Number.isFinite(scrollState.chatScrollTop)) {
      fail("screenshot-state", `${asset.path} has no deterministic scroll metadata`);
    }
    if (["language-selector", "model-settings"].includes(asset.viewId) && scrollState.chatScrollTop !== 0) {
      fail("screenshot-state", `${asset.path} background scroll is not normalized to zero`);
    }
    if (
      !citationStates ||
      !Number.isInteger(citationStates.verified) ||
      citationStates.unverified !== 0 ||
      (asset.viewId === "citation-source" && citationStates.verified < 1)
    ) {
      fail("screenshot-content", `${asset.path} does not prove clean citation state`);
    }
    const declaredView = VIEW_MATRIX.find((view) => view.id === asset.viewId);
    const declaredHighlights = declaredView ? highlightsFor(declaredView, asset.state) : [];
    const recordedHighlights = asset.stateMetadata?.highlights;
    if (declaredHighlights.length === 0) {
      if (recordedHighlights !== undefined) fail("screenshot-highlight", `${asset.path} records undeclared highlights`);
    } else if (
      !Array.isArray(recordedHighlights) ||
      recordedHighlights.length !== declaredHighlights.length ||
      recordedHighlights.some(
        (rect) =>
          ![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isInteger) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.x < 0 ||
          rect.y < 0 ||
          rect.x + rect.width > viewport.width ||
          rect.y + rect.height > viewport.height
      )
    ) {
      fail("screenshot-highlight", `${asset.path} does not record its declared highlight boxes`);
    }
    const dimensions = pngDimensions(bytes, asset.path);
    if (
      dimensions.width !== viewport.width * 2 ||
      dimensions.height !== viewport.height * 2 ||
      asset.width !== dimensions.width ||
      asset.height !== dimensions.height
    ) {
      fail("screenshot-dimensions", `${asset.path} dimensions are wrong`);
    }
    for (const [relative, digest] of Object.entries(asset.sourceFingerprints)) {
      if ((await oddSourceHash(relative)) !== digest)
        fail("screenshot-source", `${asset.viewId} stale owner ${relative}`);
    }
  }
  const fixtureRoot = path.join(repoRoot, "packages", "app", "tests", "fixtures", "user-documentation");
  const fixtureFiles = (await walkFiles(fixtureRoot)).map((file) =>
    path.relative(fixtureRoot, file).replaceAll(path.sep, "/")
  );
  for (const relative of fixtureFiles.filter((file) => [".csv", ".json", ".md"].includes(path.extname(file)))) {
    try {
      assertNoUnverifiedCitationResidue(
        { visibleText: await readFile(path.join(fixtureRoot, relative), "utf8") },
        `fixture ${relative}`
      );
    } catch (error) {
      fail("screenshot-content", error instanceof Error ? error.message : String(error));
    }
  }
  const fixtureDigest = await aggregateHash(fixtureRoot, fixtureFiles);
  if (fixtureDigest !== screenshotManifest.capture.fixtureFingerprint)
    fail("screenshot-fixture", "fixture tree changed without recapture");
  if (
    (await aggregateHash(repoRoot, CAPTURE_DEFINITION_FILES)) !==
    screenshotManifest.capture.captureDefinitionFingerprint
  )
    fail("screenshot-source", "capture definition changed without recapture");
  if (
    screenshotManifest.capture.appVersion !== appPackage.version ||
    screenshotManifest.capture.electronVersion !== appPackage.devDependencies.electron
  )
    fail("screenshot-version", "capture app/Electron version is stale");
  if (
    screenshotManifest.capture.realApplication !== true ||
    screenshotManifest.capture.liveModel !== false ||
    screenshotManifest.capture.lane !== "linux-xvfb-real-electron-cdp"
  )
    fail("screenshot-lane", "manifest does not describe the real non-live-model Electron lane");

  const referenced = new Set();
  const localeScreenshotCopy = new Map();
  for (const locale of LOCALES) {
    for (const page of manifest.pages) {
      const relative = `${locale}/${page.path}`;
      const text = localeTexts.get(relative);
      const regex =
        /<!-- screenshot:([a-z0-9-]+):([a-z0-9-]+):(desktop|narrow) -->\s*!\[([^\]]+)\]\(([^)]+)\)\s*_([^_]+)_/g;
      for (const match of text.matchAll(regex)) {
        const logical = `${match[1]}:${match[2]}:${match[3]}`;
        const key = `${locale}:${logical}`;
        if (referenced.has(key)) fail("screenshot-reference", `${key} referenced twice`);
        referenced.add(key);
        if (!match[4].trim() || !match[6].trim()) fail("screenshot-copy", `${key} lacks alt/caption`);
        const target = path.resolve(path.dirname(path.join(docsRoot, relative)), match[5]);
        if (!existsSync(target)) fail("screenshot-reference", `${key} image link is broken`);
        const expected = screenshotManifest.assets.find(
          (asset) =>
            asset.locale === locale &&
            asset.viewId === match[1] &&
            asset.state === match[2] &&
            asset.viewport === match[3]
        );
        if (!expected || path.resolve(docsRoot, expected.path) !== target)
          fail("screenshot-reference", `${key} does not resolve to its manifest asset`);
        localeScreenshotCopy.set(key, { alt: match[4].trim(), caption: match[6].trim() });
      }
    }
  }
  for (const item of expectedCases) {
    const logical = `${item.view.id}:${item.state}:${item.viewport}`;
    if (!referenced.has(`${item.locale}:${logical}`))
      fail("screenshot-reference", `${item.locale}:${logical} is not referenced`);
  }
  for (const item of captureCases(["en"])) {
    const logical = `${item.view.id}:${item.state}:${item.viewport}`;
    const en = localeScreenshotCopy.get(`en:${logical}`);
    const de = localeScreenshotCopy.get(`de:${logical}`);
    if (en.alt === de.alt || en.caption === de.caption)
      fail("screenshot-copy", `${logical} falls back to identical locale copy`);
  }

  const manualReadme = await readDocs("assets/manual/README.md");
  assertContains(
    manualReadme,
    [/Gatekeeper/i, /SmartScreen/i, /manual-only evidence/i, /MUST NOT be generated/i],
    "manual-native",
    "manual README"
  );
  const manualPngs = (await walkFiles(path.join(docsRoot, "assets", "manual"))).filter((file) => file.endsWith(".png"));
  for (const file of manualPngs)
    if (!manualReadme.includes(path.basename(file)))
      fail("manual-native", `${path.basename(file)} has no provenance row`);
  if (screenshotManifest.assets.some((asset) => asset.path.includes("/manual/")))
    fail("manual-native", "manual asset claimed as deterministic");

  const roles = manifest.reviews.map((review) => review.role);
  if (
    JSON.stringify(roles) !== JSON.stringify(REVIEW_ROLES) ||
    manifest.reviews.some((review) => !review.owner || !["pending", "complete"].includes(review.status))
  ) {
    fail("review-owners", "review roles/owners are incomplete");
  }
  if (release && manifest.reviews.some((review) => review.status !== "complete"))
    fail("review-pending", "human reviews remain pending");
  if (release && manifest.status !== "release-ready")
    fail("release-status", "documentation is still a first-review draft");

  if (ownership) {
    const navigation = {
      "README.md": "(docs/user/README.md)",
      "CHANGELOG.md": "(docs/user/README.md)",
      "docs/release-notes-template.md": "(user/README.md)",
    };
    for (const [relative, target] of Object.entries(navigation)) {
      if (!(await readSource(relative)).includes(target))
        fail("navigation", `${relative} does not link relatively to docs/user/README.md`);
    }
  }

  const rootPackage = json(await readSource("package.json"), "package.json");
  for (const [name, command] of Object.entries(rootPackage.scripts ?? {})) {
    if (name.startsWith("docs:") && /\beval\b|evaluation\/cbe-skill/.test(command))
      fail("live-eval", `${name} invokes live evaluation`);
  }

  return {
    pages: manifest.pages.length * LOCALES.length + 1,
    topics: Object.keys(manifest.topics).length,
    screenshots: screenshotManifest.assets.length,
    reviewsPending: manifest.reviews.filter((review) => review.status === "pending").length,
    releaseReady:
      manifest.status === "release-ready" && manifest.reviews.every((review) => review.status === "complete"),
  };
}
