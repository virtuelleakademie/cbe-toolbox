import { describe, it, expect } from "vitest";
import {
  CHECK_ORDER,
  canEnterDelegation,
  downstreamChecks,
  emptyDidacticChecks,
  isDidacticChecks,
  resetDownstreamOnGoalChange,
  type DidacticChecks,
} from "../src/didactic-checks.js";

/**
 * Tests for capability `cbe-skill`, Requirement: Check Execution Order — the
 * pi-bridge (state) half of task 7.4. The skill-behaviour half lives in
 * evaluation/cbe-skill/scenarios/10-check-execution-order.md.
 */
describe("didactic-checks state", () => {
  it("orders the checks Kompetenz before Alignment before Delegation", () => {
    expect(CHECK_ORDER).toEqual(["kompetenz", "alignment", "delegation"]);
  });

  it("starts every check not-started with empty payloads", () => {
    const s = emptyDidacticChecks();
    expect(s.kompetenz.status).toBe("not-started");
    expect(s.alignment.status).toBe("not-started");
    expect(s.delegation.status).toBe("not-started");
    expect(s.kompetenz.goals).toEqual([]);
    expect(s.alignment.findings).toEqual([]);
    expect(s.delegation.decisions).toEqual([]);
  });

  describe("ordering gate — premature Delegation defers", () => {
    it("blocks Delegation until both Kompetenz and Alignment are completed", () => {
      const s = emptyDidacticChecks();
      expect(canEnterDelegation(s)).toBe(false);

      s.kompetenz.status = "completed";
      expect(canEnterDelegation(s)).toBe(false); // Alignment still missing

      s.alignment.status = "in-progress";
      expect(canEnterDelegation(s)).toBe(false);

      s.alignment.status = "completed";
      expect(canEnterDelegation(s)).toBe(true);
    });
  });

  describe("goal-change resets downstream", () => {
    const completed = (): DidacticChecks => ({
      kompetenz: {
        status: "completed",
        goals: [{ id: "g1", text: "stakeholder-impact mapping", sharpness: "sharp" }],
      },
      alignment: { status: "completed", findings: [{ goalId: "g1", status: "aligned" }] },
      delegation: {
        status: "completed",
        decisions: [{ component: "Essential Question", status: "student-generated", reasoning: "owning load" }],
      },
    });

    it("resets Alignment AND Delegation when a Kompetenz goal is revised", () => {
      const next = resetDownstreamOnGoalChange(completed(), "kompetenz");
      expect(next.kompetenz.status).toBe("completed"); // the changed check itself is untouched here
      expect(next.alignment.status).toBe("not-started");
      expect(next.alignment.findings).toEqual([]);
      expect(next.delegation.status).toBe("not-started");
      expect(next.delegation.decisions).toEqual([]);
    });

    it("resets only Delegation when an Alignment goal is revised", () => {
      const next = resetDownstreamOnGoalChange(completed(), "alignment");
      expect(next.alignment.status).toBe("completed");
      expect(next.delegation.status).toBe("not-started");
      expect(next.delegation.decisions).toEqual([]);
    });

    it("resets nothing downstream when Delegation itself changes (it is last)", () => {
      const next = resetDownstreamOnGoalChange(completed(), "delegation");
      expect(next.kompetenz.status).toBe("completed");
      expect(next.alignment.status).toBe("completed");
      expect(next.delegation.status).toBe("completed");
    });

    it("does not mutate the input state", () => {
      const before = completed();
      resetDownstreamOnGoalChange(before, "kompetenz");
      expect(before.alignment.status).toBe("completed");
      expect(before.delegation.status).toBe("completed");
    });

    it("names the downstream checks a revision invalidates", () => {
      expect(downstreamChecks("kompetenz")).toEqual(["alignment", "delegation"]);
      expect(downstreamChecks("alignment")).toEqual(["delegation"]);
      expect(downstreamChecks("delegation")).toEqual([]);
    });
  });

  describe("type guard (sidecar rehydration safety)", () => {
    it("accepts a well-formed empty state", () => {
      expect(isDidacticChecks(emptyDidacticChecks())).toBe(true);
    });

    it("accepts optional dev-marked behaviour blocks when present", () => {
      const s: DidacticChecks = {
        ...emptyDidacticChecks(),
        heterogeneity: { fired: true, notes: "two study programmes" },
        softSkill: { fired: true, anchors: [{ goal: "teamwork", anchor: "team charter" }] },
      };
      expect(isDidacticChecks(s)).toBe(true);
    });

    it("rejects an unknown check status", () => {
      const bad = { ...emptyDidacticChecks(), kompetenz: { status: "done", goals: [] } };
      expect(isDidacticChecks(bad)).toBe(false);
    });

    it("rejects a missing check block", () => {
      const bad = {
        kompetenz: { status: "not-started", goals: [] },
        alignment: { status: "not-started", findings: [] },
      };
      expect(isDidacticChecks(bad)).toBe(false);
    });

    it("rejects a dev-marked block without a boolean fired flag", () => {
      const bad = { ...emptyDidacticChecks(), heterogeneity: { notes: "x" } };
      expect(isDidacticChecks(bad)).toBe(false);
    });

    it("rejects non-objects", () => {
      expect(isDidacticChecks(null)).toBe(false);
      expect(isDidacticChecks("nope")).toBe(false);
    });
  });
});
