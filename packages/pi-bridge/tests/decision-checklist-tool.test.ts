/**
 * Tests for the cbe_decision_checklist tool definition.
 *
 * Like cbe_picker, the tool returns a placeholder immediately — the lecturer's
 * marked state flows back through the next user turn, not this tool's result.
 */
import { describe, it, expect } from "vitest";
import { decisionChecklistTool, DecisionChecklistParamsSchema } from "../src/decision-checklist-tool.js";

describe("cbe_decision_checklist tool", () => {
  it("declares the expected name, label and a prompt snippet", () => {
    expect(decisionChecklistTool.name).toBe("cbe_decision_checklist");
    expect(decisionChecklistTool.label).toBe("Decision Checklist");
    expect(decisionChecklistTool.promptSnippet).toBeTruthy();
  });

  it("guideline bullets distinguish checklist from progress-bar use", () => {
    const text = decisionChecklistTool.promptGuidelines!.join(" ");
    expect(text).toMatch(/checklist/i);
    expect(text).toMatch(/progress-bar/i);
  });

  it("execute returns the spec in details and a wait-for-user-turn marker in content", async () => {
    const result = await decisionChecklistTool.execute(
      "tool-call-1",
      {
        presentation: "checklist",
        items: [
          { id: "a", label: "Item A" },
          { id: "b", label: "Item B" },
        ],
      },
      undefined,
      undefined,
      {} as never
    );
    expect(result.details).toMatchObject({
      kind: "cbe_decision_checklist",
      spec: { presentation: "checklist" },
    });
    expect((result.content[0] as { text: string }).text.toLowerCase()).toContain("next user message");
  });

  it("execute echoes the chosen presentation in the content text", async () => {
    const result = await decisionChecklistTool.execute(
      "id",
      {
        presentation: "progress-bar",
        items: [
          { id: "a", label: "Phase A" },
          { id: "b", label: "Phase B" },
        ],
      },
      undefined,
      undefined,
      {} as never
    );
    expect((result.content[0] as { text: string }).text).toContain("progress-bar");
  });

  describe("schema contract (defensive layer 1)", () => {
    const schema = DecisionChecklistParamsSchema as unknown as {
      properties: {
        presentation: { anyOf?: Array<{ const?: string }> };
        items: {
          minItems?: number;
          maxItems?: number;
          items: { properties: { id: { minLength?: number }; label: { minLength?: number } } };
        };
      };
    };

    it("items carries minItems: 2 and maxItems: 12", () => {
      expect(schema.properties.items.minItems).toBe(2);
      expect(schema.properties.items.maxItems).toBe(12);
    });

    it("every item.id and item.label carries minLength: 1", () => {
      expect(schema.properties.items.items.properties.id.minLength).toBe(1);
      expect(schema.properties.items.items.properties.label.minLength).toBe(1);
    });

    it("presentation is a closed union of checklist | progress-bar", () => {
      const consts = (schema.properties.presentation.anyOf ?? []).map((m) => m.const).sort();
      expect(consts).toEqual(["checklist", "progress-bar"]);
    });
  });
});
