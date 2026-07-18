---
name: code-module-summaries
description: Use when scanning an arbitrary Git repository to create, refresh, or selectively update Markdown summaries of code modules, especially when changes must be traced from each module's last successful update.
---

# Code Module Summaries

## Overview

Build and maintain evidence-backed Markdown summaries for an arbitrary Git
repository. Treat each module's last successful commit SHA as its incremental
checkpoint. Timestamps and Markdown mtimes are display metadata only.

The tracked control directory is the source of truth:

- `registry.json`: stable module boundaries, layout, and summary paths.
- `state/<module-id>.json`: one independent checkpoint per module.
- `modules/*.md`: summaries when using the centralized layout.
- `INDEX.md`: links and module ownership; update only when mappings change.

## Invocation

Interpret user arguments with this contract:

```text
/code-module-summaries [repo]
  [--output <control-dir>]
  [--layout centralized|colocated]
  [--update]
  [--module <id-or-exact-name>]...
  [--target <git-ref>]
  [--refresh-modules]
  [--summary-name <filename.md>]
  [--head-only]
  [--accept-summary-drift]
  [--adopt-existing-summary]
  [--rebaseline --reason <text>]
```

Defaults:

- `repo`: current Git root.
- `--output`: `code-summaries/`.
- `--layout`: `centralized`.
- `--target`: the registry's `tracked_ref`, normally `HEAD`.
- `--summary-name`: `MODULE_SUMMARY.md` for colocated summaries.

`--module` is repeatable and case-sensitive. It selects exact IDs first, then
an exact unique name. Never use fuzzy matching for a write operation.

## Required Reference and Helper

Before the first scan, mapping refresh, deletion, or history recovery, read
[REFERENCE.md](REFERENCE.md) completely.

Use the deterministic helper for every update:

```bash
python <skill-dir>/scripts/scan_changes.py --help
```

Do not replace it with `git log --since`, file mtimes, or an improvised diff.

## Workflow

### 1. Validate scope

1. Resolve the Git root and freeze the full target commit OID.
2. Confirm the control directory is inside the repository and intended to be
   tracked by Git. It must not be the repository root or an ancestor of any
   module root.
3. Default to committed Git objects. If selected-module source files are
   dirty, stop. `--head-only` may explicitly ignore those worktree changes.
4. Never run fetch, pull, stash, reset, checkout, clean, or rebase implicitly.

### 2. First scan

When `registry.json` does not exist:

1. Discover real module boundaries from workspace/package manifests, runtime
   entry points, deploy units, ownership, tests, and import cohesion.
2. Aim for a useful map, not exactly ten modules. Do not split or merge strong
   package boundaries merely to hit a count.
3. Ensure every tracked source path has an owner. When needed, use one
   repository-root module with root `.`; deeper module roots take precedence.
   A new package first appears there and triggers a mapping refresh.
4. Present the candidate map and output paths before writing unless the user
   already supplied explicit module roots.
5. Create `registry.json` using the schema in [REFERENCE.md](REFERENCE.md).
6. Run `plan` before creating summaries and retain each returned
   `checkpoint_token`. If a summary already exists without state, read and
   preserve it before explicitly using `--adopt-existing-summary`.
7. Generate each summary from code at the frozen target. Cite real paths and
   symbols; do not turn plans or README claims into implemented behavior.
8. Run `checkpoint` separately for each successfully verified module. A failed
   module must not advance its state.

### 3. Incremental update

Run a read-only plan first:

```bash
python <skill-dir>/scripts/scan_changes.py plan \
  --repo <repo> \
  --control-dir <output> \
  [--module <selector>]... \
  [--target <ref>] \
  [--head-only] \
  [--accept-summary-drift] \
  [--adopt-existing-summary]
```

Exit code `2` or `has_blockers: true` means zero summary writes until the
reported blocker is resolved. For a multi-module plan with one blocked module,
either resolve all blockers and rerun, or run a new plan selecting only the
unblocked module; never partially execute the blocker-containing plan.

A full plan also blocks on tracked paths not owned by any module or excluded by
the registry. This catches newly added top-level packages instead of silently
ignoring them.

Use `--accept-summary-drift` only after an earlier plan actually reported
`SUMMARY_DRIFT` and the existing edits were reviewed. It cannot pre-authorize a
future summary change.

Handle each selected module by plan status:

- `new`: read the whole declared module scope and create its summary.
- `changed`: inspect every reported `A/M/D/R` path, including both sides of a
  rename, then read only the surrounding code and dependencies needed to
  explain the behavioral change. Apply the minimum accurate summary edit.
