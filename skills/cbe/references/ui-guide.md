<!--
  GENERATED FILE — DO NOT HAND-EDIT.
  Generated from the UI element registry (`*.ui-registry.ts` files colocated
  with the renderer components in `packages/app/src/renderer/`).
  Regenerate with `npm run ui:reference` after any registry change; a stale
  copy of this file fails the freshness test in packages/corpus-schema.

  The control labels below are the English catalogue's. The app renders its
  chrome in the lecturer's configured interface language, and the host-injected
  `app-ui reference` block carries the labels of the language actually running —
  that block is authoritative whenever it is present. A label read from THIS file
  may therefore not be the one on the lecturer's screen; say where a control is
  rather than quoting a label you cannot see.
-->

# CBE Toolbox — App UI Guide

What each documented lecturer-facing control of the desktop app is and how to use it. Grounding rules: answer app-UI help questions from the entries below, never from invented UI behaviour. An entry with an **Availability** line is gated on the named affordance — when the session's environment descriptor does not report that affordance `true`, do not present the control as available (conservative default, `references/environment-awareness.md`). A control with no entry here is undocumented — say so instead of guessing.

## App header

### Active course name (`header-course-name`)

The course name in the strip at the top of the window, next to “CBE Toolbox”, always names the course you are working in — in every view, whether or not the left panel is open. It is also the way back to your courses: it does not switch course itself.

**How to use.** Click the course name to reveal the course list: the left panel opens on its list level and the list takes focus, and one click on a card switches the whole workspace to that course, conversation and canvas included. Renaming a course, resuming a chat, browsing its wiki and deleting it all happen a level deeper, in the course's own detail view.

**Availability:** only when the session's environment descriptor reports the `courseWorkspace` affordance as `true`.

### Help (`header-help`)

The question-mark icon at the top right of the window asks the assistant what it can help with right now: it sends a structured help request and the assistant replies with a compact orientation grounded in the current session.

**How to use.** Click it while the assistant is idle; your composer draft and pending attachments stay untouched. While the assistant is working it says so instead of dispatching. The composer's "+" menu carries the same request.

### Interface language (`header-interface-language`)

The compact globe-and-code control immediately left of Help changes the app interface language. It is the only header action available before a model provider is configured; Help, Settings and Profile keep their workspace gates.

**How to use.** Open it and choose a language by its own name. The same setting remains in the overlay's Appearance group, and either route updates the whole interface immediately without changing the conversation language.

### Settings (`settings-gear`)

The gear icon at the top right of the window opens the Settings section of the overlay — the model connection, the appearance of the app, what is installed, and the corpus. A small mark on the gear means you left an unsaved change in Settings.

**How to use.** Click the gear to open the overlay at Settings; close it with Escape, its × control, or a click outside it, and your workspace is exactly as you left it underneath. Everything in it applies to the whole app rather than to one course.

### Profile (`user-affordance`)

The person icon, the rightmost element of the header strip, opens the same overlay at its Profile section: the assistant's running estimate of how you teach and what you already work with.

**How to use.** Click it to open the overlay at Profile; from there you can switch to Settings without closing it. Close it with Escape, its × control, or a click outside it.

**Availability:** only when the session's environment descriptor reports the `profilePanel` affordance as `true`.

## Composer

### Context ring (`context-usage-ring`)

The small circle left of the model name at the bottom of the composer: how much of the model's context window this conversation occupies, i.e. how much room is left before the assistant automatically summarises the earlier part to make space.

**How to use.** Hover it or move keyboard focus to it and it states its current reading in words — not yet measured (a new conversation), carrying context that has not been re-measured yet (a reopened one), a percentage plus the token figures once both are known, or that no context window is configured, in which case the model pill beside it leads to the field that sets one. Near the summarising point it changes appearance and says so; nothing is blocked, and your canvas work, decisions, step progress and CBE Maturity reading are kept either way.

### Help (`help-me`)

The composer's route to the same help request as the header's question mark, reachable without leaving the message field.

**How to use.** Open the round "+" menu at the bottom left of the composer card and choose "Help" while the agent is idle. Your draft and pending attachments stay untouched; for a specific question, type it into the message field instead.

### Upload files (`material-upload`)

Reads existing teaching material into the conversation. Selected files appear as removable attachment pills above the message field and are sent to the assistant together with the next message.

**How to use.** Open the round "+" menu at the bottom left of the composer card, choose "Upload files" and pick one or more files. Remove a pending pill via its × before sending if needed; optionally type an instruction, then send.

**Availability:** only when the session's environment descriptor reports the `ingestion` affordance as `true`.

### Model pill (`model-pill`)

Shows which model the conversation runs on, at the bottom right of the composer card. Display-only — it never offers a model list and never switches models.

