import { WINDOW_MIN_WIDTH } from "../shared/layout.js";

/**
 * `BrowserWindow` construction options that carry a rule rather than a taste
 * (capability `desktop-app`, Requirement: The Chat Column Survives Two Flanking
 * Panels). Exported as data so the floor is assertable without booting Electron:
 * `packages/app/tests/window-minimum.test.ts` checks that `minWidth` IS the
 * shared arithmetic and not a number someone typed.
 */
export const WINDOW_BOUNDS = {
  width: 1280,
  height: 800,
  /** Derived, never a literal — see `shared/layout.ts` for the four terms. */
  minWidth: WINDOW_MIN_WIDTH,
} as const;