- `unchanged`: do not reread source and do not rewrite the Markdown; only
  checkpoint the target so the same range is not scanned again.
- `deleted`: do not delete or archive automatically. Confirm whether to retire,
  remap, or replace the module.
- `blocked`: stop for that module and follow the recovery table in
  [REFERENCE.md](REFERENCE.md).

After verifying one module's Markdown:

```bash
python <skill-dir>/scripts/scan_changes.py checkpoint \
  --repo <repo> \
  --control-dir <output> \
  --module <module-id> \
  --target <full-target-oid> \
  --target-ref <same-ref-used-by-plan> \
  --plan-token <token-returned-for-this-module> \
  --summary-sha256-at-plan <hash-returned-for-this-module> \
  [--head-only] \
  [--accept-summary-drift] \
  [--adopt-existing-summary] \
  [--summary-unchanged]
```

Pass the same plan options to `checkpoint`. Use `--summary-unchanged` only
after inspecting every reported change and confirming that none changes the
maintainer-facing summary.

Checkpoint successful modules independently. This is what lets one long-stale
module retain its own baseline while another is updated frequently.

### 4. Strict single-module mode

With `--module`:

- Do not rediscover all modules.
- Do not modify another module's summary or state.
- Do not update `INDEX.md` or `registry.json`.
- Treat a missing root, new package boundary, split, merge, or ambiguous rename
  as mapping drift; require `--refresh-modules`.
- Before finishing, verify the write set contains only the selected summaries
  and `state/<selected-id>.json`.

### 5. Mapping refresh

`--refresh-modules` is the only normal operation allowed to change module
roots, IDs, summary paths, or layout. Produce a before/after mapping and ask
before applying ambiguous splits, merges, or relocations. Retire old IDs; never
silently reuse them for unrelated code.

After an approved mapping edit, run `plan --mapping-refresh`, rebuild the
affected summary, then checkpoint with `--mapping-refresh --reason <text>` and
the returned token/hash. Mapping-refresh plans also validate whole-repository
ownership. Never delete state to bypass a revision mismatch.

After verified history rewriting, run `plan --rebaseline`, fully review the
module at the new target, then checkpoint with `--rebaseline --reason <text>`
and the returned token/hash. Rebaseline is not a date-based diff.

`--refresh-modules`, layout selection, and summary generation are Skill-level
operations. The helper deliberately implements only deterministic `plan` and
`checkpoint`; it does not guess repository architecture.

## Accuracy Invariants

- Persist full commit OIDs, never abbreviated SHAs.
- Compare Git trees from `BASE` to frozen `TARGET`; commit dates do not define
  the range.
- Require `BASE` to exist and be an ancestor of `TARGET`.
- Record one baseline per module; a repository-global baseline is insufficient
  for selective updates.
- Keep centralized and colocated layouts on the same tracked control plane.
- Exclude summaries, state, generated files, dependencies, build output, and
  caches from module source inputs.
- Preserve manual summary edits. `--accept-summary-drift` permits a merge only
  after those edits have been read and retained.
- A normal checkpoint requires the exact token from a blocker-free plan. Never
  invent, reuse, or omit it.
- Tokens bind the module state generation, target ref, target OID, mapping,
  source fingerprint, plan-time summary hash, and safety options; they are
  single-use.
- Never claim an update is complete before the summary and its checkpoint both
  succeed.

## Summary Quality

Preserve each existing document's structure and tone. A summary should help a
maintainer use, change, or extend the module:

- responsibility and explicit non-responsibilities;
- entry points, public interfaces, and core execution path;
- important classes/functions and data/config contracts;
- upstream/downstream dependencies;
- tests and operational boundaries;
- unresolved facts clearly marked as unverified.

Remove descriptions of deleted or renamed implementation. Do not add changelog
noise unless the repository explicitly uses summaries as changelogs.

## Final Response

Report:

1. frozen target commit;
2. selected modules and each module's previous checkpoint;
3. `A/M/D/R` evidence grouped by module;
4. summaries and state files written;
5. skipped unchanged modules;
6. blockers or mapping decisions still requiring confirmation.

## Common Mistakes

- Using “ten days ago” or summary mtime as the baseline.
- Advancing one global checkpoint after updating only one module.
- Reading every module before checking the Git plan.
- Losing the old side of a rename or treating deletion as an addition.
- Rebuilding all summaries because one module changed.
- Overwriting manually edited Markdown without explicit acceptance.
- Guessing after force-push, shallow history, module split, or missing state.
