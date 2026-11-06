import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { catalogueFor, interfaceLanguageOptions } from "../../shared/i18n/index.js";
import { setActiveLanguage, useChrome, useInterfaceLanguage } from "../chrome.js";
import { useCbe } from "../state/store.js";

const VIEWPORT_GUTTER = 8;
const POPUP_WIDTH = 180;
const TYPEAHEAD_RESET_MS = 1_000;
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visibleTabStops(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) => element.closest("[hidden]") === null && element.getAttribute("role") !== "option"
  );
}

/**
 * Compact second route to the main-owned interface-language setting.
 *
 * Open/focus/pending state is transient interaction state only. The applied value
 * still comes exclusively from `useInterfaceLanguage()`, whose one application-level
 * subscription is wired in `main.tsx`; a choice is never painted optimistically.
 */
export function HeaderLanguageDropdown() {
  const t = useChrome();
  const language = useInterfaceLanguage();
  const overlaySection = useCbe((state) => state.overlaySection);
  const options = interfaceLanguageOptions();
  const active = catalogueFor(language);
  const listboxId = useId();
  const feedbackId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openRef = useRef(false);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});

  openRef.current = open;

  const close = useCallback((returnFocus: boolean) => {
    openRef.current = false;
    setOpen(false);
    typeaheadRef.current = "";
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const openPopup = useCallback(() => {
    const appliedIndex = Math.max(
      0,
      options.findIndex((option) => option.code === language)
    );
    setFailed(false);
    setFocusIndex(appliedIndex);
    openRef.current = true;
    setOpen(true);
  }, [language, options]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(POPUP_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2));
      const left = Math.min(
        Math.max(VIEWPORT_GUTTER, rect.right - width),
        Math.max(VIEWPORT_GUTTER, window.innerWidth - VIEWPORT_GUTTER - width)
      );
      const top = rect.bottom + 4;
      setPopupStyle({
        left,
        top,
        width,
        maxHeight: Math.max(0, window.innerHeight - top - VIEWPORT_GUTTER),
      });
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const option = optionRefs.current[focusIndex];
    option?.focus();
    option?.scrollIntoView?.({ block: "nearest" });
  }, [focusIndex, open]);

  useLayoutEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || rootRef.current?.contains(target)) return;
      const focusable = target instanceof Element ? target.closest<HTMLElement>(TABBABLE) : null;
      close(!focusable);
    }

    function onFocusIn(event: FocusEvent) {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !rootRef.current?.contains(target)) close(false);
    }

    function onWindowBlur() {
      close(false);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [close, open]);

  useEffect(() => {
    if (overlaySection !== null && openRef.current) close(false);
  }, [close, overlaySection]);

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    },
    []
  );

  function moveFocus(next: number) {
    const wrapped = (next + options.length) % options.length;
    setFocusIndex(wrapped);
  }

  function leaveWithTab(backwards: boolean) {
    const trigger = triggerRef.current;
    close(false);
    if (!trigger) return;
    const stops = visibleTabStops();
    const triggerIndex = stops.indexOf(trigger);
    const destination = stops[triggerIndex + (backwards ? -1 : 1)];
    if (destination) destination.focus();
    else trigger.blur();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(focusIndex + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setFocusIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const focusedCode =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>("[data-language]")?.dataset.language
          : null;
      void commit(focusedCode ?? options[focusIndex]!.code);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      leaveWithTab(event.shiftKey);
      return;
    }
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;

    typeaheadRef.current += event.key.toLocaleLowerCase();
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadRef.current = "";
    }, TYPEAHEAD_RESET_MS);
    const match = options.findIndex((option) => option.endonym.toLocaleLowerCase().startsWith(typeaheadRef.current));
    if (match >= 0) {
      event.preventDefault();
      setFocusIndex(match);
    }
  }

  async function commit(code: string) {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const result = await window.cbe.setInterfaceLanguage(code);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setActiveLanguage(result.language);
      const focusStillOurs = !!rootRef.current?.contains(document.activeElement);
      close(focusStillOurs);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={rootRef} className="header-language">
      <button
        ref={triggerRef}
        type="button"
        className="header-language-trigger"
        aria-label={t.headerLanguageAccessibleName({ language: active.endonym, code: active.code.toUpperCase() })}
        title={t.headerLanguageLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-busy={pending || undefined}
        aria-describedby={pending || failed ? feedbackId : undefined}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openPopup();
          }
        }}
        onClick={() => {
          if (open) close(true);
          else openPopup();
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="header-language-globe">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
        </svg>
        <span>{active.code.toUpperCase()}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="header-language-chevron">
          <path d="m2.5 4.25 3.5 3.5 3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div
          id={listboxId}
          className="header-language-listbox"
          role="listbox"
          aria-label={t.headerLanguageLabel}
          aria-busy={pending || undefined}
          style={popupStyle}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <button
              key={option.code}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              lang={option.code}
              data-language={option.code}
              tabIndex={focusIndex === index ? 0 : -1}
              aria-selected={language === option.code}
              aria-disabled={pending || undefined}
              onFocus={() => setFocusIndex(index)}
              onClick={() => void commit(option.code)}
            >
              <span>{option.endonym}</span>
              {language === option.code && (
                <svg aria-hidden="true" viewBox="0 0 16 16" className="header-language-check">
                  <path d="m3 8 3 3 7-7" />
                </svg>
              )}
            </button>
          ))}
          {failed && (
            <span id={feedbackId} className="header-language-feedback" role="status">
              {t.headerLanguageFailure}
            </span>
          )}
        </div>
      )}
      {(pending || (failed && !open)) && (
        <span id={feedbackId} className="visually-hidden" role="status">
          {failed ? t.headerLanguageFailure : t.headerLanguageBusy}
        </span>
      )}
    </div>
  );
}
