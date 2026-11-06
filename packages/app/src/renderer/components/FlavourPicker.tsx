import { useCbe } from "../state/store.js";
import { FLAVOURS } from "../theme/catppuccin.js";
import { useChrome } from "../chrome.js";
import type { ChromeStringKey } from "../../shared/i18n/index.js";

/** Catalogue entry per Catppuccin flavour. The names are the palette's own and
 * read identically in every language; they are catalogue entries all the same, so
 * no component carries a rendered literal. */
const FLAVOUR_LABEL_KEYS: Record<(typeof FLAVOURS)[number], ChromeStringKey> = {
  frappe: "settingsFlavourFrappe",
  macchiato: "settingsFlavourMacchiato",
  mocha: "settingsFlavourMocha",
};

/**
 * Discrete buttons for the three Catppuccin dark flavours.
 * In Light mode the picker is replaced by a note (Latte is auto-applied).
 */
export function FlavourPicker() {
  const t = useChrome();
  const theme = useCbe((s) => s.theme);
  const flavour = useCbe((s) => s.flavour);
  const setFlavour = useCbe((s) => s.setFlavour);

  if (theme === "light") {
    return <p className="set-note set-note-inline">{t.settingsFlavourLatteNote}</p>;
  }

  return (
    <div className="seg" role="group" aria-label={t.settingsFlavourGroupLabel}>
      {FLAVOURS.map((f) => (
        <button key={f} type="button" aria-pressed={flavour === f} onClick={() => setFlavour(f)}>
          {t[FLAVOUR_LABEL_KEYS[f]] as string}
        </button>
      ))}
    </div>
  );
}
