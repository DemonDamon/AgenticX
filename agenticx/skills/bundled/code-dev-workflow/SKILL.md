---
name: code-dev-workflow
description: Machi code_dev harness — Explore, Read, Author phases with outline-first context discipline.
requires_tools:
  - code_outline
  - file_read
  - bash_exec
  - scratchpad_write
  - file_write
---

# Code Dev Workflow

Use when the session is in **code_dev** mode.

## Phases

1. **Explore** — `code_outline`, `grep`, `lsp_*`, `code_search` (if enabled). Write `scratchpad_write(key="phase", value="explore")` and a file list to read.
2. **Read** — `file_read` with `start_line`/`end_line` only. Summarize into scratchpad. Then `phase=read`.
3. **Author** — `file_write` skeleton first, then section-by-section updates. `phase=author`.

## Rules

- Never read entire large files without outline + line ranges.
- Do not mirror document milestones into `todo_write` unless executing multi-step work.
