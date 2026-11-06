import { useEffect, useState } from "react";
import { useCbe } from "../state/store.js";
import {
  DIMENSION_SCALES,
  PROFILE_DIMENSIONS,
  type DimensionRecord,
  type ProfileDimension,
} from "@cbe/pi-bridge/lecturer-profile";
import { LECTURER_IDENTITY_MAX_LENGTH } from "@cbe/pi-bridge/lecturer-identity";
import { useChrome } from "../chrome.js";
import type { ChromeCatalogue, ChromeStringKey } from "../../shared/i18n/index.js";

/**
 * The Profile surface (capability `desktop-app`, Requirement: Profile Panel).
 * No longer a right-panel tab: it is reached from the header's user affordance.
 *
 * Renders the five lecturer-state dimensions from the live store slice: value,
 * confidence, evidence pointer, provenance badge, last-revised. Hydrates from the
 * persisted per-lecturer record on mount; live updates arrive through the
 * `cbe_profile` tool-call consumer in ChatPanel. The per-dimension select submits
 * a manual override via IPC — the round-trip result replaces the slice, so the
 * panel always shows exactly what is stored.
 */

const DIMENSION_LABEL_KEYS: Record<ProfileDimension, ChromeStringKey> = {
  "pbl-prior-knowledge": "profileDimensionPblPriorKnowledge",
  "cbe-prior-knowledge": "profileDimensionCbePriorKnowledge",
  "didactic-stance": "profileDimensionDidacticStance",
  attitude: "profileDimensionAttitude",
  capacity: "profileDimensionCapacity",
};

function dimensionLabel(dimension: ProfileDimension, t: ChromeCatalogue): string {
  return t[DIMENSION_LABEL_KEYS[dimension]] as string;
}

