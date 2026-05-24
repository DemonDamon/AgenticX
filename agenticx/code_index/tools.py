"""Agent tool dispatch for code_index."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from agenticx.code_index.config import is_enabled, load_code_index_config
from agenticx.code_index.format import format_search_response
from agenticx.code_index.manager import CodeIndexManager
from agenticx.code_index.state import IndexStatus


def _resolve_codebase_path(raw: str, session: Any) -> Path:
    from agenticx.cli.agent_tools import _resolve_workspace_path

    text = (raw or "").strip()
    if not text:
        text = "."
    return _resolve_workspace_path(text, session, pick_existing=True)


def _require_enabled() -> None:
    if not is_enabled():
        raise RuntimeError(
            "未挂载代码脑且 code_index.enabled 为 false。请在 Near 设置 → 知识库 创建代码脑，"
            "或在 ~/.agenticx/config.yaml 启用 code_index。"
        )


def dispatch_code_search(arguments: dict[str, Any], session: Any = None) -> str:
    query = str(arguments.get("query", "") or "").strip()
    if not query:
        return "ERROR: query 不能为空"

    avatar_id = None
    if session is not None:
        avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    brain_id = str(arguments.get("brain_id") or "").strip() or None

    cfg = load_code_index_config()
    top_k = arguments.get("top_k")
    try:
        top_k_int = int(top_k) if top_k is not None else cfg.semble_default_top_k
    except (TypeError, ValueError):
        top_k_int = cfg.semble_default_top_k
    top_k_int = max(1, min(50, top_k_int))
    strategy = str(arguments.get("strategy") or cfg.semble_search_mode)

    try:
        from agenticx.brain.mount import resolve_mounted_brain_ids
        from agenticx.brain.registry import BrainRegistry
        from agenticx.brain.runtime_code import CodeBrainRuntime
        from agenticx.brain.manager import BrainManager
        from agenticx.brain.mount import load_avatar_brains_enabled
        from agenticx.brain.types import BrainType

        BrainRegistry.instance().bootstrap()
        targets = resolve_mounted_brain_ids(
            avatar_id=avatar_id,
            brains_enabled=load_avatar_brains_enabled(avatar_id),
            explicit_brain_id=brain_id,
            brain_type=BrainType.CODE,
        )
    except Exception:
        targets = []

    if targets:
        by_brain = []
        all_hits = []
        for bid in targets:
            brain = BrainRegistry.instance().get(bid)
            if brain is None:
                continue
            rt = BrainManager.instance().get_runtime(bid)
            if not isinstance(rt, CodeBrainRuntime):
                continue
            try:
                hits = rt.search(query, top_k=top_k_int)
                from agenticx.code_index.format import format_hits_for_tool

                formatted = format_hits_for_tool(hits)
                for h in formatted:
                    h["brain_id"] = bid
                    h["brain_name"] = brain.name
                by_brain.append({"brain_id": bid, "brain_name": brain.name, "hits": formatted})
                all_hits.extend(formatted)
            except Exception as exc:
                by_brain.append({"brain_id": bid, "brain_name": brain.name, "error": str(exc), "hits": []})
        return json.dumps(
            {"ok": True, "hits": all_hits[:top_k_int], "by_brain": by_brain, "brains": targets},
            ensure_ascii=False,
            indent=2,
        )

    _require_enabled()
    raw_path = str(arguments.get("codebase_path", "") or "").strip()
    try:
        codebase_path = _resolve_codebase_path(raw_path, session)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if not codebase_path.is_dir():
        return f"ERROR: codebase_path 不是目录: {codebase_path}"

    mgr = CodeIndexManager.instance()
    try:
        hits, partial, progress = mgr.search(
            codebase_path,
            query,
            top_k=top_k_int,
            strategy=strategy,
            wait_for_index=True,
        )
    except ImportError as exc:
        return (
            f"ERROR: code_index 依赖未安装 ({exc})。请执行: pip install 'agenticx[code_index]'"
        )
    except RuntimeError as exc:
        return f"ERROR: {exc}"

    return format_search_response(hits, partial=partial, indexing_progress=progress)


def dispatch_code_index_create(arguments: dict[str, Any], session: Any = None) -> str:
    _require_enabled()
    try:
        codebase_path = _resolve_codebase_path(str(arguments.get("codebase_path", "")), session)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if not codebase_path.is_dir():
        return f"ERROR: codebase_path 不是目录: {codebase_path}"
    result = CodeIndexManager.instance().create_index(codebase_path)
    return json.dumps(result, ensure_ascii=False)


def dispatch_code_index_status(arguments: dict[str, Any], session: Any = None) -> str:
    _require_enabled()
    raw = str(arguments.get("codebase_path", "") or "").strip()
    if not raw:
        mgr = CodeIndexManager.instance()
        with mgr._lock:
            tasks = [t.to_status_dict() for t in mgr._tasks.values()]
        return json.dumps({"tasks": tasks}, ensure_ascii=False, indent=2)
    try:
        codebase_path = _resolve_codebase_path(raw, session)
    except ValueError as exc:
        return f"ERROR: {exc}"
    status = CodeIndexManager.instance().get_status(codebase_path)
    return json.dumps(status, ensure_ascii=False, indent=2)


def dispatch_code_index_clear(arguments: dict[str, Any], session: Any = None) -> str:
    _require_enabled()
    try:
        codebase_path = _resolve_codebase_path(str(arguments.get("codebase_path", "")), session)
    except ValueError as exc:
        return f"ERROR: {exc}"
    CodeIndexManager.instance().clear(codebase_path)
    return json.dumps({"ok": True, "codebase_path": str(codebase_path)}, ensure_ascii=False)


def dispatch_code_index_cancel(arguments: dict[str, Any], session: Any = None) -> str:
    _require_enabled()
    task_id = str(arguments.get("task_id", "") or "").strip()
    if not task_id:
        return "ERROR: task_id 不能为空"
    ok = CodeIndexManager.instance().cancel(task_id)
    return json.dumps({"ok": ok, "task_id": task_id}, ensure_ascii=False)


def dispatch_code_find_related(arguments: dict[str, Any], session: Any = None) -> str:
    _require_enabled()
    try:
        codebase_path = _resolve_codebase_path(str(arguments.get("codebase_path", "")), session)
    except ValueError as exc:
        return f"ERROR: {exc}"
    file_path = str(arguments.get("file_path", "") or "").strip()
    line = int(arguments.get("line", 0) or 0)
    top_k = int(arguments.get("top_k", 10) or 10)
    from agenticx.code_index.format import hits_to_json
    from agenticx.code_index.manager import _task_key

    mgr = CodeIndexManager.instance()
    task = mgr.wait_until_indexed(codebase_path)
    with task.lock:
        if task.status != IndexStatus.INDEXED:
            return f"ERROR: 索引未就绪: {task.status.value} — {task.error_summary or ''}"

    backend_key = _task_key(codebase_path)
    with mgr._lock:
        backend = mgr._backends.get(backend_key)
    if backend is None:
        return "ERROR: 索引后端不存在"
    hits = backend.find_related(file_path, line, top_k=max(1, min(50, top_k)))
    return json.dumps({"results": hits_to_json(hits)}, ensure_ascii=False, indent=2)
