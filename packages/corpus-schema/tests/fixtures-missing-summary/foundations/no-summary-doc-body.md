---
id: no-summary-doc
title: "Document without summary"
category: foundations
version: "0.1.0"
sources:
  - author: "X"
    year: 2020
    title: "Y"
    url: "https://example.org/y"
    license: "test"
license: "test"
updated: "2026-05-21"
tags: []
---

# Document without summary

The body deliberately omits a `## Summary` heading AND the frontmatter omits `short-description:` so the index generator MUST fail with a clear error.
