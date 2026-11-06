import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** Host-owned native application menu, documented as another route into existing actions. */
export const nativeMenuUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "native-application-menu",
    area: "Native application menu",
    label: "menuApplication",
    description:
      "The operating system menu provides standard editing, view, window and lifecycle actions plus routes to settings, About, Help and the official PIONEER Alliance site.",
    howToUse:
      "Use {{menuSettings}} for the usual settings route, {{menuAbout}} to open the existing About group, or {{menuCbeHelp}} (F1) for the same conversational help as the header. {{menuPioneerWebsite}} opens in the system browser.",
  },
];
