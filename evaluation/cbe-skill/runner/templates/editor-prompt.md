You improve the CBE skill so it passes failing evaluation checkpoints WITHOUT weakening its didactic guardrails.

## Failing checkpoints

{{failures}}

## Current skill files

{{skill_files}}

## Your task

Propose ONE targeted change to exactly one file under `skills/cbe/` (either `SKILL.md` or a file under `references/`).

Reply in EXACTLY this delimited format — NOT JSON. The file content goes between the markers verbatim, so it may contain any characters (quotes, braces, newlines) without escaping:

TARGET_FILE: <path relative to skills/cbe/, e.g. references/checks/anti-sycophancy.md>
EDITOR_REASONING: <plain-language explanation of why this change addresses the failing checkpoints>
---BEGIN FILE CONTENT---
<the COMPLETE new content of that file, verbatim>
---END FILE CONTENT---

Hard rules:

- Change exactly one file, under `skills/cbe/` only. Never touch corpus, app, or harness code.
- NEVER delete, empty, or weaken the didactic non-negotiables, the anti-sycophancy rules, or the citation-grounding rules. Strengthen, do not strip.
- The content between the markers is the FULL file content, not a diff.
- Output the three parts above and nothing else. No prose before `TARGET_FILE:` or after `---END FILE CONTENT---`. Do not wrap anything in markdown fences.
