---
name: feature-loop
description: Coding agent for the project-level harness — one feature per session, must verify, must be mergeable.
requires_tools:
  - project_status
  - feature_select
  - feature_complete
  - verify_run
  - progress_append
  - code_outline
  - file_read
  - file_write
  - bash_exec
---

# Feature Loop

Use when `session_mode == feature_loop` and the project is past the Initializer phase (system prompt will say "Coding 阶段").

## Iron rules

1. **One feature per session.** Multiple `in_progress` features are forbidden by the store; do not bypass.
2. **Always verify before commit.** `feature_complete` rejects features that have not been promoted to `verified` via `verify_run`.
3. **Keep the branch mergeable.** Each commit must compile, pass `verify.yaml`, and not depend on uncommitted local state.

## Loop

1. **Sync from disk.** Call `project_status` first thing every session — it reads `feature_list.json` / `status.json` / `progress.md` and reseeds your understanding from the single source of truth.
2. **Pick a feature.**
   - If `status.active_feature_id` is already set, resume that one (the prompt block will tell you).
   - Otherwise call `feature_select` with no arguments to auto-pick the highest-priority pending feature with satisfied dependencies, or pass `feature_id` when the user names one.
3. **Implement using code_dev phases** (Explore → Read → Author):
   - Explore with `code_outline`, `grep`, optional `code_search`.
   - Read with `file_read` slices (start/end line). Track files you have read in scratchpad.
   - Author with `file_write` skeletons first, then section-by-section appends.
4. **Run the gate.** Call `verify_run feature_id=<id>`. If any step fails:
   - **Do not call `feature_complete`.**
   - Log a `progress_append` with the failing step name and root cause.
   - Decide: fix and rerun `verify_run`, or escalate to the user with the specific failure.
5. **Commit via shell.**
   ```
   git add -A
   git commit -m "feat(<feature_id>): <one-line summary>"
   ```
   Capture the resulting sha (`git rev-parse HEAD`).
6. **Promote to committed.** Call `feature_complete feature_id=<id> commit_sha=<sha>`. The store writes an immutable archive snapshot under `.agx/project/archive/feature_<id>.json`.
7. **Decide next step.** Either call `feature_select` for the next feature in the same session, or stop and tell the user the loop closed cleanly.

## Failure modes

- **verify_run timeouts**: do not retry blindly. Inspect the log under `.agx/project/archive/`, fix the root cause, then rerun.
- **Dependency missed**: `feature_select` will reject features whose `depends_on` isn't `committed`. Either pick a different feature or finish the prerequisite first.
- **Lost context after window compaction**: re-call `project_status`. Disk is the source of truth.
- **Cold start (new machine, fresh session)**: `project_status` + `feature_select` is enough to resume. No memory of previous turns is required.

## Forbidden

- Editing files inside `.agx/project/archive/` (immutable).
- Calling `project_init` outside the Initializer phase.
- Skipping `verify_run` because "tests are too slow".
