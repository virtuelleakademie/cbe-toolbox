/**
 * Tests for the cbe_picker tool definition.
 *
 * The tool returns a placeholder result immediately — the spec deliberately
 * routes the lecturer's actual answer through the next user turn, NOT through
 * this tool's result. See packages/pi-bridge/src/picker-tool.ts for the
 * rationale.
 */
import { describe, it, expect } from "vitest";
import { pickerTool, PickerParamsSchema } from "../src/picker-tool.js";

describe("cbe_picker tool", () => {
  it("declares the expected name, label and a prompt snippet", () => {
    expect(pickerTool.name).toBe("cbe_picker");
    expect(pickerTool.label).toBe("Picker");
    expect(pickerTool.promptSnippet).toBeTruthy();
  });

  it("includes guideline bullets so the model knows when to use it", () => {
    expect(pickerTool.promptGuidelines).toBeDefined();
    expect(pickerTool.promptGuidelines!.length).toBeGreaterThan(0);
    // At least one guideline mentions "discrete" choices — the core use-case.
    expect(pickerTool.promptGuidelines!.join(" ")).toMatch(/discrete/i);
  });

  // Guards the multi-select bias fix (change fix-picker-multiselect-bias). The
  // renderer + schema have always supported multi-select; the model rarely
  // chose it because the guidance framed single-select as the silent default.
  // These assertions pin the *positive* trigger so a future edit cannot quietly
  // revert to "multi-select only when several options genuinely apply".
  describe("multi-select positive trigger (no single-select-default bias)", () => {
    it("a guideline instructs multiSelect: true for plural / several-apply questions", () => {
      const joined = pickerTool.promptGuidelines!.join("\n");
      expect(joined).toMatch(/multiSelect:\s*true/);
      // The trigger must be framed positively (several can hold at once / plural),
      // not as a rarely-met exception.
      expect(joined).toMatch(/several|plural|combination/i);
      // The old high-threshold framing must be gone.
      expect(joined.toLowerCase()).not.toContain("only when several options genuinely apply");
    });

    it("the multiSelect schema description no longer presents single-select as the silent default", () => {
      const desc = (PickerParamsSchema as unknown as { properties: { multiSelect: { description?: string } } })
        .properties.multiSelect.description;
      expect(desc).toBeTruthy();
      expect(desc!.toLowerCase()).not.toContain("default false");
      // It describes both arms of the choice instead.
      expect(desc!).toMatch(/either\/or|exactly one/i);
      expect(desc!).toMatch(/several/i);
    });
  });

  it("execute returns the spec in details and a wait-for-user-turn marker in content", async () => {
    const result = await pickerTool.execute(
      "tool-call-1",
      {
        question: "Welche Option passt?",
        options: [
          { id: "a", label: "Option A" },
          { id: "b", label: "Option B" },
        ],
      },
      undefined,
      undefined,
      // ExtensionContext is unused by the picker's execute path.
      {} as never
    );
    expect(result.details).toMatchObject({
      kind: "cbe_picker",
      spec: {
        question: "Welche Option passt?",
        options: [
          { id: "a", label: "Option A" },
          { id: "b", label: "Option B" },
        ],
      },
    });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text.toLowerCase()).toContain("user message");
  });

  it("execute mentions the Other affordance only when otherEnabled is not explicitly false", async () => {
    const withOther = await pickerTool.execute(
      "id",
      {
        question: "Q",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
      undefined,
      undefined,
      {} as never
    );
    expect((withOther.content[0] as { text: string }).text).toMatch(/other/i);

    const withoutOther = await pickerTool.execute(
      "id",
      {
        question: "Q",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        otherEnabled: false,
      },
      undefined,
      undefined,
      {} as never
    );
    expect((withoutOther.content[0] as { text: string }).text).not.toMatch(/other/i);
  });

  describe("schema rejects empty / placeholder field values (defensive layer 1)", () => {
    // Pi validates the model's arguments against this schema BEFORE invoking
    // execute(). These assertions verify the schema CONTRACT — minLength on
    // every string field that gets rendered to the lecturer, minItems/maxItems
    // on the options list. Without these, the model could emit a payload with
    // empty option labels and the renderer would draw visually empty pills
    // (the observed failure mode). Covers agent-harness spec, *Generative-UI
    // tool schemas reject empty / placeholder field values*.

    const schema = PickerParamsSchema as unknown as {
      properties: {
        question: { minLength?: number };
        options: {
          minItems?: number;
          maxItems?: number;
          items: { properties: { id: { minLength?: number }; label: { minLength?: number } } };
        };
      };
    };

    it("question carries minLength: 1", () => {
      expect(schema.properties.question.minLength).toBe(1);
    });

    it("options carries minItems: 2 and maxItems: 7", () => {
      expect(schema.properties.options.minItems).toBe(2);
      expect(schema.properties.options.maxItems).toBe(7);
    });

    it("every option.id carries minLength: 1", () => {
      expect(schema.properties.options.items.properties.id.minLength).toBe(1);
    });

    it("every option.label carries minLength: 1", () => {
      expect(schema.properties.options.items.properties.label.minLength).toBe(1);
    });
  });
});
