/**
 * TEST FIXTURE — a populated `DidacticChecks` sample for the Decisions-section suites.
 *
 * This used to be the renderer's INITIAL `didacticChecks` value, which meant every
 * lecturer, in every course, saw this unrelated `water-systems` sample as if it were
 * their own recorded state (capability `desktop-app`, Requirement: Decision Artefacts
 * Are Per-Conversation State — "demo/fixture content MUST NOT be the initial value of
 * lecturer-facing state"). It lives under `tests/` now so it can never be imported by
 * renderer code again; the cold-start value is `emptyDidacticChecks()`.
 *
 * The shape is `DidacticChecks` from `@cbe/pi-bridge` — the same object the JSON
 * sidecar persists.
 */
import type { DidacticChecks } from "@cbe/pi-bridge/didactic-checks";

export const SAMPLE_DIDACTIC_CHECKS: DidacticChecks = {
  kompetenz: {
    status: "completed",
    goals: [
      {
        id: "g-systems",
        text: "Construct the schema systems-thinking on water flows and apply it to an unseen regional supply case.",
        sharpness: "sharp",
        citations: [
          "(corpus:foundations-005 § The seven operationalised PIONEER criteria, PIONEER Project Team WP4 2026)",
        ],
      },
      {
        id: "g-teamwork",
        text: "Teamwork",
        sharpness: "pending-sharpening",
        citations: ['(corpus:vocabulary-001 § "Durable Skills", Nichols et al. 2016)'],
      },
    ],
  },
  alignment: {
    status: "completed",
    findings: [
      { goalId: "g-systems", status: "aligned" },
      {
        goalId: "g-teamwork",
        status: "flagged",
        pattern: "soft-skill goal checked solely via a group end-product score",
        affectedArtifact: "investigate:ar",
      },
    ],
  },
  delegation: {
    status: "in-progress",
    decisions: [
      {
        component: "Essential Question formulation",
        status: "student-generated",
        reasoning: "Carries the Owning load — students must originate the question.",
      },
      {
        component: "Research synthesis",
        status: "hybrid",
        reasoning: "AI may cluster sources; students judge relevance.",
      },
      {
        component: "Solution Concept drafting",
        status: "delegable",
        reasoning: "AI drafts boilerplate; the concept decisions stay with students.",
        inconsistencyFlag:
          "Solution Concept carries germane design reasoning — full AI delegation risks the schema the goal targets.",
      },
    ],
  },
  heterogeneity: {
    fired: true,
    notes:
      "Two study programmes; wide prior-knowledge spread on hydrology. Considering hybrid teams with role rotation.",
  },
  softSkill: {
    fired: true,
    anchors: [{ goal: "teamwork", anchor: null }],
  },
};
