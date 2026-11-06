import { useCbe } from "../state/store.js";
import { ACCENTS, accentHex } from "../theme/catppuccin.js";
import { useChrome } from "../chrome.js";

/**
 * 14 Catppuccin accent swatches. The hex shown on each swatch is the accent's value
 * within the currently-active flavour (or the Latte palette in Light mode).
 */
export function AccentPicker() {
  const t = useChrome();
  const theme = useCbe((s) => s.theme);
  const flavour = useCbe((s) => s.flavour);
  const accent = useCbe((s) => s.accent);
  const setAccent = useCbe((s) => s.setAccent);

  return (
    <div className="sw-grid" role="group" aria-label={t.settingsAccentGroupLabel}>
      {ACCENTS.map((a) => {
        const hex = accentHex(theme, flavour, a);
        return (
          <button
            key={a}
            type="button"
            className="sw"
            aria-pressed={accent === a}
            title={a}
            style={{ "--sw": hex } as React.CSSProperties}
            onClick={() => setAccent(a)}
          />
        );
      })}
    </div>
  );
}
