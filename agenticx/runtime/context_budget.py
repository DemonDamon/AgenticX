"""Estimate and compact Meta chat context for small-context models."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from agenticx.cli.studio import StudioSession
from agenticx.runtime.tool_result_budget import approx_tokens

_MACHI_COMPACT_HEADER = (
    "你是 Machi（Near Meta-Agent），AgenticX 元智能体。用中文简洁回复。\n\n"
)

# Meta-only tools worth keeping on compact turns (spawn/delegate/automation).
_ESSENTIAL_META_TOOL_NAMES = frozenset(
    {
        "delegate_to_avatar",
        "spawn_subagent",
        "query_subagent_status",
        "schedule_task",
        "list_scheduled_tasks",
        "cancel_scheduled_task",
        "get_automation_task_logs",
    }
)

_COMPACT_PROMPT_CHAR_THRESHOLD = 30_000


def model_prefers_compact_meta_context(model_name: str, provider_name: str = "") -> bool:
    """Heuristic: 32B-class chat models on OpenAI-compat gateways often have tight windows."""
    model = str(model_name or "").strip().lower()
    if not model:
        return False
    if "128k" in model or "256k" in model or "1m" in model:
        return False
    if "32b" in model or model in {"qwen3-32b", "qwen-32b"}:
        return True
    if "7b" in model or "9b" in model:
        return True
    provider = str(provider_name or "").strip().lower()
    if provider.startswith("custom_openai_") and ("32b" in model or "9b" in model or "7b" in model):
        return True
    return False


def _compact_meta_tools(
    session: StudioSession,
    tools: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    from agenticx.cli.agent_tools import studio_tools_for_session

    compact = studio_tools_for_session(session)
    names = {
        str(t.get("function", {}).get("name", "")).strip()
        for t in compact
        if isinstance(t, dict)
    }
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("function", {}).get("name", "")).strip()
        if not name or name in names:
            continue
        if name not in _ESSENTIAL_META_TOOL_NAMES:
            continue
        compact.append(tool)
        names.add(name)
    return compact


def build_compact_meta_system_prompt(session: StudioSession) -> str:
    from agenticx.runtime.agent_runtime import _build_agent_system_prompt

    return _MACHI_COMPACT_HEADER + _build_agent_system_prompt(session)


def compact_meta_notice(
    model_name: str,
    *,
    est_message_tokens: int | None = None,
    est_tool_count: int | None = None,
) -> str:
    model = str(model_name or "unknown").strip() or "unknown"
    sizing = ""
    if est_message_tokens is not None:
        sizing = f"精简后约 {est_message_tokens:,} message tokens"
        if est_tool_count is not None:
            sizing += f" + {est_tool_count} 个工具 schema"
        sizing += "（全量 Meta 常超过 32K 窗口）。"
    return (
        f"当前模型（{model}）标称上下文约 32K tokens；Near Meta 全量系统提示 + 工具定义常超出该上限，"
        f"已自动切换精简模式（这不是报错）。{sizing}"
        "首轮需加载约 1.5–1.8 万 input tokens，内网 32B 推理通常需 30–60 秒，请稍候。"
    )


def force_compact_meta_turn_context(
    session: StudioSession,
    *,
    tools: Sequence[Dict[str, Any]],
) -> Tuple[str, List[Dict[str, Any]], str]:
    """Always switch Meta turns to compact prompt/tools for small-window models."""
    compact_prompt = build_compact_meta_system_prompt(session)
    compact_tools = _compact_meta_tools(session, tools)
    model = str(getattr(session, "model_name", "") or "")
    est_tokens = approx_tokens(compact_prompt)
    return compact_prompt, compact_tools, compact_meta_notice(
        model,
        est_message_tokens=est_tokens,
        est_tool_count=len(compact_tools),
    )


def maybe_compact_meta_turn_context(
    session: StudioSession,
    *,
    system_prompt: str,
    tools: Sequence[Dict[str, Any]],
) -> Tuple[str, List[Dict[str, Any]], Optional[str]]:
    """Return compact prompt/tools when the model likely cannot fit full Meta context."""
    model = str(getattr(session, "model_name", "") or "")
    provider = str(getattr(session, "provider_name", "") or "")
    if not model_prefers_compact_meta_context(model, provider):
        return system_prompt, list(tools), None
    prompt = str(system_prompt or "")
    large_meta_toolset = len(tools) >= 40
    if len(prompt) <= _COMPACT_PROMPT_CHAR_THRESHOLD and not large_meta_toolset:
        return system_prompt, list(tools), None
    compact_prompt = build_compact_meta_system_prompt(session)
    compact_tools = _compact_meta_tools(session, tools)
    est_before = approx_tokens(prompt) + approx_tokens(str(len(tools)))
    est_after = approx_tokens(compact_prompt) + approx_tokens(str(len(compact_tools)))
    if est_after >= est_before:
        return system_prompt, list(tools), None
    return compact_prompt, compact_tools, compact_meta_notice(
        model,
        est_message_tokens=est_after,
        est_tool_count=len(compact_tools),
    )


def is_context_window_exceeded_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return "contextwindowexceeded" in text or "context window" in text or "maximum context length" in text
