/**
 * Catppuccin palette definitions + applyPalette() — ported from cbe-toolbox-v3.html.
 *
 * Dark theme: three flavours (Frappé / Macchiato / Mocha) provide the surfaces + an
 * accent map keyed by accent name. Light theme uses the Latte accent map on top of
 * an oklch surface palette declared in styles.css.
 *
 * applyPalette() writes CSS variables on <html> at runtime so the dropdown choice
 * takes effect instantly without re-renders.
 */

export type Theme = "dark" | "light";
export type Flavour = "frappe" | "macchiato" | "mocha";
export type Accent =
  | "rosewater"
  | "flamingo"
  | "pink"
  | "mauve"
  | "red"
  | "maroon"
  | "peach"
  | "yellow"
  | "green"
  | "teal"
  | "sky"
  | "sapphire"
  | "blue"
  | "lavender";

export const ACCENTS: readonly Accent[] = [
  "rosewater",
  "flamingo",
  "pink",
  "mauve",
  "red",
  "maroon",
  "peach",
  "yellow",
  "green",
  "teal",
  "sky",
  "sapphire",
  "blue",
  "lavender",
];

export const FLAVOURS: readonly Flavour[] = ["frappe", "macchiato", "mocha"];
interface FlavourPalette {
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  text: string;
  subtext0: string;
  overlay1: string;
  accents: Record<Accent, string>;
}

export const CATPPUCCIN: Record<Flavour, FlavourPalette> = {
  frappe: {
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
    surface0: "#414559",
    surface1: "#51576d",
    text: "#c6d0f5",
    subtext0: "#a5adce",
    overlay1: "#838ba7",
    accents: {
      rosewater: "#f2d5cf",
      flamingo: "#eebebe",
      pink: "#f4b8e4",
      mauve: "#ca9ee6",
      red: "#e78284",
      maroon: "#ea999c",
      peach: "#ef9f76",
      yellow: "#e5c890",
      green: "#a6d189",
      teal: "#81c8be",
      sky: "#99d1db",
      sapphire: "#85c1dc",
      blue: "#8caaee",
      lavender: "#babbf1",
    },
  },
  macchiato: {
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
    surface0: "#363a4f",
    surface1: "#494d64",
    text: "#cad3f5",
    subtext0: "#a5adcb",
    overlay1: "#8087a2",
    accents: {
      rosewater: "#f4dbd6",
      flamingo: "#f0c6c6",
      pink: "#f5bde6",
      mauve: "#c6a0f6",
      red: "#ed8796",
      maroon: "#ee99a0",
      peach: "#f5a97f",
      yellow: "#eed49f",
      green: "#a6da95",
      teal: "#8bd5ca",
      sky: "#91d7e3",
      sapphire: "#7dc4e4",
      blue: "#8aadf4",
      lavender: "#b7bdf8",
    },
  },
  mocha: {
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
    surface0: "#313244",
    surface1: "#45475a",
    text: "#cdd6f4",
    subtext0: "#a6adc8",
    overlay1: "#7f849c",
    accents: {
      rosewater: "#f5e0dc",
      flamingo: "#f2cdcd",
      pink: "#f5c2e7",
      mauve: "#cba6f7",
      red: "#f38ba8",
      maroon: "#eba0ac",
      peach: "#fab387",
      yellow: "#f9e2af",
      green: "#a6e3a1",
      teal: "#94e2d5",
      sky: "#89dceb",
      sapphire: "#74c7ec",
      blue: "#89b4fa",
      lavender: "#b4befe",
    },
  },
};

export const LATTE_ACCENTS: Record<Accent, string> = {
  rosewater: "#dc8a78",
  flamingo: "#dd7878",
  pink: "#ea76cb",
  mauve: "#8839ef",
  red: "#d20f39",
  maroon: "#e64553",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  sky: "#04a5e5",
  sapphire: "#209fb5",
  blue: "#1e66f5",
  lavender: "#7287fd",
};

/** CSS variables we manage at runtime (must be cleared on every apply for clean transitions). */
const RUNTIME_VARS = [
  "--bg",
  "--panel",
  "--raise",
  "--fg",
  "--muted",
  "--faint",
  "--border",
  "--border-2",
  "--accent",
  "--accent-ink",
  "--accent-soft",
] as const;

/**
 * Apply theme + flavour + accent to <html> as inline CSS variables.
 *
 * Dark mode: full surface palette comes from the chosen flavour.
 * Light mode: surfaces stay on the oklch palette in styles.css; only the accent triple is overridden.
 *
 * The `data-theme` attribute is also set so the light vs. dark stylesheet branch in styles.css applies.
 */
export function applyPalette(theme: Theme, flavour: Flavour, accent: Accent): void {
  const rs = document.documentElement.style;
  RUNTIME_VARS.forEach((v) => rs.removeProperty(v));
  document.documentElement.dataset.theme = theme;

  if (theme === "dark") {
    const fl = CATPPUCCIN[flavour];
    rs.setProperty("--bg", fl.base);
    rs.setProperty("--panel", fl.mantle);
    rs.setProperty("--raise", fl.surface0);
    rs.setProperty("--fg", fl.text);
    rs.setProperty("--muted", fl.subtext0);
    rs.setProperty("--faint", fl.overlay1);
    rs.setProperty("--border", fl.surface0);
    rs.setProperty("--border-2", fl.surface1);
    rs.setProperty("--accent", fl.accents[accent] ?? fl.accents.blue);
    rs.setProperty("--accent-ink", fl.crust);
    rs.setProperty("--accent-soft", fl.surface1);
  } else {
    // Latte: only override the accent triple; surfaces come from styles.css :root.
    const hex = LATTE_ACCENTS[accent] ?? LATTE_ACCENTS.blue;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    rs.setProperty("--accent", hex);
    rs.setProperty("--accent-ink", "oklch(99% 0 0)");
    rs.setProperty("--accent-soft", `rgba(${r},${g},${b},.13)`);
  }
}

/** Lookup the hex for an accent given the current theme/flavour — used by the AccentPicker swatches. */
export function accentHex(theme: Theme, flavour: Flavour, accent: Accent): string {
  if (theme === "dark") {
    return CATPPUCCIN[flavour].accents[accent];
  }
  return LATTE_ACCENTS[accent];
}
