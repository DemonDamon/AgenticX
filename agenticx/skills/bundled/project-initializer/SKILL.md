---
name: project-initializer
description: Initializer agent for the project-level harness — turn a spec or issue into feature_list.json, init.sh, verify.yaml, and an initial commit.
requires_tools:
  - project_init
  - project_status
  - progress_append
  - bash_exec
  - file_read
  - file_write
---

# Project Initializer

Use exactly once per project, when `session_mode == feature_loop` and `.agx/project/` does not yet exist (system prompt will say "Initializer 阶段").

## Inputs

- A spec markdown, GitHub issue, or natural-language feature description.
- The repo root (`workspace_dir` or first non-default taskspace).

## Steps

1. **Read the spec end-to-end.** Use `file_read` if the user pointed at a file, otherwise capture the user's message as the source of truth.
2. **Decompose into ≥ 5 deliverables.** Each feature must:
   - have a stable `id` (kebab-case, ≤ 32 chars),
   - be **independently mergeable** (its commit can land on main without breaking others),
   - declare 1–3 concrete `acceptance_criteria` (observable behavior, not implementation steps),
   - declare `depends_on` only for hard ordering constraints,
   - get an integer `priority` (lower = sooner; reserve 100 for "later").
3. **Call `project_init`** with the full feature list. The tool writes `feature_list.json`, seeds `status.json` with `phase=initialize`, and drops template `init.sh` + `verify.yaml`.
4. **Customize `init.sh`** via `bash_exec` (or `file_write` with the diff path = `.agx/project/init.sh`):
   - install language runtime / package manager dependencies,
   - apply migrations / generate seed data,
   - **must be idempotent** (running twice on the same machine should not break anything).
5. **Customize `verify.yaml`** with the project's real test/lint commands. Keep the `bootstrap` step that runs `init.sh`.
6. **Smoke-run** with `verify_run` (no `feature_id`) to confirm the initial gate is green on a clean checkout.
7. **Commit** the harness files via `bash_exec`:
   ```
   git add .agx/project init.sh verify.yaml
   git commit -m "chore(project): initialize harness with N features"
   ```
   Keep this commit small — only harness files, no business code.
8. **Append a closing progress note** with `progress_append` (e.g. `"[initialize-done] commit=<sha> features=N"`) and tell the user the project is ready for a Coding session.

## Forbidden

- Editing business code in this session.
- Selecting or completing a feature — that is the Coding phase's job.
- Hardcoding secrets in `init.sh` or `verify.yaml`.
