/**
 * The Profile section's content keeps the overlay's inner spacing (capability
 * `desktop-app`, Requirement: Profile Panel — rendered as a section of the
 * Profile-and-Settings overlay).
 *
 * Reported from the product authority's chrome walkthrough on 2026-08-14: the profile's
 * dropdowns and provenance badges sat flush against the overlay's edge while the
 * sibling Settings section kept a margin, so the one surface read as two.
 *
 * jsdom lays out no pixels, so this asserts the two halves that together fix the
 * defect — the DOM containment (every dimension row lives inside the section's
 * content group, never as a direct child of the scroll region) and the
 * stylesheet source (that group's inset is the SAME value the sibling section
 * establishes, not a second spacing value invented here). Same shape as
 * `settings-scroll-structure.test.tsx`.
 *
 * The content is deliberately a POPULATED profile: the selects, the confidence
 * badge and the override badge are what reach the edge, and an empty profile
 * would not exercise them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ProfileSettingsOverlay } from "../src/renderer/components/ProfileSettingsOverlay.js";
import type { LecturerProfile } from "../src/shared/ipc-contract.js";

/** An estimate (confidence badge + evidence) and an override (accent badge) —
 * the two row shapes that carry the widest content. */
const POPULATED: LecturerProfile = {
  "pbl-prior-knowledge": {
    value: "pronounced",
    confidence: "high",
    evidence: "described a complete PBL sequence they ran",
    provenance: "estimate",
    lastRevised: "2026-06-10T09:00:00.000Z",
  },
  capacity: {
    value: "limited",
    confidence: "medium",
    evidence: "set by the lecturer in the Profile Panel",
    provenance: "override",
    lastRevised: "2026-06-10T09:05:00.000Z",
  },
};

// vitest root is packages/app (same resolution as `settings-scroll-structure.test.tsx`).
const CSS = readFileSync(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");

/** Extract a top-level CSS rule block for a selector from styles.css. */
function cssRule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `rule for ${selector}`).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("}", start) + 1);
}

function paddingOf(selector: string): string {
  const rule = cssRule(selector);
  const match = /(?:^|\n)\s*padding:\s*([^;]+);/.exec(rule);
  expect(match, `padding declaration in ${selector}`).not.toBeNull();
  return match![1].trim();
}

beforeEach(() => {
  useCbe.getState().reset();
  Object.assign(window.cbe, { getLecturerProfile: async () => POPULATED });
  useCbe.getState().showSettingsSurface("profile");
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("Profile content sits inside the overlay's inner spacing", () => {
  it("every dimension row lives in the section's content group, not flush in the scroll region", async () => {
    render(<ProfileSettingsOverlay />);
    await waitFor(() => expect(screen.getByText("set by you")).toBeTruthy());

    const scrollRegion = document.querySelector("#overlay-section-profile");
    expect(scrollRegion).not.toBeNull();

    const rows = Array.from(document.querySelectorAll(".profile-dim"));
    expect(rows.length).toBe(5);
    for (const row of rows) {
      const group = row.closest(".profile-body");
      expect(group, "dimension row inside the content group").not.toBeNull();
      expect(scrollRegion!.contains(group!)).toBe(true);
      // The defect was exactly this: the row hanging directly off the scroll
      // region, so nothing between it and the surface edge carried an inset.
      expect(row.parentElement).not.toBe(scrollRegion);
    }
  });

  it("the widest controls — the selects and the badges — are inside that group too", async () => {
    render(<ProfileSettingsOverlay />);
    await waitFor(() => expect(screen.getByText("set by you")).toBeTruthy());

    const group = document.querySelector(".profile-body");
    expect(group).not.toBeNull();
    const selects = Array.from(document.querySelectorAll("#overlay-section-profile select"));
    expect(selects.length).toBe(5);
    for (const el of selects) expect(group!.contains(el)).toBe(true);

    const badges = Array.from(document.querySelectorAll("#overlay-section-profile .profile-badge"));
    expect(badges.length).toBe(5);
    for (const el of badges) expect(group!.contains(el)).toBe(true);
  });

  it("uses the inset the sibling Settings section already establishes, not a new value", () => {
    // `.set-group` is the Settings section's content group; the Profile section
    // must not introduce a second spacing value for the same surface.
    expect(paddingOf(".profile-body")).toBe(paddingOf(".set-group"));
  });

  it("the inset does not depend on the window or panel widths", () => {
    // The overlay is a fixed-position surface over the workspace — it takes no
    // layout width from the panels, and its width is `min(760px, 100%)` of the
    // viewport. So the only way either section's inset could differ at another
    // width is a width-conditional rule; there must be none for the surface or
    // for the two content groups.
    expect(cssRule(".overlay-surface")).toMatch(/width:\s*min\(760px,\s*100%\)/);
    for (const block of CSS.split("@media").slice(1)) {
      const scoped = block.slice(0, block.indexOf("\n}\n") + 3);
      for (const sel of [".overlay-surface", ".overlay-body", ".profile-body", ".set-group", ".profile-panel"]) {
        expect(scoped, `${sel} must not be re-declared inside a media query`).not.toContain(`${sel} {`);
      }
    }
  });

  it("the panel itself carries no padding, so a full-bleed band stays full-bleed", () => {
    // The inset lives on the content group, never on the panel: a `.panel-intro`
    // band carries its own inset plus a divider that must span the whole surface
    // width, and padding on `.profile-panel` would inset that divider.
    expect(cssRule(".profile-panel")).not.toMatch(/padding:/);
  });
});
