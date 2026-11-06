import { z } from "zod";

/**
 * UI element registry entry type (capability `ui-reference-generation`,
 * Requirement: UI Element Registry).
 *
 * Each user-facing control or panel that lecturers may plausibly ask
 * "how do I use X" about declares one entry, colocated with the renderer
 * component that owns it (a `<Component>.ui-registry.ts` sibling file in
 * `packages/app/src/renderer/components/`). Entries are explicit typed
 * source objects — NOT derived by scraping `aria-label`/`title` strings out
 * of JSX: those are accessibility labels written for assistive technology,
 * not lecturer-facing explanations (see the change's design.md, Decision 1).
 */

/**
 * The environment descriptor's affordance keys a registry entry may gate on.
 * Mirrors the `affordances` map produced by `packages/pi-bridge/src/environment.ts`
 * exactly; parity is asserted in `packages/pi-bridge/tests/environment.test.ts`.
 *
 * The list MUST stay the FULL descriptor key set, not a subset: a key the
 * descriptor emits but this list rejects makes a real control undocumentable.
 * That was not hypothetical — while only the first six keys were listed, the
 * Maturity panel (gated on `maturity`) could not declare its gate at all.
 *
 * `citations`, `corpusAccess` and `bash` left the descriptor with the change
 * `rebuild-skill-prompt-and-eval`: no rule in any instruction channel read them
 * (capability `agent-harness`, Requirement: *Environment Descriptor for the Skill* —
 * every flag MUST have a named reader).
 */
export const UI_AFFORDANCE_KEYS = [
  "canvas",
  "profilePanel",
  "courseWorkspace",
  "ingestion",
  "picker",
  "step",
  "maturity",
] as const;

export type UiAffordanceKey = (typeof UI_AFFORDANCE_KEYS)[number];

export interface UiElementRegistryEntry {
  /** Stable kebab-case identifier, unique across the whole registry. */
  id: string;
  /** Area/section of the app the control lives in (e.g. "Composer"). Model-facing
   * documentation prose: English in every interface language. */
  area: string;
  /**
   * A CATALOGUE KEY naming the control's rendered label — never a literal copy of
   * it (capability `ui-reference-generation`, Requirement: *UI Element Registry*).
   * The consumer resolves it: the host-injected block against the ACTIVE interface
   * language, the committed generated reference against the REFERENCE language. A
   * key no catalogue declares is a build error, so an entry cannot name a control
   * the app does not render, and a catalogue edit moves the rendered control and
   * the quoted label together with no registry edit at all.
   *
   * The app types this field as its own `ChromeStringKey` (`AppUiRegistryEntry` in
   * `packages/app/src/shared/ui-registry-entry.ts`); here it stays `string`,
   * because this package must not depend on the desktop shell.
   */
  label: string;
  /** Short lecturer-facing description of what the control is. Model-facing
   * documentation prose — English in every interface language — except for
   * `{{catalogueKey}}` PLACEHOLDERS, which are the only permitted way for an entry
   * to say a control's name. */
  description: string;
  /** Lecturer-facing how-to-use text (steps/interaction, not implementation). Same
   * prose and placeholder rules as `description`. */
  howToUse: string;
  /**
   * Optional: names the environment-descriptor affordance the control is
   * gated behind. The entry is suppressed when the session's descriptor does
   * not report this affordance `true` — the conservative-default rule from
   * `references/environment-awareness.md`. The desktop host enforces this
   * deterministically before it injects the entries into a help turn
   * (`packages/app/src/main/ui-reference-prompt.ts`); on the fallback path,
   * where the skill reads the generated `ui-guide.md` itself, the entry's
   * **Availability** line carries the same rule for the model to honour.
   */
  affordance?: UiAffordanceKey;
}

/**
 * Runtime validator for registry entries (the generator applies it to every
 * collected entry). `.strict()` so a typo'd field name fails loudly instead
 * of silently dropping out of the generated reference; the `affordance` enum
 * covers Scenario "An affordance-gated control declares its affordance" —
 * only known environment-descriptor keys are accepted.
 */
export const uiElementRegistryEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be kebab-case"),
    area: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    howToUse: z.string().min(1),
    affordance: z.enum(UI_AFFORDANCE_KEYS).optional(),
  })
  .strict();

/**
 * A label placeholder inside an entry's prose: `{{catalogueKey}}`. Only the two
 * prose fields carry them; `label` IS a key and is resolved directly.
 *
 * Deliberately narrow — a bare identifier — so a placeholder can never be
 * confused with prose that happens to contain braces, and so an unresolved one is
 * detectable rather than silently rendered.
 */
export const UI_LABEL_PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

/** Every catalogue key an entry names — its `label` plus every prose placeholder. */
export function uiEntryLabelKeys(entry: UiElementRegistryEntry): string[] {
  const keys = new Set<string>([entry.label]);
  for (const field of [entry.description, entry.howToUse]) {
    for (const match of field.matchAll(UI_LABEL_PLACEHOLDER)) keys.add(match[1]!);
  }
  return [...keys];
}

/**
 * Resolve one entry's label and its prose placeholders through `lookup`.
 *
 * THROWS on a key the catalogue does not declare — that is the build error the
 * requirement demands, and it fires in the generator (`npm run ui:reference`) as
 * well as in the host's own block composition. The prose itself is untouched:
 * only the placeholders resolve, so an entry's `area`, description and how-to-use
 * text stay English in every interface language.
 */
export function resolveUiEntryLabels(
  entry: UiElementRegistryEntry,
  lookup: (key: string) => string | undefined
): UiElementRegistryEntry {
  const resolve = (key: string): string => {
    const value = lookup(key);
    if (typeof value !== "string") {
      throw new Error(
        `UI registry entry "${entry.id}" names catalogue key "${key}", which no chrome-string catalogue declares.`
      );
    }
    return value;
  };
  const prose = (text: string): string => text.replace(UI_LABEL_PLACEHOLDER, (_m, key: string) => resolve(key));
  return {
    ...entry,
    label: resolve(entry.label),
    description: prose(entry.description),
    howToUse: prose(entry.howToUse),
  };
}
