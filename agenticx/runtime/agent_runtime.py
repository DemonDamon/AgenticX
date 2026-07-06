#!/usr/bin/env python3
"""AgentRuntime core loop with structured event stream.

Author: Damon Li
"""

from __future__ import annotations

import json
import asyncio
import hashlib
from collections import deque
import inspect
import logging
import os
import re
from pathlib import Path
import threading
import time
import uuid
from typing import TYPE_CHECKING, Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional, Sequence

from agenticx.cli.agent_tools import (
    PENDING_VISUAL_ATTACHMENTS_KEY,
    STUDIO_TOOLS,
    VIEW_IMAGE_INJECT_LLM_TEXT,
    VIEW_IMAGE_INJECT_METADATA_SOURCE,
    studio_tools_for_session,
    _TOOL_REQUIRED_PARAMS,
    dispatch_tool_async,
    tool_denied_by_session_permissions,
)
from agenticx.cli.studio_mcp import build_mcp_tools_context
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.llms.vision import is_vision_capable, strip_nonvision_multimodal_messages
from agenticx.runtime.compactor import ContextCompactor
from agenticx.runtime.tool_result_budget import (
    apply_tool_result_budget,
    approx_tokens,
    archive_tool_result,
    get_result_class,
    load_config as load_tool_result_budget_config,
    persist_context_stats,
    record_tool_result_meta,
)
from agenticx.runtime.tool_orchestrator import partition_tool_calls
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.hooks import HookRegistry
from agenticx.runtime.loop_detector import LoopDetector
from agenticx.runtime.llm_retry import LLMRetryPolicy, _classify_error
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.token_budget import BudgetLevel, TokenBudgetGuard
from agenticx.runtime.usage_metadata import usage_metadata_from_llm_response
from agenticx.runtime.followup_stream import (
    FollowupStreamEmitter,
    split_final_answer_and_followups,
    suggested_questions_enabled_from_config,
)
from agenticx.llms.provider_fault import (
    classify_provider_fault,
    human_hint_for_fault,
    record_session_provider_hard_failure,
)
from agenticx.runtime.provider_fallback import (
    maybe_apply_provider_fallback,
    record_provider_timeout,
    reset_provider_timeout_streak,
    resolve_provider_read_timeout,
)
from agenticx.runtime.prompt_cache_policy import (
    apply_prompt_cache_breakpoints,
    build_context_management_kwargs,
    load_prompt_cache_config,
)

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any


MAX_TOOL_ROUNDS = 10


def _session_disk_dir(session: Any) -> Optional[Path]:
    sid = getattr(session, "_session_id", None) or getattr(session, "_owner_session_id", None)
    text = str(sid or "").strip()
    if not text:
        return None
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or text
    return Path.home() / ".agenticx" / "sessions" / safe


def _chat_history_tail_matches(
    history: Sequence[Dict[str, Any]] | None,
    role: str,
    content: Any,
) -> bool:
    if not history:
        return False
    last = history[-1]
    if str(last.get("role", "")).lower() != str(role or "").lower():
        return False
    return str(last.get("content", "")).strip() == str(content or "").strip()


def _chat_history_append_deduped(history: List[Dict[str, Any]], row: Dict[str, Any]) -> bool:
    """Append when tail role+content differs. Returns True if appended."""
    role = str(row.get("role", ""))
    content = row.get("content", "")
    if _chat_history_tail_matches(history, role, content):
        return False
    history.append(row)
    return True


