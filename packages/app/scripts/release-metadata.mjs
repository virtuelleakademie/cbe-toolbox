import { readFile } from "node:fs/promises";
import path from "node:path";

const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})\s*$/;
const ANY_H2 = /^## /;

// GitHub refuses a release body above 125,000 characters; keep a margin.
export const MAX_RELEASE_BODY = 120_000;

/**
 * Split CHANGELOG.md into its level-2 sections, in file order.
 * @returns {{ heading: string, version: string | null, date: string | null, unreleased: boolean, body: string }[]}
 */
export function changelogSections(changelog) {
  const lines = changelog.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (ANY_H2.test(line)) {
      const match = VERSION_HEADING.exec(line);
      current = {
        heading: line.trim(),
        version: match ? match[1] : null,
        date: match ? match[2] : null,
        unreleased: line.trim() === "## [Unreleased]",
        lines: [],
      };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map(({ lines: body, ...rest }) => ({ ...rest, body: body.join("\n").trim() }));
}

function isRealDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

/** Every reason the given product metadata cannot ship, or an empty list. */
export function releaseMetadataProblems({ appVersion, lockVersion, changelog, tag, portalVersions }) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(appVersion ?? "")) {
    problems.push(`packages/app/package.json version "${appVersion}" is not X.Y.Z`);
  }
  if (lockVersion !== undefined && lockVersion !== appVersion) {
    problems.push(`package-lock.json carries @cbe/app ${lockVersion}, package.json ${appVersion}`);
  }
  if (tag !== undefined && tag !== `v${appVersion}`) {
    problems.push(`tag ${tag} does not match the app version (expected v${appVersion})`);
  }

  const sections = changelogSections(changelog);
  if (sections.length === 0 || !sections[0].unreleased) {
    problems.push("CHANGELOG.md must open with a `## [Unreleased]` section");
  }
  const malformed = sections.filter((section) => !section.unreleased && !section.version);
  for (const section of malformed) {
    problems.push(`CHANGELOG.md heading "${section.heading}" is not "## [X.Y.Z] — YYYY-MM-DD"`);
  }
  const top = sections.find((section) => section.version);
  if (!top) {
    problems.push("CHANGELOG.md has no released version section");
  } else {
    if (top.version !== appVersion) {
      problems.push(
        `the newest CHANGELOG.md section is ${top.version}, but the app version is ${appVersion} — move the Unreleased items under "## [${appVersion}] — YYYY-MM-DD"`
      );
    }
    if (!isRealDate(top.date)) problems.push(`CHANGELOG.md section ${top.version} carries an invalid date ${top.date}`);
    if (!/^- /m.test(top.body)) problems.push(`CHANGELOG.md section ${top.version} lists no entries`);
  }
  const seen = new Set();
  for (const section of sections.filter((candidate) => candidate.version)) {
    if (seen.has(section.version)) problems.push(`CHANGELOG.md carries ${section.version} twice`);
    seen.add(section.version);
  }

  for (const [page, version] of Object.entries(portalVersions ?? {})) {
    if (version !== appVersion) {
      problems.push(
        `${page} presents release ${version ?? "(no data-release-version)"}, but the app version is ${appVersion}`
      );
    }
  }
  return problems;
}

/** The release body: the version's CHANGELOG section, then the tester note. */
export function composeReleaseBody({ changelog, version, testerNote }) {
  const section = changelogSections(changelog).find((candidate) => candidate.version === version);
  if (!section) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const body = `## CBE Toolbox ${version} — ${section.date}\n\n${section.body}\n\n## User documentation\n\n[English and German lecturer documentation](docs/user/README.md)\n\n---\n\n${testerNote.trim()}\n`;
  if (body.length > MAX_RELEASE_BODY) {
    throw new Error(`release body is ${body.length} characters (limit ${MAX_RELEASE_BODY})`);
  }
  return body;
}

/** Read only product-owned release metadata available in both canonical and mirror trees. */
export async function readProductMetadata(repoRoot) {
  const read = (relative) => readFile(path.join(repoRoot, relative), "utf8");
  const pkg = JSON.parse(await read("packages/app/package.json"));
  const lock = JSON.parse(await read("package-lock.json"));
  return {
    appVersion: pkg.version,
    lockVersion: lock.packages?.["packages/app"]?.version,
    changelog: await read("CHANGELOG.md"),
    testerNote: await read("docs/closed-testing.md"),
  };
}
