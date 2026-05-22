#!/usr/bin/env python3
"""STUDIO_TOOLS-compatible tool implementations for project_state.

Each public ``project_state_tool_*`` function returns a string ready for
inclusion in the LLM tool result. JSON payloads are pretty-printed for
human + model readability.

Author: Damon Li
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.project_state.feature_list import (
    commit_active_feature,
    find_feature,
    has_active_in_progress,
    select_next_pending,
    summarize,
    transition_feature,
    upsert_features,
)
from agenticx.project_state.init_script import (
    write_default_init_script,
    write_default_verify_yaml,
)
from agenticx.project_state.progress import ensure_progress_header
from agenticx.project_state.schema import (
    FEATURE_IN_PROGRESS,
    FEATURE_PENDING,
    FEATURE_VERIFIED,
    PHASE_COMMIT,
    PHASE_IMPLEMENT,
    PHASE_INITIALIZE,
    PHASE_VERIFY,
    Feature,
    default_feature_list,
    default_status,
)
from agenticx.project_state.store import (
    ProjectStateError,
    ProjectStore,
    locate_project_root,
)
from agenticx.project_state.verify import run_verify

PROJECT_STATE_TOOL_NAMES = frozenset(
    {
        "project_init",
        "project_status",
        "feature_select",
        "feature_complete",
        "progress_append",
        "verify_run",
    }
)


def _ok(payload: Dict[str, Any]) -> str:
    return json.dumps({"ok": True, **payload}, ensure_ascii=False, indent=2)


def _err(message: str, **extra: Any) -> str:
    return json.dumps({"ok": False, "error": message, **extra}, ensure_ascii=False, indent=2)


def _resolve_workspace_root(session: Any) -> Path:
    """Pick the most likely workspace root for the session.

    Prefers user-added taskspaces (non-default) since the user explicitly bound
    them via the Desktop workspace panel.
    """
    candidates: List[Path] = []

    def _add(raw: Any) -> None:
        text = str(raw or "").strip()
        if not text:
            return
        try:
            p = Path(text).expanduser().resolve(strict=False)
        except Exception:
            return
        if p.is_dir() and p not in candidates:
            candidates.append(p)

    taskspaces = getattr(session, "taskspaces", None)
    if isinstance(taskspaces, list):
        non_default: List[str] = []
        default_paths: List[str] = []
        for item in taskspaces:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path", "") or "").strip()
            if not path:
                continue
            if str(item.get("id", "") or "").strip() == "default":
                default_paths.append(path)
            else:
                non_default.append(path)
        for p in non_default:
            _add(p)
        for p in default_paths:
            _add(p)

    _add(getattr(session, "workspace_dir", None))
    if candidates:
        return candidates[0]
    return Path.cwd().resolve()


def _open_store(session: Any, *, create: bool = False) -> ProjectStore:
    workspace_root = _resolve_workspace_root(session)
    return ProjectStore.open(workspace_root, create=create)


def _features_payload(items: List[Dict[str, Any]]) -> List[Feature]:
    if not isinstance(items, list) or not items:
        raise ProjectStateError("project_init requires non-empty 'features' list")
    parsed: List[Feature] = []
    for raw in items:
        try:
            parsed.append(Feature.from_dict(raw))
        except ValueError as exc:
            raise ProjectStateError(f"invalid feature entry: {exc}") from exc
    return parsed


def project_init_tool(arguments: Dict[str, Any], session: Any) -> str:
    """Initialize ``.agx/project/`` with feature_list / status / templates."""
    workspace_root = _resolve_workspace_root(session)
    project_id = str(arguments.get("project_id") or workspace_root.name).strip() or workspace_root.name
    description = str(arguments.get("description") or "").strip()
    features_raw = arguments.get("features") or []
    overwrite = bool(arguments.get("overwrite", False))

    try:
        try:
            features = _features_payload(features_raw)
        except ProjectStateError as exc:
            return _err(str(exc))

        # Resolve target root: prefer .agx/project/ inside workspace, create if missing.
        try:
            root = locate_project_root(workspace_root, create=True)
        except ProjectStateError as exc:
            return _err(str(exc))
        store = ProjectStore(root)

        if store.is_initialized() and not overwrite:
            return _err(
                "project already initialized; pass overwrite=true to rewrite "
                "the feature list (status will be preserved if phase != initialize)"
            )

        with store.lock():
            payload = default_feature_list()
            upsert_features(payload, features, allow_status_overwrite=False)
            store.save_feature_list(payload)

            status = store.load_status() if store.status_path.is_file() else default_status(project_id)
            if not store.status_path.is_file():
                status.project_id = project_id
                status.phase = PHASE_INITIALIZE
            else:
                status.project_id = status.project_id or project_id
            store.save_status(status)

            ensure_progress_header(store.progress_path)
            store.append_progress(
                f"[init] phase={status.phase} project_id={status.project_id} "
                f"features={len(payload.features)} description={description!r}"
            )

            init_path = write_default_init_script(store.init_script_path)
            verify_path = write_default_verify_yaml(store.verify_yaml_path)

        return _ok(
            {
                "project_id": status.project_id,
                "root": str(store.root),
                "feature_count": len(payload.features),
                "phase": status.phase,
                "init_script": str(init_path),
                "verify_yaml": str(verify_path),
                "next_step": (
                    "review init.sh + verify.yaml, run them via bash_exec and verify_run, "
                    "then git add/commit .agx/project init.sh verify.yaml"
                ),
            }
        )
    except ProjectStateError as exc:
        return _err(str(exc))
    except Exception as exc:  # pragma: no cover - safety
        return _err(f"project_init crashed: {exc}")


def project_status_tool(arguments: Dict[str, Any], session: Any) -> str:
    """Read status.json + feature_list.json summary + progress tail."""
    progress_tail = int(arguments.get("progress_tail", 20) or 20)
    progress_tail = max(0, min(200, progress_tail))
    try:
        store = _open_store(session)
    except ProjectStateError as exc:
        return _err(str(exc), hint="call project_init to bootstrap .agx/project")
    try:
        status = store.load_status()
        feature_list = store.load_feature_list()
    except ProjectStateError as exc:
        return _err(str(exc))
    counts = summarize(feature_list)
    active = find_feature(feature_list, status.active_feature_id or "")
    pending_top = [
        {
            "id": f.id,
            "title": f.title,
            "priority": f.priority,
            "depends_on": list(f.depends_on),
        }
        for f in sorted(
            (f for f in feature_list.features if f.status == FEATURE_PENDING),
            key=lambda f: (int(f.priority), f.created_at, f.id),
        )[:5]
    ]
    return _ok(
        {
            "project_id": status.project_id,
            "root": str(store.root),
            "phase": status.phase,
            "active_feature": (active.to_dict() if active else None),
            "counts": counts,
            "verify_pass_count": status.verify_pass_count,
            "verify_fail_count": status.verify_fail_count,
            "last_commit_sha": status.last_commit_sha,
            "pending_top": pending_top,
            "progress_tail": store.read_progress_tail(progress_tail),
        }
    )


def feature_select_tool(arguments: Dict[str, Any], session: Any) -> str:
    """Mark a feature in_progress and update status.active_feature_id."""
    requested_id = str(arguments.get("feature_id") or "").strip() or None
    try:
        store = _open_store(session)
    except ProjectStateError as exc:
        return _err(str(exc))

    try:
        with store.lock():
            payload = store.load_feature_list()
            status = store.load_status()

            current = has_active_in_progress(payload)
            if current is not None and current.id != requested_id:
                return _err(
                    f"another feature is already in_progress: {current.id} ({current.title}). "
                    "Finish or skip it before selecting a new one.",
                    active_feature_id=current.id,
                )

            if requested_id:
                feat = find_feature(payload, requested_id)
                if feat is None:
                    return _err(f"unknown feature id: {requested_id}")
                missing_deps = [
                    dep for dep in feat.depends_on
                    if not any(
                        f.id == dep and f.status == "committed"
                        for f in payload.features
                    )
                ]
                if missing_deps:
                    return _err(
                        f"feature {feat.id} has unmet dependencies: {missing_deps}",
                        depends_on=missing_deps,
                    )
                if feat.status == FEATURE_IN_PROGRESS:
                    pass  # idempotent re-select
                else:
                    transition_feature(payload, feat.id, FEATURE_IN_PROGRESS)
            else:
                feat = select_next_pending(payload)
                if feat is None:
                    return _err(
                        "no pending feature with satisfied dependencies",
                        counts=summarize(payload),
                    )
                transition_feature(payload, feat.id, FEATURE_IN_PROGRESS)

            status.active_feature_id = feat.id
            status.phase = PHASE_IMPLEMENT
            store.save_feature_list(payload)
            store.save_status(status)
            store.append_progress(
                f"[select] feature_id={feat.id} title={feat.title!r} phase={status.phase}"
            )
        return _ok(
            {
                "feature": feat.to_dict(),
                "phase": status.phase,
                "next_step": "implement using code_dev (Explore→Read→Author), then call verify_run",
            }
        )
    except ProjectStateError as exc:
        return _err(str(exc))


def feature_complete_tool(arguments: Dict[str, Any], session: Any) -> str:
    """Move a verified feature to committed after a successful git commit."""
    feature_id = str(arguments.get("feature_id") or "").strip()
    commit_sha = str(arguments.get("commit_sha") or "").strip()
    if not feature_id:
        return _err("feature_id is required")
    if not commit_sha:
        return _err("commit_sha is required (run git commit first via bash_exec)")
    try:
        store = _open_store(session)
    except ProjectStateError as exc:
        return _err(str(exc))
    try:
        with store.lock():
            payload = store.load_feature_list()
            status = store.load_status()
            feat = find_feature(payload, feature_id)
            if feat is None:
                return _err(f"unknown feature id: {feature_id}")
            if feat.status == FEATURE_IN_PROGRESS:
                # Allow direct in_progress → committed when commit_sha is supplied
                # only if verify already passed (status.verify_pass_count > 0 for it).
                # Otherwise force the model to call verify_run first.
                return _err(
                    f"feature {feature_id} is still in_progress. Run verify_run first to advance to verified.",
                )
            if feat.status == FEATURE_VERIFIED:
                feat = commit_active_feature(store, payload, feature_id, commit_sha)
                status.last_commit_sha = commit_sha
                status.active_feature_id = None
                status.phase = PHASE_COMMIT
                store.save_feature_list(payload)
                store.save_status(status)
                store.append_progress(
                    f"[commit] feature_id={feature_id} sha={commit_sha[:12]} "
                    f"title={feat.title!r}"
                )
                return _ok(
                    {
                        "feature": feat.to_dict(),
                        "phase": status.phase,
                        "next_step": "call feature_select to pick the next pending feature",
                    }
                )
            return _err(
                f"feature {feature_id} status={feat.status} cannot be committed",
            )
    except ProjectStateError as exc:
        return _err(str(exc))


def progress_append_tool(arguments: Dict[str, Any], session: Any) -> str:
    """Append a freeform line to progress.md."""
    text = str(arguments.get("message") or "").strip()
    if not text:
        return _err("message is required")
    try:
        store = _open_store(session)
    except ProjectStateError as exc:
        return _err(str(exc))
    try:
        ensure_progress_header(store.progress_path)
        store.append_progress(text)
    except ProjectStateError as exc:
        return _err(str(exc))
    return _ok({"appended": True, "path": str(store.progress_path)})


def verify_run_tool(arguments: Dict[str, Any], session: Any) -> str:
    """Run verify.yaml steps; advance verified status on success."""
    feature_id = str(arguments.get("feature_id") or "").strip() or None
    only_step = str(arguments.get("only_step") or "").strip() or None
    try:
        store = _open_store(session)
    except ProjectStateError as exc:
        return _err(str(exc))
    workspace_root = _resolve_workspace_root(session)

    try:
        result = run_verify(
            store,
            workspace_root=workspace_root,
            feature_id=feature_id,
            only_step=only_step,
        )
    except ProjectStateError as exc:
        return _err(str(exc))
    except Exception as exc:  # pragma: no cover - safety
        return _err(f"verify_run crashed: {exc}")

    try:
        with store.lock():
            status = store.load_status()
            payload = store.load_feature_list()
            if result.passed:
                status.verify_pass_count += 1
                status.phase = PHASE_VERIFY
                if feature_id:
                    feat = find_feature(payload, feature_id)
                    if feat is not None and feat.status == FEATURE_IN_PROGRESS:
                        try:
                            transition_feature(
                                payload,
                                feature_id,
                                FEATURE_VERIFIED,
                                evidence={"verify_log": str(result.log_path) if result.log_path else None},
                            )
                            store.save_feature_list(payload)
                        except ProjectStateError:
                            pass
            else:
                status.verify_fail_count += 1
            store.save_status(status)
            store.append_progress(
                f"[verify] passed={result.passed} feature_id={feature_id} "
                f"summary={result.summary.splitlines()[0]!r}"
            )
    except ProjectStateError as exc:
        return _err(str(exc))

    return _ok(
        {
            "result": result.to_dict(),
            "phase": status.phase,
            "next_step": (
                "call feature_complete with the new commit sha"
                if result.passed
                else "fix the failing step and call verify_run again"
            ),
        }
    )


def project_state_tool_schemas() -> List[Dict[str, Any]]:
    """Return STUDIO_TOOLS-compatible function schemas."""
    return [
        {
            "type": "function",
            "function": {
                "name": "project_init",
                "description": (
                    "Initialize the .agx/project state machine: write feature_list.json, status.json, "
                    "init.sh, verify.yaml, and seed progress.md. Pass features=[{id,title,...}] "
                    "with at least 5 entries when the parent plan demands it. Use overwrite=true to "
                    "replace an existing feature list while preserving status."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string", "description": "Stable project id; defaults to workspace folder name."},
                        "description": {"type": "string", "description": "One-line project description."},
                        "features": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string"},
                                    "title": {"type": "string"},
                                    "description": {"type": "string"},
                                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
                                    "depends_on": {"type": "array", "items": {"type": "string"}},
                                    "priority": {"type": "integer"},
                                },
                                "required": ["id", "title"],
                            },
                        },
                        "overwrite": {"type": "boolean"},
                    },
                    "required": ["features"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "project_status",
                "description": (
                    "Read the on-disk project state: status.json, feature_list summary, top pending "
                    "features, and the tail of progress.md. Always call this first when entering a "
                    "feature_loop session to recover context from disk instead of relying on memory."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "progress_tail": {
                            "type": "integer",
                            "description": "Number of progress.md tail lines to return (0-200).",
                        },
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "feature_select",
                "description": (
                    "Mark a feature in_progress and set status.active_feature_id. Pass feature_id "
                    "explicitly to resume a specific deliverable, or leave empty to auto-pick the "
                    "highest-priority pending feature with satisfied dependencies."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "feature_id": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "feature_complete",
                "description": (
                    "Promote a verified feature to committed and write its archive snapshot. "
                    "Requires commit_sha returned by `git commit` (run via bash_exec first)."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "feature_id": {"type": "string"},
                        "commit_sha": {"type": "string"},
                    },
                    "required": ["feature_id", "commit_sha"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "progress_append",
                "description": "Append a single line to progress.md (timestamped automatically).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {"type": "string"},
                    },
                    "required": ["message"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "verify_run",
                "description": (
                    "Run the verify.yaml gate (init.sh + tests + lints). Pass feature_id when "
                    "verifying a specific deliverable so passing runs auto-advance it to verified. "
                    "Use only_step to rerun a single step by name."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "feature_id": {"type": "string"},
                        "only_step": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
            },
        },
    ]


_DISPATCH = {
    "project_init": project_init_tool,
    "project_status": project_status_tool,
    "feature_select": feature_select_tool,
    "feature_complete": feature_complete_tool,
    "progress_append": progress_append_tool,
    "verify_run": verify_run_tool,
}


def dispatch_project_state_tool(name: str, arguments: Dict[str, Any], session: Any) -> str:
    """Synchronous dispatcher for project_state tools."""
    func = _DISPATCH.get(name)
    if func is None:
        return _err(f"unknown project_state tool: {name}")
    try:
        return func(arguments or {}, session)
    except Exception as exc:  # pragma: no cover - defensive
        return _err(f"{name} crashed: {exc}")