**How to use.** Click it to open Settings at the "Model" group, where the base URL, model id and API key are configured. It stays clickable while the agent is working. "No model configured" means no model id is saved yet.

### Send / Stop (`send-stop`)

Sends your message; while the assistant works the same button is a square that stops the answer.

**How to use.** Enter or the button sends. Click the square to stop; the text already written stays, marked stopped.

## Conversation header

### New Session (`new-session`)

Starts a fresh conversation for the current course. A context reset, not a data reset: the module design on the CBE Process Canvas, the recorded decisions, the design-step progress and the CBE Maturity reading are kept, the lecturer profile persists, and the previous conversation stays resumable from Courses. Nothing is deleted.

**How to use.** Click New Session in the conversation header above the transcript and confirm in the inline prompt (it names what is kept and that the conversation stays resumable from Courses). The control is locked while the agent is still working.

## Left panel

### Course detail (`course-detail`)

One course's own level in the left panel: its title with the rename and delete icons, a Set active control when it is not the active course, and two tabs — Chats lists its stored conversations, the open one marked; Wiki is its knowledge wiki. No folder links or raw paths. Deleting is only here, never on a list card, whose surface is the activation control — one mis-click from the app's most destructive action.

**How to use.** Open a course's detail level with the chevron on its card; “← Back” returns to the list. Rename with the pencil icon; the trash icon by it never deletes on the first click: it names what goes with the course and moves the folder to the system trash, restorable from there. Cancel is pre-selected; Escape dismisses the question. In Chats, click a conversation to resume it; rows wait while the agent works.

**Availability:** only when the session's environment descriptor reports the `courseWorkspace` affordance as `true`.

### Course list (`courses-panel`)

The list level of the left panel: one card per course. A course is a self-contained folder carrying its own conversation, canvas, wiki and materials; exactly one course is active at a time, and the chat always works on the active one. A dot on a card signals that the assistant is currently running in that course, or that a run finished there while you were working elsewhere. Cards do not unfold — going into a course means opening its detail level.

**How to use.** Open the left panel (its Courses icon, its edge chevron, or the course name in the header). Click a course card to make it active — the workspace switches over and that course's conversation resumes where it left off. Click the chevron on a card to open its detail level. The dashed “New course” card at the end of the list asks for a title and switches you straight into the new course; it is the only place a course is created.

**Availability:** only when the session's environment descriptor reports the `courseWorkspace` affordance as `true`.

### Left panel (`left-panel`)

The column on the left of the window, holding your courses. It starts collapsed to a narrow strip with a single Courses icon — which is why no course list is on screen when you open the app. A marker on that icon means an assistant run in another course is live or just done, or a wiki ingest is running.

**How to use.** Click the Courses icon in the narrow strip to expand the panel, or use the chevron on the panel's edge to expand and collapse it. The course name in the header strip opens it too and puts you straight in the list. Drag the panel's inner edge to make it wider or narrower; the width is remembered, the collapsed state is not.

**Availability:** only when the session's environment descriptor reports the `courseWorkspace` affordance as `true`.

### Wiki (`wiki-browser`)

Per-course knowledge wiki: browsable, searchable knowledge atoms distilled from the course's teaching material, with a list view and a knowledge-graph view.

**How to use.** Open a course's detail level in the left panel — its Wiki tab lists the atoms. Type in the search field to filter by title, alias, type, or body text; use the toolbar button to switch between list and knowledge-graph view; click an atom to read it and follow its Related links to connected atoms.

## Native application menu

### CBE Toolbox (`native-application-menu`)

The operating system menu provides standard editing, view, window and lifecycle actions plus routes to settings, About, Help and the official PIONEER Alliance site.

**How to use.** Use Settings… for the usual settings route, About CBE Toolbox to open the existing About group, or CBE Toolbox Help (F1) for the same conversational help as the header. PIONEER Alliance Website opens in the system browser.

## Profile

### Profile (`profile-panel`)

The Profile section of the overlay that opens over your workspace, beside Settings. At the top it carries your own two entries about yourself — your name and the form of address you prefer — both optional, independent of each other, and stated by you rather than estimated. Below them it shows the assistant's running estimate of the five lecturer-state dimensions (PBL prior knowledge, CBE prior knowledge, didactic stance, attitude toward CBE, teaching load/capacity), each with value, confidence, evidence pointer, and provenance.

**How to use.** Open it with the person icon at the top right of the window, and switch to Settings without leaving the overlay. To say what you are called or how you would like to be addressed, type into the Name and Preferred form of address fields and press Save; to change or remove either one, edit or empty that field and press Save again. Leaving both empty is a normal choice and changes nothing. Below that, review each dimension's current estimate; use a dimension's dropdown to set a manual override — the override takes precedence over the assistant's running estimate until later behaviour clearly contradicts it. Close the overlay with Escape, its × control, or a click outside it.

