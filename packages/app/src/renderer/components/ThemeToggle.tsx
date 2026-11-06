import { useCbe } from "../state/store.js";
import { useChrome } from "../chrome.js";

/** Segmented Dark/Light toggle. Variant "seg" = inline in settings panel; "pill" = floating corner button. */
export function ThemeToggle({ variant = "seg" }: { variant?: "seg" | "pill" }) {
  const t = useChrome();
  const theme = useCbe((s) => s.theme);
  const setTheme = useCbe((s) => s.setTheme);

  if (variant === "pill") {
    return (
      <div className="theme-pill" aria-label={t.settingsThemeToggleLabel}>
        <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
          {t.settingsThemeDark}
        </button>
        <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
          {t.settingsThemeLight}
        </button>
      </div>
    );
  }

  return (
    <div className="seg" role="group" aria-label={t.settingsThemeLabel}>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
        {t.settingsThemeDark}
      </button>
      <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
        {t.settingsThemeLight}
      </button>
    </div>
  );
}
