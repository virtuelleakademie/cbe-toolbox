/**
 * Tests for the `/` slash-command autocomplete (capability `desktop-app`,
 * Requirement: Slash Commands via Pi-First Architecture).
 *
 * Covers the spec scenario *Composer `/` autocomplete shows pi built-ins and
 * extension commands* plus the keyboard model (Arrow / Enter / Esc) and
 * mouse selection.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SlashAutocomplete } from "../src/renderer/components/SlashAutocomplete.js";
import type { SlashCommand } from "../src/shared/ipc-contract.js";

const COMMANDS: SlashCommand[] = [
  { name: "compact", source: "prompt", description: "Compact the context" },
  { name: "new", source: "prompt" },
  { name: "session", source: "prompt" },
  { name: "cite", source: "extension", description: "Insert a corpus citation" },
];

afterEach(() => cleanup());

describe("SlashAutocomplete", () => {
  it("shows pi built-ins and extension commands, each tagged with its source", () => {
    render(<SlashAutocomplete commands={COMMANDS} query="" onAccept={() => {}} onClose={() => {}} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    // built-in compact rendered with a "pi" source tag; extension cite with "app".
    expect(screen.getByText("/compact")).toBeTruthy();
    expect(screen.getByText("/cite")).toBeTruthy();
    // The retired /mode command never surfaces.
    expect(screen.queryByText("/mode")).toBeNull();
    const appTags = document.querySelectorAll(".slash-source-app");
    const piTags = document.querySelectorAll(".slash-source-pi");
    expect(appTags.length).toBe(1); // cite
    expect(piTags.length).toBe(3); // compact, new, session
    // descriptions surface where present
    expect(screen.getByText("Insert a corpus citation")).toBeTruthy();
  });

  it("filters by the query prefix", () => {
    render(<SlashAutocomplete commands={COMMANDS} query="c" onAccept={() => {}} onClose={() => {}} />);
    const names = screen.getAllByRole("option").map((o) => o.querySelector(".slash-name")!.textContent);
    expect(names).toEqual(["/compact", "/cite"]);
  });

  it("renders nothing when the query matches no command", () => {
    const { container } = render(
      <SlashAutocomplete commands={COMMANDS} query="zzz" onAccept={() => {}} onClose={() => {}} />
    );
    expect(container.querySelector(".slash-autocomplete")).toBeNull();
  });

  it("ArrowDown then Enter accepts the highlighted command", () => {
    const onAccept = vi.fn();
    render(<SlashAutocomplete commands={COMMANDS} query="" onAccept={onAccept} onClose={() => {}} />);
    fireEvent.keyDown(document, { key: "ArrowDown" }); // active: 0 → 1 (new)
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]![0].name).toBe("new");
  });

  it("ArrowUp wraps to the last command", () => {
    const onAccept = vi.fn();
    render(<SlashAutocomplete commands={COMMANDS} query="" onAccept={onAccept} onClose={() => {}} />);
    fireEvent.keyDown(document, { key: "ArrowUp" }); // active: 0 → 4 (cite)
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onAccept.mock.calls[0]![0].name).toBe("cite");
  });

  it("Esc calls onClose", () => {
    const onClose = vi.fn();
    render(<SlashAutocomplete commands={COMMANDS} query="" onAccept={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking (mousedown) an option accepts it", () => {
    const onAccept = vi.fn();
    render(<SlashAutocomplete commands={COMMANDS} query="ci" onAccept={onAccept} onClose={() => {}} />);
    fireEvent.mouseDown(screen.getByText("/cite"));
    expect(onAccept.mock.calls[0]![0].name).toBe("cite");
  });
});
