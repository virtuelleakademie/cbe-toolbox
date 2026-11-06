/**
 * The editing surface for the lecturer's identity (capability `desktop-app`,
 * Requirement: *Lecturer Identity in the User/Profile Area*). One test per spec
 * scenario; the test names mirror the scenario headings.
 *
 * jsdom + @testing-library/react; the preload bridge is stubbed in vitest.setup.ts
 * and overridden per test.
 *
 * The scenario that carries the most weight is *The fields are not shown as a
 * dimension*: the whole difficulty of this change is that a name must not read as a
 * sixth estimated dimension, and the surface is where that confusion would land.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ProfilePanel } from "../src/renderer/components/ProfilePanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { LECTURER_IDENTITY_MAX_LENGTH } from "@cbe/pi-bridge/lecturer-identity";
import type { LecturerIdentity, LecturerIdentitySetPayload } from "../src/shared/ipc-contract.js";

beforeEach(() => {
  useCbe.setState({ lecturerProfile: {} });
});

/** A stub host that stores what it is given, normalising exactly as the real store
 *  does (empty / whitespace-only clears the field), so the panel is tested against
 *  the round-trip it will really see. */
function installStore(initial: LecturerIdentity = {}) {
  let record: LecturerIdentity = { ...initial };
  const set = vi.fn(async (payload: LecturerIdentitySetPayload) => {
    const next: LecturerIdentity = {};
    const name = (payload.name ?? "").trim();
    const formOfAddress = (payload.formOfAddress ?? "").trim();
    if (name.length > LECTURER_IDENTITY_MAX_LENGTH || formOfAddress.length > LECTURER_IDENTITY_MAX_LENGTH) {
      return { ok: false as const, identity: record, reason: "too-long" as const };
    }
    if (name) next.name = name;
    if (formOfAddress) next.formOfAddress = formOfAddress;
    record = next;
    return { ok: true as const, identity: record };
  });
  Object.assign(window.cbe, {
    getLecturerIdentity: async () => record,
    setLecturerIdentity: set,
  });
  return { set, current: () => record };
}