export function ProfilePanel() {
  const t = useChrome();
  const profile = useCbe((s) => s.lecturerProfile);
  const setProfile = useCbe((s) => s.setLecturerProfile);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the persisted record on mount (panel renders the stored profile
  // on app start; an empty record is the legitimate cold-start state).
  useEffect(() => {
    let cancelled = false;
    void window.cbe
      .getLecturerProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        /* cold start view stays — the panel never crashes on a missing record */
      });
    return () => {
      cancelled = true;
    };
  }, [setProfile]);

  async function override(dimension: ProfileDimension, value: string) {
    setError(null);
    try {
      const res = await window.cbe.overrideLecturerProfile({ dimension, value });
      setProfile(res.profile);
      if (!res.ok) setError(t.profileOverrideRejected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="profile-panel">
      {/* The section's own content group. It carries the overlay's established
          group inset — without it the dimension rows' selects and badges sit
          flush against the surface edge while the sibling Settings section keeps
          its margin (`profile-overlay-inset.test.tsx`). */}
      <div className="profile-body">
        {/* The lecturer's OWN statement about themselves, structurally separate from
            the estimated dimensions below and never a row inside them. */}
        <LecturerIdentityFields />
        <div className="profile-dimensions" data-testid="profile-dimensions">
          <h3 className="profile-group-heading">{t.profileReadingHeading}</h3>
          {/* The estimate framing belongs to THIS group and to nothing above it:
              stated any higher it would read as covering the lecturer's own two
              fields, which are not estimates (Requirement: Lecturer Identity in
              the User/Profile Area). */}
          <div className="profile-dimensions-intro">{t.profileReadingIntro}</div>
          {/* Set only by `override()`, so it sits with the dropdowns that produce
              it. Above this group it would raise an alert beside the lecturer's
              own two fields about a rejection that has nothing to do with them. */}
          {error && (
            <div className="profile-error" role="alert">
              {error}
            </div>
          )}
          {PROFILE_DIMENSIONS.map((dim) => (
            <DimensionRow
              key={dim}
              dimension={dim}
              record={profile[dim]}
              onOverride={(value) => void override(dim, value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The lecturer's identity fields (capability `desktop-app`, Requirement: Lecturer
 * Identity in the User/Profile Area) — name and preferred form of address, both
 * optional and independent.
 *
 * NOT A SIXTH DIMENSION, and the surface has to make that legible. The two fields
 * live in their own group with their own heading, above and outside the dimension
 * list; they carry no confidence badge, no evidence pointer, no provenance marking
 * and no "estimated by the assistant" affordance, because nothing about them is an
 * estimate. Nothing here presents an empty field as an incomplete profile: there is
 * no warning, no completion meter and no prompt to fill them in — leaving both empty
 * is a normal choice and stays the product's unchanged behaviour.
 *
 * The chrome follows the configured interface language; the VALUES are the lecturer's own words
 * in their own language and are stored and redisplayed exactly as entered. No
 * pattern constraint, no Latin-only restriction, no case normalisation — a form of
 * address is a phrase in the lecturer's language, not a structured field.
 *
 * What is shown after a save is what the round-trip RETURNED, never the raw input:
 * an optimistic redisplay would show an unsaved edit as saved.
 */
export function LecturerIdentityFields() {
  const t = useChrome();
  const [name, setName] = useState("");
  const [formOfAddress, setFormOfAddress] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.cbe
      .getLecturerIdentity()
      .then((identity) => {
        if (cancelled) return;
        setName(identity.name ?? "");
        setFormOfAddress(identity.formOfAddress ?? "");
      })
      .catch(() => {
        /* nothing recorded is the normal state — the empty fields stay */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refused AT INPUT with a visible reason, never silently truncated: no `maxLength`
  // on the inputs (that would swallow the characters as they are typed) and the save
  // is blocked while the value is over the documented maximum.
  const tooLong =
    name.trim().length > LECTURER_IDENTITY_MAX_LENGTH || formOfAddress.trim().length > LECTURER_IDENTITY_MAX_LENGTH;

  async function save() {
    setError(null);
    setStatus(null);
    if (tooLong) {
      setError(t.profileTooLongNothingSaved({ max: LECTURER_IDENTITY_MAX_LENGTH }));
      return;
    }
    try {
      const res = await window.cbe.setLecturerIdentity({ name, formOfAddress });
      if (res.ok) {
        // Redisplay the STORED record, not the input that produced it.
        setName(res.identity.name ?? "");
        setFormOfAddress(res.identity.formOfAddress ?? "");
        setStatus(t.profileSaved);
      } else {
        // A refusal stored nothing, so the typed text stays in the fields — it is
        // the only copy that exists.
        setError(
          res.reason === "too-long"
            ? t.profileTooLongNothingSaved({ max: LECTURER_IDENTITY_MAX_LENGTH })
            : t.profileSaveFailed
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="profile-identity" data-testid="profile-identity">
      <h3 className="profile-group-heading">{t.profileIdentityHeading}</h3>
      <div className="profile-identity-intro">{t.profileIdentityIntro}</div>
      <label className="profile-identity-field">
        <span className="profile-identity-label">{t.profileNameLabel}</span>
        <input
          type="text"
          value={name}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value);
            setStatus(null);
            setError(null);
          }}
        />
      </label>
      <label className="profile-identity-field">
        <span className="profile-identity-label">{t.profileFormOfAddressLabel}</span>
        <input
          type="text"
          value={formOfAddress}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setFormOfAddress(e.target.value);
            setStatus(null);
            setError(null);
          }}
        />
      </label>
      {tooLong && (
        <div className="profile-identity-error" role="alert">
          {t.profileTooLong({ max: LECTURER_IDENTITY_MAX_LENGTH })}
        </div>
      )}
      {error && (
        <div className="profile-identity-error" role="alert">
          {error}
        </div>
      )}
      {status && <div className="profile-identity-status">{status}</div>}
      <button type="button" className="profile-identity-save" disabled={tooLong} onClick={() => void save()}>
        {t.profileSave}
      </button>
    </section>
  );
}

function DimensionRow({
  dimension,
  record,
  onOverride,
}: {
  dimension: ProfileDimension;
  record: DimensionRecord | undefined;
  onOverride: (value: string) => void;
}) {
  const t = useChrome();
  const overridden = record?.provenance === "override";
  return (
    <section className="profile-dim" data-dimension={dimension} data-overridden={overridden || undefined}>
      <div className="profile-dim-head">
        <span className="profile-dim-label">{dimensionLabel(dimension, t)}</span>
        {record ? (
          <span className={`profile-badge mono ${overridden ? "profile-badge-override" : ""}`}>
            {overridden ? t.profileOverriddenBadge : t.profileConfidenceBadge({ confidence: record.confidence })}
          </span>
        ) : (
          <span className="profile-badge mono profile-badge-empty">{t.profileNotEstimatedBadge}</span>
        )}
      </div>
      {record && !overridden && (
        // Estimate provenance = an inferred assumption, not a fixed fact — and
        // this select is exactly where the lecturer overrides it. Override rows
        // carry "set by you" instead; this note is the estimate-only counterpart
        // (Requirement: Inferred Calibration Framed as an Overridable Assumption).
        <div className="profile-dim-assumption">{t.profileAssumptionNote}</div>
      )}
      <label className="profile-dim-control">
        <select
          value={record?.value ?? ""}
          data-empty={record ? undefined : true}
          aria-label={t.profileOverrideSelectLabel({ dimension: dimensionLabel(dimension, t) })}
          onChange={(e) => {
            if (e.target.value) onOverride(e.target.value);
          }}
        >
          {!record && (
            <option value="" disabled>
              {t.profileChooseManually}
            </option>
          )}
          {DIMENSION_SCALES[dimension].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {record && (
        <div className="profile-dim-meta">
          <span className="profile-evidence" title={record.evidence}>
            {record.evidence}
          </span>
          <span className="profile-revised mono">{t.profileLastRevised({ stamp: record.lastRevised })}</span>
        </div>
      )}
    </section>
  );
}
