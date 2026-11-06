/**
 * remark plugin: apply the single-dollar delimiter rule that keeps a sentence with two
 * currency amounts from being parsed as inline math.
 *
 * Background (change `render-latex-math-in-markdown`, capability `desktop-app`,
 * Requirement: Markdown Rendering in the Chat View — Scenario: *Currency amounts are not
 * parsed as math*). Enabling `$…$` is the whole point of the feature: it is the
 * GitHub/Obsidian dialect the model actually writes. Its cost is that
 *
 *   > The materials budget is $200 and the excursion $150.
 *
 * has two dollar signs and therefore a span between them. `design.md` assumed
 * `remark-math` already refuses such a span; it does not — `micromark-extension-math`
 * v3.1.0 exposes exactly one option (`singleDollarTextMath`) and applies no
 * whitespace rule, so the sentence above renders as typeset nonsense out of the box.
 * Verified against the installed version, not inferred.
 *
 * So the delimiter rule is supplied here rather than inherited. It is Pandoc's, and it is
 * the rule `design.md` describes: a single-dollar span only stands when the character
 * right after the opening `$` and the character right before the closing `$` are both
 * non-whitespace. `$\rightarrow$` stands; `$200 and the excursion $` does not.
 *
 * Deliberate boundaries:
 *   - This is NOT the rejected "pre-process the text" option. Nothing rewrites the
 *     model's source before parsing; the plugin reads the ALREADY parsed tree, decides
 *     per node, and restores the original source slice verbatim when it declines a node.
 *   - `$$…$$` is left alone. Two dollars are unambiguous, so no rule is needed and none
 *     is applied.
 *   - Declining is lossless and cosmetic: the text is all still there, dollars included.
 *     A missed case can still be escaped on the authoring side with `\$`.
 */
import type { Plugin } from "unified";
import type { Root, Text } from "mdast";
import { visit } from "unist-util-visit";

/** True when `ch` is whitespace by the same notion Markdown uses for its delimiter runs. */
function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

export const mathDollarGuardPlugin: Plugin<[], Root> = () => {
  return (tree, file) => {
    // The rule is about the raw delimiters, and the parsed node has already dropped
    // them (and stripped a padding space from each side, code-span style). So it is
    // decided on the ORIGINAL source slice the node covers, via its position offsets.
    const source = String(file.value ?? "");
    if (source.length === 0) return;

    visit(tree, "inlineMath", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start === undefined || end === undefined) return;

      const raw = source.slice(start, end);
      let fence = 0;
      while (fence < raw.length && raw[fence] === "$") fence += 1;
      // `$$…$$` (and longer runs) are unambiguous — never currency. Leave them.
      if (fence !== 1) return;

      const inner = raw.slice(fence, raw.length - fence);
      if (inner.length === 0) return;
      // Real math: tight against both delimiters. Keep it.
      if (!isSpace(inner[0]!) && !isSpace(inner[inner.length - 1]!)) return;

      // Prose: put the source back, dollars and all, as a plain text node. Later
      // transformers (the citation plugin) then see it as ordinary text again.
      const restored: Text = { type: "text", value: raw };
      if (node.position) restored.position = node.position;
      parent.children[index] = restored;
    });
  };
};
