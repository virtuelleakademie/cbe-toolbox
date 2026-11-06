import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useChrome } from "../chrome.js";
import { isInteractiveCard, isPhantomToolItem, type ActivityItem } from "../state/activity.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCard, isRenderablePickerCard } from "./ToolCard.js";

export function passiveDetailItems(items: readonly ActivityItem[]): ActivityItem[] {
  return items.filter((item) => {
    if (item.kind === "text" || isPhantomToolItem(item)) return false;
    if (!isInteractiveCard(item)) return true;
    // A Picker the lecturer cannot answer is technical self-correction, not an
    // interaction. Keep it inspectable here until the run either replaces it
    // with a valid Picker or ends terminally unresolved.
    return item.kind === "tool" && item.data.toolName === "cbe_picker" && !isRenderablePickerCard(item.data);
  });
}

/**
 * The one current-turn technical disclosure. Its closed state deliberately does
 * not mount the passive detail subtree: visual hiding would leave tool/reasoning
 * content in DOM text, attributes and accessibility output.
 */
export function WorkingDisclosure({
  items,
  answerVisible = false,
}: {
  items: readonly ActivityItem[];
  answerVisible?: boolean;
}) {
  const t = useChrome();
  const [open, setOpen] = useState(false);
  const [retained, setRetained] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const details = passiveDetailItems(items);

  const close = () => {
    const focusWasInside = panelRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (focusWasInside) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  // Escape is handled on the WRAPPER, not on the panel: opening deliberately does
  // not move focus, so the default post-open focus position is the trigger — a
  // panel-only handler would leave Escape inert exactly there.
  const onWrapperKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  // Visible prose becomes the progress surface for the default closed path. A
  // lecturer who deliberately opened technical detail keeps one pinned wrapper
  // for the rest of the active run, so streaming never removes a focused control.
  if (answerVisible && !retained) return null;

  return (
    <div className="working-disclosure" onKeyDown={onWrapperKeyDown}>
      <span className="visually-hidden working-disclosure-status" role="status" aria-live="polite" aria-atomic="true">
        {t.chatWorkingDisclosureLabel}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="working-disclosure-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setRetained(true);
          setOpen(true);
        }}
      >
        <span className="stream-grid" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} className="stream-dot" style={{ animationDelay: `${index * 80}ms` }} />
          ))}
        </span>
        <span className="working-disclosure-label">{t.chatWorkingDisclosureLabel}</span>
        <svg className="working-disclosure-chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path
            d={open ? "M2.5 7.5 6 4l3.5 3.5" : "M2.5 4.5 6 8l3.5-3.5"}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="working-disclosure-panel"
          role="region"
          aria-label={t.chatWorkingDetailLabel}
        >
          {details.length === 0 ? (
            <div className="working-disclosure-empty">{t.chatWorkingDetailEmpty}</div>
          ) : (
            details.map((item) =>
              item.kind === "tool" ? (
                <ToolCard key={`tool-${item.id}`} card={item.data} technicalDetail />
              ) : item.kind === "thinking" ? (
                <ThinkingBlock key={`th-${item.id}`} block={item.data} initiallyOpen />
              ) : null
            )
          )}
        </div>
      )}
    </div>
  );
}