def _append_subagent_cluster_anchor_if_needed(
    session: Any,
    *,
    tool_name: str,
    tool_call_id: str,
    raw_result: str,
) -> bool:
    """Append/update a lightweight persisted cluster anchor for spawn/delegate tool results."""
    if tool_name not in {"spawn_subagent", "delegate_to_avatar"}:
        return False
    sid = str(
        getattr(session, "_session_id", "")
        or getattr(session, "_owner_session_id", "")
        or getattr(session, "session_id", "")
        or ""
    ).strip()
    if not sid:
        return False
    try:
        payload = json.loads(str(raw_result or ""))
    except Exception:
        return False
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return False
    run_id = ""
    if tool_name == "spawn_subagent":
        run_id = str(payload.get("agent_id", "") or "").strip()
    else:
        run_id = str(
            payload.get("delegation_id", "")
            or payload.get("agent_id", "")
            or ""
        ).strip()
    if not run_id:
        return False
    try:
        store = SubAgentRunStore(sid)
        record = store.get_run(run_id)
        if record is None:
            return False
        cluster = None
        for item in store.list_clusters():
            if item.cluster_id == record.cluster_id:
                cluster = item
                break
        run_ids = list(cluster.run_ids) if cluster is not None else [record.run_id]
        if record.run_id not in run_ids:
            run_ids.append(record.run_id)
        cluster_id = str(record.cluster_id or "").strip()
        if not cluster_id:
            return False
        created_at = float(cluster.created_at if cluster is not None else record.created_at)
        title = str(cluster.title if cluster is not None else "").strip()
        if not title:
            title = f"Agent 蜂群 · {len(run_ids)} 个并行任务"
        anchor = {
            "cluster_id": cluster_id,
            "run_ids": run_ids,
            "title": title,
            "created_at": created_at,
        }
        history = getattr(session, "chat_history", None)
        if not isinstance(history, list):
            return False
        for row in history:
            if not isinstance(row, dict):
                continue
            meta = row.get("metadata")
            if not isinstance(meta, dict):
                continue
            existing = meta.get("subagent_cluster")
            if not isinstance(existing, dict):
                continue
            if str(existing.get("cluster_id", "") or "").strip() != cluster_id:
                continue
            if existing == anchor:
                return False
            meta["subagent_cluster"] = anchor
            return True
        history.append(
            {
                "role": "assistant",
                "content": "",
                "metadata": {"subagent_cluster": anchor},
                "timestamp": created_at,
                "source_tool_call_id": str(tool_call_id or "").strip() or None,
            }
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[subagent_anchor] append failed: %s", exc)
        return False


def _env_int_runtime(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return default


def _build_user_goal_anchor(
    session: "StudioSession",
    round_idx: int,
    max_rounds: int,
    tools_used_so_far: int,
    messages_total_chars: int,
    tool_result_tokens_session: int = 0,
) -> Optional[Dict[str, Any]]:
    """Build user goal anchor message for long-horizon task context management (FR-2/FR-3).

    Returns ephemeral system message that reinforces user's original query
    without being persisted to session history (NFR-3).
    """
    # NFR-6: Escape hatch to disable anchor injection
    if os.environ.get("AGX_GOAL_ANCHOR_DISABLE", "").strip() == "1":
        return None

    session._goal_anchor_prepend = False

    user_intent_raw = getattr(session, "current_user_intent", None)
    # NFR-4: Skip if None or whitespace-only (including empty string)
    if not user_intent_raw or not str(user_intent_raw).strip():
        return None

    # FR-3: Read threshold environment variables
    full_trigger_tools = _env_int_runtime("AGX_GOAL_ANCHOR_FULL_TRIGGER_TOOLS", 3)
    full_trigger_chars = _env_int_runtime("AGX_GOAL_ANCHOR_FULL_TRIGGER_CHARS", 20000)
    agent_msg_count = len(getattr(session, "agent_messages", []))

    # Defensive intent length cap for compact/full modes (parity with compactor's 4000-char cap).
    # full/compact modes embed the intent verbatim; cap to 2000 chars to prevent abnormally long
    # inputs from blowing up the per-round anchor cost. Minimal mode caps independently below.
    user_intent_full = str(user_intent_raw)[:2000]

    restrengthen_threshold = _env_int_runtime("AGX_ANCHOR_RESTRENGTHEN_THRESHOLD", 12000)
    force_prepend = tool_result_tokens_session >= restrengthen_threshold

    is_first_round = round_idx == 1 and tools_used_so_far == 0
    is_complex = (
        tools_used_so_far >= full_trigger_tools
        or messages_total_chars >= full_trigger_chars
        or agent_msg_count >= 8
        or force_prepend
    )
    session._goal_anchor_prepend = bool(force_prepend and not is_first_round)

    if is_first_round:
        # First round: minimal anchor (≤80 chars as per FR-3)
        # Prefix "[user-goal-anchor] " is 19 chars, so intent truncated to 60 chars
        anchor_text = f"[user-goal-anchor] {str(user_intent_raw)[:60]}"
        mode = "minimal"
    elif is_complex:
        # Complex scenario: full anchor with 4 execution disciplines (FR-2).
        # Discipline #3 threshold is derived from full_trigger_tools so the anchor body stays
        # consistent with the actual env-configurable trigger (no hard-coded "5").
        stop_threshold = max(full_trigger_tools + 2, 5)
        anchor_text = (
            f"[user-goal-anchor] (round {round_idx}/{max_rounds}, tools_used_so_far={tools_used_so_far})\n"
            f"==== 用户当前原始问题（一字不差，禁止改写）====\n"
            f"{user_intent_full}\n"
            f"==================================\n"
            f"执行纪律：\n"
            f"1. 本轮所有工具调用与最终答复必须直接服务于上述问题；\n"
            f"2. 若发现自己正在重复上一轮已做过的对比/分析，立即停止并直接基于已有信息产出最终方案；\n"
            f"3. 工具调用累计 >= {stop_threshold} 次仍未直接回答原始问题时，停止信息收集并产出方案；\n"
            f"4. 最终回复必须明确对照原始问题的每个子问题逐点作答（若有 a/b/c 子问题，回复中需对应 a/b/c）。"
        )
        mode = "full"
    else:
        # Middle ground: compact anchor without discipline details (FR-3)
        anchor_text = (
            f"[user-goal-anchor] (round {round_idx}/{max_rounds})\n"
            f"==== 用户当前原始问题 ====\n"
            f"{user_intent_full}\n"
            f"=================================="
        )
        mode = "compact"

    # NFR-7: Structured logging for observability
    logging.getLogger(__name__).info(
        "goal_anchor_injected=true session=%s round=%d/%d tools_used=%d anchor_chars=%d mode=%s",
        getattr(session, "session_id", "unknown") or getattr(session, "_session_id", "unknown"),
        round_idx,
        max_rounds,
        tools_used_so_far,
        len(anchor_text),
        mode,
    )

    session._goal_anchor_mode = mode
    return {"role": "system", "content": anchor_text}


def _maybe_persist_large_tool_result(
    session: Any,
    tool_call_id: str,
    tool_name: str,
    result: str,
) -> str:
    threshold = _env_int_runtime("AGX_TOOL_RESULT_PERSIST_THRESHOLD", 8000)
    text = str(result or "")
    if len(text) <= threshold:
        return text
    base = _session_disk_dir(session)
    if base is None:
        return text
    sub = base / "tool-results"
    try:
        sub.mkdir(parents=True, exist_ok=True)
    except OSError:
        return text
    safe_id = re.sub(r"[^a-zA-Z0-9_.-]+", "_", tool_call_id).strip("_") or uuid.uuid4().hex[:12]
    out_path = sub / f"{safe_id}.txt"
    try:
        out_path.write_text(text, encoding="utf-8")
    except OSError:
        return text
    preview = text[:2000]
    return (
        f"[Tool result persisted to disk: {out_path}]\n"
        f"{preview}\n"
        f"... ({len(text)} chars total, see file for full content)"
    )


def _parallel_tools_enabled() -> bool:
    """Check whether parallel tool dispatch is enabled.

    Reads from ``AGX_PARALLEL_TOOLS`` env var or ``runtime.parallel_tools``
    in ``config.yaml``.
    """
    env = os.environ.get("AGX_PARALLEL_TOOLS", "")
    if env == "1":
        return True
    if env == "0":
        return False
    try:
        from agenticx.cli.config_manager import ConfigManager
        val = ConfigManager.get_value("runtime.parallel_tools")
        return bool(val)
    except Exception:
        return False
MAX_CONTEXT_CHARS = 16_000
STOP_MESSAGE = "已中断当前生成"
DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS = 60.0
PROVIDER_INVOKE_TIMEOUT_SECONDS: Dict[str, float] = {
    # Some providers/models (especially tool-heavy rounds) often need longer first-token latency.
    "volcengine": 180.0,
    "bailian": 180.0,
    "zhipu": 150.0,
}
MODEL_INVOKE_TIMEOUT_SECONDS: Dict[str, float] = {
    # Heavy reasoning + tool planning models usually need longer invoke windows.
    "glm-5": 180.0,
    "doubao-seed-2-0-pro-260215": 180.0,
}
DEFAULT_LLM_FIRST_FEEDBACK_SECONDS = 8.0
PROVIDER_FIRST_FEEDBACK_SECONDS: Dict[str, float] = {
    "volcengine": 12.0,
    "bailian": 12.0,
    "zhipu": 10.0,
}
DEFAULT_STATUS_QUERY_BUDGET_PER_TURN = 2
DEFAULT_STATUS_QUERY_COOLDOWN_SECONDS = 8.0
DEFAULT_LLM_HEARTBEAT_TIMEOUT_SECONDS = 60.0
DEFAULT_LLM_HARD_TIMEOUT_SECONDS = 300.0
DEFAULT_LLM_ROUND_TIMEOUT_SECONDS = 180.0
LLM_ROUND_TIMEOUT_RETRY_LIMIT = 1
logger = logging.getLogger(__name__)


def _truncate(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... (truncated, total {len(text)} chars)"


def _resolve_meta_tool_dispatchers():
    """Resolve meta-only dispatchers lazily to avoid import cycles."""
    from agenticx.runtime.meta_tools import _meta_only_names, dispatch_meta_tool_async

    return _meta_only_names, dispatch_meta_tool_async


def _resolve_llm_invoke_timeout_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_INVOKE_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_invoke_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    model_name = str(getattr(session, "model_name", "") or "").strip().lower()
    if model_name and model_name in MODEL_INVOKE_TIMEOUT_SECONDS:
        return MODEL_INVOKE_TIMEOUT_SECONDS[model_name]
    provider_name = str(getattr(session, "provider_name", "") or "").strip().lower()
    if provider_name and provider_name in PROVIDER_INVOKE_TIMEOUT_SECONDS:
        return PROVIDER_INVOKE_TIMEOUT_SECONDS[provider_name]
    return DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS


def _resolve_llm_first_feedback_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_FIRST_FEEDBACK_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    provider_name = str(getattr(session, "provider_name", "") or "").strip().lower()
    if provider_name and provider_name in PROVIDER_FIRST_FEEDBACK_SECONDS:
        return PROVIDER_FIRST_FEEDBACK_SECONDS[provider_name]
    return DEFAULT_LLM_FIRST_FEEDBACK_SECONDS


def _resolve_status_query_budget_per_turn() -> int:
    env_raw = os.getenv("AGX_STATUS_QUERY_BUDGET_PER_TURN", "").strip()
    if env_raw:
        try:
            value = int(env_raw)
            if value >= 1:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.status_query_budget_per_turn")
        if cfg_value is not None:
            value = int(cfg_value)
            if value >= 1:
                return value
    except Exception:
        pass
    return DEFAULT_STATUS_QUERY_BUDGET_PER_TURN


def _resolve_status_query_cooldown_seconds() -> float:
    env_raw = os.getenv("AGX_STATUS_QUERY_COOLDOWN_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value >= 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.status_query_cooldown_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value >= 0:
                return value
    except Exception:
        pass
    return DEFAULT_STATUS_QUERY_COOLDOWN_SECONDS


def _resolve_llm_heartbeat_timeout_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_heartbeat_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    return DEFAULT_LLM_HEARTBEAT_TIMEOUT_SECONDS


def _resolve_llm_round_timeout_seconds(session: StudioSession) -> float:
    """Per-round LLM stall ceiling (FR-P0-1); defaults to 180s."""
    env_raw = os.getenv("AGX_LLM_ROUND_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_round_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    return DEFAULT_LLM_ROUND_TIMEOUT_SECONDS


def _resolve_llm_hard_timeout_seconds(session: StudioSession) -> float:
    round_cap = _resolve_llm_round_timeout_seconds(session)
    env_raw = os.getenv("AGX_LLM_HARD_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return min(value, round_cap)
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_hard_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return min(value, round_cap)
    except Exception:
        pass
    return min(DEFAULT_LLM_HARD_TIMEOUT_SECONDS, round_cap)


_STREAM_WAITING_HINT = object()


class _StreamWatchdogUserStop(Exception):
    """Raised when the user interrupts an in-flight sync stream bridge."""


async def _iter_sync_stream_with_watchdog(
    *,
    loop: asyncio.AbstractEventLoop,
    run_sync_stream: Callable[[threading.Event, Callable[[Any], None]], None],
    check_should_stop: Callable[[], Awaitable[bool]],
    invoke_timeout_seconds: float,
    heartbeat_timeout_seconds: float,
    hard_timeout_seconds: float,
    first_feedback_seconds: float = 0.0,
    emit_waiting_hint: bool = False,
    queue_poll_seconds: float = 0.1,
) -> AsyncGenerator[Any, None]:
    """Bridge a blocking sync stream iterator with idle and hard watchdogs.

    Runs ``run_sync_stream`` in a worker thread, forwarding chunks through an
    asyncio queue. Applies the same first-byte / inter-token idle semantics as
    the primary ``stream_with_tools`` path.

    Author: Damon Li
    """
    token_queue: asyncio.Queue[Any | None] = asyncio.Queue()
    stop_stream = threading.Event()

    def _queue_put(payload: Any | None) -> None:
        loop.call_soon_threadsafe(token_queue.put_nowait, payload)

    stream_task = loop.run_in_executor(
        None,
        lambda: run_sync_stream(stop_stream, _queue_put),
    )
    stream_started_at = loop.time()
    first_chunk_at = 0.0
    last_chunk_at = 0.0
    waiting_hint_emitted = False
    try:
        while True:
            if await check_should_stop():
                stop_stream.set()
                raise _StreamWatchdogUserStop()
            now = loop.time()
            elapsed = now - stream_started_at
            if (
                emit_waiting_hint
                and first_feedback_seconds > 0
                and (not waiting_hint_emitted)
                and elapsed >= first_feedback_seconds
            ):
                waiting_hint_emitted = True
                yield _STREAM_WAITING_HINT
            if elapsed >= hard_timeout_seconds:
                stop_stream.set()
                raise asyncio.TimeoutError()
            idle_limit = (
                invoke_timeout_seconds
                if first_chunk_at <= 0
                else heartbeat_timeout_seconds
            )
            idle_anchor = stream_started_at if first_chunk_at <= 0 else last_chunk_at
            if (now - idle_anchor) >= idle_limit:
                stop_stream.set()
                raise asyncio.TimeoutError()
            try:
                stream_item = await asyncio.wait_for(
                    token_queue.get(),
                    timeout=queue_poll_seconds,
                )
            except asyncio.TimeoutError:
                if stream_task.done():
                    break
                continue
            if stream_item is None:
                break
            if isinstance(stream_item, dict) and str(
                stream_item.get("type", "")
            ).strip() == "stream_error":
                raise RuntimeError(str(stream_item.get("error", "stream error")))
            if first_chunk_at <= 0:
                first_chunk_at = now
            last_chunk_at = now
            yield stream_item
    finally:
        stop_stream.set()
        try:
            await asyncio.wait_for(asyncio.shield(stream_task), timeout=1.0)
        except Exception:
            pass


def _llm_timeout_retry_count(session: StudioSession) -> int:
    sp = getattr(session, "scratchpad", None)
    if not isinstance(sp, dict):
        return 0
    try:
        return int(sp.get("_llm_round_timeout_count", 0) or 0)
    except (TypeError, ValueError):
        return 0


def _bump_llm_timeout_retry_count(session: StudioSession) -> int:
    sp = getattr(session, "scratchpad", None)
    if not isinstance(sp, dict):
        sp = {}
        setattr(session, "scratchpad", sp)
    n = _llm_timeout_retry_count(session) + 1
    sp["_llm_round_timeout_count"] = n
    return n


def _reset_llm_timeout_retry_count(session: StudioSession) -> None:
    sp = getattr(session, "scratchpad", None)
    if isinstance(sp, dict):
        sp.pop("_llm_round_timeout_count", None)


def _streamed_tool_call_truncated(name: str, args_obj: Dict[str, Any]) -> bool:
    """FR-C: judge whether a streamed tool call has been truncated.

    A tool call is considered truncated (and should NOT be dispatched) when:
    - the tool has at least one `required` parameter declared on its schema, AND
    - the parsed arguments dict is empty.

    Splitting this out as a module-level pure function keeps the streaming
    aggregator readable and unit-testable.
    """
    if not name:
        return False
    required = _TOOL_REQUIRED_PARAMS.get(name)
    if not required:
        return False
    if isinstance(args_obj, dict) and len(args_obj) == 0:
        return True
    return False


def _build_streamed_tool_truncation_hint(names: Sequence[str]) -> str:
    """FR-C: human-readable retry hint appended to assistant text when streamed
    tool calls were dropped due to truncation.

    The text is intentionally directive ("立即重新调用") to fight the failure
    mode where weak models read "ERROR" and then give up the whole task.
    """
    unique_names = ", ".join(sorted({n for n in names if n}))
    if not unique_names:
        unique_names = "<unknown>"
    return (
        f"[系统通知] 上一次工具调用（{unique_names}）因流式输出被截断导致参数为空，已被丢弃。"
        f"请立即重新调用同一工具，并把所有 required 参数完整填写一次"
        f"（file_write/file_edit 必须包含完整的 path 与 content/old_string/new_string）。"
    )


def _repair_streamed_tool_arguments(raw: str) -> Dict[str, Any]:
    def _sanitize_parsed_args(parsed: Dict[str, Any]) -> Dict[str, Any]:
        # Drop leaked streamed metadata keys/values such as call_xxx / sa-xxxx
        # before tool dispatch.
        cleaned: Dict[str, Any] = {}
        for key, value in parsed.items():
            key_text = str(key).strip()
            val_text = str(value).strip() if value is not None else ""
            if re.fullmatch(r"call_[A-Za-z0-9]+", key_text):
                continue
            if re.fullmatch(r"(call_[A-Za-z0-9]+|sa-[a-z0-9]+)", val_text):
                continue
            cleaned[key] = value
        return cleaned

    text = (raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return _sanitize_parsed_args(parsed) if isinstance(parsed, dict) else {}
    except Exception:
        pass
    lpos = text.find("{")
    rpos = text.rfind("}")
    if lpos >= 0 and rpos > lpos:
        try:
            parsed = json.loads(text[lpos : rpos + 1])
            return _sanitize_parsed_args(parsed) if isinstance(parsed, dict) else {}
        except Exception:
            pass
    return {}


def _serialize_artifacts(session: StudioSession) -> str:
    if not session.artifacts:
        return "(empty)"
    parts: List[str] = []
    for path, content in session.artifacts.items():
        parts.append(f"--- {path} ---\n{_truncate(content, 4000)}")
    return "\n\n".join(parts)


def _serialize_context_files(session: StudioSession) -> str:
    if not session.context_files:
        return "(empty)"
    parts: List[str] = []
    for fpath, content in session.context_files.items():
        parts.append(f"--- {fpath} ---\n{_truncate(content, 4000)}")
    return "\n\n".join(parts)


def _serialize_skill_summaries(session: StudioSession) -> str:
    try:
        bound = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
        summaries = get_all_skill_summaries(bound_avatar_id=bound)
    except Exception:
        summaries = []
    if not summaries:
        return "(no skills discovered)"
    return "\n".join(f"- {item['name']}: {item['description']}" for item in summaries[:120])


def _serialize_todos(session: StudioSession) -> str:
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is None:
        return "No todos."
    try:
        return str(todo_manager.render())
    except Exception:
        return "No todos."


def _serialize_scratchpad(session: StudioSession) -> str:
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict) or not scratchpad:
        return "(empty)"
    lines: List[str] = []
    for key in sorted(scratchpad.keys()):
        value = str(scratchpad.get(key, ""))
        preview = value if len(value) <= 200 else value[:200] + "..."
        lines.append(f"- {key}: {preview.replace(chr(10), ' ')}")
    return "\n".join(lines)


def _inject_pending_visual_attachments(
    session: StudioSession,
    messages: List[Dict[str, Any]],
    *,
    is_system_trigger: bool,
) -> None:
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        return
    pending = scratchpad.pop(PENDING_VISUAL_ATTACHMENTS_KEY, [])
    if not isinstance(pending, list) or not pending:
        return
    content_blocks: List[Dict[str, Any]] = [
        {
            "type": "text",
            "text": VIEW_IMAGE_INJECT_LLM_TEXT,
        },
    ]
    simplified: List[Dict[str, Any]] = []
    for item in pending:
        if not isinstance(item, dict):
            continue
        data_url = str(item.get("data_url", "")).strip()
        if not data_url.startswith("data:image/"):
            continue
        content_blocks.append({"type": "image_url", "image_url": {"url": data_url}})
        simplified.append(
            {
                "name": str(item.get("name", "") or "image"),
                "mime_type": str(item.get("mime_type", "") or "image/png"),
                "size": int(item.get("size", 0) or 0),
                "source": str(item.get("source", "") or ""),
                "data_url": data_url,
            }
        )
    if len(content_blocks) <= 1:
        return
    injected = {"role": "user", "content": content_blocks}
    messages.append(injected)
    session.agent_messages.append(injected)
    if not is_system_trigger:
        session.chat_history.append(
            {
                "role": "user",
                "content": "",
                "metadata": {"source": VIEW_IMAGE_INJECT_METADATA_SOURCE},
                "visual_attachments": simplified,
            }
        )


def _enrich_attachments_from_chat_history(
    history: List[Dict[str, Any]], chat_history: List[Dict[str, Any]]
) -> None:
    """Best-effort: copy image attachments from chat_history onto agent_messages rows."""
    from agenticx.studio.chat_attachments import sync_agent_messages_attachments_from_chat_history

    sync_agent_messages_attachments_from_chat_history(history, chat_history)


def _promote_user_image_attachments(
    messages: List[Dict[str, Any]], provider_name: str, model_name: str
) -> List[Dict[str, Any]]:
    """For vision-capable models, turn user history entries that carry attachments
    with data:image data_url into proper multimodal content lists.

    This ensures images uploaded in previous turns of the *same session* (even if
    the model at send time was text-only, or after restart/model switch) are visible
    as native vision parts to the current vision model, without requiring the user
    to re-attach or the agent to call view_image on transient paths.
    """
    if not is_vision_capable(provider_name, model_name):
        return messages
    out: List[Dict[str, Any]] = []
    for m in messages:
        if not isinstance(m, dict):
            out.append(m)
            continue
        if m.get("role") != "user":
            out.append(m)
            continue
        atts = m.get("attachments")
        if not isinstance(atts, list) or not atts:
            out.append(m)
            continue
        image_blocks: List[Dict[str, Any]] = []
        for a in atts:
            if not isinstance(a, dict):
                continue
            from agenticx.studio.chat_attachments import image_data_url_from_attachment

            du = image_data_url_from_attachment(a)
            if du.startswith("data:image/"):
                image_blocks.append({"type": "image_url", "image_url": {"url": du}})
        if not image_blocks:
            out.append(m)
            continue
        content = m.get("content")
        if isinstance(content, list):
            # Already multimodal; append any missing image blocks (dedup by url)
            existing = {
                str(b.get("image_url", {}).get("url", ""))
                for b in content
                if isinstance(b, dict) and str(b.get("type", "")) == "image_url"
            }
            new_blocks = list(content)
            for b in image_blocks:
                u = str(b.get("image_url", {}).get("url", ""))
                if u and u not in existing:
                    new_blocks.append(b)
                    existing.add(u)
            new_m = dict(m)
            new_m["content"] = new_blocks
            out.append(new_m)
        else:
            text = str(content or "").strip()
            blocks: List[Dict[str, Any]] = []
            if text:
                blocks.append({"type": "text", "text": text})
            blocks.extend(image_blocks)
            new_m = dict(m)
            new_m["content"] = blocks
            out.append(new_m)
    return out


def _build_agent_system_prompt(session: StudioSession) -> str:
    mcp_context = ""
    if session.mcp_hub is not None:
        mcp_context = build_mcp_tools_context(session.mcp_hub)
    if not mcp_context:
        mcp_context = "(no MCP tools connected)"

    try:
        from agenticx.runtime.prompts.code_mode import build_code_dev_prompt_blocks

        code_dev_block = build_code_dev_prompt_blocks(session)
    except Exception:
        code_dev_block = ""
    try:
        from agenticx.project_state.prompts import build_project_state_blocks

        project_state_block = build_project_state_blocks(session)
    except Exception:
        project_state_block = ""
    try:
        from agenticx.runtime.prompts.meta_agent import _build_widget_capability_block

        widget_block = _build_widget_capability_block()
    except Exception:
        widget_block = ""
    return (
        "你是 AgenticX Studio 的执行型 Agent（implement 角色）。\n"
        "核心目标：根据用户请求完成代码/命令操作，并在不确定或高风险动作前主动确认。\n\n"
        "## 回复语言\n"
        "- 必须使用中文回复。\n"
        "- 简洁、可执行、优先给出当前进度。\n\n"
        "## 可用元 Skills 摘要\n"
        f"{_serialize_skill_summaries(session)}\n\n"
        "## 当前会话 artifacts\n"
        f"{_serialize_artifacts(session)}\n\n"
        "## 当前 Todo 列表\n"
        f"{_serialize_todos(session)}\n\n"
        "## 当前 Scratchpad 摘要\n"
        f"{_serialize_scratchpad(session)}\n\n"
        "## 当前 context_files\n"
        f"{_serialize_context_files(session)}\n\n"
        f"{code_dev_block}"
        f"{project_state_block}"
        "## 当前 MCP 工具上下文\n"
        f"{_truncate(mcp_context, 6000)}\n\n"
        "## 浏览器自动化（browser-use 等 MCP）\n"
        "- MCP 工具**不会**自动变成单独的 function；须先用 `mcp_connect` 连接配置好的服务器（如 `browser-use`），再用 `mcp_call` 调用，"
        "`tool_name` / `arguments` 与上方「当前 MCP 工具上下文」中的名称和 schema 一致。\n"
        "- 用户给出「打开某网站、点击、登录、点赞」等**可执行**目标时：优先 `mcp_call` 调用 "
        "`retry_with_browser_use_agent`，在 `arguments.task` 中写清站点、步骤与成功标准；"
        "应用 `allowed_domains` 限制域名以降低风险。需要逐步可见过程时，可改用 `browser_navigate`、"
        "`browser_get_state`、`browser_click` 等低层工具分步执行。\n"
        "- 未连接 MCP 或缺少对应工具时，说明如何配置（如 `~/.agenticx/mcp.json`），不要假装已执行浏览器操作。\n\n"
        f"{_credential_safety_block_for_agent()}"
        "## 安全与确认规则（必须遵守）\n"
        "- bash_exec 仅对白名单命令自动执行；非白名单命令必须先征得用户确认。\n"
        "- file_write 与 file_edit 必须先展示 unified diff，再征得用户确认。\n"
        "- 当信息不足或需求含糊时，直接以文字回复追问用户，不要调用工具。\n"
        "- 多步骤任务优先使用 todo_write 跟踪进度，保持只有一个 in_progress。\n"
        "- 对中间结果优先写入 scratchpad_write，后续步骤先 scratchpad_read 复用。\n"
        "- 优先最小改动，避免无关重构。\n"
        f"{widget_block}"
    )


def _credential_safety_block_for_agent() -> str:
    try:
        from agenticx.runtime.prompts.credential_safety import CREDENTIAL_SAFETY_BLOCK

        return f"{CREDENTIAL_SAFETY_BLOCK}\n"
    except Exception:
        return ""


def _parse_tool_arguments(raw_args: Any) -> Dict[str, Any]:
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str):
        stripped = raw_args.strip()
        if not stripped:
            return {}
        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _summarize_tool_calls_for_history(tool_calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only stable fields to avoid leaking runtime metadata ids into model context."""
    summarized: List[Dict[str, Any]] = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        function_obj = call.get("function", {}) if isinstance(call.get("function"), dict) else {}
        name = str(function_obj.get("name", "")).strip()
        arguments = function_obj.get("arguments")
        if isinstance(arguments, str):
            parsed_args = _parse_tool_arguments(arguments)
        elif isinstance(arguments, dict):
            parsed_args = arguments
        else:
            parsed_args = {}
        summarized.append({"name": name, "arguments": parsed_args})
    return summarized


def _message_content_is_empty(content: Any) -> bool:
    """True when message content carries no visible text for strict chat APIs."""
    if content is None:
        return True
    if isinstance(content, str):
        return not content.strip()
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if str(block.get("type", "")).strip() != "text":
                continue
            if str(block.get("text", "")).strip():
                return False
        return True
    return not str(content).strip()


def _sanitize_context_messages(messages: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Repair history to satisfy strict tool-call pairing providers.

    Rules:
    - Drop assistant rows with empty content and no tool_calls (Kimi/Moonshot 400).
    - Assistant tool_calls rows with empty content get a single-space placeholder.
    - Keep tool messages only when their tool_call_id is declared by some assistant tool_calls.
    - Keep assistant tool_calls only when each call id has a corresponding tool response in history.
      Unmatched calls are removed from that assistant message.
    """
    sanitized: List[Dict[str, Any]] = []
    idx = 0
    total = len(messages)

    while idx < total:
        msg = messages[idx]
        role = str(msg.get("role", ""))

        if role != "assistant":
            if role == "tool":
                meta_raw = msg.get("metadata")
                meta = meta_raw if isinstance(meta_raw, dict) else {}
                # Filter UI-only notice messages from LLM context so they
                # don't pollute follow-up turns with stale interruption or
                # continuation noise.
                if meta.get("kind") in (
                    "turn_interrupted",
                    "continuation_notice",
                    "futile_resume_guard",
                    "clarification",
                ):
                    idx += 1
                    continue
            if role != "tool":
                sanitized.append(msg)
            idx += 1
            continue

        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            if _message_content_is_empty(msg.get("content")):
                idx += 1
                continue
            sanitized.append(msg)
            idx += 1
            continue

        expected_ids: set[str] = set()
        call_map: Dict[str, Dict[str, Any]] = {}
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            cid = str(call.get("id", "")).strip()
            if not cid:
                continue
            expected_ids.add(cid)
            call_map[cid] = call

        # Collect contiguous tool responses right after this assistant turn.
        j = idx + 1
        contiguous_tool_rows: List[Dict[str, Any]] = []
        responded_ids: set[str] = set()
        while j < total:
            next_msg = messages[j]
            if str(next_msg.get("role", "")) != "tool":
                break
            cid = str(next_msg.get("tool_call_id", "")).strip()
            if cid and cid in expected_ids:
                contiguous_tool_rows.append(next_msg)
                responded_ids.add(cid)
            j += 1

        kept_calls: List[Dict[str, Any]] = []
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            cid = str(call.get("id", "")).strip()
            if cid and cid in responded_ids and cid in call_map:
                kept_calls.append(call_map[cid])
        if kept_calls:
            msg_copy = dict(msg)
            msg_copy["tool_calls"] = kept_calls
            if _message_content_is_empty(msg_copy.get("content")):
                msg_copy["content"] = " "
            sanitized.append(msg_copy)
            sanitized.extend(contiguous_tool_rows)
        else:
            # Remove dangling tool_calls but keep assistant content text.
            msg_copy = dict(msg)
            msg_copy.pop("tool_calls", None)
            if _message_content_is_empty(msg_copy.get("content")):
                idx = j
                continue
            sanitized.append(msg_copy)

        # Skip contiguous tool block, whether kept or dropped.
        idx = j

    return sanitized


def _iter_text_chunks(text: str, chunk_size: int = 16) -> List[str]:
    if chunk_size <= 0:
        chunk_size = 16
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]


def _is_minimax_chat_setting_error(error: Exception) -> bool:
    """Return True when MiniMax rejects request chat settings."""
    text = str(error or "").lower()
    return (
        "invalid chat setting" in text
        or "invalid params" in text and "(2013)" in text
    )


def _merge_consecutive_simple_roles_for_minimax(
    messages: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Merge adjacent system/user rows for MiniMax OpenAI-compatible API.

    MiniMax returns error 2013 (invalid chat setting) when the same role
    appears on consecutive messages (e.g. main system prompt + [compacted]
    system block from ContextCompactor). It also rejects system messages outside
    the first position, so runtime-injected system notes are downgraded to user
    context before the request is sent. Tool-call turns are left unchanged.
    """
    merge_roles = frozenset({"system", "user"})
    out: List[Dict[str, Any]] = []
    for msg in messages:
        m = dict(msg)
        role = str(m.get("role", ""))
        if m.get("tool_calls"):
            out.append(m)
            continue
        if role == "system" and out:
            m["role"] = "user"
            m["content"] = f"[system-context]\n{str(m.get('content', '')).strip()}"
            role = "user"
        if role not in merge_roles:
            out.append(m)
            continue
        if (
            out
            and str(out[-1].get("role", "")) == role
            and not out[-1].get("tool_calls")
        ):
            prev = out[-1]
            prev["content"] = (
                str(prev.get("content", "")) + "\n\n" + str(m.get("content", ""))
            ).strip()
        else:
            out.append(m)
    return out


def _extract_inline_tool_call(
    text: str, allowed_tool_names: set[str]
) -> Optional[Dict[str, Any]]:
    """
    Parse tool-like text (e.g. <tool_code>check_resources()</tool_code>)
    and convert it to one synthetic tool call payload.
    """
    if not text:
        return None
    snippet = text
    tag_block = re.search(r"<tool_code>\s*(.*?)\s*</tool_code>", text, re.S)
    if tag_block:
        snippet = tag_block.group(1).strip()
    snippet = snippet.strip()

    def _parse_tool_call_object(obj: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(obj, dict):
            return None
        fn = obj.get("function")
        if not isinstance(fn, dict):
            return None
        name = str(fn.get("name") or "").strip()
        if not name or name not in allowed_tool_names:
            return None
        raw_args = fn.get("arguments", {})
        args_obj: Dict[str, Any] = {}
        if isinstance(raw_args, dict):
            args_obj = raw_args
        elif isinstance(raw_args, str):
            try:
                parsed_args = json.loads(raw_args)
                if isinstance(parsed_args, dict):
                    args_obj = parsed_args
            except Exception:
                args_obj = {}
        return {"name": name, "arguments": args_obj}

    # Some models (notably Ollama variants without strict tool-call support)
    # may emit OpenAI-style tool_calls JSON as plain text.
    if snippet.startswith("```") and snippet.endswith("```"):
        body = re.sub(r"^```(?:json)?\s*", "", snippet).rstrip()
        snippet = re.sub(r"\s*```$", "", body).strip()
    if snippet.startswith("{"):
        try:
            payload = json.loads(snippet)
            if isinstance(payload, dict):
                calls = payload.get("tool_calls")
                if isinstance(calls, list):
                    for item in calls:
                        parsed_call = _parse_tool_call_object(item)
                        if parsed_call is not None:
                            return parsed_call
                parsed_single = _parse_tool_call_object(payload)
                if parsed_single is not None:
                    return parsed_single
        except Exception:
            pass

    # Find the first allowed tool call anywhere in the snippet.
    # This supports wrappers such as print(check_resources()).
    tool_name: Optional[str] = None
    raw_args = ""
    for name in sorted(allowed_tool_names, key=len, reverse=True):
        match = re.search(rf"\b{re.escape(name)}\s*\((.*?)\)", snippet, re.S)
        if match:
            tool_name = name
            raw_args = (match.group(1) or "").strip()
            break
    if not tool_name:
        return None

    if not raw_args:
        args_obj: Dict[str, Any] = {}
    else:
        # Allow JSON object in parentheses: foo({"a":1})
        try:
            parsed = json.loads(raw_args)
            args_obj = parsed if isinstance(parsed, dict) else {}
        except Exception:
            args_obj = {}
    return {"name": tool_name, "arguments": args_obj}


_THINK_OPEN_TAG = chr(60) + "think" + chr(62)
_THINK_CLOSE_TAG = chr(60) + "/think" + chr(62)
_THINK_BLOCK_RE = re.compile(
    re.escape(_THINK_OPEN_TAG) + r"(.*?)" + re.escape(_THINK_CLOSE_TAG),
    re.IGNORECASE | re.DOTALL,
)
_THINK_OPEN_TAIL_RE = re.compile(
    re.escape(_THINK_OPEN_TAG) + r"(.*)" + r"\Z",
    re.IGNORECASE | re.DOTALL,
)


def _split_reasoning_and_body(text: str) -> tuple[str, str]:
    """Split assistant text into (reasoning, body).

    Reasoning models stream ``ILD... `` tokens; the persisted assistant
    ``content`` should carry only the user-facing body so it is never re-fed
    to the LLM as context, while the reasoning text lives in a dedicated
    ``reasoning`` field for the UI to render a stable "思考了 X 秒" block.
    Closed ``ILD... `` blocks and an unclosed trailing ``ILD...`` are both
    captured. Mirrors the desktop ``parseReasoningContent`` contract.
    """
    raw = str(text or "")
    reasoning_parts: list[str] = []
    for m in _THINK_BLOCK_RE.finditer(raw):
        reasoning_parts.append(m.group(1))
    if not reasoning_parts:
        open_match = _THINK_OPEN_TAIL_RE.search(raw)
        if open_match:
            reasoning_parts.append(open_match.group(1))
    body = _THINK_BLOCK_RE.sub("", raw)
    body = _THINK_OPEN_TAIL_RE.sub("", body)
    reasoning = "\n".join(part.strip() for part in reasoning_parts if part.strip()).strip()
    return reasoning, body.strip()


# Nudge hint injected when a round produces reasoning (< Mattis>...</ Mattis>) but no
# visible body and no tool_calls — i.e. the model "thought but said/did nothing".
# Forces one retry so the model emits a real final reply or an explicit tool_call,
# instead of the runtime misjudging the turn as complete and surfacing a "继续" button.
_REASONING_ONLY_NUDGE_HINT = (
    "[runtime-reasoning-only] 上一轮只输出了思考内容（< Mattis>），"
    "没有给出用户可见的回复，也没有发出 tool_call。"
    "请基于已有上下文与工具结果，直接给出用户可见的最终回复，"
    "或发出明确的 tool_call；不要只输出思考。"
)


def _sanitize_structured_assistant_text(text: str, allowed_tool_names: set[str]) -> str:
    """Extract user-facing content from model-emitted JSON wrappers.

    Some providers/models may output planner JSON as plain text, e.g.
    `{"thought":"...","tool_calls":[]}` or OpenAI-like wrappers. This helper
    keeps visible content only and drops internal scaffolding noise.
    """
    if not text:
        return ""
    snippet = str(text).strip()
    if not snippet:
        return ""
    if snippet.startswith("```") and snippet.endswith("```"):
        body = re.sub(r"^```(?:json)?\s*", "", snippet).rstrip()
        snippet = re.sub(r"\s*```$", "", body).strip()
    if not snippet.startswith("{"):
        return str(text).strip()
    try:
        payload = json.loads(snippet)
    except Exception:
        return str(text).strip()
    if not isinstance(payload, dict):
        return str(text).strip()

    for key in ("content", "response", "answer", "reply", "final"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()

    tool_calls = payload.get("tool_calls")
    if isinstance(tool_calls, list):
        for item in tool_calls:
            if not isinstance(item, dict):
                continue
            fn = item.get("function")
            fn_name = ""
            fn_args: Any = {}
            if isinstance(fn, dict):
                fn_name = str(fn.get("name") or "").strip()
                fn_args = fn.get("arguments", {})
            elif isinstance(fn, str):
                fn_name = fn.strip()
                fn_args = item.get("args", {})
            if not fn_name:
                continue
            if isinstance(fn_args, str):
                try:
                    fn_args = json.loads(fn_args)
                except Exception:
                    fn_args = {}
            if not isinstance(fn_args, dict):
                continue
            if fn_name in allowed_tool_names or fn_name in {"respond", "final_answer", "reply", "answer"}:
                for arg_key in ("content", "text", "message", "answer", "reply"):
                    maybe_text = fn_args.get(arg_key)
                    if isinstance(maybe_text, str) and maybe_text.strip():
                        return maybe_text.strip()

    internal_only_keys = {"thought", "reasoning", "plan", "analysis", "tool_calls"}
    if set(payload.keys()).issubset(internal_only_keys):
        return ""
    return str(text).strip()


def _build_progress_signature(session: StudioSession) -> str:
    artifacts = getattr(session, "artifacts", {}) or {}
    artifact_entries = []
    for key, value in artifacts.items():
        sval = str(value)
        digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
        artifact_entries.append({"path": str(key), "len": len(sval), "hash": digest})
    artifact_entries.sort(key=lambda item: item["path"])
    scratchpad = getattr(session, "scratchpad", {}) or {}
    scratch_entries = []
    if isinstance(scratchpad, dict):
        for key, value in scratchpad.items():
            sval = str(value)
            digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
            scratch_entries.append({"key": str(key), "len": len(sval), "hash": digest})
    scratch_entries.sort(key=lambda item: item["key"])
    todo_payload: List[Dict[str, Any]] = []
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is not None:
        try:
            todo_payload = list(todo_manager.to_payload())
        except Exception:
            todo_payload = []
    context_entries = []
    context_files = getattr(session, "context_files", {}) or {}
    if isinstance(context_files, dict):
        for key, value in context_files.items():
            sval = str(value)
            digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
            context_entries.append({"path": str(key), "len": len(sval), "hash": digest})
    context_entries.sort(key=lambda item: item["path"])
    raw = json.dumps(
        {
            "artifacts": artifact_entries,
            "scratchpad": scratch_entries,
            "todos": todo_payload,
            "context_files": context_entries,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


_CONFIRMATION_SPAM_KEYWORDS = frozenset(
    {"TODO", "FINAL", "COMPLETED", "ULTIMATE", "ABSOLUTE", "REPORT", "SUMMARY"}
)


def _confirmation_spam_score_for_path(path: str) -> int:
    """Count keyword hits in basename; 2+ suggests meta/status filename spam."""
    if not path:
        return 0
    basename = os.path.basename(path).upper()
    return sum(1 for kw in _CONFIRMATION_SPAM_KEYWORDS if kw in basename)


def _extract_written_paths_from_result(result: str) -> List[str]:
    if not isinstance(result, str) or not result:
        return []
    paths: List[str] = []
    for raw_line in result.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = re.match(r"^OK:\s*(?:wrote|edited)\s+(.+?)(?:\s+\(\d+\s+chars\))?$", line)
        if not match:
            continue
        path = str(match.group(1) or "").strip()
        if path:
            paths.append(path)
    return paths


def _resolve_mid_turn_persist_interval() -> float:
    """Seconds between mid-turn incremental persists (0 to disable)."""
    raw = os.environ.get("AGX_MID_TURN_PERSIST_INTERVAL_SEC", "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return 30.0


def _resolve_mid_turn_persist_tool_count() -> int:
    """Number of tool calls between mid-turn persists (0 to disable)."""
    raw = os.environ.get("AGX_MID_TURN_PERSIST_TOOL_COUNT", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 3


# Forced tool_choice used to make weak function-calling models (e.g. qwen-plus)
# actually invoke knowledge_search on the first round under KB "always" mode,
# instead of narrating fake retrieval results in prose (no tool_calls -> no
# tool card / no references / no citation badges).
_KB_FORCED_TOOL_CHOICE: Dict[str, Any] = {
    "type": "function",
    "function": {"name": "knowledge_search"},
}


def _kb_retrieval_always_mode(session: Any) -> bool:
    """Return True when the effective KB retrieval mode is "always".

    Session-level override (``kb_retrieval_mode``) wins over the global KB
    config, mirroring ``_build_kb_retrieval_policy_block``. Returns False when
    the KB subsystem is unavailable or disabled.
    """
    mode = str(getattr(session, "kb_retrieval_mode", "") or "").strip().lower()
    if mode in {"auto", "always"}:
        return mode == "always"
    try:
        from agenticx.studio.kb import KBManager

        cfg = KBManager.instance().read_config()
        if not bool(getattr(cfg, "enabled", True)):
            return False
        cfg_mode = str(
            getattr(getattr(cfg, "retrieval", None), "mode", "auto") or "auto"
        ).strip().lower()
        return cfg_mode == "always"
    except Exception:
        return False


def _eager_knowledge_search_query(user_input: str) -> str:
    text = " ".join(str(user_input or "").split())
    return text[:800] if text else "知识库检索"


async def _eager_knowledge_search_events(
    *,
    runtime: "AgentRuntime",
    session: Any,
    user_input: str,
    messages: List[Dict[str, Any]],
    agent_id: str,
    executed_tool_names: List[str],
    is_system_trigger: bool,
    team_manager: Any,
) -> AsyncGenerator[RuntimeEvent, None]:
    """Run knowledge_search before round-1 LLM when KB mode is always.

    Weak FC models (e.g. qwen-plus) may ignore forced tool_choice with a large
    tool schema and narrate fake ``[N]`` markers without references. Eager
    execution guarantees tool_result + structured references for the UI.
    """
    tool_name = "knowledge_search"
    tool_call_id = f"call_kb_{uuid.uuid4().hex[:8]}"
    arguments = {"query": _eager_knowledge_search_query(user_input)}
    dispatch_arguments = {**arguments, "__tool_call_id": tool_call_id, "__agent_id": agent_id}

    yield RuntimeEvent(
        type=EventType.TOOL_CALL.value,
        data={"name": tool_name, "arguments": arguments, "tool_call_id": tool_call_id},
        agent_id=agent_id,
    )

    hook_outcome = await runtime.hooks.run_before_tool_call(tool_name, arguments, session)
    if hook_outcome.blocked:
        blocked_message = hook_outcome.reason or f"工具 {tool_name} 被策略阻止。"
        yield RuntimeEvent(
            type=EventType.TOOL_RESULT.value,
            data={"name": tool_name, "result": blocked_message, "tool_call_id": tool_call_id},
            agent_id=agent_id,
        )
        return

    effective_tm = team_manager or getattr(session, "_team_manager", None)
    try:
        result = await dispatch_tool_async(
            tool_name,
            dispatch_arguments,
            session,
            confirm_gate=runtime.confirm_gate,
            team_manager=effective_tm,
        )
    except Exception as exc:
        result = f"ERROR: {exc}"

    raw_result = str(result)
    executed_tool_names.append(tool_name)
    compacted = runtime.compactor.micro_compact_tool_result(tool_name, raw_result)

    assistant_tool_message: Dict[str, Any] = {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": tool_call_id,
                "type": "function",
                "function": {
                    "name": tool_name,
                    "arguments": json.dumps(arguments, ensure_ascii=False),
                },
            }
        ],
    }
    tool_message: Dict[str, Any] = {
        "role": "tool",
        "tool_call_id": tool_call_id,
        "name": tool_name,
        "content": compacted,
    }
    messages.append(assistant_tool_message)
    messages.append(tool_message)
    session.agent_messages.append(assistant_tool_message)
    session.agent_messages.append(tool_message)
    if not is_system_trigger:
        session.chat_history.append(
            {
                "role": "tool",
                "content": compacted,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "tool_args": arguments,
                "tool_status": "error" if str(result).startswith("ERROR:") else "done",
            }
        )

    _tool_result_data: Dict[str, Any] = {
        "name": tool_name,
        "result": compacted,
        "tool_call_id": tool_call_id,
    }
    try:
        from agenticx.studio.references import structured_payload_for_tool_result

        _structured = structured_payload_for_tool_result(
            session, tool_name, arguments, raw_result
        )
        if _structured:
            _tool_result_data["structured"] = _structured
    except Exception:
        pass

    yield RuntimeEvent(
        type=EventType.TOOL_RESULT.value,
        data=_tool_result_data,
        agent_id=agent_id,
    )
    runtime._tools_since_persist += 1
    runtime._maybe_mid_turn_persist()


class AgentRuntime:
    """LLM-driven runtime that emits structured events."""

    def __init__(
        self,
        llm: Any,
        confirm_gate: ConfirmGate,
        *,
        max_tool_rounds: int = MAX_TOOL_ROUNDS,
        loop_warning_threshold: int = 6,
        loop_critical_threshold: int = 12,
        hooks: Optional[HookRegistry] = None,
        team_manager: Optional[Any] = None,
        mid_turn_persist: Optional[Callable[[], None]] = None,
        clarify_gate: Optional[Any] = None,
        is_unattended: bool = False,
    ) -> None:
        self.llm = llm
        self.confirm_gate = confirm_gate
        self.clarify_gate = clarify_gate
        self.is_unattended = bool(is_unattended)
        self.max_tool_rounds = max_tool_rounds
        self.hooks = hooks or HookRegistry()
        self.compactor = ContextCompactor(llm)
        self.loop_detector = LoopDetector(
            warning_threshold=loop_warning_threshold,
            critical_threshold=loop_critical_threshold,
        )
        self._pending_loop_nudge: Optional[str] = None
        self._recent_exploratory_fps: deque[str] = deque(maxlen=10)
        # Exploratory tools get a bounded "schema discovery" budget:
        # the first N consecutive unique errors count as progress, after
        # which the detector goes back to treating errors as no-progress.
        self._exploratory_error_streak: int = 0
        self._exploratory_error_budget: int = 3
        self.team_manager = team_manager
        self.token_budget = TokenBudgetGuard()
        # Per-turn latches: token budget stays >= COMPRESS after compaction (counters
        # are not reduced), so without these every tool round would re-summarize and
        # re-emit the same UI warning.
        self._forced_budget_compact_this_turn = False
        self._proactive_compact_this_turn = False
        self._budget_compress_notice_sent_this_turn = False
        self._mid_turn_persist = mid_turn_persist
        self._persist_interval_sec = _resolve_mid_turn_persist_interval()
        self._persist_tool_count = _resolve_mid_turn_persist_tool_count()
        self._last_persist_time: float = 0.0
        self._tools_since_persist: int = 0
        try:
            from agenticx.runtime.hooks.legacy_event_bridge_hook import LegacyEventBridgeHook

            # Bridge AgentRuntime events to global HookEvent handlers (bundled/imported hooks).
            self.hooks.register(LegacyEventBridgeHook(), priority=100)
        except Exception:
            pass
        try:
            from agenticx.runtime.hooks.memory_hook import MemoryHook
            self.hooks.register(MemoryHook(), priority=-10)
        except Exception:
            pass
        try:
            from agenticx.runtime.hooks.session_summary_hook import SessionSummaryHook
            self.hooks.register(SessionSummaryHook(), priority=-20)
        except Exception:
            pass
        try:
            from agenticx.learning.observer import ObservationHook
            self.hooks.register(ObservationHook(), priority=-30)
        except Exception:
            pass
        try:
            from agenticx.learning.session_review_hook import SessionReviewHook
            self.hooks.register(SessionReviewHook(), priority=-50)
        except Exception:
            pass
        try:
            from agenticx.runtime.hooks.session_freeze_hook import SessionFreezeHook
            self.hooks.register(SessionFreezeHook(), priority=-55)
        except Exception:
            pass
        try:
            from agenticx.memory.turn_archive_config import load_turn_archive_config
            from agenticx.runtime.hooks.turn_archive_hook import TurnArchiveHook

            _ta_cfg = load_turn_archive_config()
            if _ta_cfg.get("enabled"):
                self.hooks.register(TurnArchiveHook(enabled=True), priority=-60)
        except Exception:
            pass

    def _maybe_mid_turn_persist(self) -> None:
        """Fire incremental persist if interval or tool-count thresholds are met."""
        if self._mid_turn_persist is None:
            return
        now = time.time()
        interval_ok = (
            self._persist_interval_sec > 0
            and (now - self._last_persist_time) >= self._persist_interval_sec
        )
        count_ok = (
            self._persist_tool_count > 0
            and self._tools_since_persist >= self._persist_tool_count
        )
        if interval_ok or count_ok:
            try:
                self._mid_turn_persist()
            except Exception:
                pass
            self._last_persist_time = now
            self._tools_since_persist = 0

    async def run_turn(
        self,
        user_input: str,
        session: StudioSession,
        should_stop: Optional[Callable[[], bool | Awaitable[bool]]] = None,
        *,
        agent_id: str = "meta",
        tools: Optional[Sequence[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
        user_message_content: Optional[Any] = None,
        history_user_attachments: Optional[list[dict[str, Any]]] = None,
        persist_user_message: bool = True,
        usage_session_id: Optional[str] = None,
        usage_avatar_id: Optional[str] = None,
    ) -> AsyncGenerator[RuntimeEvent, None]:
        async def _check_should_stop() -> bool:
            if should_stop is None:
                return False
            try:
                result = should_stop()
                if inspect.isawaitable(result):
                    return bool(await result)
                return bool(result)
            except Exception:
                return False

        self.token_budget.reset_turn()
        self._forced_budget_compact_this_turn = False
        self._proactive_compact_this_turn = False
        self._budget_compress_notice_sent_this_turn = False
        self._pending_loop_nudge = None
        setattr(session, "_context_chain_repair_attempted", False)
        self._last_persist_time = time.time()
        self._tools_since_persist = 0
        try:
            from agenticx.studio.references import reset_turn_references

            reset_turn_references(session)
        except Exception:
            pass
        # Reset per-turn exploratory tracking so each turn starts with a
        # fresh "schema discovery" budget.
        self._recent_exploratory_fps.clear()
        self._exploratory_error_streak = 0

        current_system_prompt = system_prompt or _build_agent_system_prompt(session)
        active_tools: Sequence[Dict[str, Any]] = (
            studio_tools_for_session(session) if tools is None else tools
        )
        from agenticx.runtime.context_budget import maybe_compact_meta_turn_context

        compact_prompt, compact_tools, compact_notice = maybe_compact_meta_turn_context(
            session,
            system_prompt=current_system_prompt,
            tools=list(active_tools),
        )
        if compact_notice:
            current_system_prompt = compact_prompt
            active_tools = compact_tools
        allowed_tool_names = {
            str(tool.get("function", {}).get("name", "")).strip()
            for tool in active_tools
            if isinstance(tool, dict)
        }
        # KB "always" mode: force knowledge_search on the first round so weak
        # function-calling models (e.g. qwen-plus) actually invoke the tool
        # instead of narrating fake retrieval results in prose.
        _kb_force_always = (
            "knowledge_search" in allowed_tool_names and _kb_retrieval_always_mode(session)
        )
        history = _sanitize_context_messages(session.agent_messages)
        # Enrich plain user entries in agent_messages history from chat_history attachments
        # (covers resumes of sessions that had images persisted only to chat_history, and
        # aligns pre-fix data so promotion below can see data:image attachments).
        try:
            _enrich_attachments_from_chat_history(history, getattr(session, "chat_history", None) or [])
        except Exception:
            pass
        if getattr(session, "_code_dev_phase_compact_pending", False):
            setattr(session, "_code_dev_phase_compact_pending", False)
            compact_model = str(getattr(session, "model_name", "") or "")
            history, _phase_did, _phase_sum, _phase_cnt, _ = await self.compactor.maybe_compact(
                history,
                force=True,
                model=compact_model,
            )
            if _phase_did:
                session.agent_messages = list(history)
        compact_model = str(getattr(session, "model_name", "") or "")
        did_compact = False
        compact_summary = ""
        compacted_count = 0
        compacted_history = history
        try:
            compacted_history, did_compact, compact_summary, compacted_count, _pending_q = await self.compactor.maybe_compact(
                history,
                model=compact_model,
            )
        except Exception as exc:
            logger.warning(
                "proactive compaction failed; continuing with unsplit history session=%s: %s",
                getattr(session, "session_id", ""),
                exc,
                exc_info=True,
            )
            compacted_history = history
            did_compact = False
        if did_compact:
            compacted_history = _sanitize_context_messages(compacted_history)
            if len(compacted_history) <= 1:
                logger.warning(
                    "proactive compaction collapsed history to <=1 row; skipping persist session=%s",
                    getattr(session, "session_id", ""),
                )
                compacted_history = history
                did_compact = False
        messages: List[Dict[str, Any]] = [{"role": "system", "content": current_system_prompt}]
        messages.extend(compacted_history)
        # Promote any user history attachments (with data:image data_url) into native
        # multimodal content blocks when the target model supports vision. This is the
        # key step that makes previously uploaded chat images visible after model switch
        # or across turns, without the user re-uploading or the agent calling view_image
        # on transient client paths.
        try:
            p = str(getattr(session, "provider_name", "") or "")
            m = str(getattr(session, "model_name", "") or "")
            messages = _promote_user_image_attachments(messages, p, m)
        except Exception:
            pass
        try:
            from agenticx.runtime.session_mode import (
                EXPLORE_WHOLE_FILE_READ_WARN_KEY,
                PHASE_EXPLORE,
                get_session_phase,
                is_code_dev,
            )

            if is_code_dev(session) and get_session_phase(session) == PHASE_EXPLORE:
                scratch = getattr(session, "scratchpad", None) or {}
                if isinstance(scratch, dict):
                    warn_n = int(scratch.get(EXPLORE_WHOLE_FILE_READ_WARN_KEY, 0) or 0)
                    if warn_n >= 2:
                        messages.append({
                            "role": "system",
                            "content": (
                                "[code_dev] 当前处于探索阶段，已连续整文件 file_read。"
                                "请先使用 code_outline / grep 定位，再用 start_line/end_line 片段读取。"
                            ),
                        })
                        scratch[EXPLORE_WHOLE_FILE_READ_WARN_KEY] = "0"
        except Exception:
            pass
        _is_system_trigger = user_input.startswith("[系统通知]")
        if did_compact:
            yield RuntimeEvent(
                type=EventType.COMPACTION.value,
                data={
                    "compacted_count": compacted_count,
                    "summary": compact_summary,
                },
                agent_id=agent_id,
            )
            try:
                await self.hooks.run_on_compaction(compacted_count, compact_summary, session)
            except Exception:
                logger.debug("run_on_compaction hook failed", exc_info=True)
            # FR-1: persist proactive compaction so later turns use compacted history
            # instead of re-summarizing full agent_messages every turn.
            session.agent_messages = list(compacted_history)
            self._proactive_compact_this_turn = True
            if not _is_system_trigger and str(user_input or "").strip():
                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "[compaction-notice] 较早历史已压缩为摘要；请继续完成用户当前请求，"
                            "勿将 [compacted] 标记误判为任务终止。"
                        ),
                    },
                )
        user_content: Any = user_message_content if user_message_content is not None else user_input
        messages.append({"role": "user", "content": user_content})
        if persist_user_message:
            # Store rich content (list with image_url blocks for vision uploads) + attachments
            # so that later turns (including after model switch to a vision model) can replay
            # the images as native multimodal parts instead of relying on ephemeral paths or view_image.
            am_user: dict[str, Any] = {"role": "user", "content": user_content}
            if history_user_attachments:
                am_user["attachments"] = list(history_user_attachments)
            session.agent_messages.append(am_user)
        await self.hooks.run_on_agent_start(session, agent_id, user_input)
        synced_session_message_count = len(session.agent_messages)
        if persist_user_message and not _is_system_trigger:
            hist_user: dict[str, Any] = {"role": "user", "content": user_input}
            if history_user_attachments:
                hist_user["attachments"] = list(history_user_attachments)
            _chat_history_append_deduped(session.chat_history, hist_user)
            # Set current user intent for goal anchor injection (FR-1)
            session.current_user_intent = user_input
            # Persist the user turn to disk immediately. Otherwise messages.json
            # lags until the first mid-turn checkpoint, and a client that reloads
            # this session (e.g. switching away and back) reads a stale snapshot
            # missing the just-sent user turn -- the message appears to vanish.
            if self._mid_turn_persist is not None:
                try:
                    self._mid_turn_persist()
                    self._last_persist_time = time.time()
                except Exception:
                    pass
        elif not _is_system_trigger:
            # skip_user_history still feeds the model, but Desktop must show the
            # user bubble after reload. Append a display row when the tail does
            # not already contain this utterance (retry keeps the truncated row).
            from agenticx.studio.continuation import is_continuation_user_prompt

            ui_text = str(user_input or "").strip()
            if ui_text and not is_continuation_user_prompt(ui_text):
                last_user_text = ""
                for item in reversed(session.chat_history or []):
                    if item.get("role") == "user":
                        last_user_text = str(item.get("content", "")).strip()
                        break
                if last_user_text != ui_text:
                    hist_user: dict[str, Any] = {"role": "user", "content": user_input}
                    if history_user_attachments:
                        hist_user["attachments"] = list(history_user_attachments)
                    _chat_history_append_deduped(session.chat_history, hist_user)
                    session.current_user_intent = user_input
                    if self._mid_turn_persist is not None:
                        try:
                            self._mid_turn_persist()
                            self._last_persist_time = time.time()
                        except Exception:
                            pass
        status_query_total = 0
        status_query_attempts_total = 0
        max_status_queries_per_turn = _resolve_status_query_budget_per_turn()
        min_status_query_interval_sec = _resolve_status_query_cooldown_seconds()
        last_status_query_at = 0.0
        last_status_query_signature: Optional[str] = None
        repeated_status_query_count = 0
        last_status_query_had_rows = False
        executed_tool_names: List[str] = []
        disk_write_paths: set[str] = set()
        write_path_counts: Dict[str, int] = {}
        confirmation_spam_count = 0
        rounds_without_todo = 0
        # Turn-level counter for reasoning-only rounds (model emitted < Mattis> but no
        # visible body and no tool_call). Capped at 1 to avoid infinite nudge loops.
        reason_only_retry = 0
        invoke_timeout_seconds = _resolve_llm_invoke_timeout_seconds(session)
        heartbeat_timeout_seconds = _resolve_llm_heartbeat_timeout_seconds(session)
        hard_timeout_seconds = _resolve_llm_hard_timeout_seconds(session)
        provider_read_timeout = resolve_provider_read_timeout(session)
        request_timeout_seconds = max(
            invoke_timeout_seconds,
            heartbeat_timeout_seconds,
            hard_timeout_seconds,
            provider_read_timeout,
        ) + 15.0
        first_feedback_seconds = _resolve_llm_first_feedback_seconds(session)
        provider_name = str(getattr(session, "provider_name", "") or "").strip()
        model_name = str(getattr(session, "model_name", "") or "").strip()
        prompt_cache_cfg = load_prompt_cache_config()
        latest_cache_telemetry: Dict[str, Any] = {
            "cache_mode": "disabled",
            "cache_breakpoints": 0,
            "cache_eligible_chars": 0,
            "cache_hit_chars": 0,
            "cache_hit_rate": 0.0,
            "cache_saved_tokens_est": 0,
        }
        try:
            _notice = ""
            if isinstance(session.scratchpad, dict):
                _notice = str(session.scratchpad.pop("vision_budget_notice", "") or "").strip()
            if _notice:
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={"text": _notice, "severity": "warning", "detector": "vision_history_budget"},
                    agent_id=agent_id,
                )
        except Exception:
            pass

        if compact_notice:
            yield RuntimeEvent(
                type=EventType.ERROR.value,
                data={
                    "text": compact_notice,
                    "severity": "warning",
                    "detector": "context_budget_compact",
                },
                agent_id=agent_id,
            )

        for round_idx in range(1, self.max_tool_rounds + 1):
            if await _check_should_stop():
                yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                return
            if self._pending_loop_nudge:
                nudge_text = self._pending_loop_nudge
                self._pending_loop_nudge = None
                messages.append(
                    {
                        "role": "system",
                        "content": f"[runtime-loop-hint]\n{nudge_text}",
                    }
                )
                logger.info(
                    "loop_nudge_injected=true session=%s round=%s",
                    getattr(session, "session_id", ""),
                    round_idx,
                )
            yield RuntimeEvent(
                type=EventType.ROUND_START.value,
                data={"round": round_idx, "max_rounds": self.max_tool_rounds},
                agent_id=agent_id,
            )
            _followups_enabled = suggested_questions_enabled_from_config()
            followup_emitter = FollowupStreamEmitter(_followups_enabled)
            if agent_id != "meta" and round_idx > 1 and (round_idx - 1) % 8 == 0:
                checkpoint = {
                    "agent_id": agent_id,
                    "round": round_idx - 1,
                    "max_rounds": self.max_tool_rounds,
                    "executed_tools": list(dict.fromkeys(executed_tool_names))[-10:],
                    "artifact_count": len(session.artifacts),
                    "text": f"已执行至第 {round_idx - 1} 轮，准备继续。",
                }
                yield RuntimeEvent(
                    type=EventType.SUBAGENT_CHECKPOINT.value,
                    data=checkpoint,
                    agent_id=agent_id,
                )
                recent_tools = (
                    executed_tool_names[-32:]
                    if len(executed_tool_names) > 32
                    else list(executed_tool_names)
                )
                file_write_heavy = sum(1 for n in recent_tools if n in ("file_write", "file_edit"))
                unique_recent = set(recent_tools)
                is_stalling = file_write_heavy > 5 and len(unique_recent) <= 2
                if is_stalling and recent_tools:
                    task_hint = str(user_input or "")[:800]
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                f"<checkpoint round={round_idx - 1}>"
                                f"WARNING: {file_write_heavy} of your last {len(recent_tools)} tool calls "
                                "were file writes/edits. You appear to be creating status/confirmation files "
                                "instead of performing the actual task. STOP creating files and focus on "
                                f"your delegated_task: {task_hint}. "
                                "If the task is done, output your final answer as text."
                                "</checkpoint>"
                            ),
                        },
                    )
            if len(session.agent_messages) > synced_session_message_count:
                messages.extend(
                    _sanitize_context_messages(session.agent_messages[synced_session_message_count:])
                )
                synced_session_message_count = len(session.agent_messages)
            if rounds_without_todo > 10:
                messages.append(
                    {
                        "role": "user",
                        "content": "<reminder>10+ rounds without todo_write. Please update todo list.</reminder>",
                    }
                )
            # FR-C: 标记本轮是否需要因流式工具调用截断而强制进入下一轮，
            # 而不是把空 tool_calls 当作模型最终回答处理。每轮起始重置。
            force_retry_next_round = False
            if (
                _kb_force_always
                and round_idx == 1
                and "knowledge_search" not in executed_tool_names
                and not _is_system_trigger
                and provider_name.strip().lower() != "minimax"
            ):
                async for _kb_evt in _eager_knowledge_search_events(
                    runtime=self,
                    session=session,
                    user_input=user_input,
                    messages=messages,
                    agent_id=agent_id,
                    executed_tool_names=executed_tool_names,
                    is_system_trigger=_is_system_trigger,
                    team_manager=self.team_manager,
                ):
                    yield _kb_evt
                if "knowledge_search" in executed_tool_names:
                    synced_session_message_count = len(session.agent_messages)
            try:
                # Increment per-turn counter for SessionReviewHook nudge threshold
                session._turns_since_skill_manage = getattr(session, "_turns_since_skill_manage", 0) + 1
                messages = await self.hooks.run_before_model(messages, session)
                messages = _sanitize_context_messages(messages)
                # Late promote (idempotent) so that any attachments added to recent user
                # entries (current turn or injected) are visible as vision parts for
                # capable models before stripping.
                try:
                    messages = _promote_user_image_attachments(messages, provider_name, model_name)
                except Exception:
                    pass
                messages = strip_nonvision_multimodal_messages(
                    messages, provider_name, model_name
                )
                if provider_name.strip().lower() == "minimax":
                    messages = _merge_consecutive_simple_roles_for_minimax(messages)
                budget_cfg = load_tool_result_budget_config()
                messages, budget_stats = apply_tool_result_budget(
                    messages,
                    current_round=round_idx,
                    session=session,
                    cfg=budget_cfg,
                )
                messages_total_chars = sum(
                    len(str(m.get("content", ""))) for m in messages if isinstance(m, dict)
                )
                anchor_message = _build_user_goal_anchor(
                    session=session,
                    round_idx=round_idx,
                    max_rounds=self.max_tool_rounds,
                    tools_used_so_far=len(executed_tool_names),
                    messages_total_chars=messages_total_chars,
                    tool_result_tokens_session=budget_stats.tool_result_tokens_session,
                )
                if anchor_message:
                    prepend = bool(getattr(session, "_goal_anchor_prepend", False))
                    if prepend:
                        insert_idx = 0
                        for i, m in enumerate(messages):
                            if isinstance(m, dict) and str(m.get("role", "")).lower() == "system":
                                insert_idx = i + 1
                            else:
                                break
                        messages_for_llm = list(messages)
                        messages_for_llm.insert(insert_idx, anchor_message)
                    else:
                        messages_for_llm = list(messages) + [anchor_message]
                else:
                    messages_for_llm = messages
                llm_call_kwargs: Dict[str, Any] = {}
                try:
                    messages_for_llm, cache_telemetry = apply_prompt_cache_breakpoints(
                        messages_for_llm,
                        provider_name=provider_name,
                        cfg=prompt_cache_cfg,
                    )
                    llm_call_kwargs = build_context_management_kwargs(
                        provider_name=provider_name,
                        cfg=prompt_cache_cfg,
                    )
                    cache_eligible_chars = int(cache_telemetry.get("cache_eligible_chars", 0) or 0)
                    cache_saved_tokens_est = int(cache_eligible_chars / 4) if cache_eligible_chars > 0 else 0
                    latest_cache_telemetry = {
                        "cache_mode": str(cache_telemetry.get("cache_mode", "disabled")),
                        "cache_breakpoints": int(cache_telemetry.get("cache_breakpoints", 0) or 0),
                        "cache_eligible_chars": cache_eligible_chars,
                        "cache_hit_chars": 0,
                        "cache_hit_rate": 0.0,
                        "cache_saved_tokens_est": cache_saved_tokens_est,
                    }
                except Exception:
                    llm_call_kwargs = {}
                context_payload = {
                    "round": round_idx,
                    "prompt_tokens_approx": approx_tokens(
                        "\n".join(str(m.get("content", "")) for m in messages_for_llm if isinstance(m, dict))
                    ),
                    "tool_result_tokens_round": budget_stats.tool_result_tokens_round,
                    "tool_result_tokens_session": budget_stats.tool_result_tokens_session,
                    "archived_tool_calls": budget_stats.archived_replaced,
                    "anchor_mode": getattr(session, "_goal_anchor_mode", None),
                    "anchor_prepend": bool(getattr(session, "_goal_anchor_prepend", False)),
                    "cache_mode": latest_cache_telemetry.get("cache_mode", "disabled"),
                    "cache_breakpoints": latest_cache_telemetry.get("cache_breakpoints", 0),
                    "cache_eligible_chars": latest_cache_telemetry.get("cache_eligible_chars", 0),
                    "cache_saved_tokens_est": latest_cache_telemetry.get("cache_saved_tokens_est", 0),
                }
                persist_context_stats(session, context_payload)
                yield RuntimeEvent(
                    type=EventType.CONTEXT_STATS.value,
                    data=context_payload,
                    agent_id=agent_id,
                )
                # Ensure any attachments on recent history (including current turn) are
                # promoted for this round's LLM call when the model is vision capable.
                try:
                    messages_for_llm = _promote_user_image_attachments(messages_for_llm, provider_name, model_name)
                except Exception:
                    pass
                messages_for_llm = strip_nonvision_multimodal_messages(
                    messages_for_llm, provider_name, model_name
                )
                if provider_name.strip().lower() == "minimax":
                    messages_for_llm = _merge_consecutive_simple_roles_for_minimax(messages_for_llm)
                response_text = ""
                tool_calls: List[Dict[str, Any]] = []
                response: Any
                # Reasoning phase timing captured during the streaming path for
                # reasoning_seconds persistence. Populated only when the model
                # emits  Mattis... Mattis tags via the streaming path.
                _stream_reasoning_start_ts: Optional[float] = None
                _stream_body_start_ts: Optional[float] = None
                stream_with_tools = getattr(self.llm, "stream_with_tools", None)
                used_stream_path = False
                if callable(stream_with_tools):
                    try:
                        loop = asyncio.get_running_loop()

                        def _run_sync_stream_with_tools(
                            stop_event: threading.Event,
                            queue_put: Callable[[Any], None],
                        ) -> None:
                            try:
                                _round_tool_choice: Any = "auto"
                                if (
                                    _kb_force_always
                                    and round_idx == 1
                                    and "knowledge_search" not in executed_tool_names
                                    and provider_name.strip().lower() != "minimax"
                                ):
                                    _round_tool_choice = _KB_FORCED_TOOL_CHOICE
                                stream_kwargs: Dict[str, Any] = {
                                    "tools": list(active_tools),
                                    "tool_choice": _round_tool_choice,
                                    "temperature": 0.2,
                                    "max_tokens": 8192,
                                    "timeout": request_timeout_seconds,
                                }
                                if provider_name.strip().lower() == "minimax":
                                    stream_kwargs.pop("tool_choice", None)
                                    stream_kwargs.pop("temperature", None)
                                    stream_kwargs["max_tokens"] = 4096
                                stream_kwargs.update(llm_call_kwargs)
                                for chunk in stream_with_tools(
                                    messages_for_llm,
                                    **stream_kwargs,
                                ):
                                    if stop_event.is_set():
                                        break
                                    if isinstance(chunk, dict):
                                        queue_put(dict(chunk))
                            except Exception as exc:
                                queue_put(
                                    {"type": "stream_error", "error": str(exc)}
                                )
                            finally:
                                queue_put(None)

                        tool_calls_acc: Dict[int, Dict[str, str]] = {}
                        stream_usage: Dict[str, int] = {}

                        def _safe_int(value: Any) -> int:
                            if isinstance(value, bool):
                                return int(value)
                            if isinstance(value, (int, float)):
                                return int(value)
                            if isinstance(value, str):
                                raw = value.strip()
                                if not raw:
                                    return 0
                                try:
                                    return int(raw)
                                except ValueError:
                                    try:
                                        return int(float(raw))
                                    except ValueError:
                                        return 0
                            return 0

                        async for stream_chunk in _iter_sync_stream_with_watchdog(
                            loop=loop,
                            run_sync_stream=_run_sync_stream_with_tools,
                            check_should_stop=_check_should_stop,
                            invoke_timeout_seconds=invoke_timeout_seconds,
                            heartbeat_timeout_seconds=heartbeat_timeout_seconds,
                            hard_timeout_seconds=hard_timeout_seconds,
                            first_feedback_seconds=first_feedback_seconds,
                            emit_waiting_hint=True,
                        ):
                            if stream_chunk is _STREAM_WAITING_HINT:
                                yield RuntimeEvent(
                                    type=EventType.TOKEN.value,
                                    data={"text": "⏳"},
                                    agent_id=agent_id,
                                )
                                continue
                            chunk_type = str(stream_chunk.get("type", "")).strip()
                            if chunk_type == "content":
                                tok = str(stream_chunk.get("text", ""))
                                if tok:
                                    # Capture reasoning phase timing for
                                    # reasoning_seconds persistence. The first
                                    #  Mattis marks reasoning start; the first
                                    #  Mattis/ marks body start.
                                    if (
                                        _stream_reasoning_start_ts is None
                                        and _THINK_OPEN_TAG in response_text + tok
                                    ):
                                        _stream_reasoning_start_ts = time.monotonic()
                                    if (
                                        _stream_reasoning_start_ts is not None
                                        and _stream_body_start_ts is None
                                        and _THINK_CLOSE_TAG in response_text + tok
                                    ):
                                        _stream_body_start_ts = time.monotonic()
                                    response_text += tok
                                    _vis = followup_emitter.feed_append(tok)
                                    if _vis:
                                        yield RuntimeEvent(
                                            type=EventType.TOKEN.value,
                                            data={"text": _vis},
                                            agent_id=agent_id,
                                        )
                            elif chunk_type == "usage":
                                usage_raw = stream_chunk.get("usage", {})
                                if isinstance(usage_raw, dict):
                                    pt = _safe_int(
                                        usage_raw.get("prompt_tokens") or usage_raw.get("input_tokens") or 0
                                    )
                                    ct = _safe_int(
                                        usage_raw.get("completion_tokens")
                                        or usage_raw.get("output_tokens")
                                        or 0
                                    )
                                    tt = _safe_int(usage_raw.get("total_tokens") or 0)
                                    if tt == 0 and (pt > 0 or ct > 0):
                                        tt = pt + ct
                                    if pt > 0 or ct > 0 or tt > 0:
                                        stream_usage = {
                                            "prompt_tokens": pt,
                                            "completion_tokens": ct,
                                            "total_tokens": tt,
                                        }
                            elif chunk_type == "tool_call_delta":
                                raw_idx = stream_chunk.get("tool_index", 0)
                                idx = raw_idx if isinstance(raw_idx, int) else 0
                                acc = tool_calls_acc.setdefault(
                                    idx, {"id": "", "name": "", "arguments": ""}
                                )
                                raw_tc_id = stream_chunk.get("tool_call_id", "")
                                tool_call_id = str(raw_tc_id).strip() if isinstance(raw_tc_id, str) else ""
                                raw_tn = stream_chunk.get("tool_name", "")
                                tool_name = str(raw_tn).strip() if isinstance(raw_tn, str) and raw_tn is not None else ""
                                if tool_name.lower() == "none":
                                    tool_name = ""
                                args_delta = str(stream_chunk.get("arguments_delta", ""))
                                if tool_call_id:
                                    acc["id"] = tool_call_id
                                if tool_name:
                                    acc["name"] = tool_name
                                if args_delta:
                                    acc["arguments"] += args_delta
                        # FR-C：流式工具调用偶尔因 token 紧张被截断 → arguments 字段为空。
                        # 如果该工具有 required 参数（如 file_write），则不要把空参数派发出去，
                        # 改成丢弃并往本轮 response_text 追加一条 retry hint，让下一轮 LLM
                        # 看到提示后重新生成完整调用，避免「ERROR → 模型放弃」死循环。
                        truncated_tool_names: List[str] = []
                        for idx in sorted(tool_calls_acc.keys()):
                            item = tool_calls_acc[idx]
                            accumulated_name = (item.get("name") or "").strip()
                            if not accumulated_name or accumulated_name.lower() == "none":
                                logger.warning(
                                    "Dropping streamed tool_call at index %d with empty/invalid name",
                                    idx,
                                )
                                continue
                            args_obj = _repair_streamed_tool_arguments(item.get("arguments", ""))
                            if _streamed_tool_call_truncated(accumulated_name, args_obj):
                                logger.warning(
                                    "Dropping streamed tool_call '%s' (idx=%d) due to truncated/empty arguments; "
                                    "will surface retry hint to model",
                                    accumulated_name,
                                    idx,
                                )
                                truncated_tool_names.append(accumulated_name)
                                continue
                            tool_calls.append(
                                {
                                    "id": item.get("id") or f"stream-{uuid.uuid4().hex[:8]}",
                                    "type": "function",
                                    "function": {
                                        "name": accumulated_name,
                                        "arguments": json.dumps(args_obj, ensure_ascii=False),
                                    },
                                }
                            )
                        # FR-C: 流式工具调用被截断后，drop 掉的空参 tool_call
                        # 不能让 turn 走 finalText 分支结束。这里把 hint 注入
                        # messages 里作为 system 消息，并设置 force_retry 标志，
                        # 让外层 for round_idx 循环立即进入下一轮 LLM 调用。
                        if truncated_tool_names:
                            force_retry_next_round = True
                            hint = _build_streamed_tool_truncation_hint(truncated_tool_names)
                            # 把 hint 同时写进会话历史（让前端/后续 LLM 上下文都能感知），
                            # 但不附加到 assistant_message——避免污染 tool_calls 链路。
                            messages.append({"role": "system", "content": hint})
                            session.agent_messages.append({"role": "system", "content": hint})
                            # 给前端透出一条事件，提示当前轮被流式截断、即将自动重试，
                            # 而不是让 UI 看到"模型沉默"再触发 stall 提示。
                            yield RuntimeEvent(
                                type=EventType.ROUND_END.value,
                                data={
                                    "round": round_idx,
                                    "max_rounds": self.max_tool_rounds,
                                    "auto_retry": True,
                                    "reason": "streamed_tool_call_truncated",
                                    "tools": sorted(set(truncated_tool_names)),
                                },
                                agent_id=agent_id,
                            )
                        response = type(
                            "StreamResponse",
                            (),
                            {"content": response_text, "tool_calls": tool_calls, "usage": stream_usage},
                        )()
                        used_stream_path = True
                    except _StreamWatchdogUserStop:
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={"text": STOP_MESSAGE},
                            agent_id=agent_id,
                        )
                        return
                    except Exception as stream_exc:
                        logger.warning(
                            "stream_with_tools failed, fallback to invoke path",
                            exc_info=True,
                        )
                        record_session_provider_hard_failure(
                            session,
                            provider_name,
                            fault=classify_provider_fault(stream_exc),
                        )
                        used_stream_path = False
                if not used_stream_path:
                    def _invoke_once_with_fallback() -> Any:
                        _fallback_tool_choice: Any = "auto"
                        if (
                            _kb_force_always
                            and round_idx == 1
                            and "knowledge_search" not in executed_tool_names
                            and provider_name.strip().lower() != "minimax"
                        ):
                            _fallback_tool_choice = _KB_FORCED_TOOL_CHOICE
                        try:
                            return self.llm.invoke(
                                messages_for_llm,
                                tools=active_tools,
                                tool_choice=_fallback_tool_choice,
                                temperature=0.2,
                                max_tokens=8192,
                                timeout=request_timeout_seconds,
                                **llm_call_kwargs,
                            )
                        except Exception as invoke_exc:
                            provider_lower = provider_name.strip().lower()
                            if provider_lower == "minimax" and _is_minimax_chat_setting_error(invoke_exc):
                                logger.warning(
                                    "MiniMax rejected chat settings; retrying invoke with conservative params",
                                    exc_info=True,
                                )
                                minimax_retries = [
                                    # Keep tools, but remove advanced settings and lower token budget.
                                    {
                                        "tools": active_tools,
                                        "max_tokens": 4096,
                                        "timeout": request_timeout_seconds,
                                        **llm_call_kwargs,
                                    },
                                    # Some accounts reject max_tokens + tool_choice combos in edge cases.
                                    {
                                        "tools": active_tools,
                                        "timeout": request_timeout_seconds,
                                        **llm_call_kwargs,
                                    },
                                ]
                                last_exc: Exception = invoke_exc
                                for retry_kwargs in minimax_retries:
                                    try:
                                        return self.llm.invoke(messages_for_llm, **retry_kwargs)
                                    except Exception as retry_exc:
                                        last_exc = retry_exc
                                        if not _is_minimax_chat_setting_error(retry_exc):
                                            raise
                                raise last_exc
                            raise

                    _retry_policy = LLMRetryPolicy()

                    def _invoke_with_retry() -> Any:
                        return _retry_policy.call_sync_with_retry(_invoke_once_with_fallback)

                    invoke_task = asyncio.create_task(
                        asyncio.to_thread(
                            _invoke_with_retry,
                        )
                    )
                    wait_started_at = asyncio.get_running_loop().time()
                    waiting_hint_emitted = False
                    last_pulse_at = wait_started_at
                    while True:
                        if await _check_should_stop():
                            invoke_task.cancel()
                            try:
                                await invoke_task
                            except (asyncio.CancelledError, Exception):
                                pass
                            yield RuntimeEvent(
                                type=EventType.ERROR.value,
                                data={"text": STOP_MESSAGE},
                                agent_id=agent_id,
                            )
                            return
                        if invoke_task.done():
                            response = await invoke_task
                            break
                        now = asyncio.get_running_loop().time()
                        elapsed = now - wait_started_at
                        if (not waiting_hint_emitted) and elapsed >= first_feedback_seconds:
                            waiting_hint_emitted = True
                            last_pulse_at = now
                            yield RuntimeEvent(
                                type=EventType.TOKEN.value,
                                data={"text": "⏳"},
                                agent_id=agent_id,
                            )
                        if elapsed >= invoke_timeout_seconds:
                            invoke_task.cancel()
                            raise asyncio.TimeoutError()
                        await asyncio.sleep(0.1)
                await self.hooks.run_after_model(response, session)

                _round_usage = usage_metadata_from_llm_response(response)
                self.token_budget.record(_round_usage)
                if _round_usage:
                    usage_snapshot = dict(_round_usage)

                    async def _persist_usage_row() -> None:
                        try:
                            from agenticx.runtime.usage_store import get_usage_store

                            sid_eff = (usage_session_id or "").strip() or str(
                                getattr(session, "_usage_owner_session_id", "") or ""
                            ).strip()
                            aid_eff = (usage_avatar_id or "").strip()
                            await get_usage_store().record_async(
                                session_id=sid_eff,
                                avatar_id=aid_eff,
                                provider=provider_name,
                                model=model_name,
                                input_tokens=int(usage_snapshot.get("input_tokens", 0) or 0),
                                output_tokens=int(usage_snapshot.get("output_tokens", 0) or 0),
                                cached_tokens=int(usage_snapshot.get("cached_tokens", 0) or 0),
                                reasoning_tokens=int(usage_snapshot.get("reasoning_tokens", 0) or 0),
                                total_tokens=int(usage_snapshot.get("total_tokens", 0) or 0),
                            )
                        except Exception as exc:
                            logger.debug("usage persist skipped: %s", exc)

                    asyncio.create_task(_persist_usage_row())
                budget_level, budget_source, budget_current, budget_max = self.token_budget.check_with_source()
                if budget_level == BudgetLevel.EXCEEDED:
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": (
                                "Token budget exceeded "
                                f"({budget_current}/{budget_max}, source={budget_source}). "
                                "Stopping to preserve results."
                            ),
                            "detector": "token_budget",
                            "budget_exceeded": True,
                            "budget_source": budget_source,
                            "current": budget_current,
                            "max_allowed": budget_max,
                            "unattended_useless": True,
                        },
                        agent_id=agent_id,
                    )
                    return
                if budget_level == BudgetLevel.COMPRESS:
                    did_react = False
                    react_summary = ""
                    react_count = 0
                    # Session-level token budget counts cumulative LLM usage; compacting
                    # chat history cannot reduce it. Only attempt forced compaction for
                    # per-turn budget pressure, and never twice in one turn (proactive
                    # compaction already ran at turn start).
                    should_force_reactive_compact = (
                        not self._forced_budget_compact_this_turn
                        and not self._proactive_compact_this_turn
                        and budget_source == "turn"
                    )
                    if should_force_reactive_compact:
                        self._forced_budget_compact_this_turn = True
                        hist_compact = _sanitize_context_messages(session.agent_messages)
                        react_hist, did_react, react_summary, react_count, _pending_q_react = await self.compactor.maybe_compact(
                            hist_compact,
                            force=True,
                            model=model_name,
                        )
                        if did_react:
                            react_hist = _sanitize_context_messages(react_hist)
                            if len(react_hist) <= 1:
                                did_react = False
                            else:
                                session.agent_messages = react_hist
                                messages[:] = [{"role": "system", "content": current_system_prompt}, *list(react_hist)]
                                # Re-promote after forced history replacement so vision images from
                                # attachments survive this compaction/reset path when applicable.
                                try:
                                    p = str(getattr(session, "provider_name", "") or "")
                                    m = str(getattr(session, "model_name", "") or "")
                                    messages = _promote_user_image_attachments(messages, p, m)
                                except Exception:
                                    pass
                                try:
                                    await self.hooks.run_on_compaction(react_count, react_summary, session)
                                except Exception:
                                    pass
                    budget_level, budget_source, budget_current, budget_max = self.token_budget.check_with_source()
                    if (
                        budget_level == BudgetLevel.COMPRESS
                        and not self._budget_compress_notice_sent_this_turn
                    ):
                        self._budget_compress_notice_sent_this_turn = True
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "<budget_compress>Please compress context aggressively and focus on "
                                    "final deliverable only. Avoid exploratory loops.</budget_compress>"
                                ),
                            },
                        )
                        # FR-4: one concise notice — skip separate reactive compaction event when
                        # budget is still over limit (Desktop would otherwise show two long lines).
                        if budget_source == "session":
                            compress_notice = (
                                f"本会话 Token 预算已接近上限（{budget_current}/{budget_max}），"
                                "建议收口交付或新建会话续接。"
                            )
                        elif did_react:
                            compress_notice = (
                                f"本回合上下文接近上限，已压缩 {react_count} 条历史但仍偏紧，"
                                "建议收口或新建会话。"
                            )
                        else:
                            compress_notice = "上下文接近上限，建议收口或新建会话。"
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={
                                "text": compress_notice,
                                "severity": "warning",
                                "detector": "token_budget_compress",
                                "current": budget_current,
                                "max": budget_max,
                                "budget_source": budget_source,
                            },
                            agent_id=agent_id,
                        )
                    elif did_react:
                        yield RuntimeEvent(
                            type=EventType.COMPACTION.value,
                            data={
                                "compacted_count": react_count,
                                "summary": react_summary,
                                "reactive": True,
                            },
                            agent_id=agent_id,
                        )
                    # FR-5: surface compactor circuit-breaker tripping so the user
                    # knows long-session stability may degrade.
                    cf_state = getattr(self, "_compactor_failure_warned", False)
                    cf_count = int(getattr(self.compactor, "_consecutive_failures", 0) or 0)
                    if cf_count >= 3 and not cf_state:
                        self._compactor_failure_warned = True
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={
                                "text": (
                                    "自动上下文压缩已暂停（连续 3 次失败）。长会话稳定性可能下降，"
                                    "建议新建会话或检查模型连通性。"
                                ),
                                "severity": "warning",
                                "detector": "compactor_circuit_breaker",
                            },
                            agent_id=agent_id,
                        )
                    elif cf_count == 0 and cf_state:
                        # Reset latch when compactor recovers.
                        self._compactor_failure_warned = False
                if budget_level == BudgetLevel.WARNING:
                    messages.append({"role": "user", "content": self.token_budget.convergence_hint()})
            except asyncio.TimeoutError:
                round_timeout = _resolve_llm_round_timeout_seconds(session)
                retries = _llm_timeout_retry_count(session)
                provider_hint = provider_name or "(unknown)"
                model_hint = model_name or "(unknown)"
                streak = record_provider_timeout(session)
                applied, fallback_msg = maybe_apply_provider_fallback(session)
                if applied and fallback_msg:
                    provider_name = str(getattr(session, "provider_name", "") or provider_name)
                    model_name = str(getattr(session, "model_name", "") or model_name)
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={
                            "tool_name": "system",
                            "content": fallback_msg,
                            "tool_call_id": f"llm-fallback-{round_idx}",
                        },
                        agent_id=agent_id,
                    )
                if retries < LLM_ROUND_TIMEOUT_RETRY_LIMIT:
                    attempt = _bump_llm_timeout_retry_count(session)
                    notice = (
                        f"模型 {int(round_timeout)}s 内无响应（provider={provider_hint}, "
                        f"model={model_hint}），正在重试（{attempt}/{LLM_ROUND_TIMEOUT_RETRY_LIMIT + 1}）。"
                    )
                    if applied and fallback_msg:
                        notice = f"{fallback_msg} {notice}"
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={
                            "tool_name": "system",
                            "content": notice,
                            "tool_call_id": f"llm-timeout-retry-{round_idx}-{attempt}",
                        },
                        agent_id=agent_id,
                    )
                    messages.append({"role": "user", "content": f"[系统通知] {notice}"})
                    continue
                yield RuntimeEvent(
                    type=EventType.STALL.value,
                    data={
                        "text": (
                            f"模型响应超时（>{int(round_timeout)}s），任务已暂停。"
                            "可点击「继续」或切换更快模型后重试。"
                        ),
                        "detector": "llm_round_timeout",
                        "silent_seconds": int(round_timeout),
                        "provider": provider_hint,
                        "model": model_hint,
                        "timeout_streak": streak,
                    },
                    agent_id=agent_id,
                )
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={
                        "text": (
                            f"{human_hint_for_fault('transient')} "
                            f"(>{int(round_timeout)}s, provider={provider_hint}, model={model_hint})"
                        ),
                        "detector": "llm_round_timeout",
                        "severity": "error",
                    },
                    agent_id=agent_id,
                )
                return
            except Exception as exc:
                fault = classify_provider_fault(exc)
                record_session_provider_hard_failure(
                    session,
                    provider_name,
                    fault=fault,
                )
                if fault == "rate_limit" and agent_id != "meta":
                    pause_text = (
                        f"模型供应商触发限流（provider={provider_name or '(unknown)'}, "
                        f"model={model_name or '(unknown)'}）。任务已暂停，可等待限流窗口恢复后继续。"
                    )
                    yield RuntimeEvent(
                        type=EventType.SUBAGENT_PAUSED.value,
                        data={
                            "agent_id": agent_id,
                            "round": round_idx,
                            "max_rounds": self.max_tool_rounds,
                            "text": pause_text,
                            "detector": "rate_limit",
                            "retryable": True,
                        },
                        agent_id=agent_id,
                    )
                    return
                if (
                    fault == "context_window"
                    and not self._forced_budget_compact_this_turn
                    and agent_id == "meta"
                ):
                    from agenticx.runtime.context_budget import (
                        force_compact_meta_turn_context,
                        model_prefers_compact_meta_context,
                    )

                    if model_prefers_compact_meta_context(model_name, provider_name):
                        self._forced_budget_compact_this_turn = True
                        compact_prompt, compact_tools, compact_notice = force_compact_meta_turn_context(
                            session,
                            tools=active_tools,
                        )
                        current_system_prompt = compact_prompt
                        active_tools = compact_tools
                        allowed_tool_names = {
                            str(tool.get("function", {}).get("name", "")).strip()
                            for tool in active_tools
                            if isinstance(tool, dict)
                        }
                        if messages and str(messages[0].get("role", "")).lower() == "system":
                            messages[0] = {"role": "system", "content": current_system_prompt}
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={
                                "text": compact_notice,
                                "severity": "warning",
                                "detector": "context_budget_compact",
                            },
                            agent_id=agent_id,
                        )
                        continue

                err_text = (
                    human_hint_for_fault(fault)
                    if fault in {"billing", "auth", "rate_limit", "context_window", "transient"}
                    else f"模型调用失败: {exc}"
                )
                # Recover once from broken tool-call pairing after compaction/split.
                if (
                    fault in {"context_window", "transient"}
                    and not getattr(session, "_context_chain_repair_attempted", False)
                ):
                    repaired_messages = _sanitize_context_messages(messages)
                    repaired_agent = _sanitize_context_messages(session.agent_messages)
                    if repaired_messages != messages or repaired_agent != session.agent_messages:
                        setattr(session, "_context_chain_repair_attempted", True)
                        messages[:] = repaired_messages
                        session.agent_messages = repaired_agent
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={
                                "text": "上下文链已修复，正在重试本轮模型调用…",
                                "severity": "warning",
                                "detector": "context_chain_repair",
                            },
                            agent_id=agent_id,
                        )
                        continue
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={
                        "text": err_text,
                        "detector": fault,
                        "retryable": fault in {"rate_limit", "transient"},
                        "severity": "warning" if fault in {"rate_limit", "context_window"} else "error",
                    },
                    agent_id=agent_id,
                )
                return
            _reset_llm_timeout_retry_count(session)
            reset_provider_timeout_streak(session)
            # Preserve reasoning from the streamed accumulation before
            # response.content overwrites it. Non-streaming response.content
            # carries reasoning in a separate field (reasoning_content), so
            # _split_reasoning_and_body on the overwritten text yields empty
            # and the reasoning chain never reaches messages.json / the final
            # SSE event, causing the "思考过程" block to vanish after the
            # user switches away from and back into the session.
            _streamed_reasoning, _ = _split_reasoning_and_body(response_text)
            response_text = _sanitize_structured_assistant_text(
                (response.content or "").strip(),
                allowed_tool_names,
            )
            # Fallback: recover reasoning from the non-streaming response
            # object when the streaming path did not run (provider without
            # stream_with_tools, or pure ainvoke).
            _rc_any = getattr(response, "reasoning_content", None) or getattr(
                response, "reasoning", None
            )
            _nonstream_reasoning = ""
            if isinstance(_rc_any, str) and _rc_any.strip():
                _nonstream_reasoning = _rc_any.strip()
            _turn_reasoning = _streamed_reasoning or _nonstream_reasoning
            raw_tc = response.tool_calls or []
            tool_calls = [
                tc for tc in raw_tc
                if isinstance(tc, dict)
                and (tc.get("function", {}) if isinstance(tc.get("function"), dict) else {}).get("name")
                and str((tc.get("function", {}) if isinstance(tc.get("function"), dict) else {}).get("name", "")).strip().lower() != "none"
            ]
            # FR-C: 如果本轮所有 tool_calls 都因流式截断被丢弃，禁止把空 tool_calls
            # 当作"模型最终回答"处理，强制进入下一轮 LLM 调用让模型重新生成完整工具调用。
            if force_retry_next_round and not tool_calls:
                logger.info(
                    "force_retry_next_round=true session=%s round=%s reason=streamed_tool_call_truncated",
                    getattr(session, "session_id", ""),
                    round_idx,
                )
                continue
            if not tool_calls:
                inline_tool = _extract_inline_tool_call(response_text, allowed_tool_names)
                if inline_tool is not None:
                    tool_calls = [
                        {
                            "id": f"inline-{uuid.uuid4().hex[:8]}",
                            "type": "function",
                            "function": {
                                "name": inline_tool["name"],
                                "arguments": json.dumps(inline_tool["arguments"], ensure_ascii=False),
                            },
                        }
                    ]
            ac_clean, _ac_suggestions = (
                split_final_answer_and_followups(response_text)
                if _followups_enabled
                else (response_text, [])
            )
            # --- Widget flow guard: detect text-based diagrams and force retry ---
            if not tool_calls and "show_widget" in allowed_tool_names:
                from agenticx.runtime.widget_flow_guard import (
                    WIDGET_FLOW_MAX_RETRIES_PER_SESSION,
                    WIDGET_FLOW_RETRY_HINT,
                    contains_text_flow_diagram,
                )

                _widget_flow_retry_count = getattr(
                    session, "_widget_flow_retry_count", 0
                )
                if (
                    contains_text_flow_diagram(response_text)
                    and _widget_flow_retry_count < WIDGET_FLOW_MAX_RETRIES_PER_SESSION
                ):
                    setattr(
                        session,
                        "_widget_flow_retry_count",
                        _widget_flow_retry_count + 1,
                    )
                    logger.info(
                        "widget_flow_guard: detected text flow diagram, forcing retry (count=%s)",
                        _widget_flow_retry_count + 1,
                    )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "detector": "widget_flow_guard",
                            "action": "discard_stream",
                            "severity": "internal",
                        },
                        agent_id=agent_id,
                    )
                    messages.append({"role": "assistant", "content": ac_clean})
                    messages.append({"role": "system", "content": WIDGET_FLOW_RETRY_HINT})
                    session.agent_messages.append({"role": "assistant", "content": ac_clean})
                    session.agent_messages.append({"role": "system", "content": WIDGET_FLOW_RETRY_HINT})
                    continue
            # --- End widget flow guard ---
            # --- Data source flow guard: uncited quantitative claims ---
            if (
                not tool_calls
                and "query_data_source" in allowed_tool_names
                and agent_id == "meta"
            ):
                from agenticx.runtime.data_source_flow_guard import detect_uncited_quant_claim

                ds_nudge = detect_uncited_quant_claim(ac_clean, executed_tool_names)
                if ds_nudge and not getattr(session, "_data_source_flow_retried", False):
                    setattr(session, "_data_source_flow_retried", True)
                    logger.info(
                        "data_source_flow_guard: uncited quant claim, forcing retry"
                    )
                    messages.append({"role": "assistant", "content": ac_clean})
                    messages.append({"role": "system", "content": ds_nudge})
                    session.agent_messages.append({"role": "assistant", "content": ac_clean})
                    session.agent_messages.append({"role": "system", "content": ds_nudge})
                    continue
            # --- End data source flow guard ---
            assistant_message: Dict[str, Any] = {"role": "assistant", "content": ac_clean}
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            session.agent_messages.append(assistant_message)
            synced_session_message_count = len(session.agent_messages)

            if not tool_calls:
                # Reasoning-only empty turn detection: model emitted < Mattis> reasoning
                # but no visible body and no tool_call. Nudge once to force a real reply
                # or explicit tool_call, instead of misjudging the turn as complete and
                # surfacing a "继续" button (cases cc9152ab / e3033b24).
                _, _visible_text = _split_reasoning_and_body(response_text)
                if (
                    not _visible_text.strip()
                    and not _is_system_trigger
                    and reason_only_retry < 1
                ):
                    reason_only_retry += 1
                    logger.info(
                        "reason_only_retry session=%s round=%s reason=reasoning_only_empty_turn",
                        getattr(session, "session_id", ""),
                        round_idx,
                    )
                    messages.append({"role": "assistant", "content": _visible_text})
                    messages.append({"role": "system", "content": _REASONING_ONLY_NUDGE_HINT})
                    session.agent_messages.append({"role": "assistant", "content": _visible_text})
                    session.agent_messages.append({"role": "system", "content": _REASONING_ONLY_NUDGE_HINT})
                    continue
                if response_text.strip():
                    # Tokens were already streamed to the client during the
                    # invoke/stream phase above; do NOT re-send them here.
                    final_text, sug_list = (
                        split_final_answer_and_followups(response_text)
                        if _followups_enabled
                        else (response_text.strip(), [])
                    )
                else:
                    streamed_text = ""
                    sug_list = []
                    try:
                        stream_loop = asyncio.get_running_loop()

                        def _run_sync_stream_fallback(
                            stop_event: threading.Event,
                            queue_put: Callable[[Any], None],
                        ) -> None:
                            try:
                                for chunk in self.llm.stream(
                                    messages,
                                    temperature=0.2,
                                    max_tokens=8192,
                                    timeout=request_timeout_seconds,
                                    **llm_call_kwargs,
                                ):
                                    if stop_event.is_set():
                                        break
                                    # Stream-fallback path: providers (litellm/kimi) yield
                                    # dict chunks with a "text" key (not "content"), so read
                                    # "text" first and fall back to "content" for str-only
                                    # providers. Without this, streamed_text stays empty and
                                    # the补救 logic fires even when the model did stream tokens.
                                    if isinstance(chunk, str):
                                        tok = chunk
                                    else:
                                        tok = str(chunk.get("text", "") or chunk.get("content", ""))
                                    if tok:
                                        queue_put(tok)
                            finally:
                                queue_put(None)

                        async for tok in _iter_sync_stream_with_watchdog(
                            loop=stream_loop,
                            run_sync_stream=_run_sync_stream_fallback,
                            check_should_stop=_check_should_stop,
                            invoke_timeout_seconds=invoke_timeout_seconds,
                            heartbeat_timeout_seconds=heartbeat_timeout_seconds,
                            hard_timeout_seconds=hard_timeout_seconds,
                            queue_poll_seconds=0.05,
                        ):
                            streamed_text += str(tok)
                            _vis2 = followup_emitter.feed_append(str(tok))
                            if _vis2:
                                yield RuntimeEvent(
                                    type=EventType.TOKEN.value,
                                    data={"text": _vis2},
                                    agent_id=agent_id,
                                )
                    except _StreamWatchdogUserStop:
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={"text": STOP_MESSAGE},
                            agent_id=agent_id,
                        )
                        return
                    except asyncio.TimeoutError:
                        timeout_hint = human_hint_for_fault("transient")
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={
                                "text": (
                                    f"{timeout_hint} "
                                    f"(provider={provider_name or '(unknown)'}, "
                                    f"model={model_name or '(unknown)'})"
                                ),
                                "detector": "llm_stream_timeout",
                                "severity": "error",
                            },
                            agent_id=agent_id,
                        )
                        return
                    except Exception:
                        streamed_text = response_text
                    raw_tail = streamed_text.strip() if streamed_text.strip() else response_text
                    raw_tail = _sanitize_structured_assistant_text(str(raw_tail), allowed_tool_names)
                    final_text, sug_list = (
                        split_final_answer_and_followups(raw_tail)
                        if _followups_enabled
                        else (str(raw_tail).strip(), [])
                    )
                if not _visible_text.strip() and executed_tool_names:
                    unique_tools = ", ".join(dict.fromkeys(executed_tool_names))
                    final_text = (
                        "已完成工具调用（"
                        f"{unique_tools}）。\n"
                        "当前模型未返回进一步正文，请继续给我下一步指令。"
                    )
                    sug_list = []
                # Invoke/stream may leave response.content empty while the stream-fallback
                # path fills final_text; chat_history used to update but agent_messages kept "".
                # Split reasoning out of final_text once, so < Mattis> never leaks into
                # agent_messages content (would be re-fed to the LLM next round) or
                # messages.json (FR-4: content stays clean, reasoning lives in its field).
                _reasoning_text, _clean_body = _split_reasoning_and_body(final_text)
                if not _reasoning_text and _turn_reasoning:
                    _reasoning_text = _turn_reasoning
                if session.agent_messages and isinstance(session.agent_messages[-1], dict):
                    _last_am = session.agent_messages[-1]
                    if (
                        str(_last_am.get("role", "")).lower() == "assistant"
                        and not _last_am.get("tool_calls")
                        and str(_clean_body or "").strip()
                    ):
                        _last_am["content"] = _clean_body
                if not _is_system_trigger:
                    _hist_assistant: Dict[str, Any] = {"role": "assistant", "content": _clean_body}
                    if sug_list:
                        _hist_assistant["suggested_questions"] = list(sug_list)
                    if _reasoning_text:
                        _hist_assistant["reasoning"] = _reasoning_text[:16384]
                        if (
                            _stream_reasoning_start_ts is not None
                            and _stream_body_start_ts is not None
                        ):
                            _rs = int(_stream_body_start_ts - _stream_reasoning_start_ts)
                            if _rs >= 1:
                                _hist_assistant["reasoning_seconds"] = _rs
                    try:
                        from agenticx.studio.references import turn_reference_payload

                        _ref_payload = turn_reference_payload(session)
                        if _ref_payload.get("references"):
                            _hist_assistant["references"] = list(_ref_payload["references"])
                        if _ref_payload.get("searched_queries"):
                            _hist_assistant["searched_queries"] = list(_ref_payload["searched_queries"])
                    except Exception:
                        pass
                    _chat_history_append_deduped(session.chat_history, _hist_assistant)
                await self.hooks.run_on_agent_end(final_text, session)
                _um = usage_metadata_from_llm_response(response)
                _final_reasoning, _final_clean_body = (
                    (_reasoning_text, _clean_body)
                    if not _is_system_trigger
                    else _split_reasoning_and_body(final_text)
                )
                _final_data: dict[str, Any] = {"text": _final_clean_body}
                if sug_list:
                    _final_data["suggested_questions"] = list(sug_list)
                if _final_reasoning:
                    _final_data["reasoning"] = _final_reasoning[:16384]
                    if (
                        _stream_reasoning_start_ts is not None
                        and _stream_body_start_ts is not None
                    ):
                        _rs = int(_stream_body_start_ts - _stream_reasoning_start_ts)
                        if _rs >= 1:
                            _final_data["reasoning_seconds"] = _rs
                try:
                    from agenticx.studio.references import turn_reference_payload

                    _ref_payload = turn_reference_payload(session)
                    if _ref_payload.get("references"):
                        _final_data["references"] = list(_ref_payload["references"])
                    if _ref_payload.get("searched_queries"):
                        _final_data["searched_queries"] = list(_ref_payload["searched_queries"])
                except Exception:
                    pass
                if _um:
                    _final_data["usage_metadata"] = {
                        **_um,
                        "model": model_name,
                        "provider": provider_name,
                        "cache_mode": latest_cache_telemetry.get("cache_mode", "disabled"),
                        "cache_breakpoints": int(latest_cache_telemetry.get("cache_breakpoints", 0) or 0),
                        "cache_eligible_chars": int(latest_cache_telemetry.get("cache_eligible_chars", 0) or 0),
                        "cache_hit_chars": int(latest_cache_telemetry.get("cache_hit_chars", 0) or 0),
                        "cache_hit_rate": float(latest_cache_telemetry.get("cache_hit_rate", 0.0) or 0.0),
                        "cache_saved_tokens_est": int(latest_cache_telemetry.get("cache_saved_tokens_est", 0) or 0),
                    }
                yield RuntimeEvent(type=EventType.FINAL.value, data=_final_data, agent_id=agent_id)
                return

            assistant_tool_message = {
                "role": "assistant",
                "content": ac_clean,
                "tool_calls": tool_calls,
            }
            messages.append(assistant_tool_message)
            if not _is_system_trigger and str(ac_clean or "").strip():
                _chat_history_append_deduped(session.chat_history, {"role": "assistant", "content": ac_clean})

            _parallel_mode = _parallel_tools_enabled() and len(tool_calls) > 1
            if _parallel_mode:
                logger.debug(
                    "tool parallel partition batch sizes: %s",
                    [len(b) for b in partition_tool_calls(tool_calls)],
                )

            for call in tool_calls:
                if await _check_should_stop():
                    yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                    return
                function_obj = call.get("function", {}) if isinstance(call, dict) else {}
                raw_tool_name = function_obj.get("name", "")
                tool_name = str(raw_tool_name).strip() if isinstance(raw_tool_name, str) else ""
                if tool_name.lower() == "none":
                    tool_name = ""
                tool_call_id = str(call.get("id", "")) if isinstance(call, dict) else ""
                arguments = _parse_tool_arguments(function_obj.get("arguments"))
                dispatch_arguments = dict(arguments)
                dispatch_arguments["__tool_call_id"] = tool_call_id
                dispatch_arguments["__agent_id"] = agent_id
                if not tool_name:
                    invalid_message = "模型返回了无效工具调用（缺少 tool name），已忽略本次调用。"
                    tool_name = "unknown_tool"
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": invalid_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": invalid_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    if not _is_system_trigger:
                        session.chat_history.append(
                        {
                            "role": "tool",
                            "content": invalid_message,
                            "tool_call_id": tool_call_id,
                            "tool_name": tool_name,
                            "tool_args": arguments,
                            "tool_status": "error",
                        }
                        )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": invalid_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={"name": tool_name, "result": invalid_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                # Policy deny + allowlist before hooks / confirm (align CC deny > hook ask).
                perm_deny = tool_denied_by_session_permissions(tool_name)
                if perm_deny:
                    denied_message = perm_deny
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    if not _is_system_trigger:
                        session.chat_history.append(
                        {
                            "role": "tool",
                            "content": denied_message,
                            "tool_call_id": tool_call_id,
                            "tool_name": tool_name,
                            "tool_args": arguments,
                            "tool_status": "error",
                        }
                        )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={"name": tool_name, "result": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                if tool_name not in allowed_tool_names:
                    denied_message = f"工具 '{tool_name}' 不在当前允许列表中，已拒绝执行。"
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    if not _is_system_trigger:
                        session.chat_history.append(
                            {
                                "role": "tool",
                                "content": denied_message,
                                "tool_call_id": tool_call_id,
                                "tool_name": tool_name,
                                "tool_args": arguments,
                                "tool_status": "error",
                            }
                        )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={"name": tool_name, "result": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                hook_outcome = await self.hooks.run_before_tool_call(tool_name, arguments, session)
                if hook_outcome.blocked:
                    blocked_message = hook_outcome.reason or f"工具 {tool_name} 被策略阻止。"
                    # Emit TOOL_CALL first so the desktop client has a pending card to merge
                    # the blocked result into (mirrors the normal dispatch path below), rather
                    # than falling back to a bare, metadata-less tool bubble.
                    yield RuntimeEvent(
                        type=EventType.TOOL_CALL.value,
                        data={"name": tool_name, "arguments": arguments, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": blocked_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": blocked_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    if not _is_system_trigger:
                        session.chat_history.append(
                            {
                                "role": "tool",
                                "content": blocked_message,
                                "tool_call_id": tool_call_id,
                                "tool_name": tool_name,
                                "tool_args": arguments,
                                "tool_status": "error",
                            }
                        )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": blocked_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={"name": tool_name, "result": blocked_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                if tool_name == "query_subagent_status":
                    status_query_attempts_total += 1
                    if agent_id == "meta" and status_query_attempts_total > max_status_queries_per_turn:
                        budget_msg = (
                            f"【已阻止】本轮状态查询已超过预算上限（{max_status_queries_per_turn} 次），为避免无效轮询已停止继续查询。\n"
                            "请基于已有状态结果直接回复用户，或等待后台完成事件。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": budget_msg,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": budget_msg,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": budget_msg, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "本轮状态查询达到预算上限（2 次），已停止轮询。"
                                "我会在子智能体完成/失败后主动汇报。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue
                    now_ts = time.time()
                    if (
                        agent_id == "meta"
                        and last_status_query_at > 0
                        and (now_ts - last_status_query_at) < min_status_query_interval_sec
                    ):
                        wait_left = max(1, int(min_status_query_interval_sec - (now_ts - last_status_query_at)))
                        cooldown_msg = (
                            "【已阻止】query_subagent_status 冷却中，避免无效轮询。\n"
                            f"请至少等待 {wait_left}s 再次查询，或直接基于当前信息回答用户。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": cooldown_msg,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": cooldown_msg,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": cooldown_msg, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "状态查询处于冷却窗口，我先停止本轮轮询。"
                                "若子智能体仍在运行，我会在完成事件到达后主动汇报。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue
                    # Allow exactly one status query per turn for meta agent;
                    # block only from the second attempt in the same turn.
                    if agent_id == "meta" and status_query_attempts_total > 1:
                        throttled_once = (
                            "【已阻止】本轮已调用过一次 query_subagent_status，禁止同一轮重复轮询。\n"
                            "请基于该次结果直接回答用户，或结束本轮等待后台完成事件。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled_once,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled_once,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": throttled_once, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "本轮状态已查询过一次，已停止重复轮询。"
                                "若子智能体仍运行，我会在完成事件到达后主动汇报。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue
                    status_query_total += 1
                    last_status_query_at = now_ts
                    try:
                        signature = json.dumps(arguments, ensure_ascii=False, sort_keys=True)
                    except Exception:
                        signature = str(arguments)
                    if signature == last_status_query_signature:
                        repeated_status_query_count += 1
                    else:
                        last_status_query_signature = signature
                        repeated_status_query_count = 1
                    if (
                        status_query_attempts_total > 20
                        or (
                            status_query_total > 12
                            and repeated_status_query_count > 6
                            and last_status_query_had_rows
                        )
                    ):
                        throttled = (
                            "【已阻止】query_subagent_status 调用过于频繁，本次调用被拦截。\n"
                            "⚠️ 你必须立即停止查询并执行以下操作之一：\n"
                            "1) 如果子智能体仍在运行 → 直接告知用户任务正在后台执行，结束本轮对话，等待完成事件。\n"
                            "2) 如果子智能体已完成 → 根据已知信息汇报结果，不再查询。\n"
                            "3) 如果不确定 → 告知用户「任务已提交，完成后会自动通知」，结束本轮。\n"
                            "禁止再次调用 query_subagent_status，否则将继续被拦截并消耗轮次配额。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": throttled, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "检测到状态轮询过于频繁，已停止本轮自动执行。"
                                "我会等待后台完成事件并主动给你汇报结果。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue

                yield RuntimeEvent(
                    type=EventType.TOOL_CALL.value,
                    data={"name": tool_name, "arguments": arguments, "tool_call_id": tool_call_id},
                    agent_id=agent_id,
                )
                pending_events: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()

                async def _on_tool_event(event_payload: Dict[str, Any]) -> None:
                    pending_events.put_nowait(event_payload)

                before_progress = _build_progress_signature(session)
                before_disk_write_count = len(disk_write_paths)
                effective_tm = self.team_manager or getattr(session, "_team_manager", None)
                meta_only_names, meta_dispatch = _resolve_meta_tool_dispatchers()
                if tool_name in meta_only_names:
                    if effective_tm is None:
                        dispatch_task = asyncio.create_task(
                            asyncio.sleep(0, result=f"ERROR: meta tool '{tool_name}' requires team manager")
                        )
                    else:
                        dispatch_task = asyncio.create_task(
                            meta_dispatch(
                                tool_name,
                                dispatch_arguments,
                                team_manager=effective_tm,
                                session=session,
                            )
                        )
                else:
                    dispatch_task = asyncio.create_task(
                        dispatch_tool_async(
                            tool_name,
                            dispatch_arguments,
                            session,
                            confirm_gate=self.confirm_gate,
                            event_callback=_on_tool_event,
                            team_manager=effective_tm,
                            clarify_gate=self.clarify_gate,
                            is_unattended=self.is_unattended,
                        )
                    )

                # Long-running tools (e.g. mcp_call → browser_navigate) block here with no LLM chunks;
                # emit periodic TOOL_PROGRESS so Desktop SSE stays alive and users see liveness.
                _tool_wait_loop = asyncio.get_running_loop()
                _tool_exec_wait_started = _tool_wait_loop.time()
                _next_tool_progress_at = _tool_exec_wait_started + 0.8

                while True:
                    if await _check_should_stop():
                        dispatch_task.cancel()
                        try:
                            await dispatch_task
                        except asyncio.CancelledError:
                            pass
                        yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                        return
                    if dispatch_task.done() and pending_events.empty():
                        break
                    try:
                        emitted = await asyncio.wait_for(pending_events.get(), timeout=0.05)
                        evt_type = str(emitted.get("type", ""))
                        evt_data = dict(emitted.get("data", {}))
                        if evt_type == "tool_output":
                            evt_data.setdefault("name", tool_name)
                            evt_data.setdefault("tool_call_id", tool_call_id)
                            evt_type = EventType.TOOL_PROGRESS.value
                        yield RuntimeEvent(
                            type=evt_type,
                            data=evt_data,
                            agent_id=agent_id,
                        )
                    except asyncio.TimeoutError:
                        _now = _tool_wait_loop.time()
                        if not dispatch_task.done() and _now >= _next_tool_progress_at:
                            yield RuntimeEvent(
                                type=EventType.TOOL_PROGRESS.value,
                                data={
                                    "name": tool_name,
                                    "tool_call_id": tool_call_id,
                                    "elapsed_seconds": round(_now - _tool_exec_wait_started, 1),
                                },
                                agent_id=agent_id,
                            )
                            _next_tool_progress_at = _now + 2.0
                        continue

                try:
                    result = await dispatch_task
                except Exception as exc:
                    result = f"ERROR: tool execution failed: {exc}"
                if tool_name == "query_subagent_status":
                    has_rows = False
                    try:
                        parsed = json.loads(result)
                        if isinstance(parsed, dict):
                            rows = parsed.get("subagents")
                            if isinstance(rows, list) and len(rows) > 0:
                                has_rows = True
                            if isinstance(parsed.get("subagent"), dict):
                                has_rows = True
                    except Exception:
                        has_rows = False
                    last_status_query_had_rows = has_rows
                    if not has_rows:
                        status_query_total = max(0, status_query_total - 1)
                        repeated_status_query_count = 0
                result = await self.hooks.run_after_tool_call(tool_name, result, session)
                budget_cfg = load_tool_result_budget_config()
                raw_result = str(result)
                rclass = get_result_class(tool_name, raw_result)
                archive_path = None
                if rclass in {"large", "blob"} or approx_tokens(raw_result) >= budget_cfg.large_threshold_tokens:
                    archive_path = archive_tool_result(
                        session,
                        round_idx=round_idx,
                        tool_call_id=tool_call_id,
                        tool_name=tool_name,
                        content=raw_result,
                        cfg=budget_cfg,
                    )
                result = self.compactor.micro_compact_tool_result(tool_name, raw_result)
                record_tool_result_meta(
                    session,
                    round_idx=round_idx,
                    tool_call_id=tool_call_id,
                    tool_name=tool_name,
                    content=raw_result,
                    archive_path=archive_path,
                )
                # Learning counters for SessionReviewHook threshold checks
                session._total_tool_calls = getattr(session, "_total_tool_calls", 0) + 1
                if tool_name == "skill_manage":
                    session._turns_since_skill_manage = 0
                if tool_name == "todo_write":
                    rounds_without_todo = 0
                else:
                    rounds_without_todo += 1
                executed_tool_names.append(tool_name)
                after_progress = _build_progress_signature(session)
                written_paths_for_progress: List[str] = []
                if tool_name in {"file_write", "file_edit"} and isinstance(result, str):
                    written_paths_for_progress = _extract_written_paths_from_result(result)
                    for path in written_paths_for_progress:
                        write_path_counts[path] = write_path_counts.get(path, 0) + 1
                        disk_write_paths.add(path)
                if agent_id != "meta" and tool_name in {"file_write", "file_edit"} and isinstance(
                    result, str
                ):
                    for path in written_paths_for_progress:
                        if _confirmation_spam_score_for_path(path) >= 2:
                            confirmation_spam_count += 1
                    if confirmation_spam_count >= 3:
                        spam_msg = "Detected confirmation file spam. Terminating subagent."
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={"text": spam_msg, "detector": "confirmation_spam"},
                            agent_id=agent_id,
                        )
                        return
                file_write_progress = (
                    tool_name in {"file_write", "file_edit"}
                    and isinstance(result, str)
                    and (
                        "OK: wrote " in result
                        or "OK: edited " in result
                    )
                )
                if file_write_progress and written_paths_for_progress:
                    for p in written_paths_for_progress:
                        if write_path_counts.get(p, 0) > 2:
                            file_write_progress = False
                            break
                disk_write_progress = len(disk_write_paths) > before_disk_write_count
                PROGRESS_TOOLS = {
                    "todo_write", "scratchpad_write", "bash_exec",
                    "file_read", "list_files", "file_search", "grep_search",
                    # MCP / 外部信息发现类：返回新内容即视为进展
                    "mcp_call", "list_mcps", "mcp_connect",
                    "web_search", "web_fetch",
                    "browser_navigate", "browser_snapshot", "browser_click",
                }
                # schema 探索：同一工具连续失败但 error 内容不同，认知上仍在推进
                EXPLORATORY_TOOLS = {"mcp_call", "list_mcps", "mcp_connect"}
                result_head = result.lstrip()[:80] if isinstance(result, str) else ""
                is_error_result = isinstance(result, str) and (
                    result_head.startswith("ERROR:")
                    or result_head.startswith("❌")
                    or result_head.startswith("⚠️")
                )
                logical_progress = (
                    tool_name in PROGRESS_TOOLS
                    and isinstance(result, str)
                    and not is_error_result
                    and len(result.strip()) > 10
                )
                if tool_name in EXPLORATORY_TOOLS and isinstance(result, str) and result.strip():
                    if not is_error_result:
                        # Successful exploratory call resets the discovery budget
                        self._exploratory_error_streak = 0
                    else:
                        # Failed exploratory call: each unique error counts as
                        # progress only within a bounded schema-discovery budget
                        self._exploratory_error_streak += 1
                        fp = hashlib.sha1(
                            result[:512].encode("utf-8", errors="replace")
                        ).hexdigest()[:12]
                        new_fp = fp not in self._recent_exploratory_fps
                        self._recent_exploratory_fps.append(fp)
                        if (
                            new_fp
                            and self._exploratory_error_streak
                            <= self._exploratory_error_budget
                        ):
                            logical_progress = True
                result_fp: Optional[str] = None
                if isinstance(result, str) and not is_error_result:
                    result_fp = LoopDetector.fingerprint_from_result(result) or None
                self.loop_detector.record_call(
                    tool_name,
                    LoopDetector.args_signature(arguments),
                    has_progress=(
                        (before_progress != after_progress)
                        or file_write_progress
                        or disk_write_progress
                        or logical_progress
                    ),
                    result_fingerprint=result_fp,
                    result_text=result if isinstance(result, str) else None,
                )
                loop_issue = self.loop_detector.check()
                if loop_issue is not None and loop_issue.nudge:
                    self._pending_loop_nudge = loop_issue.nudge
                loop_halt = loop_issue is not None and loop_issue.level == "critical"
                if loop_issue is not None:
                    _original_task_snippet = (user_input or "").strip().replace("\n", " ")[:300]
                    reminder = (
                        f"[loop-{loop_issue.level}] {loop_issue.message} "
                        f"用户原始请求：{_original_task_snippet}\n"
                        "请严格围绕该原始请求继续推进，不要引入无关话题；"
                        "若确实无法继续，请直接向用户总结已尝试动作、失败原因与下一步建议。"
                    )
                    messages.append({"role": "user", "content": reminder})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": result,
                    }
                )
                session.agent_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": result,
                    }
                )
                synced_session_message_count = len(session.agent_messages)
                if not _is_system_trigger:
                    session.chat_history.append(
                        {
                            "role": "tool",
                            "content": result,
                            "tool_call_id": tool_call_id,
                            "tool_name": tool_name,
                            "tool_args": arguments,
                            "tool_status": "error" if str(result).startswith("ERROR:") else "done",
                        }
                    )
                    if _append_subagent_cluster_anchor_if_needed(
                        session,
                        tool_name=tool_name,
                        tool_call_id=tool_call_id,
                        raw_result=raw_result,
                    ):
                        self._tools_since_persist += 1

                self._tools_since_persist += 1
                self._maybe_mid_turn_persist()

                _tool_result_data: dict[str, Any] = {
                    "name": tool_name,
                    "result": result,
                    "tool_call_id": tool_call_id,
                }
                try:
                    from agenticx.studio.references import structured_payload_for_tool_result

                    # References must be parsed from the FULL, un-compacted result:
                    # `result` may already be micro-compacted (JSON truncated in the
                    # middle), which makes json.loads fail and drops all references —
                    # the assistant then has no references and the UI strips the
                    # [N] citation markers as "orphans" after streaming ends.
                    _structured = structured_payload_for_tool_result(
                        session, tool_name, arguments, raw_result
                    )
                    if _structured:
                        _tool_result_data["structured"] = _structured
                except Exception:
                    pass

                yield RuntimeEvent(
                    type=EventType.TOOL_RESULT.value,
                    data=_tool_result_data,
                    agent_id=agent_id,
                )

                if loop_halt and loop_issue is not None:
                    # Fill in filler tool results for any remaining unanswered
                    # tool_calls from the same assistant batch so downstream
                    # LLM sees well-formed messages.
                    try:
                        current_idx = tool_calls.index(call)
                    except ValueError:
                        current_idx = len(tool_calls) - 1
                    for remaining in tool_calls[current_idx + 1:]:
                        rem_fn = remaining.get("function") if isinstance(remaining, dict) else None
                        rem_name = str((rem_fn or {}).get("name") or "unknown_tool")
                        rem_id = str(remaining.get("id", "")) if isinstance(remaining, dict) else ""
                        filler = "（工具未执行：会话已因连续无进展而自动停止）"
                        messages.append(
                            {"role": "tool", "tool_call_id": rem_id, "name": rem_name, "content": filler}
                        )
                        session.agent_messages.append(
                            {"role": "tool", "tool_call_id": rem_id, "name": rem_name, "content": filler}
                        )
                    synced_session_message_count = len(session.agent_messages)

                    _original_task_snippet = (user_input or "").strip().replace("\n", " ")[:500]
                    halt_prompt = (
                        "[system-halt] 运行时检测到连续工具调用无进展，已自动停止重试。\n"
                        f"触发原因：{loop_issue.message}\n"
                        f"【用户原始请求】{_original_task_snippet}\n"
                        "⚠️ 严格要求：回答必须紧扣上面的【用户原始请求】，不得切换、发明或扩展到任何其它话题（例如不要自行转为配置教程、产品对比等与原始请求无关的主题）。\n"
                        "请用中文 3-5 句直接对用户说明：\n"
                        "1) 围绕【用户原始请求】你尝试过哪些工具/参数；\n"
                        "2) 失败或无进展的主要原因（参数不对 / 站点不可达 / 工具能力不足 / 需鉴权 等）；\n"
                        "3) 围绕同一个原始请求的下一步建议（换工具、补充信息、手动执行等）。\n"
                        "请直接给出正文，不要再调用任何工具，也不要讨论与原始请求无关的内容。"
                    )
                    messages.append({"role": "user", "content": halt_prompt})

                    summary_text = ""
                    try:
                        halt_loop = asyncio.get_running_loop()

                        def _run_halt_stream(
                            stop_event: threading.Event,
                            queue_put: Callable[[Any], None],
                        ) -> None:
                            try:
                                for chunk in self.llm.stream(
                                    messages,
                                    temperature=0.2,
                                    max_tokens=800,
                                    timeout=request_timeout_seconds,
                                ):
                                    if stop_event.is_set():
                                        break
                                    tok = chunk if isinstance(chunk, str) else str(chunk.get("content", ""))
                                    if tok:
                                        queue_put(tok)
                            finally:
                                queue_put(None)

                        async for tok in _iter_sync_stream_with_watchdog(
                            loop=halt_loop,
                            run_sync_stream=_run_halt_stream,
                            check_should_stop=_check_should_stop,
                            invoke_timeout_seconds=invoke_timeout_seconds,
                            heartbeat_timeout_seconds=heartbeat_timeout_seconds,
                            hard_timeout_seconds=hard_timeout_seconds,
                            queue_poll_seconds=0.05,
                        ):
                            summary_text += str(tok)
                            yield RuntimeEvent(
                                type=EventType.TOKEN.value,
                                data={"text": str(tok)},
                                agent_id=agent_id,
                            )
                    except (_StreamWatchdogUserStop, asyncio.TimeoutError) as exc:
                        logger.warning("loop-halt summary stream stopped: %s", exc)
                    except Exception as exc:
                        logger.warning("loop-halt summary stream failed: %s", exc)
                    summary_text = summary_text.strip() or (
                        f"我多次尝试后仍未取得进展（{loop_issue.message}）。"
                        "建议你换用其它工具，或先手动确认目标可行性后再继续。"
                    )
                    assistant_summary = {"role": "assistant", "content": summary_text}
                    session.agent_messages.append(assistant_summary)
                    synced_session_message_count = len(session.agent_messages)
                    if not _is_system_trigger:
                        session.chat_history.append(assistant_summary)
                    await self.hooks.run_on_agent_end(summary_text, session)
                    yield RuntimeEvent(
                        type=EventType.FINAL.value,
                        data={
                            "text": summary_text,
                            "loop_halt": True,
                            "detector": loop_issue.detector,
                        },
                        agent_id=agent_id,
                    )
                    return

            _inject_pending_visual_attachments(
                session,
                messages,
                is_system_trigger=_is_system_trigger,
            )

        message = (
            "已达到最大工具调用轮数，已暂停自动执行。"
            "请基于当前结果继续指示，或缩小任务范围。"
        )
        if agent_id == "meta":
            await self.hooks.run_on_agent_end(message, session)
            yield RuntimeEvent(
                type=EventType.ERROR.value,
                data={
                    "text": message,
                    "round": self.max_tool_rounds,
                    "max_rounds": self.max_tool_rounds,
                },
                agent_id=agent_id,
            )
            return
        await self.hooks.run_on_agent_end(message, session)
        yield RuntimeEvent(
            type=EventType.SUBAGENT_PAUSED.value,
            data={
                "agent_id": agent_id,
                "round": self.max_tool_rounds,
                "max_rounds": self.max_tool_rounds,
                "text": message,
                "executed_tools": list(dict.fromkeys(executed_tool_names))[-10:],
            },
            agent_id=agent_id,
        )
