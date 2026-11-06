# How the CBE Toolbox handles your data

This page is for lecturers using the CBE Toolbox. It explains, in plain language,
where the material you put into the app goes.

It used to be a permanent line under the chat composer. It said the same three
things on every turn of every session, which is not how anyone reads a fact like
this — so it lives here now, where you can read it once and come back to it.

Nothing about how the app handles your data has changed. These are the same three
facts, in full.

## 1. What you submit is stored locally only

Everything you put into the app — what you type in the chat, the files you ingest,
your courses, your canvas, your lecturer wiki, your settings — is written to your
own device, in the application's data folder:

- **macOS:** `~/Library/Application Support/CBE Toolbox/`
- **Windows:** `%APPDATA%\CBE Toolbox\`
- **Linux:** `~/.config/CBE Toolbox/`

There is no CBE Toolbox operator server and no other third-party server that
receives a copy. If you delete that folder, the material is gone; apart from
anything you have exported yourself, there is no other place it exists. Nothing is
synchronised anywhere, and the app uploads nothing on its own.

Your API key is stored in the same folder, encrypted through your operating
system's credential store (Electron `safeStorage`) where the system provides one.

## 2. The language model you configured reads what you submit

The app cannot answer without a language model, and the model you configure is
not part of the app — it is a service you bring yourself. To answer you, the app
sends the model what it needs: your messages, the content of the files you have
ingested, the relevant parts of your course material, and passages from the CBE
corpus.

That means your material leaves your device on its way to the endpoint you
configured, and only to that endpoint. This is not a background transfer — it
happens when you send a turn, and it is what makes an answer possible at all.

If you have configured a model that runs on your own machine (for example Ollama
or LM Studio), nothing leaves your device at all.

## 3. Your provider's data-protection terms apply to what the model receives

Because the model is a service you chose, it is that provider's data-protection
terms — not the CBE Toolbox's — that govern everything they receive. What they
store, for how long, on which servers, and whether they train on it is decided by
their terms, and you should read them for the provider you use.

The app makes no promise on their behalf, and it cannot: the same app is used with
a university-hosted model, a commercial API and a model on your own laptop, and
those three answers are completely different.

### Which provider is actually in force?

The app never guesses this for you. Open the settings overlay from the gear at the
top right of the window and select the **model group** — the one holding your
endpoint, model id and key. It shows the provider host and the model id **actually
in force for the running session**, in full, including after you have swapped a
provider without restarting. Whatever is shown there is whose terms apply to your
material.

If no provider is configured, the group says so — and no material is being sent
anywhere, because the app cannot answer at all in that state.

## Short version

|                 |                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- |
| **Stored**      | on your device only — no CBE or third-party server holds a copy                           |
| **Read by**     | the language model you configured in the settings overlay's model group, and nothing else |
| **Governed by** | that provider's data-protection terms, which you should read                              |

---

_Specification: `openspec/specs/desktop-app/spec.md`, Requirement **Data-Handling
Disclaimer**, operationalising the stakeholder requirement `legal-data-info`
(data-usage transparency)._
