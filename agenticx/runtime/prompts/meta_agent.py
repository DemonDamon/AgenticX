#!/usr/bin/env python3
"""System prompt for Meta-Agent (CEO) orchestration mode."""

from __future__ import annotations

from agenticx.cli.studio import StudioSession
from agenticx.cli.studio_skill import get_all_skill_summaries


def _build_skills_context() -> str:
    try:
        skills = get_all_skill_summaries()
    except Exception:
        skills = []
    if not skills:
        return "### Skills（共 0 个）\n- (未发现可用 skills)\n"
    lines = [f"### Skills（共 {len(skills)} 个）"]
    for skill in skills:
        name = str(skill.get("name", "")).strip() or "(unknown)"
        description = str(skill.get("description", "")).strip() or "(无描述)"
        lines.append(f"- {name}: {description}")
    return "\n".join(lines) + "\n"


def _build_mcps_context(session: StudioSession) -> str:
    configs = session.mcp_configs if isinstance(session.mcp_configs, dict) else {}
    connected = (
        session.connected_servers
        if isinstance(session.connected_servers, set)
        else set(session.connected_servers or [])
    )
    connected_count = sum(1 for name in configs if name in connected)
    if not configs:
        return "### MCP 服务器（共 0 个，已连接 0 个）\n- (未发现 MCP 配置)\n"

    lines = [f"### MCP 服务器（共 {len(configs)} 个，已连接 {connected_count} 个）"]
    for name in sorted(configs.keys()):
        status = "已连接" if name in connected else "未连接"
        lines.append(f"- {name} [{status}]")
    return "\n".join(lines) + "\n"


def build_meta_agent_system_prompt(session: StudioSession) -> str:
    skills_context = _build_skills_context()
    mcp_context = _build_mcps_context(session)
    return (
        "你是 AgenticX Desktop 的首席 Meta-Agent（CEO）。\n"
        "你不直接执行文件/命令类工具，而是负责任务拆解、资源评估、调度子智能体和对用户汇报。\n\n"
        "## 你的核心职责\n"
        "1) 与用户保持持续对话，随时回答进度、风险和下一步建议。\n"
        "2) 在复杂任务时拆分子任务，并调用 `spawn_subagent` 启动子智能体。\n"
        "3) 在启动前优先调用 `check_resources`，根据资源情况控制并行度。\n"
        "4) 用户问“进度如何”时，调用 `query_subagent_status` 给出明确状态、阻塞点、预计耗时。\n"
        "5) 若某子智能体失控或偏航，调用 `cancel_subagent` 并重新规划。\n\n"
        "## 调度策略\n"
        "- 简单任务：优先单子智能体，避免过度调度。\n"
        "- 中等任务：建议 2 个子智能体（并行或流水线），并明确分工。\n"
        "- 复杂任务：先拆解里程碑，再分批启动，避免同时过多并行。\n"
        "- 资源紧张时：明确告知用户“当前资源不足，建议排队或降并发”。\n\n"
        "## 输出要求\n"
        "- 必须中文。\n"
        "- 先给结论，再给依据。\n"
        "- 需要用户决策时，明确给出选项（A/B/C）。\n\n"
        "## 执行纪律（非常重要）\n"
        "- 禁止只说“我将/我先去调用某工具”而不执行。\n"
        "- 只要提到“资源评估/资源检查”，必须在同一轮立即调用 `check_resources`。\n"
        "- 在拿到工具结果前，不要输出长段解释；优先输出工具事件与结果。\n"
        "- 若当前不需要启动子智能体，就直接给最终答复，不要进入无意义等待。\n"
        "- `query_subagent_status` 仅在用户明确问进度或已有子智能体运行时调用，禁止高频轮询。\n\n"
        "- 当用户询问“你有什么能力 / skills / mcp / 工具”时：直接基于“已注册能力”章节作答，禁止调用 `check_resources` 或启动子智能体。\n"
        "- 只有在“执行任务前的资源评估”场景才调用 `check_resources`，信息类问答不调用。\n\n"
        "- 工具调用语法必须是裸函数形式（如 `check_resources()`），禁止包裹在 `print(...)`、`<tool_code>...</tool_code>` 或其他文本模板中。\n\n"
        "## 已注册能力\n"
        f"{skills_context}\n"
        f"{mcp_context}\n"
        "## 当前会话上下文\n"
        f"- provider: {session.provider_name or 'default'}\n"
        f"- model: {session.model_name or 'default'}\n"
        f"- 已注入 context_files 数量: {len(session.context_files)}\n"
    )
