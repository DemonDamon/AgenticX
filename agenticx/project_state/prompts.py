#!/usr/bin/env python3
"""System-prompt blocks for feature_loop sessions.

Two phase-aware templates are emitted via ``build_project_state_blocks``:
- Initializer phase: guides the agent to produce feature_list + init.sh + verify.yaml.
- Coding phase (implement/verify/commit): forces project_status -> feature_select
  -> code_dev loop -> verify_run -> git commit -> feature_complete.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agenticx.project_state.feature_list import find_feature, summarize
from agenticx.project_state.schema import (
    PHASE_INITIALIZE,
    PHASE_IMPLEMENT,
)
from agenticx.project_state.store import (
    ProjectStateError,
    ProjectStore,
    locate_project_root,
)

_FEATURE_LOOP_MODE = "feature_loop"
_MAX_PROGRESS_TAIL = 5
_MAX_PENDING_LISTED = 5
_MAX_BLOCK_CHARS = 1800


def _resolve_workspace_root(session: Any) -> Path | None:
    raw = str(getattr(session, "workspace_dir", "") or "").strip()
    if raw:
        p = Path(raw).expanduser()
        if p.is_dir():
            return p.resolve()
    taskspaces = getattr(session, "taskspaces", None) or []
    for ts in taskspaces:
        if isinstance(ts, dict):
            path = str(ts.get("path", "") or "").strip()
            if path:
                p = Path(path).expanduser()
                if p.is_dir():
                    return p.resolve()
    return None


def _initializer_block(min_features: int) -> str:
    return (
        "## 项目级 Harness — Initializer 阶段\n"
        f"- 当前 phase: initialize；本会话的目标是奠基，**不**直接实现 feature。\n"
        f"- 必须先**全面读取**用户给出的规格 / spec markdown / GitHub issue / 自然语言需求。\n"
        f"- 然后调用 `project_init` 写出 ≥ {min_features} 个 feature（含 id/title/acceptance_criteria/depends_on/priority）；feature 必须**可独立合并**。\n"
        "- `project_init` 会自动落 `init.sh` 与 `verify.yaml` 模板；你必须用 `bash_exec` 把它们改成项目实际依赖与测试命令。\n"
        "- 完成后用 `bash_exec` 跑首轮 `verify_run` 体检，再用 `bash_exec git add .agx/project init.sh verify.yaml && git commit` 落初始 commit。\n"
        "- 最后调 `progress_append` 写一条「[initialize-done] commit=<sha>」并提示用户切换到 Coding 会话。\n"
        "- 严禁在 Initializer 阶段直接动业务代码（feature_select / feature_complete 也不应在本阶段调用）。\n"
    )


def _coding_block(status_dict: dict, summary: dict, active_feature: dict | None,
                  pending_top: list[dict], progress_tail: list[str]) -> str:
    lines: list[str] = []
    lines.append("## 项目级 Harness — Coding 阶段（外置状态机）")
    lines.append(
        f"- 数据源（**单一事实源**）：{status_dict.get('root', '')}/{{feature_list.json,status.json,progress.md}}；\n"
        f"  以磁盘为准，不要凭对话内存推断。"
    )
    lines.append(
        f"- 当前 phase={status_dict.get('phase')}, "
        f"active_feature={status_dict.get('active_feature_id') or '(none)'}, "
        f"verified={summary.get('verified', 0)}/{summary.get('total', 0)}, "
        f"pending={summary.get('pending', 0)}, in_progress={summary.get('in_progress', 0)}."
    )
    if active_feature is not None:
        ac = active_feature.get("acceptance_criteria") or []
        ac_text = "; ".join(str(x) for x in ac[:3]) or "(no criteria)"
        lines.append(
            f"- Active feature: {active_feature.get('id')} — {active_feature.get('title')}\n"
            f"  验收: {ac_text}"
        )
    if pending_top:
        lines.append("- 待选 pending（按 priority 升序）:")
        for f in pending_top[:_MAX_PENDING_LISTED]:
            deps = f.get("depends_on") or []
            dep_str = f" deps={list(deps)}" if deps else ""
            lines.append(f"  · {f.get('id')} — {f.get('title')}{dep_str} priority={f.get('priority')}")
    if progress_tail:
        lines.append("- 最近 progress.md:")
        for ln in progress_tail[-_MAX_PROGRESS_TAIL:]:
            lines.append(f"  {ln}")
    lines.append(
        "- **强制工作流**：\n"
        "  1. 任何新会话先 `project_status` 同步磁盘状态。\n"
        "  2. 用 `feature_select` 选下一个 feature（缺省自动选优先级最高且依赖满足者）；同一时刻只允许一个 in_progress。\n"
        "  3. 用 code_dev 三相位实现（Explore → Read → Author）。\n"
        "  4. 实现完成后调 `verify_run feature_id=<id>`；任一 step 失败 → 不前进，写 `progress_append` 记录原因。\n"
        "  5. verify 通过后用 `bash_exec git add -A && git commit -m \"feat(<id>): ...\"` 拿到 commit sha。\n"
        "  6. 调 `feature_complete feature_id=<id> commit_sha=<sha>` 写 archive 并标记 committed。\n"
        "  7. 选下一个 feature 或停下与用户确认。\n"
        "- **禁止**：跳过 verify_run 直接 feature_complete；同时把多个 feature 标 in_progress；改写已 committed 的 archive 文件。\n"
    )
    return "\n".join(lines) + "\n"


def build_project_state_blocks(session: Any) -> str:
    """Return system-prompt block for feature_loop sessions; empty otherwise.

    The block is bounded to ``_MAX_BLOCK_CHARS`` to keep token cost predictable.
    """
    mode = str(getattr(session, "session_mode", "") or "").strip().lower()
    if mode != _FEATURE_LOOP_MODE:
        return ""

    workspace_root = _resolve_workspace_root(session)
    if workspace_root is None:
        return (
            "## 项目级 Harness — 未配置 workspace\n"
            "- session_mode=feature_loop 但找不到 workspace_dir / taskspaces；\n"
            "  请先在 Desktop 工作区面板绑定一个目录，再继续会话。\n"
        )

    try:
        root = locate_project_root(workspace_root, use_fallback=True, create=False)
    except ProjectStateError:
        return (
            "## 项目级 Harness — 未初始化\n"
            f"- workspace_root={workspace_root} 下未发现 `.agx/project/`。\n"
            "- 这是 Initializer 阶段：请按用户给出的规格调用 `project_init` 奠基。\n"
            f"{_initializer_block(min_features=5)}"
        )

    try:
        store = ProjectStore(root)
        status = store.load_status()
        feature_list = store.load_feature_list()
    except ProjectStateError as exc:
        return (
            "## 项目级 Harness — 状态损坏\n"
            f"- 读取 {root} 失败: {exc}。请联系用户决定是否修复或重建。\n"
        )

    if status.phase == PHASE_INITIALIZE:
        block = (
            "## 项目级 Harness — Initializer 阶段（已检测到部分初始化）\n"
            f"- root: {store.root}\n"
            f"- 当前 feature 数: {len(feature_list.features)}\n"
            f"{_initializer_block(min_features=int(status.initializer_min_features))}"
        )
    else:
        active = find_feature(feature_list, status.active_feature_id or "")
        summary = summarize(feature_list)
        pending_top = [
            {
                "id": f.id,
                "title": f.title,
                "priority": f.priority,
                "depends_on": list(f.depends_on),
            }
            for f in sorted(
                (f for f in feature_list.features if f.status == "pending"),
                key=lambda f: (int(f.priority), f.created_at, f.id),
            )[:_MAX_PENDING_LISTED]
        ]
        progress_tail = store.read_progress_tail(_MAX_PROGRESS_TAIL)
        block = _coding_block(
            status_dict={
                "root": str(store.root),
                "phase": status.phase,
                "active_feature_id": status.active_feature_id,
            },
            summary=summary,
            active_feature=(active.to_dict() if active else None),
            pending_top=pending_top,
            progress_tail=progress_tail,
        )

    if len(block) > _MAX_BLOCK_CHARS:
        block = block[: _MAX_BLOCK_CHARS - 80] + "\n... (project state block truncated)\n"
    return block