const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;
const addressInput = () => screen.getByLabelText("Preferred form of address") as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("Lecturer Identity in the User/Profile Area", () => {
  // Scenario: The lecturer records both fields
  it("persists both fields and redisplays exactly the stored values after the round-trip", async () => {
    const host = installStore();
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput()).toBeTruthy());

    // Trailing whitespace on the way in; the surface must show what came BACK.
    fireEvent.change(nameInput(), { target: { value: "Anna Béringer-Oduya  " } });
    fireEvent.change(addressInput(), { target: { value: "Frau Prof. Béringer" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(host.current()).toEqual({
        name: "Anna Béringer-Oduya",
        formOfAddress: "Frau Prof. Béringer",
      })
    );
    await waitFor(() => expect(nameInput().value).toBe("Anna Béringer-Oduya"));
    expect(addressInput().value).toBe("Frau Prof. Béringer");
  });

  // Scenario: One field alone is a valid state
  it("saves one field alone with no validation error and no completion warning", async () => {
    const host = installStore();
    render(<ProfilePanel />);
    await waitFor(() => expect(addressInput()).toBeTruthy());

    fireEvent.change(addressInput(), { target: { value: "just Sam" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(host.current()).toEqual({ formOfAddress: "just Sam" }));
    expect(nameInput().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    // Nothing anywhere calls the half-filled record incomplete.
    expect(document.body.textContent).not.toMatch(/incomplete|required|missing|complete your profile/i);
  });

  // Scenario: Clearing a field removes it
  it("clears a previously recorded field and leaves the other untouched", async () => {
    const host = installStore({ name: "Sam Oyelaran", formOfAddress: "just Sam" });
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput().value).toBe("Sam Oyelaran"));

    // Whitespace-only is equivalent to empty.
    fireEvent.change(addressInput(), { target: { value: "   " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(host.current()).toEqual({ name: "Sam Oyelaran" }));
    // No empty value survives to be rendered: the field comes back genuinely empty.
    await waitFor(() => expect(addressInput().value).toBe(""));
    expect(nameInput().value).toBe("Sam Oyelaran");
  });

  // Scenario: The fields are not shown as a dimension
  it("keeps the two fields out of the dimension list and free of estimate affordances", async () => {
    installStore({ name: "Sam Oyelaran" });
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput().value).toBe("Sam Oyelaran"));

    const identity = screen.getByTestId("profile-identity");
    const dimensions = screen.getByTestId("profile-dimensions");

    // Structurally separate: neither contains the other, and the fields appear in no
    // position within the dimension list.
    expect(identity.contains(dimensions)).toBe(false);
    expect(dimensions.contains(identity)).toBe(false);
    expect(dimensions.querySelectorAll(".profile-dim")).toHaveLength(5);
    expect(dimensions.textContent).not.toContain("Sam Oyelaran");
    expect(dimensions.querySelector("input")).toBeNull();

    // No confidence, evidence, provenance or override affordance anywhere near them.
    expect(identity.querySelector(".profile-badge")).toBeNull();
    expect(identity.querySelector(".profile-dim-assumption")).toBeNull();
    expect(identity.querySelector("select")).toBeNull();
    expect(identity.textContent).not.toMatch(/confidence|evidence|provenance|override|set by you|estimat/i);
  });

  // Scenario: The fields are not shown as a dimension (adjacency half)
  it("keeps the estimate framing inside the dimension group, never above the fields", () => {
    installStore({ name: "Sam Oyelaran" });
    render(<ProfilePanel />);

    const identity = screen.getByTestId("profile-identity");
    const dimensions = screen.getByTestId("profile-dimensions");

    // The estimate framing describes the dimensions and lives with them. Stated
    // any higher in the panel it would sit immediately above the lecturer's own
    // two fields and read as covering them.
    const framing = screen.getByText(/Estimates come from the conversation/);
    expect(dimensions.contains(framing)).toBe(true);
    expect(identity.contains(framing)).toBe(false);

    // Nothing about estimates precedes the identity group in document order.
    const panel = document.querySelector(".profile-panel")!;
    for (const node of Array.from(panel.children)) {
      if (node.contains(identity)) break;
      expect(node.textContent ?? "").not.toMatch(/estimat/i);
    }
    const body = identity.parentElement!;
    for (const node of Array.from(body.children)) {
      if (node === identity || node.contains(identity)) break;
      expect(node.textContent ?? "").not.toMatch(/estimat/i);
    }
  });

  // Scenario: An empty identity is not flagged as incomplete
  it("presents an unrecorded identity as optional and empty, with no warning or meter", async () => {
    installStore();
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput()).toBeTruthy());

    expect(nameInput().value).toBe("");
    expect(addressInput().value).toBe("");
    const identity = screen.getByTestId("profile-identity");
    expect(identity.textContent).toMatch(/optional/i);
    expect(identity.textContent).toMatch(/leaving them empty is a normal choice/i);
    expect(identity.querySelector('[role="alert"]')).toBeNull();
    expect(identity.querySelector("progress")).toBeNull();
    expect(identity.textContent).not.toMatch(/incomplete|please (enter|fill)|required|% complete/i);
    // Nothing marks the empty inputs as invalid or required.
    expect(nameInput().required).toBe(false);
    expect(addressInput().required).toBe(false);
  });

  // Scenario: A non-English value is preserved exactly
  it("stores and redisplays a non-Latin, diacritic value byte-identically while the chrome stays English", async () => {
    const host = installStore();
    render(<ProfilePanel />);
    await waitFor(() => expect(addressInput()).toBeTruthy());

    const entered = "  Frau Prof. Dr. İnci Öztürk-Ñuñez ／ 教授  ";
    fireEvent.change(addressInput(), { target: { value: entered } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(host.current().formOfAddress).toBe(entered.trim()));
    await waitFor(() => expect(addressInput().value).toBe(entered.trim()));
    // No case normalisation, no transliteration, no pattern constraint, no Latin-only
    // restriction: a form of address is a phrase in the lecturer's language.
    expect(addressInput().value).toContain("İ");
    expect(addressInput().value).toContain("教授");
    expect(addressInput().getAttribute("pattern")).toBeNull();
    // The chrome around it stays English (repo convention).
    const identity = screen.getByTestId("profile-identity");
    expect(identity.querySelector(".profile-group-heading")?.textContent).toBe("How you would like to be addressed");
    expect(screen.getByText("Preferred form of address")).toBeTruthy();
  });

  // Scenario: An over-long value is refused, not truncated
  it("refuses an over-long value at input with a visible reason and stores nothing", async () => {
    const host = installStore({ name: "Sam" });
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput().value).toBe("Sam"));

    const overLong = "x".repeat(LECTURER_IDENTITY_MAX_LENGTH + 1);
    fireEvent.change(addressInput(), { target: { value: overLong } });

    // Refused AT INPUT: the reason is visible before any save is attempted…
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(new RegExp(`${LECTURER_IDENTITY_MAX_LENGTH} characters`));
    // …the value is NOT silently shortened as it is typed…
    expect(addressInput().value).toHaveLength(overLong.length);
    expect(addressInput().getAttribute("maxlength")).toBeNull();
    // …and nothing reaches the record.
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(saveButton());
    await waitFor(() => expect(host.set).not.toHaveBeenCalled());
    expect(host.current()).toEqual({ name: "Sam" });
  });

  // Scenario: A saved change reaches the running session
  it("persists immediately on save, without an app restart and without optimistic display", async () => {
    const host = installStore({ name: "Sam Oyelaran" });
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput().value).toBe("Sam Oyelaran"));

    fireEvent.change(nameInput(), { target: { value: "Dr. Sam Oyelaran" } });
    // Before the save the record is untouched — typing is not a write.
    expect(host.current()).toEqual({ name: "Sam Oyelaran" });

    fireEvent.click(saveButton());
    await waitFor(() => expect(host.set).toHaveBeenCalledTimes(1));
    // Persisted immediately; the running session is told at its next turn boundary by
    // the main process (`lecturer-identity-store.test.ts` covers that note).
    await waitFor(() => expect(host.current()).toEqual({ name: "Dr. Sam Oyelaran" }));
    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
  });

  it("keeps the typed text in the fields when the host refuses the write", async () => {
    // A refusal stored nothing, so the typed text is the only copy that exists —
    // replacing it with the previously stored record while reporting "nothing was
    // stored" would destroy the lecturer's input with no way to recover it.
    Object.assign(window.cbe, {
      getLecturerIdentity: async () => ({ name: "Sam Oyelaran" }),
      setLecturerIdentity: async () => ({ ok: false as const, identity: { name: "Sam Oyelaran" } }),
    });
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput().value).toBe("Sam Oyelaran"));

    fireEvent.change(nameInput(), { target: { value: "Dr. Sam Oyelaran" } });
    fireEvent.change(addressInput(), { target: { value: "just Sam" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/nothing was stored/i));
    expect(nameInput().value).toBe("Dr. Sam Oyelaran");
    expect(addressInput().value).toBe("just Sam");
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("shows what the host stored, not the input that produced it", async () => {
    // Same scenario, the anti-optimism half: a host that normalises differently from
    // the input must win the redisplay.
    Object.assign(window.cbe, {
      getLecturerIdentity: async () => ({}),
      setLecturerIdentity: async () => ({ ok: true as const, identity: { name: "stored by the host" } }),
    });
    render(<ProfilePanel />);
    await waitFor(() => expect(nameInput()).toBeTruthy());

    fireEvent.change(nameInput(), { target: { value: "typed by the lecturer" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(nameInput().value).toBe("stored by the host"));
  });
});
