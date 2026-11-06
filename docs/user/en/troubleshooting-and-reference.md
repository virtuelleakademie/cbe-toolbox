---
pageId: troubleshooting-and-reference
locale: en
appVersion: 0.1.21
---

# Troubleshooting and reference

Use the visible symptom to choose a safe next step.

<a id="troubleshooting"></a>

<!-- topic:troubleshooting -->

## Common symptoms and safe recovery

<a id="model-connection-fails"></a>

### The model is not configured or the connection test fails

Your local Course files remain safe. Work through these steps:

1. Check the model configuration as described in [Connect a model](installation-and-local-it.md#model-connection): the exact base URL, model ID and API key without accidental surrounding quotes, and context-window and reasoning settings that your provider supports.
2. Save the connection before you use the connection test in the same group; the test checks the saved connection. It returns one of these results:
   - “Endpoint unreachable — check the base URL and your network.” The app cannot reach the base URL. The base URL may be wrong, or something else blocks the connection, for example a VPN that is required to reach that address. If your institution blocks the endpoint, contact local IT.
   - “Unauthorized — the endpoint rejected the API key (HTTP 401). Check or re-enter the key.” The base URL is correct and can be reached. The likely cause is the API key or its authorisations with the provider. Some providers report HTTP 403 instead.
   - “Connection OK — the endpoint responded and accepted the key.” The base URL and API key work. Return to the chat and have a conversation with the Toolbox.

   For security reasons, a saved API key is never carried over to a changed base URL. Whenever you edit the base URL, enter the API key again before you save.

3. If the test returned “Connection OK” but the chat shows “The model provider could not complete the request. Your conversation is unchanged — try again; the full error detail is in the session log.”, the likely cause is the model ID. Model IDs are defined by your provider and follow no common standard. Check the correct model ID with your provider.

Do not paste the key into a ticket.

<!-- ui:settings-panel -->

### The provider reports a rate limit or model error

Keep the Chat open. Wait for the provider's stated retry period or choose an approved model/endpoint. Retry the request once. Repeated retries can worsen a rate limit. If the provider gives a request id, share that id—not your prompt or key—with the authorised provider administrator.

<a id="session-log"></a>

### Session log

Some error messages say that the full error detail is in the session log. This is the stored record of the conversation: each conversation is saved as a `.jsonl` file in the `sessions` folder of its Course, and the most recently changed file belongs to the latest conversation. The Course folders are inside the app-data folder:

- macOS: `~/Library/Application Support/CBE Toolbox/courses/<course folder>/sessions/`
- Windows: `%APPDATA%\CBE Toolbox\courses\<course folder>\sessions\`
- Linux: `~/.config/CBE Toolbox/courses/<course folder>/sessions/`

The file contains the whole conversation. Do not send it to anyone by default; see [What to share with support](#support-sharing).

### An answer appears stalled, is stopped or is cut off

While the working status is visible, wait or use the square Stop control. Stop keeps text already received. For an explicitly cut-off answer, choose Continue to finish it or Retry to regenerate the turn. Do not start repeated parallel requests. If the app remains unresponsive, close it only after waiting for local persistence, reopen the Course and inspect the last completed turn.

<!-- ui:send-stop -->

### The Course or stored Chat does not open

Return to the course list and select the Course again. A missing or damaged lossless JSON sidecar can make Resume unavailable while its readable Markdown archive remains listed. Preserve the Course folder and contact support before deleting anything. If a Course deletion was intentional, use the operating system trash to restore its whole folder.

### An attachment cannot be extracted

<!-- formats:SUPPORTED_EXTENSIONS -->

Remove the pending attachment, keep the original, and check that its extension is in **PDF, DOCX, PPTX, XLSX, TXT, MD, CSV** and that the file itself opens normally. Image-only pages or protected/corrupt office files may yield no usable text. Create an accessible text-based copy rather than overwriting the original.

<!-- ui:material-upload -->

### Excel material is refused

`.xls`, `.xlsb` and `.xlsm` are deliberately refused. Open the original in a trusted spreadsheet application, use **Save As** to create a separate `.xlsx` copy, inspect that copy and attach/import it again. Do not merely rename the extension.

### A Wiki import is refused, fails or is aborted

A new import can start only for the active Course and only when that Course has no live import. Re-activate the intended Course and retry the failed document. One document's failure does not erase successful siblings. A run that cannot reach the model ends visibly and remains retryable. If you switched Courses, reopen the origin Course to see or abort its run.

### CBE Maturity says provisional or stale

This is a state description, not data loss. Provisional means evidence is thin; stale means the recorded design changed after the assessment. Ask in the conversation to discuss or refresh the assessment. Criterion levels are not manually editable.

### A citation cannot be opened or verified

Keep the answer but treat the claim as unverified. Reopen the citation and inspect its detail. If a section is missing, ask the assistant to identify the exact source passage or state the gap. For Wiki material, confirm the atom still exists in the active Course. Never treat a plausible-looking broken link as evidence.

### A Picker does not render or shows a failure

Continue in prose: repeat the question briefly and state your choice. The assistant should recover with an ordinary question rather than exposing technical details. Your earlier Course work is unaffected.

<a id="updates-and-refresh"></a>

<!-- topic:updates-and-refresh -->

### App update or content refresh fails

Keep the installed version. Retry only after confirming network access and the current release/content source with local IT. Do not disable certificate checks or replace files inside the app bundle. On unsigned macOS builds, obtain the next installer manually; content refresh is not an app update.

<a id="support-sharing"></a>

<!-- topic:support-sharing -->

## What to share with support

Start with app/Skill version, operating system/version, time, visible symptom, steps that led to it, and a redacted screenshot or copied visible error. Version 0.1.21 has no one-click support export. Share neither provider keys nor personal student data. Do not send a whole app-data/Course folder by default. If authorised support needs a specific session Markdown, JSON sidecar or diagnostic file, agree the exact file and secure channel, retain an untouched backup and redact confidential content.

Contact local IT when policy, certificate, proxy, endpoint reachability, installer trust or storage permissions are involved. This includes installation problems caused by restrictions on institutionally managed devices and problems with the model configuration (base URL, model ID, API key): your local IT department is the right contact for these, not the providers of CBE Toolbox.

Report a reproducible defect of the application itself as an issue in the GitHub repository [https://github.com/virtuelleakademie/cbe-toolbox/issues](https://github.com/virtuelleakademie/cbe-toolbox/issues). Name the exact app version and the steps that lead to the defect. Do not include keys, personal data or course content in an issue.
