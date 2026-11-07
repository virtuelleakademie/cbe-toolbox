---
pageId: accessibility-keyboard
locale: en
appVersion: 0.1.23
---

# Accessibility and keyboard

Keyboard, focus, status and zoom behaviour in CBE Toolbox.

<a id="keyboard"></a>

<!-- topic:keyboard -->

## Keyboard operation

- In the composer, **Enter** sends and **Shift+Enter** inserts a newline. Cmd+Enter and Ctrl+Enter also send. Input-method composition is respected, so confirming composed text does not accidentally send.
- Use **Tab/Shift+Tab** to move through ordinary controls. Activation uses Enter or Space according to the control.
- The composer `+` menu, header language selector, panel disclosures, settings/profile overlay and Picker are keyboard-operable.
- The native application menu follows platform conventions: settings uses `Cmd+,` on macOS and `Ctrl+,` on Windows/Linux, Help uses `F1`, and the Edit/View/Window items provide native editing, zoom, full-screen and window actions.
- **Escape** closes the currently open menu, language list, disclosure, panel layer or overlay where that surface owns Escape, and returns focus to its trigger when appropriate. The language list also supports arrow movement, Home/End and typeahead.
- In a Picker, Tab/Shift+Tab moves between choices, Space or Enter selects, and Escape leaves the focused choice. The free-text choice accepts typing and Enter submission.
- **Escape does not stop an answer.** Move focus to the square Stop control and activate it. This prevents a global Escape press from destroying work while you are dismissing another surface.
<!-- ui:send-stop -->

The app does not advertise a global shortcut palette. If a path above does not work, use the focused on-screen control and report the visible failure rather than guessing an undocumented key.

<a id="focus-and-status"></a>

<!-- topic:focus-and-status -->

## Focus, names and non-colour status

Keyboard focus is visibly outlined. Closing a popup or overlay returns focus locally where appropriate; selecting a Course moves focus into the matching workspace rather than leaving it on a hidden control. Opening the first-use card does not steal focus.

The official PIONEER Alliance control in the information group is a keyboard-focusable link whose description says it opens the system browser; a failed open leaves focus and the app in place for a retry.

Primary icon controls carry accessible names. Running work is exposed as a text status and the composer changes to a separately named Stop control; colour is not the only signal. Maturity uncertainty/staleness, the active Course, selected language, selected Picker choices and open disclosures also carry text, state or accessible semantics in addition to colour. Chat turn roles remain available to assistive technology even when the visual role label is hidden.

<a id="zoom-and-native"></a>

<!-- topic:zoom-and-native -->

## Text size, narrow widths, zoom and native dialogs

The appearance settings provide chat text size. The app-owned layout is designed to remain usable at the supported narrow width of **775 CSS pixels** and at **200% browser-equivalent zoom**, including the first-use card, transcript and composer. Side panels can collapse to preserve the centre conversation.

Operating-system file pickers, installer windows and security prompts follow your operating system's keyboard and screen-reader behaviour. Use the accessibility guidance for your operating system.

If focus becomes trapped or content overlaps at your text/zoom setting, preserve the Course, record OS/version, window size, text setting and the focused control, then follow [What to share with support](troubleshooting-and-reference.md#support-sharing).
