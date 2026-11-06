/**
 * Artifact annotation model + the structured payload the `↻ Iterate` button
 * sends back as the next user turn.
 *
 * Covers `specs/desktop-app/spec.md`, Requirement: Artifact Annotation and
 * Iteration Loop. The payload is "semantically identical to the lecturer typing
 * 'please address these notes: …', but structured" — so the skill can read each
 * anchored excerpt and its note deterministically.
 */

export interface ArtifactAnnotation {
  /** Stable id for removal + React keys. */
  id: string;
  /** The artifact the annotation is anchored to (artifact item id). */
  artifactId: string;
  /** The anchored content excerpt (the artifact text the note refers to). */
  excerpt: string;
  /** The lecturer's note. */
  note: string;
}

/**
 * Build the structured user-turn text for an iteration round. Mirrors the
 * picker's `formatPickerAnswer` shape: a machine-recognisable header line plus
 * one numbered entry per annotation carrying the anchored excerpt and the note.
 */
export function buildIterationPayload(annotations: ArtifactAnnotation[]): string {
  const n = annotations.length;
  const header = `[artifact iteration · ${n} annotation${n === 1 ? "" : "s"}]`;
  const lines = annotations.map((a, i) => `${i + 1}. "${a.excerpt}" — ${a.note}`);
  return [header, ...lines].join("\n");
}
