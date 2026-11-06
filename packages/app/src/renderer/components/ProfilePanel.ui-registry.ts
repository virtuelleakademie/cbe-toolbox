import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entry for the Profile surface (`ui-reference-generation` spec,
 * Requirement: UI Element Registry). Colocated with `ProfilePanel.tsx` — when the
 * panel changes, update this entry in the same diff and run `npm run ui:reference`.
 *
 * The `area` names the surface's REAL home: the profile is the Profile section of
 * the Profile-and-Settings overlay, no longer a tab of the right panel, and an
 * entry that still said so would send a lecturer to a tab that does not exist. It
 * is reached from the header's user affordance.
 * Plain data module: type-only imports, no runtime deps. */
export const profilePanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "profile-panel",
    area: "Profile",
    label: "overlayProfileTab",
    description:
      "The {{overlayProfileTab}} section of the overlay that opens over your workspace, beside {{overlaySettingsTab}}. At the top it carries your own two entries about yourself — your name and the form of address you prefer — both optional, independent of each other, and stated by you rather than estimated. Below them it shows the assistant's running estimate of the five lecturer-state dimensions (PBL prior knowledge, CBE prior knowledge, didactic stance, attitude toward CBE, teaching load/capacity), each with value, confidence, evidence pointer, and provenance.",
    howToUse:
      "Open it with the person icon at the top right of the window, and switch to {{overlaySettingsTab}} without leaving the overlay. To say what you are called or how you would like to be addressed, type into the {{profileNameLabel}} and {{profileFormOfAddressLabel}} fields and press {{profileSave}}; to change or remove either one, edit or empty that field and press {{profileSave}} again. Leaving both empty is a normal choice and changes nothing. Below that, review each dimension's current estimate; use a dimension's dropdown to set a manual override — the override takes precedence over the assistant's running estimate until later behaviour clearly contradicts it. Close the overlay with Escape, its × control, or a click outside it.",
    affordance: "profilePanel",
  },
];
