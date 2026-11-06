/**
 * The whole prose surface of one tool: `description` + every parameter description.
 *
 * This is the tool-side instruction channel (Requirement: *Instruction Channel
 * Boundary*) — `description` and the parameter descriptions are the only tool fields
 * this app binds. Shared so the budget test and the channel-boundary assertions
 * measure the SAME string: two copies could drift, and the drift would be silent.
 */
export function toolProse(tool: { description?: string; parameters?: unknown }): string {
  const params: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "description" && typeof v === "string") params.push(v);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(tool.parameters);
  return [tool.description ?? "", ...params].join("\n");
}
