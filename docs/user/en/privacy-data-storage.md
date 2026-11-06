---
pageId: privacy-data-storage
locale: en
appVersion: 0.1.21
---

# Privacy, data and storage

How CBE Toolbox stores data and sends requests to the configured model provider.

> [!CAUTION]
>
> - Conversations, including information gathered about you in previous conversations (for example your teaching experience or institutional context), are transmitted to the inference service you configured. The privacy and data policies of that service apply. Users are responsible for ensuring compliance.
> - Each time it starts, the application checks for a newer app version at an address hosted by Cloudflare. In this process, your IP address is revealed to Cloudflare. In version 0.1.21, Corpus and Skill content is not updated over the network.

<a id="local-storage"></a>

<!-- topic:local-storage -->

## What is stored locally

The Toolbox writes its state to the operating system's app-data folder:

- macOS: `~/Library/Application Support/CBE Toolbox/`
- Windows: `%APPDATA%\CBE Toolbox\`
- Linux: `~/.config/CBE Toolbox/`

Inside it, each Course has its own folder with course context, course-owned sessions, Canvas/design state, Wiki originals/extractions/atoms and related material. Deleting a Course moves that folder as a unit to the operating system trash.

Some records are intentionally **outside every Course**: app/model settings, the lecturer-wide Profile estimates, lecturer identity, lasting support preference, interface/onboarding choices and workspace pointers. The provider key is stored with app configuration and protected through the operating system's credential encryption where available. It is not written into a Course.

<a id="backup-boundary"></a>

<!-- topic:backup-boundary -->

## Back up one Course or the whole installation

1. Finish any running answer or Wiki import and **close the app**.
2. Preserve the original folder; copy rather than move it.
3. For one Course, copy that Course's complete folder, including all session and Wiki sidecars. This preserves course-owned work but **not** lecturer-wide Profile/support/identity or app/model configuration.
4. For a complete backup, copy the whole CBE Toolbox app-data folder using an institutionally approved encrypted destination.
5. Restore only to a compatible reviewed installation and keep the backup untouched until the restored state has been checked.

An operating-system-encrypted provider credential may not decrypt on another machine or account. Copying one Course or even the app-data folder does not guarantee a portable usable key; re-enter it through the settings surface when authorised.

<a id="provider-data-flow"></a>

<!-- topic:provider-data-flow -->

## Local persistence versus provider transfer

Course work is persisted on your device. When you send a request, the configured model receives what it needs to answer: your messages, relevant attached or Wiki material and retrieved corpus passages. The app sends this to the endpoint shown in the settings overlay's model group, not to an inference service operated by the CBE Toolbox project.

<!-- ui:settings-panel -->

If that endpoint is an external service, the material leaves your device and that provider's retention, training, region and data-protection terms apply. Read those terms. If the endpoint runs on your own device through loopback (for example a locally managed compatible server), the model exchange stays local. Content/version checks are separate network operations and do not change which model receives a chat request.

<a id="student-data"></a>

<!-- topic:student-data -->

## Do not submit personal student data

Personal student data is not accepted for chat, attachments or Wiki ingestion. Remove or anonymise names, identifiers, contact details, grades, free-text feedback and any combination that could identify a student **before** adding material. A provider contract does not turn identifiable student data into acceptable input. If anonymisation would remove essential meaning, do not submit the material and consult your institution's privacy contact.
