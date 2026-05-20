#!/usr/bin/env python3
"""System prompt blocks for code_dev harness mode.

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from agenticx.runtime.code_read_cache import build_read_files_block
from agenticx.runtime.session_mode import is_code_dev

_REPO_SKELETON_MAX = 4000
_SKIP_DIR_NAMES = {
    "node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv",
    ".cursor", "coverage", ".turbo", "target", ".next",
}
_ENTRY_CANDIDATES = (
    "agenticx/cli/__main__.py",
    "agenticx/studio/server.py",
    "desktop/electron/main.ts",
    "desktop/src/main.tsx",
)


def _workspace_root(session: Any) -> Path | None:
    raw = str(getattr(session, "workspace_dir", "") or "").strip()
    if raw:
        p = Path(raw).expanduser()
        if p.is_dir():
            return p.resolve()
    for ts in getattr(session, "taskspaces", None) or []:
        if isinstance(ts, dict):
            path = str(ts.get("path", "") or "").strip()
            if path:
                p = Path(path).expanduser()
                if p.is_dir():
                    return p.resolve()
    env = os.getenv("AGX_WORKSPACE_ROOT", "").strip()
    if env:
        p = Path(env).expanduser()
        if p.is_dir():
            return p.resolve()
    cwd = Path.cwd()
    if cwd.is_dir():
        return cwd.resolve()
    return None


def _tree_lines(root: Path, max_depth: int = 2) -> list[str]:
    lines: list[str] = []

    def walk(path: Path, prefix: str, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            children = sorted(path.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return
        dirs = [c for c in children if c.is_dir() and c.name not in _SKIP_DIR_NAMES and not c.name.startswith(".")]
        files = [c for c in children if c.is_file() and not c.name.startswith(".")][:20]
        for d in dirs:
            lines.append(f"{prefix}{d.name}/")
            walk(d, prefix + "  ", depth + 1)
        for f in files:
            lines.append(f"{prefix}{f.name}")

    lines.append(f"{root.name}/")
    walk(root, "  ", 1)
    return lines


def _project_snippet(root: Path) -> str:
    parts: list[str] = []
    pyproject = root / "pyproject.toml"
    if pyproject.is_file():
        try:
            text = pyproject.read_text(encoding="utf-8", errors="replace")
            parts.append("### pyproject.toml (excerpt)\n" + "\n".join(text.splitlines()[:25]))
        except OSError:
            pass
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            text = pkg.read_text(encoding="utf-8", errors="replace")
            parts.append("### package.json (excerpt)\n" + "\n".join(text.splitlines()[:20]))
        except OSError:
            pass
    entries = [p for p in _ENTRY_CANDIDATES if (root / p).is_file()]
    if entries:
        parts.append("### 主入口候选\n" + "\n".join(f"- {e}" for e in entries))
    return "\n\n".join(parts)


def build_repo_skeleton_block(session: Any) -> str:
    if not is_code_dev(session):
        return ""
    root = _workspace_root(session)
    if root is None:
        return ""
    tree = "\n".join(_tree_lines(root))
    snippet = _project_snippet(root)
    body = (
        f"当前工作区: `{root}`\n\n"
        f"### 目录树 (depth≤2)\n```\n{tree}\n```\n\n"
        f"{snippet}\n"
    )
    if len(body) > _REPO_SKELETON_MAX:
        body = body[:_REPO_SKELETON_MAX] + "\n...(truncated)\n"
    return f"## 仓库骨架（L1，code_dev）\n{body}\n"


def _code_index_enabled() -> bool:
    try:
        from agenticx.code_index.config import is_enabled

        return is_enabled()
    except Exception:
        return False


def build_phase_gate_block() -> str:
    explore_tools = (
        "`code_search`（优先）→ `code_outline` → `bash_exec grep` → `lsp_*`"
        if _code_index_enabled()
        else "`code_outline`、`bash_exec grep`、`lsp_*`、`code_search`（若可用）"
    )
    correct_line = (
        "✅ 正确：code_search → file_read(命中行范围扩上下文) → scratchpad → file_write 分章。\n"
        if _code_index_enabled()
        else "✅ 正确：grep → code_outline → file_read(行范围) → scratchpad → file_write 分章。\n"
    )
    return (
        "## 工作相位（Phase Gate，code_dev 必须遵守）\n"
        "三相位与建议工具预算（相对 max_tool_rounds）：\n"
        f"1. **Explore（≤25%）**：{explore_tools}。"
        "产出「待读文件清单」并 `scratchpad_write(key=\"phase\", value=\"explore\")`。\n"
        "2. **Read（≤50%）**：`file_read` 必须带 `start_line/end_line` 片段；结论写入 scratchpad。"
        "完成后 `scratchpad_write(key=\"phase\", value=\"read\")`。\n"
        "3. **Author（≥25%）**：先 `file_write` 骨架（仅标题占位），再分章追加；"
        "`scratchpad_write(key=\"phase\", value=\"author\")`。\n\n"
        f"{correct_line}"
        "❌ 错误：一上来 file_read 整个 core/ 目录下所有 .py。\n\n"
        "切换相位时更新 scratchpad 的 `phase` 键；进入 Author 前须已有骨架文件。\n"
    )


def build_file_read_discipline_block() -> str:
    locate_hint = (
        "2. `code_search` 命中后必须用 `file_read(start_line,end_line)` 扩上下文，禁止仅凭 snippet 作答。\n"
        "3. 精确字符串/是否存在 → 仍用 `bash_exec grep -n`。\n"
        if _code_index_enabled()
        else "2. 已知行号 → 必须 `start_line/end_line`；未知 → 先 `bash_exec grep -n`。\n"
    )
    tail = (
        "4. 已读文件见「已读文件清单」；未变更则勿重复整读。\n"
        "5. 单文件输出上限 8000 字符（code_dev）；截断后请缩小行范围。\n"
        if _code_index_enabled()
        else (
            "3. 已读文件见「已读文件清单」；未变更则勿重复整读。\n"
            "4. 单文件输出上限 8000 字符（code_dev）；截断后请缩小行范围。\n"
        )
    )
    return (
        "## 读取纪律（L3/L4，code_dev）\n"
        "1. 整文件 `file_read` 仅在 outline + grep 仍无法定位时使用，并说明理由。\n"
        f"{locate_hint}"
        f"{tail}"
    )


def build_author_templates_block() -> str:
    return (
        "## Author 阶段模板（先骨架后分章）\n"
        "进入 Author 后第一次 `file_write` 只写一级标题与占位段落（≤100 行）。"
        "每完成一节再 `file_write` 更新该节；禁止最后一轮一次性输出超长全文。\n"
        "完成后 `scratchpad_write(key=\"delivered_sections::<目标路径>\", value=\"章节列表\")`。\n\n"
        "任务类型章节建议：\n"
        "- 架构调研：背景 / 现状 / 瓶颈 / 候选方案 / 风险 / 里程碑\n"
        "- PR Review：变更摘要 / 风险点 / 测试缺口 / 建议\n"
        "- 重构方案：目标 / 范围 / 步骤 / 回滚\n"
        "- Bug 分析：现象 / 根因 / 修复 / 验证\n"
    )


def build_code_dev_prompt_blocks(session: Any) -> str:
    if not is_code_dev(session):
        return ""
    parts = [
        "## 模式：代码开发（code_dev）\n"
        "你处于 **代码开发** 模式：优先低成本上下文（骨架 → outline → 片段读 → 落盘），"
        "禁止用大量整文件读取堆满上下文。\n",
        build_repo_skeleton_block(session),
        build_phase_gate_block(),
        build_file_read_discipline_block(),
        build_author_templates_block(),
        build_read_files_block(session),
    ]
    return "\n".join(p for p in parts if p.strip())


CODE_DEV_WORKFLOW_SKILL = "code-dev-workflow"


def ensure_code_dev_workflow_skill(session: Any) -> bool:
    """Inject bundled code-dev-workflow skill into context_files when allowed."""
    if not is_code_dev(session):
        return False
    context_files = getattr(session, "context_files", None)
    if not isinstance(context_files, dict):
        return False
    skill_key = f"skill:{CODE_DEV_WORKFLOW_SKILL}"
    if skill_key in context_files and str(context_files.get(skill_key, "")).strip():
        return True
    bound = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    try:
        from agenticx.cli.studio_skill import skill_is_allowed_for_session, skill_use

        allowed, _err = skill_is_allowed_for_session(
            CODE_DEV_WORKFLOW_SKILL, bound_avatar_id=bound
        )
        if not allowed:
            return False
        return bool(
            skill_use(
                context_files,
                CODE_DEV_WORKFLOW_SKILL,
                bound_avatar_id=bound,
                quiet=True,
            )
        )
    except Exception:
        return False
