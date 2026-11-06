import { useState } from "react";
import { useCbe } from "../state/store.js";
import { ActionIcon } from "./ActionIcon.js";
import type { CheckName, DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import { useChrome } from "../chrome.js";

/**
 * Canvas "Decisions" section (capability `desktop-app`, Requirements: Decision
 * Artifacts — Population of the Canvas from Didactic-Check Outcomes; Decisions
 * Section Visible Across the Three CBL Phase Views).
 *
 * A fourth top-level container alongside the three CBL-phase accordions. It opens
 * INDEPENDENTLY — its own boolean state, orthogonal to the phase accordion's
 * one-at-a-time constraint — so the lecturer can keep a phase and Decisions open
 * together. Populated from the VISIBLE conversation's `didacticChecks` slice, which
 * the store projects into the top-level mirror like `artifacts` / `steps` /
 * `maturity` — a course without recorded decisions renders the empty state, never
 * another course's entries. Cold start is empty; a resume seeds it from that
 * course's own JSON sidecar.
 */

function Citation({ token }: { token: string }) {
  return (
    <div className="decision-citation">
      <code className="mono">{token}</code>
    </div>
  );
}

/** Reset badge shown when an upstream goal revision invalidated this entry (goal-revision propagation). */
function ResetBadge() {
  return <span className="decision-reset">{useChrome().decisionsResetBadge}</span>;
}

function ModuleGoals({ checks }: { checks: DidacticChecks }) {
  const t = useChrome();
  const k = checks.kompetenz;
  return (
    <div className="decision-entry" data-entry="module-goals">
      <div className="decision-entry-head">
        <span className="artifact-label mono">{t.decisionsModuleGoals}</span>
        <span className="artifact-state mono">
          <span className="st-dot" />
          {k.status}
        </span>
      </div>
      {k.goals.length === 0 ? (
        <div className="artifact-value muted">{t.decisionsNoGoals}</div>
      ) : (
        k.goals.map((g) => (
          <div key={g.id} className="decision-goal">
            <div className="artifact-value">{g.text}</div>
            <span className={`sharpness-flag sharpness-${g.sharpness}`}>{g.sharpness}</span>
            {(g.citations ?? []).map((c, i) => (
              <Citation key={i} token={c} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function AlignmentStatus({ checks, invalidated }: { checks: DidacticChecks; invalidated: boolean }) {
  const t = useChrome();
  const a = checks.alignment;
  return (
    <div className="decision-entry" data-entry="alignment-status">
      <div className="decision-entry-head">
        <span className="artifact-label mono">{t.decisionsAlignmentStatus}</span>
        <span className="artifact-state mono">
          <span className="st-dot" />
          {a.status}
        </span>
        {invalidated && <ResetBadge />}
      </div>
      {a.findings.length === 0 ? (
        <div className="artifact-value muted">{invalidated ? t.decisionsAlignmentReset : t.decisionsNoAlignment}</div>
      ) : (
        a.findings.map((f, i) => (
          <div key={i} className="decision-finding" data-status={f.status}>
            <span className="artifact-label mono">{f.goalId}</span>
            <span className={`alignment-flag alignment-${f.status}`}>{f.status}</span>
            {f.pattern && <div className="artifact-value">{f.pattern}</div>}
            {f.affectedArtifact && (
              <a className="decision-deeplink" href={`#${f.affectedArtifact}`} data-target={f.affectedArtifact}>
                → {f.affectedArtifact}
              </a>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function DelegationDecisions({ checks, invalidated }: { checks: DidacticChecks; invalidated: boolean }) {
  const t = useChrome();
  const d = checks.delegation;
  return (
    <div className="decision-entry" data-entry="delegation-decisions">
      <div className="decision-entry-head">
        <span className="artifact-label mono">{t.decisionsDelegation}</span>
        <span className="artifact-state mono">
          <span className="st-dot" />
          {d.status}
        </span>
        {invalidated && <ResetBadge />}
      </div>
      {d.decisions.length === 0 ? (
        <div className="artifact-value muted">{invalidated ? t.decisionsDelegationReset : t.decisionsNoDelegation}</div>
      ) : (
        d.decisions.map((dec, i) => (
          <div key={i} className="decision-delegation">
            <div className="decision-delegation-top">
              <span className="artifact-label mono">{dec.component}</span>
              <span className={`delegation-status delegation-${dec.status}`}>{dec.status}</span>
            </div>
            <div className="artifact-value">{dec.reasoning}</div>
            {dec.inconsistencyFlag && (
              <div className="decision-flag">
                <ActionIcon kind="warning" label={t.decisionsWarningLabel} /> {dec.inconsistencyFlag}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** Heterogeneity Notes. */
function HeterogeneityNotes({ checks }: { checks: DidacticChecks }) {
  const t = useChrome();
  const h = checks.heterogeneity;
  if (!h?.fired) return null;
  return (
    <div className="decision-entry" data-entry="heterogeneity-notes">
      <div className="decision-entry-head">
        <span className="artifact-label mono">{t.decisionsHeterogeneity}</span>
      </div>
      <div className="artifact-value">{h.notes ?? t.decisionsEmptyValue}</div>
    </div>
  );
}

/** Soft-Skill Anchors. */
function SoftSkillAnchors({ checks }: { checks: DidacticChecks }) {
  const t = useChrome();
  const s = checks.softSkill;
  if (!s?.fired) return null;
  return (
    <div className="decision-entry" data-entry="soft-skill-anchors">
      <div className="decision-entry-head">
        <span className="artifact-label mono">{t.decisionsSoftSkill}</span>
      </div>
      {(s.anchors ?? []).map((a, i) => (
        <div key={i} className="decision-anchor">
          <span className="artifact-label mono">{a.goal}</span>
          {a.anchor ? (
            <span className="anchor-value">{a.anchor}</span>
          ) : (
            <span className="anchor-missing">{t.decisionsMissingAnchor}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Whether anything has actually been recorded. An untouched check state renders the
 * honest empty state instead of a scaffold of "not-started" rows — and demo content is
 * never a lecturer-facing value (Requirement: Decision Artefacts Are Per-Conversation
 * State; Collected UX-2 Fixes). */
function hasAnyDecision(checks: DidacticChecks): boolean {
  if (checks.kompetenz.goals.length > 0) return true;
  if (checks.alignment.findings.length > 0) return true;
  if (checks.delegation.decisions.length > 0) return true;
  if (checks.heterogeneity?.fired) return true;
  if (checks.softSkill?.fired) return true;
  return false;
}

export function DecisionsSection() {
  const t = useChrome();
  const checks = useCbe((s) => s.didacticChecks);
  const invalidatedChecks = useCbe((s) => s.invalidatedChecks);
  const [open, setOpen] = useState(false);
  const isInvalid = (c: CheckName) => invalidatedChecks.includes(c);

  return (
    <div className="phase-group decisions-section">
      <button
        type="button"
        className="phase-head decisions-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="phase-name">{t.decisionsHeading}</span>
        <span className="phase-chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && hasAnyDecision(checks) && (
        <div className="phase-body decisions-body">
          <ModuleGoals checks={checks} />
          <AlignmentStatus checks={checks} invalidated={isInvalid("alignment")} />
          <DelegationDecisions checks={checks} invalidated={isInvalid("delegation")} />
          <HeterogeneityNotes checks={checks} />
          <SoftSkillAnchors checks={checks} />
        </div>
      )}
      {open && !hasAnyDecision(checks) && (
        <div className="phase-body decisions-body decisions-empty">
          <p className="panel-intro">{t.decisionsEmpty}</p>
        </div>
      )}
    </div>
  );
}