**Availability:** only when the session's environment descriptor reports the `profilePanel` affordance as `true`.

## Right panel

### Artefact notes and ↻ Iterate (`artifact-annotation`)

Lets you comment on individual artefacts and hand all your comments back to the assistant in one message, instead of re-describing them in the chat. Each card keeps its own notes, and the counter above the canvas shows how many are still pending.

**How to use.** Click “+ Note” on an artefact card, type your comment and press Enter (or click “Add”); repeat on as many cards as you like, and remove a note with the × beside it. When you are done, click “↻ Iterate” at the top of the CBE Process Canvas tab — it sends every pending note as your next message and clears them. The button stays inactive while there are no notes and while the assistant is working.

**Availability:** only when the session's environment descriptor reports the `canvas` affordance as `true`.

### Delete artefact (`artifact-delete`)

Clears one artefact card's content from the canvas. It is not a history deletion: the conversation keeps everything that was said, and the assistant is informed with your next message that you removed the artefact, so it does not silently write it back.

**How to use.** On a card that carries content, click the × in its header and confirm with “Delete” in the inline prompt; “Cancel” leaves the card untouched. Cards that are still empty have no × — there is nothing to clear.

**Availability:** only when the session's environment descriptor reports the `canvas` affordance as `true`.

### CBE Process Canvas (`design-flow-canvas`)

The design-flow canvas: the ten design steps as an accordion, each holding the artefact cards that belong to it (step 4 carries the challenge ladder, step 6 the four-part learning journey). Every step header shows how far that step has been taken and marks the single step currently in focus. The cards are written by the assistant during the conversation — this is where the module design becomes visible as a document rather than as chat.

**How to use.** The right panel is open on the CBE Process Canvas tab when you start the app; click a step header to open that step and read its cards; one step is open at a time. Click the arrow (→) beside a step header to put that step in focus — the focus marker moves immediately and nothing is added to the conversation; the assistant is told which step you chose with your next message. It stays available while the assistant is working. You do not type into the cards; you shape them through the conversation or through the notes described below.

**Availability:** only when the session's environment descriptor reports the `canvas` affordance as `true`.

### CBE Maturity (`maturity-panel`)

Shows how the assistant currently reads your design's CBE maturity: three levels (CBE light, good practice, full-fledged) across seven criteria, each with the level read now, the level you are working toward, and a hint on what is still missing. It opens with the two figures you read against each other — the target maturity settled for the design as a whole, and the overall level reached, which is worked out from the criterion readings below it and names how many of the seven it rests on. The levels are the assistant's working assumption from your material and this conversation — not a verdict — and the panel states it plainly when a reading rests on a thin evidence base or has fallen behind the design since it was taken.

**How to use.** Select the CBE Maturity tab in the right panel. Click “Assess maturity” to have the assistant read the design as it currently stands; that is also the way to refresh a reading marked out of date. To correct or develop a single criterion, click “Discuss in chat” in its row — it carries that criterion into the conversation. Click a criterion's level token to unfold the full wording behind it. Both controls are locked while the assistant is working, and you cannot set a level yourself: the levels are argued in the conversation, not picked from a list.

**Availability:** only when the session's environment descriptor reports the `maturity` affordance as `true`.

### Right panel (`right-panel`)

The column on the right of the window, holding the two surfaces that belong to the course you are working on: the CBE Process Canvas (your module design along the ten design steps) and CBE Maturity (how the assistant reads the design's maturity). It is open on the CBE Process Canvas when you start, so the design work is on screen straight away. Your courses are in the left panel; your profile and the app's settings are behind their icons at the top right of the window.

**How to use.** Switch between the two tabs with the tab row at the top of the panel. Use the chevron on the panel's edge to collapse it to a narrow strip of icons and to open it again — clicking one of those icons opens the panel straight onto that tab. Drag the panel's inner edge to make it wider or narrower; the width is remembered, the collapsed state is not.

## Settings

### Settings (`settings-panel`)

App configuration in the Settings section over your workspace. Four groups, one open at a time: Model (endpoint, model id and key; context length, reasoning and key deletion behind Advanced), Appearance (theme, colour, chat text size, interface language), About (installed facts, the official PIONEER Alliance link and the rereadable first-use overview), and Corpus (corpus version and refresh). Only Model names the model your work runs on.

**How to use.** Open it with the gear at the top right or Settings… in the native menu; About CBE Toolbox opens About directly. It opens on Appearance; its Interface language matches the globe-and-code control left of Help in the header and applies immediately. Open Model for the connection; opening a group closes the other. A field's ? reveals its explanation. In About, Reread the first-use overview shows the same overview inline without sending Help. Close with Escape, ×, or outside click; unsaved work remains and marks the gear. Model changes reach the open conversation on Save.
