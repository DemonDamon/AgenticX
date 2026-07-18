#!/usr/bin/env python3
"""Plan and checkpoint Git-backed module summary updates.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Sequence


SCHEMA_VERSION = 1


class ScanError(RuntimeError):
    """Raised when deterministic update planning cannot continue safely."""


@dataclass(frozen=True)
class Module:
    module_id: str
    name: str
    roots: tuple[str, ...]
    shared_paths: tuple[str, ...]
    summary_path: str
    mapping_revision: int
    primary_root: str | None


@dataclass(frozen=True)
class Context:
    repo: Path
    control_dir: Path
    control_rel: str
    tracked_ref: str
    object_format: str
    layout: str
    summary_name: str
    exclude_paths: tuple[str, ...]
    modules: tuple[Module, ...]


def git(
    repo: Path,
    *args: str,
    check: bool = True,
) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
    )
    if check and result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise ScanError(f"git {' '.join(args)} failed: {detail}")
    return result


def git_text(repo: Path, *args: str) -> str:
    return git(repo, *args).stdout.decode("utf-8", errors="strict").strip()


def normalize_repo_path(raw: object, field: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise ScanError(f"{field} must be a non-empty repository-relative path")
    candidate = raw.replace("\\", "/").strip()
    path = PurePosixPath(candidate)
    if path.is_absolute() or ".." in path.parts:
        raise ScanError(f"{field} must stay inside the repository: {raw}")
    normalized = path.as_posix()
    return "." if normalized in {"", "."} else normalized.removeprefix("./")


def path_inside(path: Path, parent: Path, field: str) -> str:
    try:
        relative = path.resolve().relative_to(parent.resolve())
    except ValueError as exc:
        raise ScanError(f"{field} must be inside the Git repository") from exc
    value = relative.as_posix()
    return "." if value == "." else value


def load_context(repo_arg: str, control_arg: str) -> Context:
    requested_repo = Path(repo_arg).expanduser().resolve()
    root_result = git(requested_repo, "rev-parse", "--show-toplevel")
    repo = Path(root_result.stdout.decode("utf-8", errors="strict").strip()).resolve()
    control_dir = Path(control_arg).expanduser()
    if not control_dir.is_absolute():
        control_dir = repo / control_dir
    control_dir = control_dir.resolve()
    control_rel = path_inside(control_dir, repo, "control directory")

    registry_path = control_dir / "registry.json"
    if not registry_path.is_file():
        raise ScanError(f"registry not found: {registry_path}")
    try:
        raw_registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ScanError(f"cannot read registry: {exc}") from exc
    if not isinstance(raw_registry, dict):
        raise ScanError("registry root must be a JSON object")
    if raw_registry.get("schema_version") != SCHEMA_VERSION:
        raise ScanError(f"registry schema_version must be {SCHEMA_VERSION}")
    layout = raw_registry.get("layout")
    if layout not in {"centralized", "colocated"}:
        raise ScanError("registry layout must be centralized or colocated")
    summary_name = raw_registry.get("summary_name", "MODULE_SUMMARY.md")
    if (
        not isinstance(summary_name, str)
        or not summary_name.endswith(".md")
        or PurePosixPath(summary_name).name != summary_name
    ):
        raise ScanError("summary_name must be a Markdown filename")
    raw_exclude_paths = raw_registry.get("exclude_paths", [])
    if not isinstance(raw_exclude_paths, list):
        raise ScanError("exclude_paths must be an array")
    exclude_paths = tuple(
        normalize_repo_path(path, "exclude path") for path in raw_exclude_paths
    )

    tracked_ref = raw_registry.get("tracked_ref", "HEAD")
    if not isinstance(tracked_ref, str) or not tracked_ref.strip():
        raise ScanError("tracked_ref must be a non-empty string")
    raw_modules = raw_registry.get("modules")
    if not isinstance(raw_modules, list) or not raw_modules:
        raise ScanError("registry modules must be a non-empty array")
    raw_retired_modules = raw_registry.get("retired_modules", [])
    if not isinstance(raw_retired_modules, list):
        raise ScanError("retired_modules must be an array")
    retired_ids: set[str] = set()
    for index, retired in enumerate(raw_retired_modules):
        if not isinstance(retired, dict):
            raise ScanError(f"retired_modules[{index}] must be an object")
        retired_id = retired.get("id")
        if (
            not isinstance(retired_id, str)
            or re.fullmatch(
                r"[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?",
                retired_id,
            )
            is None
        ):
            raise ScanError(f"invalid retired module id at index {index}")
        if retired_id in retired_ids:
            raise ScanError(f"duplicate retired module id: {retired_id}")
        retired_ids.add(retired_id)

    modules: list[Module] = []
    seen_ids: set[str] = set()
    seen_roots: dict[str, str] = {}
    seen_summaries: dict[str, str] = {}
    for index, raw_module in enumerate(raw_modules):
        if not isinstance(raw_module, dict):
            raise ScanError(f"modules[{index}] must be an object")
        module_id = raw_module.get("id")
        name = raw_module.get("name")
        if (
            not isinstance(module_id, str)
            or re.fullmatch(r"[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?", module_id)
            is None
        ):
            raise ScanError(
                f"invalid module id at modules[{index}]: use lowercase letters, "
                "numbers, dots, underscores, or hyphens"
            )
        if module_id in seen_ids:
            raise ScanError(f"duplicate module id: {module_id}")
        if module_id in retired_ids:
            raise ScanError(f"retired module id cannot be reused: {module_id}")
        seen_ids.add(module_id)
        if not isinstance(name, str) or not name.strip():
            raise ScanError(f"modules[{index}].name must be a non-empty string")

        raw_roots = raw_module.get("roots")
        if not isinstance(raw_roots, list) or not raw_roots:
            raise ScanError(f"module {module_id} must declare at least one root")
        roots = tuple(
            normalize_repo_path(root, f"module {module_id} root")
            for root in raw_roots
        )
        for root in roots:
            if path_matches_prefix(root, control_rel):
                raise ScanError(
                    f"control directory cannot contain module root {root}"
                )
            owner = seen_roots.get(root)
            if owner is not None:
                raise ScanError(f"duplicate module root {root}: {owner}, {module_id}")
            seen_roots[root] = module_id

        raw_shared = raw_module.get("shared_paths", [])
        if not isinstance(raw_shared, list):
            raise ScanError(f"module {module_id} shared_paths must be an array")
        shared_paths = tuple(
            normalize_repo_path(path, f"module {module_id} shared path")
            for path in raw_shared
        )
        summary_path = normalize_repo_path(
            raw_module.get("summary_path"),
            f"module {module_id} summary_path",
        )
        summary_owner = seen_summaries.get(summary_path)
        if summary_owner is not None:
            raise ScanError(
                f"duplicate summary path {summary_path}: "
                f"{summary_owner}, {module_id}"
            )
        seen_summaries[summary_path] = module_id
        path_inside(
            (repo / summary_path).resolve(),
            repo,
            f"module {module_id} summary path",
        )
        raw_primary_root = raw_module.get("primary_root")
        primary_root = (
            normalize_repo_path(
                raw_primary_root,
                f"module {module_id} primary_root",
            )
            if raw_primary_root is not None
            else None
        )
        if layout == "centralized":
            expected_summary_path = PurePosixPath(
                control_rel,
                "modules",
                f"{module_id}.md",
            ).as_posix()
            if summary_path != expected_summary_path:
                raise ScanError(
                    f"centralized summary for {module_id} must be "
                    f"{expected_summary_path}"
                )
        else:
            if primary_root is None:
                if len(roots) != 1:
                    raise ScanError(
                        f"colocated module {module_id} with multiple roots "
                        "must declare primary_root"
                    )
                primary_root = roots[0]
            if primary_root not in roots:
                raise ScanError(
                    f"module {module_id} primary_root must be one of its roots"
                )
            expected_summary_path = PurePosixPath(
                primary_root,
                summary_name,
            ).as_posix()
            if summary_path != expected_summary_path:
                raise ScanError(
                    f"colocated summary for {module_id} must be "
                    f"{expected_summary_path}"
                )
        mapping_revision = raw_module.get("mapping_revision", 1)
        if not isinstance(mapping_revision, int) or mapping_revision < 1:
            raise ScanError(f"module {module_id} mapping_revision must be positive")
        modules.append(
            Module(
                module_id=module_id,
                name=name,
                roots=roots,
                shared_paths=shared_paths,
                summary_path=summary_path,
                mapping_revision=mapping_revision,
                primary_root=primary_root,
            )
        )

    object_format = git_text(repo, "rev-parse", "--show-object-format")
    if object_format not in {"sha1", "sha256"}:
        raise ScanError(f"unsupported Git object format: {object_format}")
    return Context(
        repo=repo,
        control_dir=control_dir,
        control_rel=control_rel,
        tracked_ref=tracked_ref,
        object_format=object_format,
        layout=layout,
        summary_name=summary_name,
        exclude_paths=exclude_paths,
        modules=tuple(modules),
    )


def select_modules(context: Context, selectors: Sequence[str]) -> tuple[Module, ...]:
    if not selectors:
        return context.modules
    selected: list[Module] = []
    seen: set[str] = set()
    for selector in selectors:
        exact_id = [module for module in context.modules if module.module_id == selector]
        matches = exact_id or [
            module for module in context.modules if module.name == selector
        ]
        if not matches:
            raise ScanError(f"unknown module selector: {selector}")
        if len(matches) > 1:
            ids = ", ".join(module.module_id for module in matches)
            raise ScanError(f"ambiguous module selector {selector}: {ids}")
        module = matches[0]
        if module.module_id not in seen:
            selected.append(module)
            seen.add(module.module_id)
    return tuple(selected)


def path_matches_prefix(path: str, prefix: str) -> bool:
    return prefix == "." or path == prefix or path.startswith(f"{prefix}/")


def managed_path(context: Context, path: str) -> bool:
    if path_matches_prefix(path, context.control_rel):
        return True
    return any(path == module.summary_path for module in context.modules)


def root_owners(context: Context, path: str) -> set[str]:
    matches: list[tuple[int, str]] = []
    for module in context.modules:
        for root in module.roots:
            if path_matches_prefix(path, root):
                depth = 0 if root == "." else len(PurePosixPath(root).parts)
                matches.append((depth, module.module_id))
    if not matches:
        return set()
    max_depth = max(depth for depth, _ in matches)
    return {module_id for depth, module_id in matches if depth == max_depth}


def path_relevant(context: Context, module: Module, path: str | None) -> bool:
    if (
        path is None
        or managed_path(context, path)
        or path_excluded(context, path)
    ):
        return False
    if module.module_id in root_owners(context, path):
        return True
    return any(path_matches_prefix(path, shared) for shared in module.shared_paths)


def path_excluded(context: Context, path: str) -> bool:
    return any(
        path_matches_prefix(path, excluded) for excluded in context.exclude_paths
    )


def unassigned_tracked_paths(context: Context, target: str) -> list[str]:
    result = git(
        context.repo,
        "ls-tree",
        "-r",
        "--name-only",
        "-z",
        target,
    )
    paths = nul_paths(result)
    shared_paths = tuple(
        shared for module in context.modules for shared in module.shared_paths
    )
    return sorted(
        path
        for path in paths
        if not managed_path(context, path)
        and not path_excluded(context, path)
        and not root_owners(context, path)
        and not any(
            path_matches_prefix(path, shared) for shared in shared_paths
        )
    )


def nul_paths(result: subprocess.CompletedProcess[bytes]) -> set[str]:
    return {
        token.decode("utf-8", errors="surrogateescape")
        for token in result.stdout.split(b"\0")
        if token
    }


def dirty_paths(context: Context, module: Module) -> list[str]:
    paths = set()
    paths.update(nul_paths(git(context.repo, "diff", "--name-only", "-z", "--")))
    paths.update(
        nul_paths(git(context.repo, "diff", "--cached", "--name-only", "-z", "--"))
    )
    paths.update(
        nul_paths(
            git(
                context.repo,
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
            )
        )
    )
    return sorted(path for path in paths if path_relevant(context, module, path))


def parse_diff(raw: bytes) -> list[dict[str, str | None]]:
    tokens = raw.split(b"\0")
    if tokens and tokens[-1] == b"":
        tokens.pop()
    changes: list[dict[str, str | None]] = []
    index = 0
    while index < len(tokens):
        status = tokens[index].decode("ascii", errors="strict")
        index += 1
        if status.startswith(("R", "C")):
            if index + 1 >= len(tokens):
                raise ScanError("malformed NUL-delimited rename/copy diff")
            old_path = tokens[index].decode("utf-8", errors="surrogateescape")
            new_path = tokens[index + 1].decode("utf-8", errors="surrogateescape")
            index += 2
        else:
            if index >= len(tokens):
                raise ScanError("malformed NUL-delimited name-status diff")
            path = tokens[index].decode("utf-8", errors="surrogateescape")
            index += 1
            old_path = path if status != "A" else None
            new_path = path if status != "D" else None
        changes.append(
            {
                "status": status,
                "old_path": old_path,
                "new_path": new_path,
            }
        )
    return changes


def module_changes(
    context: Context,
    module: Module,
    baseline: str,
    target: str,
) -> list[dict[str, str | None]]:
    result = git(
        context.repo,
        "diff",
        "--name-status",
        "-z",
        "-M",
        "--diff-filter=ACDMRTUXB",
        baseline,
        target,
        "--",
    )
    changes = [
        change
        for change in parse_diff(result.stdout)
        if path_relevant(context, module, change["old_path"])
        or path_relevant(context, module, change["new_path"])
    ]
    return sorted(
        changes,
        key=lambda change: (
            change["old_path"] or "",
            change["new_path"] or "",
            change["status"] or "",
        ),
    )


def tree_paths(context: Context, module: Module, target: str) -> list[str]:
    pathspecs = list(module.roots)
    result = git(
        context.repo,
        "ls-tree",
        "-r",
        "--name-only",
        "-z",
        target,
        "--",
        *pathspecs,
    )
    paths = nul_paths(result)
    return sorted(
        path
        for path in paths
        if not managed_path(context, path)
        and module.module_id in root_owners(context, path)
    )


def source_fingerprint(context: Context, module: Module, target: str) -> str:
    pathspecs = list(dict.fromkeys((*module.roots, *module.shared_paths)))
    result = git(
        context.repo,
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        target,
        "--",
        *pathspecs,
    )
    digest = hashlib.sha256()
    digest.update(f"module:{module.module_id}\0".encode())
    digest.update(f"mapping:{module.mapping_revision}\0".encode())
    entries = []
    for entry in result.stdout.split(b"\0"):
        if not entry:
            continue
        _, separator, raw_path = entry.partition(b"\t")
        if not separator:
            raise ScanError("malformed git ls-tree output")
        path = raw_path.decode("utf-8", errors="surrogateescape")
        if path_relevant(context, module, path):
            entries.append(entry)
    for entry in sorted(entries):
        digest.update(entry)
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def is_full_oid(context: Context, value: object) -> bool:
    if not isinstance(value, str):
        return False
    expected_length = 40 if context.object_format == "sha1" else 64
    return re.fullmatch(rf"[0-9a-f]{{{expected_length}}}", value) is not None


def summary_file(context: Context, module: Module) -> Path:
    path = (context.repo / module.summary_path).resolve()
    path_inside(path, context.repo, f"module {module.module_id} summary path")
    return path


def state_path(context: Context, module: Module) -> Path:
    path = (context.control_dir / "state" / f"{module.module_id}.json").resolve()
    path_inside(path, context.control_dir, f"module {module.module_id} state path")
    return path


def load_state(context: Context, module: Module) -> dict[str, object] | None:
    path = state_path(context, module)
    if not path.exists():
        return None
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ScanError(f"cannot read state for {module.module_id}: {exc}") from exc
    if not isinstance(state, dict):
        raise ScanError(f"state for {module.module_id} must be an object")
    if state.get("schema_version") != SCHEMA_VERSION:
        raise ScanError(f"state schema mismatch for {module.module_id}")
    if state.get("module_id") != module.module_id:
        raise ScanError(f"state module_id mismatch for {module.module_id}")
    return state


def resolve_commit(context: Context, ref: str) -> str:
    return git_text(context.repo, "rev-parse", "--verify", f"{ref}^{{commit}}")


def commit_exists(context: Context, commit: str) -> bool:
    return (
        git(context.repo, "cat-file", "-e", f"{commit}^{{commit}}", check=False)
        .returncode
        == 0
    )


def is_ancestor(context: Context, baseline: str, target: str) -> bool:
    result = git(
        context.repo,
        "merge-base",
        "--is-ancestor",
        baseline,
        target,
        check=False,
    )
    if result.returncode not in {0, 1}:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise ScanError(f"cannot compare history: {detail}")
    return result.returncode == 0


def make_checkpoint_token(
    context: Context,
    module: Module,
    state: dict[str, object] | None,
    target: str,
    target_ref: str,
    changes: list[dict[str, str | None]],
    summary_sha256_at_plan: str,
    *,
    head_only: bool,
    accept_summary_drift: bool,
    adopt_existing_summary: bool,
    mapping_refresh: bool,
    rebaseline: bool,
) -> str:
    previous_baseline = state.get("baseline_commit") if state is not None else None
    previous_summary_hash = (
        state.get("summary_sha256") if state is not None else None
    )
    payload = {
        "schema_version": SCHEMA_VERSION,
        "module_id": module.module_id,
        "mapping_revision": module.mapping_revision,
        "state_generation": state.get("generation") if state is not None else None,
        "baseline_commit": previous_baseline,
        "target_commit": target,
        "target_ref": target_ref,
        "source_fingerprint": source_fingerprint(context, module, target),
        "previous_summary_sha256": previous_summary_hash,
        "summary_sha256_at_plan": summary_sha256_at_plan,
        "changes": changes,
        "head_only": head_only,
        "accept_summary_drift": accept_summary_drift,
        "adopt_existing_summary": adopt_existing_summary,
        "mapping_refresh": mapping_refresh,
        "rebaseline": rebaseline,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def plan_module(
    context: Context,
    module: Module,
    target: str,
    target_ref: str,
    *,
    head_only: bool,
    accept_summary_drift: bool,
    adopt_existing_summary: bool,
    mapping_refresh: bool,
    rebaseline: bool,
) -> dict[str, object]:
    state = load_state(context, module)
    blockers: list[str] = []
    warnings: list[str] = []
    summary_drift_detected = False
    dirty = dirty_paths(context, module)
    if dirty:
        if head_only:
            warnings.append("DIRTY_WORKTREE_IGNORED")
        else:
            blockers.append("DIRTY_WORKTREE")

    baseline: str | None = None
    changes: list[dict[str, str | None]] = []
    history_problem: str | None = None
    if state is not None:
        raw_baseline = state.get("baseline_commit")
        if not is_full_oid(context, raw_baseline):
            history_problem = "INVALID_BASELINE_OID"
        else:
            assert isinstance(raw_baseline, str)
            baseline = raw_baseline
            if not commit_exists(context, baseline):
                history_problem = "BASELINE_MISSING"
            elif not is_ancestor(context, baseline, target):
                history_problem = "HISTORY_DIVERGED"
            else:
                changes = module_changes(context, module, baseline, target)

        if rebaseline:
            if history_problem is None:
                blockers.append("REBASELINE_NOT_NEEDED")
            else:
                warnings.append("REBASELINE_REQUIRED")
        elif history_problem is not None:
            blockers.append(history_problem)

        mapping_changed = state.get("mapping_revision") != module.mapping_revision
        if mapping_refresh:
            if mapping_changed:
                warnings.append("MAPPING_REFRESH_REQUIRED")
            else:
                blockers.append("MAPPING_REFRESH_NOT_NEEDED")
        elif mapping_changed:
            blockers.append("MAPPING_REVISION_CHANGED")

        summary_path = summary_file(context, module)
        if not summary_path.is_file():
            if mapping_refresh or rebaseline:
                warnings.append("SUMMARY_REBUILD_REQUIRED")
            else:
                blockers.append("SUMMARY_MISSING")
        else:
            expected_hash = state.get("summary_sha256")
            if not isinstance(expected_hash, str):
                blockers.append("INVALID_SUMMARY_HASH")
            elif file_sha256(summary_path) != expected_hash:
                summary_drift_detected = True
                if accept_summary_drift:
                    warnings.append("SUMMARY_DRIFT_ACCEPTED")
                else:
                    blockers.append("SUMMARY_DRIFT")
    else:
        if mapping_refresh or rebaseline:
            blockers.append("RECOVERY_WITHOUT_STATE")
        summary_path = summary_file(context, module)
        if summary_path.exists():
            if adopt_existing_summary:
                warnings.append("EXISTING_SUMMARY_ADOPTED")
            else:
                blockers.append("SUMMARY_WITHOUT_STATE")

    tracked_paths = tree_paths(context, module, target)
    empty = not tracked_paths
    deleted = state is not None and empty
    if deleted:
        blockers.append("MODULE_DELETED")
    elif empty:
        blockers.append("MODULE_EMPTY")
    if accept_summary_drift and not summary_drift_detected:
        blockers.append("SUMMARY_DRIFT_NOT_PRESENT")

    if deleted:
        status = "deleted"
    elif blockers:
        status = "blocked"
    elif state is None:
        status = "new"
    elif changes or mapping_refresh or rebaseline:
        status = "changed"
    else:
        status = "unchanged"

    summary_sha256_at_plan = (
        file_sha256(summary_path) if summary_path.is_file() else "missing"
    )
    checkpoint_token = None
    if not blockers:
        checkpoint_token = make_checkpoint_token(
            context,
            module,
            state,
            target,
            target_ref,
            changes,
            summary_sha256_at_plan,
            head_only=head_only,
            accept_summary_drift=accept_summary_drift,
            adopt_existing_summary=adopt_existing_summary,
            mapping_refresh=mapping_refresh,
            rebaseline=rebaseline,
        )

    return {
        "id": module.module_id,
        "name": module.name,
        "status": status,
        "baseline_commit": baseline,
        "target_commit": target,
        "summary_path": module.summary_path,
        "changes": changes,
        "dirty_paths": dirty,
        "blockers": sorted(set(blockers)),
        "warnings": sorted(set(warnings)),
        "summary_sha256_at_plan": summary_sha256_at_plan,
        "checkpoint_token": checkpoint_token,
    }


def command_plan(args: argparse.Namespace) -> int:
    context = load_context(args.repo, args.control_dir)
    selected = select_modules(context, args.module)
    target_ref = args.target or context.tracked_ref
    target = resolve_commit(context, target_ref)
    modules = [
        plan_module(
            context,
            module,
            target,
            target_ref,
            head_only=args.head_only,
            accept_summary_drift=args.accept_summary_drift,
            adopt_existing_summary=args.adopt_existing_summary,
            mapping_refresh=args.mapping_refresh,
            rebaseline=args.rebaseline,
        )
        for module in selected
    ]
    unassigned_paths = (
        unassigned_tracked_paths(context, target)
        if not args.module or args.mapping_refresh
        else []
    )
    global_blockers = (
        ["UNASSIGNED_TRACKED_PATHS"] if unassigned_paths else []
    )
    has_blockers = bool(global_blockers) or any(
        module["blockers"] for module in modules
    )
    if has_blockers:
        for module in modules:
            module["checkpoint_token"] = None
    payload = {
        "schema_version": SCHEMA_VERSION,
        "repo_root": str(context.repo),
        "control_dir": str(context.control_dir),
        "target_ref": target_ref,
        "target_commit": target,
        "selection": [module.module_id for module in selected],
        "has_blockers": has_blockers,
        "global_blockers": global_blockers,
        "unassigned_paths": unassigned_paths,
        "modules": modules,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 2 if has_blockers else 0


def atomic_write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def command_checkpoint(args: argparse.Namespace) -> int:
    context = load_context(args.repo, args.control_dir)
    if not is_full_oid(context, args.target):
        raise ScanError("TARGET_OID_REQUIRED: --target must be a full commit OID")
    recovery_mode = args.mapping_refresh or args.rebaseline
    if recovery_mode and not args.reason:
        raise ScanError("--mapping-refresh/--rebaseline requires --reason")
    if args.reason and not recovery_mode:
        raise ScanError("--reason requires --mapping-refresh or --rebaseline")
    if not args.plan_token:
        raise ScanError(
            "PLAN_TOKEN_REQUIRED: run a blocker-free plan before checkpoint"
        )
    if args.summary_sha256_at_plan is None:
        raise ScanError(
            "PLAN_SUMMARY_HASH_REQUIRED: pass summary_sha256_at_plan from plan"
        )
    if (
        args.summary_sha256_at_plan != "missing"
        and re.fullmatch(
            r"sha256:[0-9a-f]{64}",
            args.summary_sha256_at_plan,
        )
        is None
    ):
        raise ScanError("invalid --summary-sha256-at-plan")

    selected = select_modules(context, [args.module])
    module = selected[0]
    target = resolve_commit(context, args.target)
    target_ref = args.target_ref
    current = resolve_commit(context, target_ref)
    if current != target:
        raise ScanError(
            f"TARGET_MOVED: {target_ref} is {current}, expected {target}"
        )
    tracked_paths = tree_paths(context, module, target)
    if not tracked_paths:
        raise ScanError(f"MODULE_DELETED: {module.module_id}")
    dirty = dirty_paths(context, module)
    if dirty and not args.head_only:
        raise ScanError(
            "DIRTY_WORKTREE: "
            + ", ".join(dirty)
            + " (commit changes or pass --head-only)"
        )

    previous = load_state(context, module)
    previous_baseline: str | None = None
    history_valid = previous is None
    mapping_changed = False
    if previous is not None:
        raw_baseline = previous.get("baseline_commit")
        if is_full_oid(context, raw_baseline):
            assert isinstance(raw_baseline, str)
            previous_baseline = raw_baseline
            history_valid = commit_exists(
                context,
                previous_baseline,
            ) and is_ancestor(
                context,
                previous_baseline,
                target,
            )
        else:
            history_valid = False
        mapping_changed = previous.get("mapping_revision") != module.mapping_revision
        if mapping_changed and not args.mapping_refresh:
            raise ScanError(
                "MAPPING_REVISION_CHANGED: run the mapping-refresh workflow"
            )

    if args.rebaseline:
        if previous is None:
            raise ScanError("REBASELINE_WITHOUT_STATE: use a normal initial plan")
        if history_valid:
            raise ScanError("REBASELINE_NOT_NEEDED: history is still linear")
    elif not history_valid:
        raise ScanError(
            "HISTORY_DIVERGED: use --rebaseline with --reason after a full rebuild"
        )
    if args.mapping_refresh:
        if previous is None:
            raise ScanError("MAPPING_REFRESH_WITHOUT_STATE: use a normal initial plan")
        if not mapping_changed:
            raise ScanError("MAPPING_REFRESH_NOT_NEEDED")

    changes: list[dict[str, str | None]] = []
    if previous_baseline is not None and history_valid:
        changes = module_changes(context, module, previous_baseline, target)
    expected_token = make_checkpoint_token(
        context,
        module,
        previous,
        target,
        target_ref,
        changes,
        args.summary_sha256_at_plan,
        head_only=args.head_only,
        accept_summary_drift=args.accept_summary_drift,
        adopt_existing_summary=args.adopt_existing_summary,
        mapping_refresh=args.mapping_refresh,
        rebaseline=args.rebaseline,
    )
    if args.plan_token != expected_token:
        raise ScanError(
            "PLAN_TOKEN_MISMATCH: repository, state, mapping, target ref, "
            "or plan options changed"
        )

    summary_path = summary_file(context, module)
    if not summary_path.is_file():
        raise ScanError(f"summary not found: {summary_path}")
    current_summary_hash = file_sha256(summary_path)
    summary_review_required = bool(changes) or recovery_mode
    if (
        summary_review_required
        and current_summary_hash == args.summary_sha256_at_plan
        and not args.summary_unchanged
    ):
        code = (
            "REBASELINE_SUMMARY_NOT_REBUILT"
            if args.rebaseline
            else "SUMMARY_NOT_UPDATED"
        )
        raise ScanError(
            f"{code}: edit the summary or pass --summary-unchanged "
            "after reviewing every reported change"
        )
    if args.summary_unchanged and not summary_review_required:
        raise ScanError(
            "SUMMARY_UNCHANGED_NOT_APPLICABLE: the plan reported no source "
            "or mapping change"
        )
    if (
        previous is not None
        and not summary_review_required
        and current_summary_hash != args.summary_sha256_at_plan
        and not args.accept_summary_drift
    ):
        raise ScanError(
            "SUMMARY_DRIFT: rerun plan/checkpoint with --accept-summary-drift "
            "after preserving the manual edits"
        )
    tree = git_text(context.repo, "rev-parse", "--verify", f"{target}^{{tree}}")
    payload: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "module_id": module.module_id,
        "generation": uuid.uuid4().hex,
        "mapping_revision": module.mapping_revision,
        "baseline_commit": target,
        "baseline_tree": tree,
        "source_fingerprint": source_fingerprint(context, module, target),
        "summary_path": module.summary_path,
        "summary_sha256": current_summary_hash,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if args.summary_unchanged:
        payload["summary_review"] = "unchanged-after-review"
    if args.rebaseline:
        payload["rebaseline"] = {
            "previous_baseline": previous_baseline,
            "reason": args.reason,
        }
    if args.mapping_refresh:
        payload["mapping_refresh"] = {
            "previous_mapping_revision": (
                previous.get("mapping_revision") if previous is not None else None
            ),
            "reason": args.reason,
        }
    path = state_path(context, module)
    atomic_write_json(path, payload)
    print(
        json.dumps(
            {
                "status": "checkpointed",
                "module_id": module.module_id,
                "target_commit": target,
                "state_path": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Plan and checkpoint per-module Git summary updates."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser(
        "plan",
        help="Emit a read-only JSON update plan.",
    )
    plan_parser.add_argument("--repo", required=True)
    plan_parser.add_argument("--control-dir", required=True)
    plan_parser.add_argument("--module", action="append", default=[])
    plan_parser.add_argument("--target")
    plan_parser.add_argument(
        "--head-only",
        action="store_true",
        help="Ignore target-module worktree changes and analyze committed Git objects.",
    )
    plan_parser.add_argument(
        "--accept-summary-drift",
        action="store_true",
        help="Allow a manually edited summary after preserving its changes.",
    )
    plan_parser.add_argument(
        "--adopt-existing-summary",
        action="store_true",
        help="Adopt a reviewed existing summary when no module state exists.",
    )
    plan_parser.add_argument("--mapping-refresh", action="store_true")
    plan_parser.add_argument("--rebaseline", action="store_true")
    plan_parser.set_defaults(handler=command_plan)

    checkpoint_parser = subparsers.add_parser(
        "checkpoint",
        help="Atomically record one module's successful summary baseline.",
    )
    checkpoint_parser.add_argument("--repo", required=True)
    checkpoint_parser.add_argument("--control-dir", required=True)
    checkpoint_parser.add_argument("--module", required=True)
    checkpoint_parser.add_argument("--target", required=True)
    checkpoint_parser.add_argument("--target-ref", required=True)
    checkpoint_parser.add_argument("--plan-token", required=True)
    checkpoint_parser.add_argument("--summary-sha256-at-plan", required=True)
    checkpoint_parser.add_argument("--head-only", action="store_true")
    checkpoint_parser.add_argument("--accept-summary-drift", action="store_true")
    checkpoint_parser.add_argument("--adopt-existing-summary", action="store_true")
    checkpoint_parser.add_argument("--summary-unchanged", action="store_true")
    checkpoint_parser.add_argument("--mapping-refresh", action="store_true")
    checkpoint_parser.add_argument("--rebaseline", action="store_true")
    checkpoint_parser.add_argument("--reason")
    checkpoint_parser.set_defaults(handler=command_checkpoint)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except ScanError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
