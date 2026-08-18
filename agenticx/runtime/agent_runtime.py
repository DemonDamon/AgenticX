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
from typing import (
    TYPE_CHECKING,
    Any,
    AsyncGenerator,
    Awaitable,
    Callable,
    Dict,
    List,
    Literal,
    Mapping,
    Optional,
    Sequence,
)

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
from agenticx.runtime.context_file_budget import serialize_context_files
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
from agenticx.runtime.token_budget import (
    BudgetLevel,
    DEFAULT_WARNING_TOKENS_PER_SESSION,
    TOKEN_BUDGET_SCRATCHPAD_KEY,
    TokenBudgetGuard,
    session_token_budget_preflight,
)
from agenticx.runtime.truncated_final import (
    detect_suspected_truncated_final,
    reasoning_has_action_intent,
)
from agenticx.runtime.usage_metadata import usage_metadata_from_llm_response
from agenticx.runtime.assistant_output import (
    ParsedAssistantOutput,
    parse_assistant_output,
    sanitize_public_tool_summary,
)
from agenticx.runtime.followup_stream import (
    FollowupStreamEmitter,
    suggested_questions_enabled_from_config,
)
from agenticx.llms.provider_fault import (
    classify_provider_fault,
    human_hint_for_fault,
    is_model_param_compat_error,
    record_session_provider_hard_failure,
)
from agenticx.llms.provider_resolver import (
    config_default_llm_names,
    should_fallback_to_default_model,
)
from agenticx.llms.sampling_params import resolve_chat_temperature
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
SHOW_WIDGET_DELTA_MIN_INTERVAL_MS = 120
SHOW_WIDGET_DELTA_MIN_CHARS = 800


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
    """Append when tail role, content, or stable user-turn identity differs."""
    role = str(row.get("role", ""))
    content = row.get("content", "")
    if _chat_history_tail_matches(history, role, content):
        last = history[-1] if history else {}
        row_metadata = row.get("metadata")
        last_metadata = last.get("metadata")
        row_client_turn_id = (
            str(row_metadata.get("client_turn_id") or "").strip()
            if isinstance(row_metadata, dict)
            else ""
        )
        last_client_turn_id = (
            str(last_metadata.get("client_turn_id") or "").strip()
            if isinstance(last_metadata, dict)
            else ""
        )
        if not (
            role.lower() == "user"
            and row_client_turn_id
            and last_client_turn_id
            and row_client_turn_id != last_client_turn_id
        ):
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
DEFAULT_LLM_STALL_PATIENCE_MAX_ATTEMPTS = 3
DEFAULT_LLM_STALL_PATIENCE_BUDGET_SECONDS = 900.0
DEFAULT_LLM_STALL_PATIENCE_BASE_SECONDS = 15.0
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
    # Strip LiteLLM-style routing prefixes (e.g. openai/glm-5.2).
    model_name = str(getattr(session, "model_name", "") or "").strip().lower().split("/")[-1]
    if model_name:
        for model_prefix, timeout in sorted(
            MODEL_INVOKE_TIMEOUT_SECONDS.items(), key=lambda item: len(item[0]), reverse=True
        ):
            if model_name == model_prefix or model_name.startswith(model_prefix):
                return timeout
    provider_name = str(getattr(session, "provider_name", "") or "").strip().lower()
    if provider_name and provider_name in PROVIDER_INVOKE_TIMEOUT_SECONDS:
        return PROVIDER_INVOKE_TIMEOUT_SECONDS[provider_name]
    if model_name.startswith("glm-") and (
        provider_name == "zhipu" or provider_name.startswith("custom_openai_")
    ):
        # Company OpenAI-compatible GLM routes share native BigModel latency.
        return PROVIDER_INVOKE_TIMEOUT_SECONDS["zhipu"]
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
    model_name = str(getattr(session, "model_name", "") or "").strip().lower().split("/")[-1]
    if model_name.startswith("glm-") and (
        provider_name == "zhipu" or provider_name.startswith("custom_openai_")
    ):
        return PROVIDER_FIRST_FEEDBACK_SECONDS["zhipu"]
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
                and first_chunk_at <= 0
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


def _resolve_stall_patience_config(session: StudioSession) -> Dict[str, Any]:
    """Resolve patience-mode config: env first, runtime config, then defaults."""

    def _cfg(key: str) -> Any:
        try:
            from agenticx.cli.config_manager import ConfigManager

            return ConfigManager.get_value(f"runtime.llm_stall_patience_{key}")
        except Exception:
            return None

    def _bool(env_key: str, cfg_key: str, default: bool) -> bool:
        raw = os.getenv(env_key, "").strip().lower()
        if raw in {"0", "false", "no", "off"}:
            return False
        if raw in {"1", "true", "yes", "on"}:
            return True
        cfg_value = _cfg(cfg_key)
        return bool(cfg_value) if cfg_value is not None else default

    def _int(env_key: str, cfg_key: str, default: int) -> int:
        raw = os.getenv(env_key, "").strip()
        if raw:
            try:
                value = int(raw)
                if value > 0:
                    return value
            except ValueError:
                pass
        cfg_value = _cfg(cfg_key)
        if cfg_value is not None:
            try:
                value = int(cfg_value)
                if value > 0:
                    return value
            except (TypeError, ValueError):
                pass
        return default

    def _float(env_key: str, cfg_key: str, default: float) -> float:
        raw = os.getenv(env_key, "").strip()
        if raw:
            try:
                value = float(raw)
                if value > 0:
                    return value
            except ValueError:
                pass
        cfg_value = _cfg(cfg_key)
        if cfg_value is not None:
            try:
                value = float(cfg_value)
                if value > 0:
                    return value
            except (TypeError, ValueError):
                pass
        return default

    return {
        "enabled": _bool("AGX_LLM_STALL_PATIENCE_ENABLED", "enabled", True),
        "max_attempts": _int(
            "AGX_LLM_STALL_PATIENCE_MAX_ATTEMPTS",
            "max_attempts",
            DEFAULT_LLM_STALL_PATIENCE_MAX_ATTEMPTS,
        ),
        "budget_seconds": _float(
            "AGX_LLM_STALL_PATIENCE_BUDGET_SECONDS",
            "budget_seconds",
            DEFAULT_LLM_STALL_PATIENCE_BUDGET_SECONDS,
        ),
        "base_seconds": _float(
            "AGX_LLM_STALL_PATIENCE_BASE_SECONDS",
            "base_seconds",
            DEFAULT_LLM_STALL_PATIENCE_BASE_SECONDS,
        ),
    }


def _stall_patience_state(session: StudioSession) -> Dict[str, Any]:
    """Return per-session patience retry state."""
    state = getattr(session, "_stall_patience", None)
    if not isinstance(state, dict):
        state = {"attempts": 0, "started_at": 0.0}
        setattr(session, "_stall_patience", state)
    state.setdefault("attempts", 0)
    state.setdefault("started_at", 0.0)
    return state


def _reset_stall_patience(session: StudioSession) -> None:
    setattr(session, "_stall_patience", {"attempts": 0, "started_at": 0.0})


def _should_emit_show_widget_delta(
    emit_state: Dict[int, Dict[str, float]],
    idx: int,
    arguments_raw: str,
    *,
    force: bool = False,
    now_mono: Optional[float] = None,
) -> bool:
    """Decide whether a progressive ``show_widget`` delta should be emitted.

    Emits the very first frame immediately (even empty args) so UI can paint a
    loading scaffold, then throttles by argument growth / elapsed time.
    """
    state = emit_state.setdefault(idx, {"last_emit_mono": 0.0, "last_len": -1.0})
    last_len = int(state.get("last_len", -1.0))
    current_len = len(arguments_raw or "")
    if last_len < 0:
        state["last_emit_mono"] = float(now_mono if now_mono is not None else time.monotonic())
        state["last_len"] = float(current_len)
        return True
    if current_len <= last_len:
        return False
    if force:
        state["last_emit_mono"] = float(now_mono if now_mono is not None else time.monotonic())
        state["last_len"] = float(current_len)
        return True
    last_emit_mono = float(state.get("last_emit_mono", 0.0))
    now = float(now_mono if now_mono is not None else time.monotonic())
    growth = current_len - last_len
    elapsed_ms = (now - last_emit_mono) * 1000.0
    if growth < SHOW_WIDGET_DELTA_MIN_CHARS and elapsed_ms < SHOW_WIDGET_DELTA_MIN_INTERVAL_MS:
        return False
    state["last_emit_mono"] = now
    state["last_len"] = float(current_len)
    return True


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


def _chat_temperature_kwargs(
    model_name: str,
    provider_name: str,
    *,
    fallback_model: str = "",
) -> Dict[str, float]:
    """Build optional temperature kwarg for invoke/stream (omit when None)."""
    value = resolve_chat_temperature(
        model_name,
        provider=provider_name,
        fallback_model=fallback_model,
    )
    if value is None:
        return {}
    return {"temperature": float(value)}


def _resolve_round_max_tokens(
    base: int,
    recent_tools: Sequence[str],
    *,
    provider: str = "",
) -> int:
    """Resolve per-round max_tokens, raising budget after recent file writes."""
    try:
        resolved_base = int(base)
    except Exception:
        resolved_base = 8192
    if resolved_base <= 0:
        resolved_base = 8192
    write_heavy = any(
        str(name or "").strip() in {"file_write", "file_edit"}
        for name in list(recent_tools or ())[-8:]
    )
    resolved = (
        min(16384, max(resolved_base, 12288)) if write_heavy else resolved_base
    )
    if str(provider or "").strip().lower() == "minimax":
        return min(4096, int(resolved))
    return int(resolved)


def _kimi_k3_reasoning_effort_kwargs(session: Any, model_name: str) -> Dict[str, Any]:
    """Pass Moonshot Kimi K3 top-level ``reasoning_effort`` when set on the session.

    Values: ``low`` / ``high`` / ``max``. Other models ignore this attribute.
    """
    bare = str(model_name or "").strip().lower().split("/")[-1]
    if not (bare == "kimi-k3" or bare.startswith("kimi-k3-") or bare.startswith("kimi-k3.")):
        return {}
    raw = str(getattr(session, "_reasoning_effort", "") or "").strip().lower()
    if raw not in {"low", "high", "max"}:
        return {}
    return {"reasoning_effort": raw}


def _is_deepseek_v4_model(model_name: str) -> bool:
    bare = str(model_name or "").strip().lower().split("/")[-1]
    return bare.startswith("deepseek-v4")


def _deepseek_v4_thinking_kwargs(session: Any, model_name: str) -> Dict[str, Any]:
    """OpenAI-compat DeepSeek V4 thinking via extra_body only.

    LiteLLM's OpenAI adapter rejects top-level ``reasoning_effort`` for
    ``openai/deepseek-v4-*`` (UnsupportedParamsError). Official Chat Completions
    still accepts ``reasoning_effort`` in the JSON body, so nest it next to
    ``thinking`` in extra_body.
    """
    if not _is_deepseek_v4_model(model_name):
        return {}
    enabled = getattr(session, "_thinking_enabled", None)
    if enabled is False:
        return {"extra_body": {"thinking": {"type": "disabled"}}}
    raw = str(getattr(session, "_reasoning_effort", "") or "").strip().lower()
    effort = raw if raw in {"high", "max"} else "high"
    return {
        "extra_body": {
            "thinking": {"type": "enabled"},
            "reasoning_effort": effort,
        },
    }


def _ensure_deepseek_v4_tool_reasoning_content(
    messages: Sequence[Dict[str, Any]],
    session: Any,
    model_name: str,
) -> List[Dict[str, Any]]:
    """Echo reasoning_content on assistant+tool_calls rows for DeepSeek V4 thinking.

    Official Chat Completions rejects follow-up tool rounds when the field is
    missing. An empty string is accepted and is used when no thought was captured.
    """
    if not _is_deepseek_v4_model(model_name):
        return list(messages)
    if getattr(session, "_thinking_enabled", None) is False:
        return list(messages)
    out: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role", "")).strip() != "assistant" or not msg.get("tool_calls"):
            out.append(msg)
            continue
        if "reasoning_content" in msg:
            out.append(msg)
            continue
        patched = dict(msg)
        patched["reasoning_content"] = ""
        out.append(patched)
    return out


def _merge_llm_call_kwargs(base: Dict[str, Any], extra: Dict[str, Any]) -> None:
    """Update call kwargs; merge extra_body instead of replacing prompt-cache extra_body."""
    payload = dict(extra or {})
    extra_body = payload.pop("extra_body", None)
    base.update(payload)
    if isinstance(extra_body, dict):
        existing = base.get("extra_body")
        merged = dict(existing) if isinstance(existing, dict) else {}
        merged.update(extra_body)
        base["extra_body"] = merged


def _build_streamed_tool_truncation_hint(names: Sequence[str]) -> str:
    """FR-C: human-readable retry hint appended to assistant text when streamed
    tool calls were dropped due to truncation.

    The text is intentionally directive ("立即重新调用") to fight the failure
    mode where weak models read "ERROR" and then give up the whole task.
    """
    unique_names = ", ".join(sorted({n for n in names if n}))
    if not unique_names:
        unique_names = "<unknown>"
    hint = (
        f"[系统通知] 上一次工具调用（{unique_names}）因流式输出被截断导致参数为空，已被丢弃。"
        f"请立即重新调用同一工具，并把所有 required 参数完整填写一次"
        f"（file_write/file_edit 必须包含完整的 path 与 content/old_string/new_string）。"
    )
    if {"file_write", "file_edit"} & {str(n or "").strip() for n in names}:
        hint += (
            "请改用小块写入：file_write 先写骨架（< 80 行），再用多次 file_edit 追加章节；"
            "单次 new_text/content 建议不超过 120 行，禁止一次生成完整长 HTML。"
        )
    return hint


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
    return serialize_context_files(session.context_files)


def _build_attached_files_hint(session: StudioSession) -> str:
    """List attached text/document files at the user-turn level for the model."""
    cf = getattr(session, "context_files", None)
    if not isinstance(cf, dict) or not cf:
        return ""
    lines: list[str] = []
    for key, value in cf.items():
        k = str(key or "").strip()
        v = str(value or "").strip()
        if not k or k.startswith("skill:") or k.startswith("@dir:"):
            continue
        if (
            v.startswith("[图片")
            or v.startswith("[视频]")
            or v.startswith("[附件解析失败]")
            or v.startswith("[附件] ")
            or v.startswith("[文件引用] ")
        ):
            continue
        name = os.path.basename(k.replace("\\", "/")) or k
        lines.append(f"- {name}（{k}）")
    if not lines:
        return ""
    return (
        "\n\n[已附文件]\n"
        + "\n".join(lines)
        + "\n上述文件内容已在 system prompt 的 context_files 节中给出，请直接阅读并基于其回答。"
    )


def _turn_has_external_context(session: StudioSession, user_input: Any) -> bool:
    """Return whether this turn references external files or attachments."""
    if getattr(session, "context_files", None):
        return True
    if isinstance(user_input, dict):
        return bool(user_input.get("attachments") or user_input.get("context_files"))
    text = str(user_input or "")
    return "@file[" in text


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
        if key == TOKEN_BUDGET_SCRATCHPAD_KEY:
            continue
        value = str(scratchpad.get(key, ""))
        preview = value if len(value) <= 200 else value[:200] + "..."
        lines.append(f"- {key}: {preview.replace(chr(10), ' ')}")
    return "\n".join(lines) if lines else "(empty)"


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
        # When ToolSearch mode != off, defer MCP schema dumping into the system
        # prompt (names/catalog only). Exact auto-threshold application may still
        # fail-open in projection; avoiding full schema dump is the token win.
        defer_schemas = False
        try:
            from agenticx.runtime.tool_search_runtime import read_tool_search_config

            _ts_cfg = read_tool_search_config()
            defer_schemas = _ts_cfg.mode in {"auto", "always"}
        except Exception:
            defer_schemas = False
        mcp_context = build_mcp_tools_context(
            session.mcp_hub,
            defer_schemas=defer_schemas,
        )
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


# OpenAI-compatible chat message keys. Studio may persist extras (metadata,
# attachments, …) on agent_messages; strict gateways (e.g. Zhipu) reject them
# with「API 调用参数有误」when those fields are forwarded upstream.
_LLM_MESSAGE_KEEP_KEYS = frozenset(
    {
        "role",
        "content",
        "name",
        "tool_calls",
        "tool_call_id",
        "function_call",
        "refusal",
        "reasoning_content",
    }
)


def _strip_non_llm_message_fields(
    messages: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Return a shallow-copied message list safe to send to chat completions APIs."""
    out: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        cleaned = {k: v for k, v in msg.items() if k in _LLM_MESSAGE_KEEP_KEYS}
        if "role" not in cleaned:
            continue
        out.append(cleaned)
    return out


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


def _messages_contain_image(messages: Any) -> bool:
    """True when any message carries an image_url content block."""
    if not isinstance(messages, (list, tuple)):
        return False
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and str(block.get("type", "")) == "image_url":
                    return True
    return False


def _is_zhipu_transient_invalid_input(exc: BaseException) -> bool:
    """Zhipu multimodal requests flake with 1210 'invalid input' upstream.

    Excludes the *deterministic* text-only rejection (content.type 参数非法,
    取值范围 ['text']) which must NOT be retried — that model simply cannot
    take images (handled by vision stripping instead).
    """
    text = f"{type(exc).__name__} {exc}".lower()
    if "取值范围" in text and "text" in text:
        return False
    return "invalid input" in text or "1210" in text


_GLM_TOOL_STREAM_MODEL_PREFIXES = (
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "glm-4.7",
    "glm-4.6",
)


def _zhipu_tool_stream_supported(provider_name: str, model_name: str) -> bool:
    """Return whether the configured GLM route supports incremental tool calls.

    The company GLM gateway is exposed as ``custom_openai_*`` and is resolved
    to the generic OpenAI-compatible provider.  Capability detection therefore
    cannot be restricted to the native ``zhipu`` provider name.

    Vision SKUs (glm-4.6v, glm-4.5v, ...) must not opt into incremental
    tool-call streaming; the prefix table targets text GLM-4.7/5.x only.
    """
    provider = str(provider_name or "").strip().lower()
    model = str(model_name or "").strip().lower().split("/")[-1]
    is_glm_route = provider == "zhipu" or provider.startswith("custom_openai_")
    if re.search(r"\dv|vision|vl", model):
        return False
    return is_glm_route and model.startswith(_GLM_TOOL_STREAM_MODEL_PREFIXES)


def _response_finish_reason(response: Any) -> str:
    """Best-effort normalized finish reason for stream and invoke responses."""
    direct = getattr(response, "finish_reason", None)
    if isinstance(direct, str) and direct.strip():
        return direct.strip().lower()
    choices = getattr(response, "choices", None)
    if isinstance(choices, Sequence) and choices:
        first = choices[0]
        if isinstance(first, Mapping):
            raw = first.get("finish_reason")
        else:
            raw = getattr(first, "finish_reason", None)
        if isinstance(raw, str) and raw.strip():
            return raw.strip().lower()
    return ""


_MAX_TOKENS_CAP_RE = re.compile(
    r"max_tokens.*?[\[（(]\s*1\s*[,，]\s*(\d+)\s*[\]）)]",
    re.IGNORECASE,
)


def _parse_max_tokens_cap(exc: BaseException) -> Optional[int]:
    """Parse vendor max_tokens upper bound from an error message, if present."""
    text = str(exc or "")
    if "max_tokens" not in text.lower():
        return None
    match = _MAX_TOKENS_CAP_RE.search(text)
    if not match:
        # Common Zhipu flash wording without needing the full regex match shape.
        if "1024" in text and "max_tokens" in text.lower():
            return 1024
        return None
    try:
        cap = int(match.group(1))
    except (TypeError, ValueError):
        return None
    return cap if cap >= 1 else None


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


_GLM_TOOL_CALL_RE = re.compile(
    r"<tool_call>\s*([A-Za-z0-9_./-]+)\s*(.*?)\s*</tool_call>",
    re.IGNORECASE | re.DOTALL,
)
_GLM_ARG_KEY_OPEN = "<arg_key>"
_GLM_ARG_VALUE_CLOSE = "</arg_value>"
_GLM_ARG_CANONICAL_SPLIT_RE = re.compile(
    r"</arg_key>\s*<arg_value>",
    re.IGNORECASE,
)


def _normalize_file_tool_arg_aliases(
    tool_name: str, args: Dict[str, Any]
) -> Dict[str, Any]:
    """Normalize common file-tool arg aliases to schema keys."""
    if not isinstance(args, dict):
        return {}
    out = dict(args)
    if tool_name == "file_edit":
        alias_map = (
            ("old_str", "old_text"),
            ("old_string", "old_text"),
            ("new_str", "new_text"),
            ("new_string", "new_text"),
        )
    elif tool_name == "file_write":
        alias_map = (
            ("text", "content"),
            ("body", "content"),
            ("new_content", "content"),
        )
    else:
        return out
    for src, dst in alias_map:
        if src in out and dst not in out:
            out[dst] = out.pop(src)
        elif src in out:
            out.pop(src, None)
    return out


def _parse_glm_arg_key_value_body(body: str) -> Dict[str, Any]:
    """Parse GLM <arg_key>/<arg_value> pairs, including sticky key: value forms."""
    args: Dict[str, Any] = {}
    text = str(body or "")
    lower = text.lower()
    pos = 0
    while True:
        start = lower.find(_GLM_ARG_KEY_OPEN, pos)
        if start < 0:
            break
        key_start = start + len(_GLM_ARG_KEY_OPEN)
        value_end = lower.find(_GLM_ARG_VALUE_CLOSE, key_start)
        if value_end < 0:
            break
        segment = text[key_start:value_end]
        canonical = _GLM_ARG_CANONICAL_SPLIT_RE.search(segment)
        if canonical:
            key = segment[: canonical.start()].strip()
            value = segment[canonical.end() :]
        else:
            colon = segment.find(":")
            if colon < 0:
                pos = value_end + len(_GLM_ARG_VALUE_CLOSE)
                continue
            key = segment[:colon].strip()
            value = segment[colon + 1 :]
        if key:
            args[key] = value
        pos = value_end + len(_GLM_ARG_VALUE_CLOSE)
    return args


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
        return {
            "name": name,
            "arguments": _normalize_file_tool_arg_aliases(name, args_obj),
        }

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

    # GLM / Zhipu dialect: <tool_call>name<arg_key>…</arg_key><arg_value>…
    for glm_match in _GLM_TOOL_CALL_RE.finditer(text):
        name = str(glm_match.group(1) or "").strip()
        if name not in allowed_tool_names:
            continue
        args = _parse_glm_arg_key_value_body(glm_match.group(2))
        args = _normalize_file_tool_arg_aliases(name, args)
        return {"name": name, "arguments": args}

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
        args_obj = {}
    else:
        # Allow JSON object in parentheses: foo({"a":1})
        try:
            parsed = json.loads(raw_args)
            args_obj = parsed if isinstance(parsed, dict) else {}
        except Exception:
            args_obj = {}
    return {
        "name": tool_name,
        "arguments": _normalize_file_tool_arg_aliases(tool_name, args_obj),
    }


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

    Compatibility wrapper over :func:`parse_assistant_output`. Terminal
    paths should parse once and reuse ``ParsedAssistantOutput`` instead of
    calling this helper repeatedly with different follow-up splitters.
    """
    parsed = parse_assistant_output(str(text or ""))
    return parsed.reasoning, parsed.visible_body.strip()


def _dedupe_reasoning_against_body(reasoning_text: str, body: str) -> str:
    """Drop reasoning that is only a copy of the public body.

    Some providers (notably GLM via reasoning_content + content) echo the same
    completion into both fields. Persisting both makes the UI render the answer
    twice (ReasoningBlock + body).
    """
    reasoning = str(reasoning_text or "").strip()
    visible = str(body or "").strip()
    if not reasoning or not visible:
        return str(reasoning_text or "")
    if reasoning == visible:
        return ""
    return str(reasoning_text or "")


_PUBLIC_TERMINAL_MESSAGE_TOOLS = frozenset({"create_avatar"})

ToolTurnOutcome = Literal["success", "failed", "pending", "unknown"]

_PUBLIC_COMPLETION_SIGNAL_RE = re.compile(
    r"(?:已(?:经)?(?:完成|修复|修改|更新|处理|解决|创建|删除|调整|添加|写入|保存|落盘)"
    r"|已(?:经)?(?:读取|查询|找到|确认|检查|生成|导出|汇总)"
    r"|(?:修复|修改|更新|处理|创建|删除|调整|添加|写入|保存)(?:方案)?(?:已经)?完成"
    r"|(?:问题|任务).{0,16}已(?:经)?(?:修复|解决|完成)"
    r"|(?:结果如下|以下是(?:结果|说明|汇总)|最终(?:结果|说明))"
    r"|\b(?:done|completed|complete|fixed|updated|created|deleted|saved|written|resolved|finished)\b)",
    re.IGNORECASE | re.DOTALL,
)
_INTERNAL_REASONING_HEAD_RE = re.compile(
    r"^(?:我(?:需要|得|应该|将|先)|让我|先(?:分析|检查|读取|查看|思考)"
    r"|(?:接下来|下一步)(?:需要|应该|先)|用户(?:要求|想要|提到)"
    r"|系统(?:提示|要求)|根据(?:用户|系统)(?:要求|提示)"
    r"|(?:需要|应该)(?:调用|使用)(?:工具|\s*file_)"
    r"|(?:调用|使用)(?:工具|\s*file_)|tool[_ -]?call"
    r"|(?:i(?:'m| am)?\s+(?:going to|need to|should|will)|let me)"
    r"|first\s+(?:analyze|check|read|inspect|think)|next\s+(?:step|i\s+need)|tool\s+call)",
    re.IGNORECASE,
)
_NON_TERMINAL_FINISH_REASONS = frozenset(
    {
        "length",
        "max_tokens",
        "token_limit",
        "context_length",
        "content_filter",
        "safety",
        "error",
    }
)


def _recover_public_completion_from_reasoning(
    reasoning_text: str,
    *,
    has_successful_file_write: bool,
    has_successful_tool: bool = False,
    last_tool_outcome: ToolTurnOutcome,
    finish_reason: str,
) -> str:
    """Promote a strict completion-shaped reasoning payload without leaking CoT.

    Ported-ref: fix/glm-stream-common-finalization@5bf63d3e
    """
    if not (has_successful_file_write or has_successful_tool):
        return ""
    if last_tool_outcome in {"failed", "pending"}:
        return ""
    normalized_finish = str(finish_reason or "").strip().lower()
    if normalized_finish in _NON_TERMINAL_FINISH_REASONS:
        return ""
    cleaned = sanitize_public_tool_summary(str(reasoning_text or ""))
    if not cleaned or not (12 <= len(cleaned) <= 6000):
        return ""
    lowered = cleaned.lower()
    if (
        "[runtime-" in lowered
        or "<tool_code" in lowered
        or "<analysis" in lowered
        or "reasoning:" in lowered
        or "thought:" in lowered
    ):
        return ""
    nonempty_lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    first_line = nonempty_lines[0] if nonempty_lines else ""
    public_head = re.sub(r"^[\s#>*_`~\-✅☑️🎉🛠️]+", "", first_line).strip()
    if not public_head or _INTERNAL_REASONING_HEAD_RE.search(public_head[:240]):
        return ""
    for line in nonempty_lines[1:]:
        public_line = re.sub(r"^[\s#>*_`~\-✅☑️🎉🛠️]+", "", line).strip()
        if public_line and _INTERNAL_REASONING_HEAD_RE.search(public_line[:240]):
            return ""
    if not _PUBLIC_COMPLETION_SIGNAL_RE.search(cleaned[:480]):
        return ""
    return cleaned.strip()


_EMPTY_RESPONSE_FALLBACK = "本轮模型未能生成完整的可见回复，请重新提问。"
_TOOL_TURN_EMPTY_FALLBACK = (
    "工具已执行完成，但模型没有给出总结说明。"
    "请直接回复「继续」让我基于已有结果完成说明，或告诉我下一步。"
)


def _user_facing_tool_success_silence_fallback(
    executed_tool_names: Sequence[str],
    disk_write_paths: Sequence[str] | set[str] | None = None,
) -> str:
    """User-facing notice when tools succeeded but the model stayed silent."""
    recent: list[str] = []
    for name in reversed(list(executed_tool_names or ())):
        text = str(name or "").strip()
        if not text or text in recent:
            continue
        recent.append(text)
        if len(recent) >= 5:
            break
    recent.reverse()
    lines = ["工具已执行完成，但模型没有给出总结说明。"]
    if recent:
        joined = ", ".join(f"`{name}`" for name in recent)
        lines.append(f"最近工具：{joined}")
    write_paths: list[str] = []
    for path in list(disk_write_paths or ()):
        text = str(path or "").strip()
        if not text or text in write_paths:
            continue
        write_paths.append(text)
        if len(write_paths) >= 3:
            break
    if write_paths:
        path_text = ", ".join(f"`{path}`" for path in write_paths)
        lines.append(f"产物路径：{path_text}")
    lines.append("请直接回复「继续」让我基于已有结果完成说明，或告诉我下一步。")
    return "\n".join(lines)

_READONLY_REFERENCE_PATH_RE = re.compile(
    r"path is read-only \(mounted as reference\):\s*(.+?)(?:\. Do not retry|\.\s*$|$)",
    re.IGNORECASE | re.DOTALL,
)
_ESCAPES_WORKSPACE_PATH_RE = re.compile(
    r"path escapes workspace:\s*(\S+)",
    re.IGNORECASE,
)


def _iter_recent_tool_result_messages(
    messages: Sequence[Mapping[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Collect trailing tool results from the latest tool cluster (newest last)."""
    out: list[dict[str, Any]] = []
    for msg in reversed(list(messages or ())):
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role", "")).lower()
        if role == "tool":
            out.append(msg)
            continue
        content = str(msg.get("content") or "")
        if role == "assistant" and msg.get("tool_calls"):
            # The assistant turn that issued the tools — stop above the cluster.
            break
        if role == "assistant" and not content.strip():
            continue
        if role == "system" and content.lstrip().startswith("[runtime-"):
            continue
        break
    out.reverse()
    return out


def _user_facing_tool_error_fallback(
    messages: Sequence[Mapping[str, Any]] | None,
) -> str | None:
    """Prefer a plain-language summary when the latest tools failed with ERROR."""
    for msg in reversed(_iter_recent_tool_result_messages(messages)):
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        head = content.lstrip()
        if not (
            head.startswith("ERROR:")
            or head.startswith("❌")
            or head.startswith("CANCELLED:")
        ):
            continue
        name = str(msg.get("name") or msg.get("tool_name") or "tool").strip() or "tool"
        if "read-only (mounted as reference)" in content:
            path = ""
            match = _READONLY_REFERENCE_PATH_RE.search(content)
            if match:
                path = match.group(1).strip().rstrip(".")
            path_line = f"\n\n路径：`{path}`" if path else ""
            return (
                "没法修改这个文件：它当前是「引用」挂载（只读）。"
                f"{path_line}\n\n"
                "请在左侧工作区把对应文件夹改成「直连」，或让我改写到会话工作区里的副本。"
            )
        if "path escapes workspace" in content:
            path = ""
            match = _ESCAPES_WORKSPACE_PATH_RE.search(content)
            if match:
                path = match.group(1).strip()
            path_line = f"\n\n路径：`{path}`" if path else ""
            return (
                "没法写入该路径：不在当前会话的可写工作区内。"
                f"{path_line}\n\n"
                "请先把文件/文件夹以「直连」或「复制」加入工作区，或指定工作区内的路径。"
            )
        brief = head.split("\n", 1)[0]
        for prefix in ("ERROR:", "❌", "CANCELLED:"):
            if brief.startswith(prefix):
                brief = brief[len(prefix) :].strip()
                break
        return (
            f"工具 `{name}` 没有成功：{brief}\n\n"
            "请展开上方工具卡片查看详情，再告诉我下一步。"
        )
    return None


def _extract_public_tool_result_summary(
    tool_name: str,
    raw_result: str,
) -> str | None:
    """Extract a whitelist public message from a successful built-in tool result."""
    if tool_name not in _PUBLIC_TERMINAL_MESSAGE_TOOLS:
        return None
    try:
        payload = json.loads(str(raw_result or ""))
    except Exception:
        return None
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return None
    if any(payload.get(key) for key in ("queued", "pending", "skipped", "already_running")):
        return None
    message = payload.get("message")
    if not isinstance(message, str):
        return None
    return sanitize_public_tool_summary(message)


def _classify_tool_turn_outcome(
    tool_name: str,
    raw_result: str,
) -> ToolTurnOutcome:
    """Classify a tool result for public-summary invalidation rules."""
    del tool_name  # reserved for future per-tool rules
    text = str(raw_result or "")
    head = text.lstrip()
    if (
        head.startswith("[ACTION_CONFIRMED]")
        or head.startswith("OK:")
    ):
        return "success"
    if (
        head.startswith("ERROR:")
        or head.startswith("❌")
        or head.startswith("CANCELLED:")
        or head.startswith("[ACTION_REJECTED]")
        or head.startswith("[ACTION_CONFIRMATION_EXPIRED]")
        or head.startswith("[ACTION_CONFIRMATION_SUSPENDED]")
    ):
        return "failed"
    try:
        payload = json.loads(text)
    except Exception:
        return "unknown"
    if not isinstance(payload, dict):
        return "unknown"
    if any(payload.get(key) for key in ("queued", "pending", "skipped", "already_running")):
        return "pending"
    if payload.get("ok") is True:
        return "success"
    if payload.get("ok") is False:
        return "failed"
    return "unknown"


# Nudge hint injected when a round produces reasoning (think tags) but no
# visible body and no tool_calls — i.e. the model "thought but said/did nothing".
# Forces one retry so the model emits a real final reply or an explicit tool_call,
# instead of the runtime misjudging the turn as complete and surfacing a "继续" button.
_REASONING_ONLY_NUDGE_WITH_TOOLS_HINT = (
    "[runtime-reasoning-only] 上一轮只输出了思考内容（"
    + _THINK_OPEN_TAG
    + "），"
    "没有给出用户可见的回复，也没有发出 tool_call。"
    "请基于已有上下文与工具结果，直接给出用户可见的最终回复，"
    "或发出明确的 tool_call；不要只输出思考。"
)
_REASONING_ONLY_NUDGE_WITHOUT_TOOLS_HINT = (
    "[runtime-reasoning-only] 上一轮只输出了思考内容（"
    + _THINK_OPEN_TAG
    + "），"
    "没有给出用户可见的回复，也没有发出 tool_call。"
    "本轮请直接输出简短、完整的用户可见最终回复，不要调用工具，"
    "也不要只输出思考。"
)
_TRUNCATED_FINAL_NUDGE_HINT = (
    "[runtime-truncated-final] 你上一条回复似乎在中途被截断：正文很短、没有结束标记，"
    "而你的思考表明还需要继续执行（例如调用工具核实信息）。"
    "请直接继续完成这一轮：如需工具就发起 tool_call，否则输出完整的最终回答。"
    "不要复述已经说过的开场白，不要向用户解释本条提示。"
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
            if key == TOKEN_BUDGET_SCRATCHPAD_KEY:
                continue
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


def _tool_result_ok_flag(result: Any) -> Optional[bool]:
    """Return the boolean ``ok`` flag from a JSON tool result, if present.

    Meta tools (create_avatar / delegate_to_avatar / config writers, etc.)
    return ``{"ok": true|false, ...}``; use it as an authoritative progress
    signal. Returns None when the result is not a JSON object with a boolean
    ``ok`` field, so callers fall back to existing heuristics.
    """
    if not isinstance(result, str):
        return None
    head = result.lstrip()[:4000]
    if not head.startswith("{"):
        return None
    try:
        parsed = json.loads(head)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    flag = parsed.get("ok")
    return flag if isinstance(flag, bool) else None


def _build_loop_halt_success_digest(session: StudioSession, *, max_items: int = 20) -> str:
    """Summarize confirmed successful tool outcomes from this session for the
    loop-halt prompt, so the final user-facing summary cannot claim "no
    progress" when concrete results were already produced."""
    lines: List[str] = []
    seen: set[str] = set()
    for msg in getattr(session, "agent_messages", []) or []:
        if not isinstance(msg, dict) or msg.get("role") != "tool":
            continue
        content = msg.get("content")
        if _tool_result_ok_flag(content) is not True:
            continue
        try:
            payload = json.loads(str(content).lstrip()[:4000])
        except Exception:
            continue
        tool_name = str(msg.get("name") or "tool")
        label = payload.get("name") or payload.get("message") or ""
        line = f"{tool_name} 成功：{label}" if label else f"{tool_name} 成功"
        if line in seen:
            continue
        seen.add(line)
        lines.append(f"- {line}")
    if len(lines) > max_items:
        lines = lines[-max_items:]
    return "\n".join(lines)


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
    from agenticx.features import local_knowledge_enabled

    if not local_knowledge_enabled():
        return False

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
        "reasoning_content": "",
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
        llm_factory: Optional[Callable[[], Any]] = None,
    ) -> None:
        self.llm = llm
        self._llm_factory = llm_factory
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
        self._session_budget_crossed_notice_sent_this_turn = False
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

    def _reload_llm_for_session(self, session: Any) -> bool:
        """Rebuild the active provider after a session-level fallback switch.

        Ported-ref: fix/glm-stream-common-finalization@5bf63d3e
        """
        del session
        if not callable(self._llm_factory):
            return False
        next_llm = self._llm_factory()
        if next_llm is None:
            return False
        self.llm = next_llm
        self.compactor.llm = next_llm
        return True

    def _restore_token_budget_usage(self, session: Any) -> None:
        """Restore this session's totals while keeping current configured limits."""
        scratchpad = getattr(session, "scratchpad", None)
        payload = (
            scratchpad.get(TOKEN_BUDGET_SCRATCHPAD_KEY)
            if isinstance(scratchpad, dict)
            else None
        )
        self.token_budget.restore_usage(payload if isinstance(payload, dict) else None)

    def _store_token_budget_usage(self, session: Any) -> None:
        """Place durable usage state in the session's existing scratchpad store."""
        scratchpad = getattr(session, "scratchpad", None)
        if not isinstance(scratchpad, dict):
            scratchpad = {}
            setattr(session, "scratchpad", scratchpad)
        scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {
            "version": 1,
            "cumulative_input": self.token_budget.cumulative_input,
            "cumulative_output": self.token_budget.cumulative_output,
            "warning_emitted": self.token_budget.warning_emitted,
        }

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

    def _persist_final_checkpoint(self) -> None:
        """Persist the completed turn before exposing its FINAL event."""
        if self._mid_turn_persist is None:
            return
        try:
            self._mid_turn_persist()
        except Exception:
            logger.exception("final session checkpoint failed")
        self._last_persist_time = time.time()
        self._tools_since_persist = 0

    def _append_terminal_assistant(
        self,
        session: StudioSession,
        text: str,
        *,
        is_system_trigger: bool,
    ) -> None:
        """Append a synthetic terminal reply to both persisted message views."""
        content = str(text or "").strip()
        if not content:
            return
        message = {
            "role": "assistant",
            "content": content,
            "metadata": {
                "turn_terminal": True,
                "terminal_reason": "synthetic_terminal",
            },
        }
        if not (
            session.agent_messages
            and session.agent_messages[-1].get("role") == "assistant"
            and str(session.agent_messages[-1].get("content") or "").strip() == content
        ):
            # agent_messages must stay provider-safe: no runtime-only metadata.
            session.agent_messages.append({"role": "assistant", "content": content})
        if not is_system_trigger:
            _chat_history_append_deduped(session.chat_history, dict(message))

    async def _finish_terminal_reply(
        self,
        session: StudioSession,
        *,
        clean_body: str,
        reasoning_text: str = "",
        suggestions: Sequence[str] = (),
        reasoning_seconds: int | None = None,
        references: Sequence[dict[str, Any]] = (),
        searched_queries: Sequence[str] = (),
        usage_metadata: Mapping[str, Any] | None = None,
        terminal_reason: str,
        agent_id: str,
        is_system_trigger: bool,
        terminal_metadata: Mapping[str, Any] | None = None,
        extra_final: Mapping[str, Any] | None = None,
    ) -> RuntimeEvent:
        """Persist one terminal assistant reply and build the FINAL event."""
        # FINAL is the last invariant boundary before text reaches both SSE and
        # disk. Recovery paths may supply a raw provider payload even when the
        # normal per-round parser already reported malformed protocol (for
        # example an unclosed ``<followups>`` block). Parse once more here so a
        # recovery branch can never persist model-control tags as public text.
        terminal_parsed = parse_assistant_output(str(clean_body or ""))
        body = terminal_parsed.visible_body
        if terminal_parsed.malformed:
            suggestions = ()
            if terminal_reason == "model_final":
                terminal_reason = "malformed_model_final_recovered"
        if not is_system_trigger and not body.strip():
            raise RuntimeError("interactive FINAL must have visible body")

        safe_reasoning = str(reasoning_text or "")
        if not safe_reasoning.strip() and not terminal_parsed.malformed:
            safe_reasoning = terminal_parsed.reasoning
        safe_reasoning = _dedupe_reasoning_against_body(safe_reasoning, body)
        terminal_suggestions = suggestions or terminal_parsed.suggested_questions
        sug_list = [str(s) for s in terminal_suggestions if str(s).strip()]

        if session.agent_messages and isinstance(session.agent_messages[-1], dict):
            last_am = session.agent_messages[-1]
            if (
                str(last_am.get("role", "")).lower() == "assistant"
                and not last_am.get("tool_calls")
            ):
                last_am["content"] = body
            elif body.strip():
                session.agent_messages.append({"role": "assistant", "content": body})
        elif body.strip():
            session.agent_messages.append({"role": "assistant", "content": body})

        if not is_system_trigger:
            persisted_metadata: Dict[str, Any] = {
                "turn_terminal": True,
                "terminal_reason": terminal_reason,
            }
            if terminal_metadata:
                for key, value in terminal_metadata.items():
                    if key not in {"turn_terminal", "terminal_reason"}:
                        persisted_metadata[str(key)] = value
            hist: Dict[str, Any] = {
                "role": "assistant",
                "content": body,
                "metadata": persisted_metadata,
            }
            if sug_list:
                hist["suggested_questions"] = list(sug_list)
            if safe_reasoning.strip():
                hist["reasoning"] = safe_reasoning[:16384]
                if reasoning_seconds is not None and int(reasoning_seconds) >= 1:
                    hist["reasoning_seconds"] = int(reasoning_seconds)
            if references:
                hist["references"] = list(references)
            if searched_queries:
                hist["searched_queries"] = list(searched_queries)
            _chat_history_append_deduped(session.chat_history, hist)

        await self.hooks.run_on_agent_end(body, session)

        final_data: dict[str, Any] = {
            "text": body,
            "turn_terminal": True,
            "terminal_reason": terminal_reason,
        }
        if terminal_metadata:
            for key, value in terminal_metadata.items():
                if key not in {"turn_terminal", "terminal_reason"}:
                    final_data[str(key)] = value
        if sug_list:
            final_data["suggested_questions"] = list(sug_list)
        if safe_reasoning.strip():
            final_data["reasoning"] = safe_reasoning[:16384]
            if reasoning_seconds is not None and int(reasoning_seconds) >= 1:
                final_data["reasoning_seconds"] = int(reasoning_seconds)
        if references:
            final_data["references"] = list(references)
        if searched_queries:
            final_data["searched_queries"] = list(searched_queries)
        if usage_metadata:
            final_data["usage_metadata"] = dict(usage_metadata)
        if extra_final:
            for key, value in extra_final.items():
                final_data[key] = value

        self._persist_final_checkpoint()
        return RuntimeEvent(type=EventType.FINAL.value, data=final_data, agent_id=agent_id)

    async def run_turn(
        self,
        user_input: Any,
        session: StudioSession,
        should_stop: Optional[Callable[[], bool | Awaitable[bool]]] = None,
        *,
        agent_id: str = "meta",
        tools: Optional[Sequence[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
        user_message_content: Optional[Any] = None,
        history_user_attachments: Optional[list[dict[str, Any]]] = None,
        history_user_metadata: Optional[dict[str, Any]] = None,
        history_user_content: Optional[str] = None,
        history_quoted_content: Optional[str] = None,
        history_quoted_message_id: Optional[str] = None,
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

        self._restore_token_budget_usage(session)
        self.token_budget.reset_turn()
        self.loop_detector.reset()
        self._forced_budget_compact_this_turn = False
        self._proactive_compact_this_turn = False
        self._budget_compress_notice_sent_this_turn = False
        self._session_budget_crossed_notice_sent_this_turn = False
        self._pending_loop_nudge = None
        token_budget_preflight = session_token_budget_preflight(
            getattr(session, "scratchpad", None),
            max_tokens_per_session=self.token_budget.max_session,
        )
        if token_budget_preflight is not None:
            yield RuntimeEvent(
                type=EventType.ERROR.value,
                data=token_budget_preflight,
                agent_id=agent_id,
            )
            return
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
        full_tool_pool: list[Dict[str, Any]] = list(
            studio_tools_for_session(session) if tools is None else tools
        )
        from agenticx.runtime.context_budget import maybe_compact_meta_turn_context
        from agenticx.runtime.tool_search import (
            auto_load_deferred_tool,
            is_tool_pending_next_round,
            project_tools_for_round,
        )
        from agenticx.runtime.tool_search_runtime import (
            build_runtime_context,
            collect_mcp_descriptors,
        )

        compact_prompt, compact_tools, compact_notice = maybe_compact_meta_turn_context(
            session,
            system_prompt=current_system_prompt,
            tools=list(full_tool_pool),
        )
        if compact_notice:
            current_system_prompt = compact_prompt
            full_tool_pool = list(compact_tools)

        def _rebuild_ts_ctx():
            return build_runtime_context(
                session=session,
                full_openai_tools=full_tool_pool,
                mcp_descriptors=collect_mcp_descriptors(session, full_tool_pool),
            )

        ts_ctx = _rebuild_ts_ctx()

        def _project_active_tools() -> tuple[list[Dict[str, Any]], set[str]]:
            nonlocal ts_ctx
            # Refresh MCP snapshots each round (connect/disconnect) while keeping scratchpad state.
            prev_loaded = list(ts_ctx.state.loaded_ids)
            ts_ctx = _rebuild_ts_ctx()
            # Prefer in-memory loaded ids from this turn (tool_search), then scratchpad.
            if prev_loaded:
                from agenticx.runtime.tool_search import ToolSearchStateV1, prune_state_to_catalog

                ts_ctx.state = prune_state_to_catalog(
                    ToolSearchStateV1(
                        loaded_ids=prev_loaded,
                        catalog_fingerprint=ts_ctx.catalog.fingerprint,
                        version=ts_ctx.state.version,
                    ),
                    ts_ctx.catalog,
                )
            projected = project_tools_for_round(
                ts_ctx,
                full_openai_tools=full_tool_pool,
            )
            names = {
                str(tool.get("function", {}).get("name", "")).strip()
                for tool in projected
                if isinstance(tool, dict)
            }
            names.discard("")
            return list(projected), names

        active_tools, allowed_tool_names = _project_active_tools()
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
        _is_system_trigger = str(user_input or "").startswith("[系统通知]")
        # Defer chat_history compaction notice until after the user row is appended
        # so transcript order stays [user] → [compaction notice] → [assistant].
        pending_compaction_notice_count: Optional[int] = None
        if did_compact:
            yield RuntimeEvent(
                type=EventType.COMPACTION.value,
                data={
                    "compacted_count": compacted_count,
                    "summary": compact_summary,
                    "trigger_reason": str(
                        getattr(self.compactor, "last_trigger_reason", "") or ""
                    ),
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
            # Visible notice is deferred (system triggers stay silent for users).
            if not _is_system_trigger:
                pending_compaction_notice_count = int(compacted_count)
        user_content: Any = user_message_content if user_message_content is not None else user_input
        attached_hint = _build_attached_files_hint(session)
        if attached_hint:
            if isinstance(user_content, str):
                user_content = f"{user_content}{attached_hint}"
            elif isinstance(user_content, list):
                user_content = list(user_content) + [{"type": "text", "text": attached_hint}]
        if history_user_attachments and not is_vision_capable(
            str(getattr(session, "provider_name", "") or ""),
            str(getattr(session, "model_name", "") or ""),
        ):
            _img_rows = [
                a
                for a in history_user_attachments
                if isinstance(a, dict)
                and (
                    str(a.get("mime_type", "") or "").startswith("image/")
                    or str(a.get("data_url", "") or "").startswith("data:image/")
                )
            ]
            if _img_rows:
                _names = ", ".join(str(a.get("name", "") or "image") for a in _img_rows[:4])
                _omit_notice = (
                    f"\n[系统提示] 用户本轮附带了 {len(_img_rows)} 张图片（{_names}），"
                    "但当前模型不支持视觉输入，图片未包含在你的输入中。"
                    "请调用 analyze_image（target 可省略，默认读取最近附图；可用 question 指定关注点）"
                    "获取图片内容解读后继续任务；不要回复用户「我看不到图片」。"
                )
                if isinstance(user_content, str):
                    user_content = f"{user_content}{_omit_notice}"
                elif isinstance(user_content, list):
                    user_content = list(user_content) + [{"type": "text", "text": _omit_notice}]
        messages.append({"role": "user", "content": user_content})
        if persist_user_message:
            # Store rich content (list with image_url blocks for vision uploads) + attachments
            # so that later turns (including after model switch to a vision model) can replay
            # the images as native multimodal parts instead of relying on ephemeral paths or view_image.
            am_user: dict[str, Any] = {"role": "user", "content": user_content}
            if history_user_attachments:
                am_user["attachments"] = list(history_user_attachments)
            if history_user_metadata:
                am_user["metadata"] = dict(history_user_metadata)
            session.agent_messages.append(am_user)
        await self.hooks.run_on_agent_start(session, agent_id, user_input)
        synced_session_message_count = len(session.agent_messages)
        _should_mid_turn_persist = False
        # Visible chat history should keep the clean user utterance; model context
        # may still use effective_input (e.g. with an injected quote block).
        _history_text = (
            str(history_user_content)
            if history_user_content is not None
            else str(user_input or "")
        )
        _history_quoted = str(history_quoted_content or "").strip()
        _history_quoted_id = str(history_quoted_message_id or "").strip()

        def _build_hist_user(content: str) -> dict[str, Any]:
            row: dict[str, Any] = {"role": "user", "content": content}
            if history_user_attachments:
                row["attachments"] = list(history_user_attachments)
            if history_user_metadata:
                row["metadata"] = dict(history_user_metadata)
            if _history_quoted:
                row["quoted_content"] = _history_quoted
            if _history_quoted_id:
                row["quoted_message_id"] = _history_quoted_id
            return row

        if persist_user_message and not _is_system_trigger:
            hist_user = _build_hist_user(_history_text)
            _chat_history_append_deduped(session.chat_history, hist_user)
            # Set current user intent for goal anchor injection (FR-1)
            session.current_user_intent = _history_text or user_input
            _should_mid_turn_persist = True
            # Persist the user turn to disk immediately. Otherwise messages.json
            # lags until the first mid-turn checkpoint, and a client that reloads
            # this session (e.g. switching away and back) reads a stale snapshot
            # missing the just-sent user turn -- the message appears to vanish.
        elif not _is_system_trigger:
            # skip_user_history still feeds the model, but Desktop must show the
            # user bubble after reload. Append a display row when the tail does
            # not already contain this utterance (retry keeps the truncated row).
            from agenticx.studio.continuation import is_continuation_user_prompt

            ui_text = str(_history_text or user_input or "").strip()
            if ui_text and not is_continuation_user_prompt(ui_text):
                last_user_text = ""
                for item in reversed(session.chat_history or []):
                    if item.get("role") == "user":
                        last_user_text = str(item.get("content", "")).strip()
                        break
                from agenticx.studio.message_forward import forward_note_already_on_tail

                # Merge-forward already embeds the follow-up cue on the forward card.
                # Do not append a second identical user bubble for the auto-reply turn.
                if forward_note_already_on_tail(session.chat_history, ui_text):
                    session.current_user_intent = _history_text or user_input
                elif last_user_text != ui_text:
                    hist_user = _build_hist_user(_history_text or user_input)
                    _chat_history_append_deduped(session.chat_history, hist_user)
                    session.current_user_intent = _history_text or user_input
                    _should_mid_turn_persist = True
        # FR-1: append visible compaction notice after the user chat_history row
        # so reload order is [user] → [compaction notice] → [assistant].
        if pending_compaction_notice_count is not None:
            from agenticx.studio.compaction_notice import append_or_update_compaction_notice

            append_or_update_compaction_notice(
                session,
                count=pending_compaction_notice_count,
                reactive=False,
                agent_id=agent_id,
            )
            pending_compaction_notice_count = None
            _should_mid_turn_persist = True
        if _should_mid_turn_persist and self._mid_turn_persist is not None:
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
        public_tool_summaries: List[str] = []
        unresolved_after_public_summary = False
        disk_write_paths: set[str] = set()
        write_path_counts: Dict[str, int] = {}
        completed_tool_names: set[str] = set()
        last_tool_outcome: ToolTurnOutcome = "unknown"
        confirmation_spam_count = 0
        rounds_without_todo = 0
        # Turn-level counter for reasoning-only rounds (model emitted < Mattis> but no
        # visible body and no tool_call). Capped at 1 to avoid infinite nudge loops.
        reason_only_retry = 0
        reason_only_retry_without_tools = False
        truncated_final_retry = 0
        suspected_truncated_signal = ""
        reasoning_before_nudge = ""
        reasoning_only_protocol_errors: list[str] = []
        round_timings: list[dict[str, Any]] = []
        model_round_count = 0
        first_visible_token_ms: int | None = None
        turn_model_started_at = time.monotonic()
        setattr(session, "_empty_tool_calls_retry_used", False)

        def _record_tool_turn_outcome(
            outcome: ToolTurnOutcome,
            tool_name: str = "",
        ) -> None:
            nonlocal unresolved_after_public_summary
            nonlocal last_tool_outcome
            last_tool_outcome = outcome
            if outcome in {"success", "unknown"} and tool_name:
                completed_tool_names.add(tool_name)
            if not public_tool_summaries:
                return
            if outcome in ("failed", "pending", "unknown"):
                unresolved_after_public_summary = True
            elif outcome == "success":
                unresolved_after_public_summary = False

        def _note_public_tool_summary(tool_name: str, raw_result: str) -> None:
            nonlocal unresolved_after_public_summary
            summary = _extract_public_tool_result_summary(tool_name, raw_result)
            if not summary:
                return
            if summary not in public_tool_summaries:
                public_tool_summaries.append(summary)
                if len(public_tool_summaries) > 3:
                    del public_tool_summaries[:-3]
            unresolved_after_public_summary = False
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
        if not model_name:
            model_name = str(getattr(self.llm, "model", "") or "").strip()
        if not provider_name:
            llm_cls = type(self.llm).__name__
            if llm_cls == "MiniMaxProvider" or "minimax" in model_name.lower():
                provider_name = "minimax"
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
            # Re-project each round so tool_search loads take effect next round.
            active_tools, allowed_tool_names = _project_active_tools()
            if reason_only_retry_without_tools:
                active_tools = []
                allowed_tool_names = set()
                reason_only_retry_without_tools = False
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
            model_round_count += 1
            round_started_at = time.monotonic()
            round_first_feedback_at: float | None = None
            round_first_visible_at: float | None = None
            round_tool_schema_tokens_sent = 0
            round_timing_recorded = False

            def _record_round_timing(*, reasoning_only: bool) -> None:
                nonlocal round_timing_recorded
                if round_timing_recorded:
                    return
                ended_at = time.monotonic()
                elapsed_ms = max(0, int((ended_at - round_started_at) * 1000))
                feedback_ms = (
                    max(0, int((round_first_feedback_at - round_started_at) * 1000))
                    if round_first_feedback_at is not None
                    else elapsed_ms
                )
                visible_ms = (
                    max(0, int((round_first_visible_at - round_started_at) * 1000))
                    if round_first_visible_at is not None
                    else 0
                )
                round_timings.append(
                    {
                        "round": round_idx,
                        "elapsed_ms": elapsed_ms,
                        "first_feedback_ms": feedback_ms,
                        "first_visible_token_ms": visible_ms,
                        "reasoning_only": bool(reasoning_only),
                        "tool_schema_tokens_sent": int(round_tool_schema_tokens_sent),
                    }
                )
                round_timing_recorded = True

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
                try:
                    _merge_llm_call_kwargs(
                        llm_call_kwargs,
                        _kimi_k3_reasoning_effort_kwargs(session, model_name),
                    )
                    _merge_llm_call_kwargs(
                        llm_call_kwargs,
                        _deepseek_v4_thinking_kwargs(session, model_name),
                    )
                except Exception:
                    pass
                try:
                    from agenticx.runtime.tool_search import (
                        estimate_schema_tokens,
                        should_apply_tool_search,
                    )

                    _ts_before = estimate_schema_tokens(list(full_tool_pool))
                    _ts_sent = estimate_schema_tokens(list(active_tools))
                    round_tool_schema_tokens_sent = int(_ts_sent)
                    if ts_ctx.resolved_applied is not None:
                        _ts_applied = bool(ts_ctx.resolved_applied)
                    else:
                        _ts_applied = should_apply_tool_search(
                            ts_ctx.config,
                            full_pool_schema_tokens=_ts_before,
                            tool_search_allowed=ts_ctx.tool_search_allowed,
                            effective_threshold=ts_ctx.effective_threshold,
                            prev_applied=ts_ctx.prev_applied,
                        )
                    _ts_mode = str(ts_ctx.config.normalized().mode)
                    _ts_loaded = len(ts_ctx.state.loaded_ids)
                    _ts_candidates = len(ts_ctx.catalog.descriptors)
                    _ts_threshold = int(ts_ctx.effective_threshold or 0)
                    _ts_strategy = str(ts_ctx.config.normalized().threshold_strategy)
                    _ts_latched = bool(
                        ts_ctx.prev_applied is not None and ts_ctx.prev_applied == _ts_applied
                    )
                except Exception:
                    _ts_before = 0
                    _ts_sent = 0
                    _ts_applied = False
                    _ts_mode = "off"
                    _ts_loaded = 0
                    _ts_candidates = 0
                    _ts_threshold = 0
                    _ts_strategy = "adaptive"
                    _ts_latched = False
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
                    "tool_search_mode": _ts_mode,
                    "tool_search_applied": bool(_ts_applied),
                    "tool_search_candidate_count": int(_ts_candidates),
                    "tool_search_loaded_count": int(_ts_loaded),
                    "tool_search_schema_tokens_before": int(_ts_before),
                    "tool_search_schema_tokens_sent": int(_ts_sent),
                    "tool_search_schema_tokens_saved": max(0, int(_ts_before) - int(_ts_sent)),
                    "tool_search_effective_threshold": int(_ts_threshold),
                    "tool_search_threshold_strategy": str(_ts_strategy),
                    "tool_search_decision_latched": bool(_ts_latched),
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
                # Drop Studio-only fields (metadata/attachments/…) before upstream call.
                messages_for_llm = _strip_non_llm_message_fields(messages_for_llm)
                messages_for_llm = _ensure_deepseek_v4_tool_reasoning_content(
                    messages_for_llm, session, model_name
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
                                _max_tokens = _resolve_round_max_tokens(
                                    int(
                                        getattr(session, "_max_tokens_override", None)
                                        or 8192
                                    ),
                                    executed_tool_names,
                                    provider=provider_name,
                                )
                                stream_kwargs: Dict[str, Any] = {
                                    "tools": list(active_tools),
                                    "tool_choice": _round_tool_choice,
                                    "max_tokens": int(_max_tokens),
                                    "timeout": request_timeout_seconds,
                                    **_chat_temperature_kwargs(model_name, provider_name),
                                }
                                if _zhipu_tool_stream_supported(provider_name, model_name):
                                    # BigModel exposes incremental tool-call deltas as
                                    # a separate opt-in capability for GLM-4.7/5.x text.
                                    # Vision SKUs are excluded by the gate.
                                    stream_kwargs["tool_stream"] = True
                                if provider_name.strip().lower() == "minimax":
                                    stream_kwargs.pop("tool_choice", None)
                                    # _resolve_round_max_tokens already clamps MiniMax.
                                    stream_kwargs["max_tokens"] = int(_max_tokens)
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
                        show_widget_delta_state: Dict[int, Dict[str, float]] = {}
                        stream_usage: Dict[str, int] = {}
                        stream_finish_reason = ""

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
                                    type=EventType.TOOL_PROGRESS.value,
                                    data={
                                        "name": "模型响应",
                                        "phase": "waiting_for_model",
                                        "tool_call_id": "",
                                    },
                                    agent_id=agent_id,
                                )
                                continue
                            if round_first_feedback_at is None:
                                round_first_feedback_at = time.monotonic()
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
                                    if round_first_visible_at is None:
                                        _, streamed_visible_body = _split_reasoning_and_body(
                                            response_text
                                        )
                                        if streamed_visible_body.strip():
                                            round_first_visible_at = time.monotonic()
                                            if first_visible_token_ms is None:
                                                first_visible_token_ms = max(
                                                    0,
                                                    int(
                                                        (
                                                            round_first_visible_at
                                                            - turn_model_started_at
                                                        )
                                                        * 1000
                                                    ),
                                                )
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
                            elif chunk_type == "done":
                                raw_finish = stream_chunk.get("finish_reason", "")
                                if isinstance(raw_finish, str) and raw_finish.strip():
                                    stream_finish_reason = raw_finish.strip().lower()
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
                                accumulated_name = str(acc.get("name") or "").strip()
                                if accumulated_name == "show_widget":
                                    current_args = str(acc.get("arguments") or "")
                                    if _should_emit_show_widget_delta(
                                        show_widget_delta_state,
                                        idx,
                                        current_args,
                                    ):
                                        yield RuntimeEvent(
                                            type=EventType.TOOL_CALL_DELTA.value,
                                            data={
                                                "name": "show_widget",
                                                "tool_call_id": str(acc.get("id") or f"stream-pending-{idx}"),
                                                "arguments_raw": current_args,
                                                "partial": True,
                                            },
                                            agent_id=agent_id,
                                        )
                                elif accumulated_name:
                                    yield RuntimeEvent(
                                        type=EventType.TOOL_CALL_DELTA.value,
                                        data={
                                            "name": accumulated_name,
                                            "tool_call_id": str(
                                                acc.get("id") or f"stream-pending-{idx}"
                                            ),
                                            "arguments_raw": str(acc.get("arguments") or ""),
                                            "partial": True,
                                        },
                                        agent_id=agent_id,
                                    )
                        for idx in sorted(tool_calls_acc.keys()):
                            item = tool_calls_acc[idx]
                            accumulated_name = str(item.get("name") or "").strip()
                            if accumulated_name != "show_widget":
                                continue
                            current_args = str(item.get("arguments") or "")
                            if _should_emit_show_widget_delta(
                                show_widget_delta_state,
                                idx,
                                current_args,
                                force=True,
                            ):
                                yield RuntimeEvent(
                                    type=EventType.TOOL_CALL_DELTA.value,
                                    data={
                                        "name": "show_widget",
                                        "tool_call_id": str(item.get("id") or f"stream-pending-{idx}"),
                                        "arguments_raw": current_args,
                                        "partial": True,
                                    },
                                    agent_id=agent_id,
                                )
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
                            {
                                "content": response_text,
                                "tool_calls": tool_calls,
                                "usage": stream_usage,
                                "finish_reason": stream_finish_reason,
                            },
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
                                max_tokens=_resolve_round_max_tokens(
                                    int(
                                        getattr(session, "_max_tokens_override", None)
                                        or 8192
                                    ),
                                    executed_tool_names,
                                    provider=provider_name,
                                ),
                                timeout=request_timeout_seconds,
                                **_chat_temperature_kwargs(model_name, provider_name),
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
                            if round_first_feedback_at is None:
                                round_first_feedback_at = time.monotonic()
                            break
                        now = asyncio.get_running_loop().time()
                        elapsed = now - wait_started_at
                        if (not waiting_hint_emitted) and elapsed >= first_feedback_seconds:
                            waiting_hint_emitted = True
                            last_pulse_at = now
                            yield RuntimeEvent(
                                type=EventType.TOOL_PROGRESS.value,
                                data={
                                    "name": "模型响应",
                                    "phase": "waiting_for_model",
                                    "tool_call_id": "",
                                },
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
                session_budget_level = self.token_budget.check_session()
                turn_budget_level = self.token_budget.check_turn()
                warning_started_now = (
                    self.token_budget.cumulative_total
                    >= DEFAULT_WARNING_TOKENS_PER_SESSION
                    and not self.token_budget.warning_emitted
                )
                if warning_started_now:
                    self.token_budget.warning_emitted = True
                self._store_token_budget_usage(session)

                # The optional per-turn hard limit retains its original semantics.
                # It is evaluated before session pressure so a simultaneous session
                # crossing cannot accidentally weaken an explicitly enforced turn cap.
                if turn_budget_level == BudgetLevel.EXCEEDED:
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": (
                                "Token budget exceeded "
                                f"({self.token_budget.turn_total}/{self.token_budget.max_turn}, source=turn). "
                                "Stopping to preserve results."
                            ),
                            "detector": "token_budget",
                            "budget_exceeded": True,
                            "budget_source": "turn",
                            "current": self.token_budget.turn_total,
                            "max_allowed": self.token_budget.max_turn,
                            "unattended_useless": True,
                        },
                        agent_id=agent_id,
                    )
                    # This branch intentionally has no normal FINAL checkpoint.
                    # Persist the paid usage/user row before preserving the legacy
                    # per-turn hard-stop behavior.
                    self._persist_final_checkpoint()
                    return

                # A paid model response may carry the cumulative session over its
                # hard cap. Do not discard that result: warn once, request convergence,
                # and let this run reach its normal FINAL/persistence path. The next
                # run_turn preflight will reject before touching user history or LLMs.
                if (
                    session_budget_level == BudgetLevel.EXCEEDED
                    and not self._session_budget_crossed_notice_sent_this_turn
                ):
                    self._session_budget_crossed_notice_sent_this_turn = True
                    messages.append(
                        {"role": "user", "content": self.token_budget.convergence_hint()}
                    )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": (
                                "本轮已达到会话 Token 上限，将先完成当前结果；"
                                "下一轮开始前会停止并提示新建会话或提高上限。"
                            ),
                            "severity": "warning",
                            "detector": "token_budget_session_reached",
                            "budget_source": "session",
                            "current": self.token_budget.cumulative_total,
                            "max_allowed": self.token_budget.max_session,
                            "block_next_turn": True,
                        },
                        agent_id=agent_id,
                    )
                elif warning_started_now:
                    messages.append(
                        {"role": "user", "content": self.token_budget.convergence_hint()}
                    )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": (
                                "本会话累计 Token 已达到 "
                                f"{DEFAULT_WARNING_TOKENS_PER_SESSION:,}。当前任务会继续，"
                                "建议在完成后新建会话以保持稳定。"
                            ),
                            "severity": "warning",
                            "detector": "token_budget_warning",
                            "budget_source": "session",
                            "current": self.token_budget.cumulative_total,
                            "warning_at": DEFAULT_WARNING_TOKENS_PER_SESSION,
                            "max_allowed": self.token_budget.max_session,
                        },
                        agent_id=agent_id,
                    )

                if session_budget_level == BudgetLevel.EXCEEDED:
                    budget_level = turn_budget_level
                    budget_source = "turn"
                    budget_current = self.token_budget.turn_total
                    budget_max = self.token_budget.max_turn
                else:
                    budget_level, budget_source, budget_current, budget_max = (
                        self.token_budget.check_with_source()
                    )
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
                    if session_budget_level == BudgetLevel.EXCEEDED:
                        budget_level = self.token_budget.check_turn()
                        budget_source = "turn"
                        budget_current = self.token_budget.turn_total
                        budget_max = self.token_budget.max_turn
                    else:
                        budget_level, budget_source, budget_current, budget_max = (
                            self.token_budget.check_with_source()
                        )
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
                                "trigger_reason": str(
                                    getattr(self.compactor, "last_trigger_reason", "") or ""
                                ),
                            },
                            agent_id=agent_id,
                        )
                        # FR-2: persist reactive compaction notice into chat_history
                        # so reload / session switch still shows the ContextNoticeLine.
                        from agenticx.studio.compaction_notice import append_or_update_compaction_notice

                        append_or_update_compaction_notice(
                            session,
                            count=react_count,
                            reactive=True,
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
                if budget_level == BudgetLevel.WARNING and (
                    budget_source == "turn"
                    or (turn_budget_level == BudgetLevel.WARNING and not warning_started_now)
                ):
                    messages.append({"role": "user", "content": self.token_budget.convergence_hint()})
            except asyncio.TimeoutError:
                round_timeout = _resolve_llm_round_timeout_seconds(session)
                retries = _llm_timeout_retry_count(session)
                provider_hint = provider_name or "(unknown)"
                model_hint = model_name or "(unknown)"
                streak = record_provider_timeout(session)
                applied, fallback_msg = maybe_apply_provider_fallback(session)
                if applied and fallback_msg:
                    fallback_reloaded = False
                    try:
                        fallback_reloaded = self._reload_llm_for_session(session)
                    except Exception:
                        logger.warning(
                            "failed to rebuild LLM after fallback session=%s",
                            getattr(session, "session_id", ""),
                            exc_info=True,
                        )
                    if not fallback_reloaded:
                        logger.warning(
                            "fallback model recorded but active LLM was not rebuilt session=%s",
                            getattr(session, "session_id", ""),
                        )
                    provider_name = str(getattr(session, "provider_name", "") or provider_name)
                    model_name = str(getattr(session, "model_name", "") or model_name)
                    if not model_name:
                        model_name = str(getattr(self.llm, "model", "") or "").strip()
                    invoke_timeout_seconds = _resolve_llm_invoke_timeout_seconds(session)
                    heartbeat_timeout_seconds = _resolve_llm_heartbeat_timeout_seconds(session)
                    hard_timeout_seconds = _resolve_llm_hard_timeout_seconds(session)
                    first_feedback_seconds = _resolve_llm_first_feedback_seconds(session)
                    request_timeout_seconds = max(
                        invoke_timeout_seconds,
                        heartbeat_timeout_seconds,
                        hard_timeout_seconds,
                        provider_read_timeout,
                    ) + 15.0
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
                patience = _resolve_stall_patience_config(session)
                if patience["enabled"]:
                    patience_state = _stall_patience_state(session)
                    now_mono = asyncio.get_running_loop().time()
                    if not patience_state.get("started_at"):
                        patience_state["started_at"] = now_mono
                    waited_seconds = now_mono - float(patience_state["started_at"])
                    if (
                        patience_state["attempts"] < patience["max_attempts"]
                        and waited_seconds < patience["budget_seconds"]
                    ):
                        patience_state["attempts"] += 1
                        wait_seconds = min(
                            patience["base_seconds"] * (2 ** (patience_state["attempts"] - 1)),
                            60.0,
                            max(1.0, patience["budget_seconds"] - waited_seconds),
                        )
                        yield RuntimeEvent(
                            type=EventType.TOOL_PROGRESS.value,
                            data={
                                "name": "模型响应",
                                "phase": "stall_patient_wait",
                                "tool_call_id": "",
                                "attempt": patience_state["attempts"],
                                "max_attempts": patience["max_attempts"],
                                "waited_seconds": int(waited_seconds),
                                "next_retry_in_seconds": int(wait_seconds),
                                "provider": provider_hint,
                                "model": model_hint,
                            },
                            agent_id=agent_id,
                        )
                        if patience_state["attempts"] == 1:
                            messages.append(
                                {
                                    "role": "user",
                                    "content": (
                                        "[系统通知] 模型响应持续超时，系统正在自动等待并重试；"
                                        "恢复后将继续本轮，无需用户操作。"
                                    ),
                                }
                            )
                        await asyncio.sleep(wait_seconds)
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
                # 智谱视觉模型「多模态 + 工具」请求偶发 1210 invalid input（上游抖动）。
                # 同请求重试常成功，做一次会话级一次性重试再放弃。
                if (
                    provider_name.strip().lower() == "zhipu"
                    and _messages_contain_image(messages_for_llm)
                    and _is_zhipu_transient_invalid_input(exc)
                    and not getattr(session, "_zhipu_vision_flake_retry_attempted", False)
                ):
                    setattr(session, "_zhipu_vision_flake_retry_attempted", True)
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": "视觉模型上游返回参数错误，正在自动重试一次…",
                            "severity": "warning",
                            "detector": "zhipu_vision_flake_retry",
                            "retryable": True,
                        },
                        agent_id=agent_id,
                    )
                    continue
                # Vendor rejected max_tokens (e.g. glm-4v-flash cap 1024). Downshift once.
                _cap = _parse_max_tokens_cap(exc)
                if (
                    _cap is not None
                    and not getattr(session, "_max_tokens_downshifted", False)
                ):
                    setattr(session, "_max_tokens_downshifted", True)
                    setattr(session, "_max_tokens_override", int(_cap))
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": f"模型不支持当前 max_tokens，已降到 {_cap} 并自动重试…",
                            "severity": "warning",
                            "detector": "max_tokens_cap_retry",
                            "retryable": True,
                        },
                        agent_id=agent_id,
                    )
                    continue
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
                            tools=full_tool_pool,
                        )
                        current_system_prompt = compact_prompt
                        full_tool_pool = list(compact_tools)
                        ts_ctx = _rebuild_ts_ctx()
                        active_tools, allowed_tool_names = _project_active_tools()
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

                if fault == "context_window":
                    from agenticx.runtime.harden_flags import (
                        max_overflow_retries,
                        overflow_retry_enabled,
                    )

                    if (
                        overflow_retry_enabled()
                        and self._overflow_retries_this_turn < max_overflow_retries()
                    ):
                        hist_before = _sanitize_context_messages(session.agent_messages)
                        new_hist, did, summary, count, _pending_q = await self.compactor.maybe_compact(
                            hist_before,
                            force=True,
                            model=model_name,
                        )
                        new_hist = _sanitize_context_messages(new_hist) if did else new_hist
                        made_progress = (
                            bool(did) and len(new_hist) > 1 and len(new_hist) < len(hist_before)
                        )
                        if made_progress:
                            self._overflow_retries_this_turn += 1
                            session.agent_messages = new_hist
                            messages[:] = [
                                {"role": "system", "content": current_system_prompt},
                                *list(new_hist),
                            ]
                            try:
                                messages = _promote_user_image_attachments(
                                    messages,
                                    str(getattr(session, "provider_name", "") or ""),
                                    str(getattr(session, "model_name", "") or ""),
                                )
                            except Exception:
                                pass
                            try:
                                await self.hooks.run_on_compaction(count, summary, session)
                            except Exception:
                                pass
                            yield RuntimeEvent(
                                type=EventType.ERROR.value,
                                data={
                                    "text": (
                                        "上下文超出模型窗口，已压缩历史并重试本轮"
                                        f"（{self._overflow_retries_this_turn}/{max_overflow_retries()}）…"
                                    ),
                                    "severity": "warning",
                                    "detector": "context_overflow_compact_retry",
                                    "retryable": True,
                                },
                                agent_id=agent_id,
                            )
                            continue

                default_provider, default_model = config_default_llm_names()
                if (
                    is_model_param_compat_error(exc)
                    and should_fallback_to_default_model(
                        already_attempted=bool(
                            getattr(session, "_default_model_compat_fallback_attempted", False)
                        ),
                        current_provider=provider_name,
                        current_model=model_name,
                        default_provider=default_provider,
                        default_model=default_model,
                    )
                ):
                    setattr(session, "_default_model_compat_fallback_attempted", True)
                    session.provider_name = default_provider
                    session.model_name = default_model
                    reloaded = False
                    try:
                        reloaded = self._reload_llm_for_session(session)
                    except Exception:
                        logger.warning(
                            "failed to rebuild LLM after default-model fallback session=%s",
                            getattr(session, "session_id", ""),
                            exc_info=True,
                        )
                    if reloaded:
                        provider_name = default_provider
                        model_name = default_model
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={
                                "text": (
                                    "当前模型参数不兼容，已自动降级到默认模型 "
                                    f"{default_provider}/{default_model} 并重试…"
                                ),
                                "severity": "warning",
                                "detector": "default_model_compat_fallback",
                                "retryable": True,
                            },
                            agent_id=agent_id,
                        )
                        continue
                if fault in {"billing", "auth", "rate_limit", "context_window", "transient"}:
                    err_text = human_hint_for_fault(fault)
                else:
                    _prov = str(provider_name or "").strip() or "?"
                    _model = str(model_name or "").strip() or "?"
                    err_text = f"模型调用失败 ({_prov}/{_model}): {exc}"
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
            if _stall_patience_state(session)["attempts"] > 0:
                yield RuntimeEvent(
                    type=EventType.TOOL_PROGRESS.value,
                    data={
                        "name": "模型响应",
                        "phase": "stall_patient_recovered",
                        "tool_call_id": "",
                    },
                    agent_id=agent_id,
                )
            _reset_stall_patience(session)
            _reset_llm_timeout_retry_count(session)
            reset_provider_timeout_streak(session)
            # Preserve streamed raw before response.content overwrites the
            # accumulate buffer. Authoritative body/followups source is chosen
            # below; stream reasoning is only a bound fallback for streamed_raw.
            streamed_raw = str(followup_emitter.raw or response_text or "")
            _streamed_reasoning, _ = _split_reasoning_and_body(streamed_raw)
            final_content = _sanitize_structured_assistant_text(
                (response.content or "").strip(),
                allowed_tool_names,
            )
            response_text = final_content
            _rc_any = getattr(response, "reasoning_content", None) or getattr(
                response, "reasoning", None
            )
            _nonstream_reasoning = ""
            if isinstance(_rc_any, str) and _rc_any.strip():
                _nonstream_reasoning = _rc_any.strip()

            authoritative_source_kind = "final_content"
            authoritative_raw = final_content
            if final_content.strip():
                authoritative_source_kind = "final_content"
                authoritative_raw = final_content
                if streamed_raw.strip() and streamed_raw.strip() != final_content.strip():
                    logger.info(
                        "terminal_source_mismatch session=%s round=%s kind=final_over_stream",
                        getattr(session, "session_id", ""),
                        round_idx,
                    )
            elif streamed_raw.strip():
                authoritative_source_kind = "streamed_raw"
                authoritative_raw = streamed_raw
                response_text = streamed_raw
            else:
                authoritative_source_kind = "sync_fallback"
                authoritative_raw = ""

            parsed: ParsedAssistantOutput = parse_assistant_output(authoritative_raw)
            ac_clean = parsed.visible_body
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
                _record_round_timing(reasoning_only=False)
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
            model_finish_reason = _response_finish_reason(response)
            _fr = str(model_finish_reason or "").strip().lower()
            if (
                not tool_calls
                and not str(ac_clean or "").strip()
                and _fr in {"tool_calls", "tool_call", "function_call", "functions"}
                and not getattr(session, "_empty_tool_calls_retry_used", False)
            ):
                setattr(session, "_empty_tool_calls_retry_used", True)
                hint = (
                    "[系统通知] 上一轮 finish_reason 表明模型要调用工具，但没有收到完整可用的 tool_call。"
                    "请立即重新发出明确的 tool_call（补全所有 required 参数）；"
                    "若已无需工具，请直接给出用户可见的最终说明。"
                )
                messages.append({"role": "system", "content": hint})
                session.agent_messages.append({"role": "system", "content": hint})
                logger.info(
                    "empty_tool_calls_with_tool_finish session=%s round=%s finish_reason=%s",
                    getattr(session, "session_id", ""),
                    round_idx,
                    _fr,
                )
                yield RuntimeEvent(
                    type=EventType.ROUND_END.value,
                    data={
                        "round": round_idx,
                        "max_rounds": self.max_tool_rounds,
                        "auto_retry": True,
                        "reason": "empty_tool_calls_with_tool_finish",
                    },
                    agent_id=agent_id,
                )
                continue
            reasoning_field_final_recovered = False
            if not tool_calls and not ac_clean.strip():
                reasoning_candidate = parsed.reasoning or _nonstream_reasoning
                recovered_body = _recover_public_completion_from_reasoning(
                    reasoning_candidate,
                    has_successful_file_write=bool(disk_write_paths),
                    has_successful_tool=bool(completed_tool_names),
                    last_tool_outcome=last_tool_outcome,
                    finish_reason=model_finish_reason,
                )
                if recovered_body:
                    reasoning_field_final_recovered = True
                    parsed = ParsedAssistantOutput(
                        reasoning="",
                        visible_body=recovered_body,
                        suggested_questions=(),
                        protocol_errors=(),
                    )
                    ac_clean = recovered_body
                    response_text = recovered_body
                    logger.warning(
                        "reasoning_field_final_recovered session=%s round=%s finish_reason=%s",
                        getattr(session, "session_id", ""),
                        round_idx,
                        model_finish_reason or "unknown",
                    )
            if ac_clean.strip() and round_first_visible_at is None:
                round_first_visible_at = time.monotonic()
                if first_visible_token_ms is None:
                    first_visible_token_ms = max(
                        0,
                        int((round_first_visible_at - turn_model_started_at) * 1000),
                    )
            _record_round_timing(
                reasoning_only=not tool_calls and not ac_clean.strip()
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
            reasoning_for_tool_call = (
                _streamed_reasoning
                or _nonstream_reasoning
                or parsed.reasoning
            )
            assistant_message: Dict[str, Any] = {"role": "assistant", "content": ac_clean}
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
                assistant_message["reasoning_content"] = (
                    reasoning_for_tool_call
                    if isinstance(reasoning_for_tool_call, str) and reasoning_for_tool_call
                    else ""
                )
            session.agent_messages.append(assistant_message)
            synced_session_message_count = len(session.agent_messages)

            if not tool_calls:
                # Reasoning-only / bodyless turn: nudge, then deterministic fallback.
                # After tools have already run, allow more retries (Kimi tool-only style).
                _reason_only_budget = 3 if executed_tool_names else 1
                if (
                    not parsed.visible_body.strip()
                    and not _is_system_trigger
                    and reason_only_retry < _reason_only_budget
                ):
                    can_finalize_without_tools = (
                        round_idx == 1
                        and not executed_tool_names
                        and not reasoning_has_action_intent(
                            str(reasoning_for_tool_call or "")
                        )
                        and not _turn_has_external_context(session, user_input)
                    )
                    reason_only_retry_without_tools = can_finalize_without_tools
                    reason_only_retry += 1
                    if isinstance(reasoning_for_tool_call, str) and reasoning_for_tool_call:
                        reasoning_before_nudge = reasoning_for_tool_call
                        assistant_message["content"] = " "
                        assistant_message["reasoning_content"] = reasoning_for_tool_call
                        session.agent_messages[-1] = assistant_message
                    for protocol_error in parsed.protocol_errors:
                        if protocol_error not in reasoning_only_protocol_errors:
                            reasoning_only_protocol_errors.append(protocol_error)
                    logger.info(
                        "reason_only_retry session=%s round=%s reason=reasoning_only_empty_turn",
                        getattr(session, "session_id", ""),
                        round_idx,
                    )
                    messages.append(dict(assistant_message))
                    reasoning_only_nudge = (
                        _REASONING_ONLY_NUDGE_WITHOUT_TOOLS_HINT
                        if can_finalize_without_tools
                        else _REASONING_ONLY_NUDGE_WITH_TOOLS_HINT
                    )
                    messages.append({"role": "system", "content": reasoning_only_nudge})
                    session.agent_messages.append(
                        {"role": "system", "content": reasoning_only_nudge}
                    )
                    synced_session_message_count = len(session.agent_messages)
                    continue

                if not _is_system_trigger and truncated_final_retry < 1:
                    truncation_signal = detect_suspected_truncated_final(
                        visible_body=parsed.visible_body,
                        reasoning_text=str(reasoning_for_tool_call or ""),
                        had_tool_calls_this_round=bool(tool_calls),
                        executed_tool_names=executed_tool_names,
                        finish_reason=model_finish_reason,
                    )
                    if truncation_signal:
                        truncated_final_retry += 1
                        suspected_truncated_signal = truncation_signal
                        logger.warning(
                            "truncated_final_retry session=%s round=%s signal=%s "
                            "body_len=%s finish_reason=%s",
                            getattr(session, "session_id", ""),
                            round_idx,
                            truncation_signal,
                            len(parsed.visible_body.strip()),
                            model_finish_reason or "unknown",
                        )
                        messages.append(dict(assistant_message))
                        messages.append(
                            {"role": "system", "content": _TRUNCATED_FINAL_NUDGE_HINT}
                        )
                        session.agent_messages.append(
                            {"role": "system", "content": _TRUNCATED_FINAL_NUDGE_HINT}
                        )
                        synced_session_message_count = len(session.agent_messages)
                        continue

                if (
                    authoritative_source_kind == "sync_fallback"
                    and not authoritative_raw.strip()
                ):
                    streamed_text = ""
                    try:
                        stream_loop = asyncio.get_running_loop()

                        def _run_sync_stream_fallback(
                            stop_event: threading.Event,
                            queue_put: Callable[[Any], None],
                        ) -> None:
                            try:
                                for chunk in self.llm.stream(
                                    messages,
                                    max_tokens=_resolve_round_max_tokens(
                                        int(
                                            getattr(session, "_max_tokens_override", None)
                                            or 8192
                                        ),
                                        executed_tool_names,
                                        provider=provider_name,
                                    ),
                                    timeout=request_timeout_seconds,
                                    **_chat_temperature_kwargs(model_name, provider_name),
                                    **llm_call_kwargs,
                                ):
                                    if stop_event.is_set():
                                        break
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
                        streamed_text = ""
                    raw_tail = _sanitize_structured_assistant_text(
                        str(streamed_text or "").strip(),
                        allowed_tool_names,
                    )
                    if raw_tail:
                        authoritative_source_kind = "sync_fallback"
                        authoritative_raw = raw_tail
                        parsed = parse_assistant_output(raw_tail)
                        ac_clean = parsed.visible_body
                        if session.agent_messages and isinstance(session.agent_messages[-1], dict):
                            _last_am = session.agent_messages[-1]
                            if (
                                str(_last_am.get("role", "")).lower() == "assistant"
                                and not _last_am.get("tool_calls")
                            ):
                                _last_am["content"] = ac_clean

                if reasoning_field_final_recovered:
                    reasoning_text = ""
                elif parsed.malformed:
                    reasoning_text = ""
                else:
                    reasoning_text = (
                        parsed.reasoning
                        or _streamed_reasoning
                        or _nonstream_reasoning
                        or reasoning_before_nudge
                    )

                clean_body = parsed.visible_body
                sug_list = (
                    list(parsed.suggested_questions) if _followups_enabled else []
                )
                tool_silence_kind = ""
                if not clean_body.strip() and not _is_system_trigger:
                    sug_list = []
                    if public_tool_summaries and not unresolved_after_public_summary:
                        clean_body = "\n".join(public_tool_summaries[-3:])
                        terminal_reason = "tool_result_fallback"
                    elif executed_tool_names:
                        # Prefer the actual tool ERROR over an opaque "model silent" notice.
                        error_body = (
                            _user_facing_tool_error_fallback(messages)
                            or _user_facing_tool_error_fallback(session.agent_messages)
                        )
                        if error_body:
                            clean_body = error_body
                            tool_silence_kind = "error"
                        else:
                            clean_body = _user_facing_tool_success_silence_fallback(
                                executed_tool_names,
                                disk_write_paths,
                            )
                            tool_silence_kind = "success"
                        terminal_reason = "tool_turn_empty_fallback"
                    else:
                        clean_body = _EMPTY_RESPONSE_FALLBACK
                        terminal_reason = "empty_response_fallback"
                else:
                    if reasoning_field_final_recovered:
                        terminal_reason = "reasoning_field_final_recovered"
                    elif parsed.malformed:
                        terminal_reason = (
                            "malformed_model_final_recovered"
                        )
                    elif (
                        suspected_truncated_signal
                        and detect_suspected_truncated_final(
                            visible_body=clean_body,
                            reasoning_text=reasoning_text,
                            had_tool_calls_this_round=False,
                            executed_tool_names=executed_tool_names,
                            finish_reason=model_finish_reason,
                        )
                    ):
                        terminal_reason = "suspected_truncated_final"
                    else:
                        terminal_reason = "model_final"

                if parsed.malformed or terminal_reason != "model_final":
                    terminal_protocol_errors = list(reasoning_only_protocol_errors)
                    for protocol_error in parsed.protocol_errors:
                        if protocol_error not in terminal_protocol_errors:
                            terminal_protocol_errors.append(protocol_error)
                    logger.warning(
                        "terminal_output_recovered session=%s round=%s reason=%s "
                        "protocol_errors=%s tools=%s finish_reason=%s reasoning_chars=%s",
                        getattr(session, "session_id", ""),
                        round_idx,
                        terminal_reason,
                        terminal_protocol_errors,
                        list(dict.fromkeys(executed_tool_names))[-10:],
                        model_finish_reason or "unknown",
                        len(reasoning_text or ""),
                    )

                _rs: int | None = None
                if (
                    reasoning_text
                    and _stream_reasoning_start_ts is not None
                    and _stream_body_start_ts is not None
                ):
                    _candidate_rs = int(_stream_body_start_ts - _stream_reasoning_start_ts)
                    if _candidate_rs >= 1:
                        _rs = _candidate_rs

                _ref_list: list[dict[str, Any]] = []
                _query_list: list[str] = []
                try:
                    from agenticx.studio.references import turn_reference_payload

                    _ref_payload = turn_reference_payload(session)
                    if _ref_payload.get("references"):
                        _ref_list = list(_ref_payload["references"])
                    if _ref_payload.get("searched_queries"):
                        _query_list = list(_ref_payload["searched_queries"])
                except Exception:
                    pass

                _um = usage_metadata_from_llm_response(response)
                _usage_payload: dict[str, Any] | None = None
                if _um:
                    _usage_payload = {
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

                yield await self._finish_terminal_reply(
                    session,
                    clean_body=clean_body,
                    reasoning_text=reasoning_text if not parsed.malformed else "",
                    suggestions=sug_list,
                    reasoning_seconds=_rs,
                    references=_ref_list,
                    searched_queries=_query_list,
                    usage_metadata=_usage_payload,
                    terminal_reason=terminal_reason,
                    agent_id=agent_id,
                    is_system_trigger=_is_system_trigger,
                    terminal_metadata={
                        "model_finish_reason": model_finish_reason or "unknown",
                        "body_len": len((clean_body or "").strip()),
                        "had_tool_calls": bool(executed_tool_names),
                        "model_round_count": int(model_round_count),
                        "reasoning_only_retry_count": int(reason_only_retry),
                        "model_elapsed_ms": sum(
                            int(item.get("elapsed_ms", 0) or 0)
                            for item in round_timings
                        ),
                        "first_visible_token_ms": int(
                            first_visible_token_ms or 0
                        ),
                        "round_timings": list(
                            round_timings[: self.max_tool_rounds]
                        ),
                        **(
                            {
                                "model_finish_reason": model_finish_reason or "unknown",
                                "protocol_errors": list(
                                    dict.fromkeys(
                                        [
                                            *reasoning_only_protocol_errors,
                                            *parsed.protocol_errors,
                                        ]
                                    )
                                ),
                            }
                            if terminal_reason
                            in {
                                "empty_response_fallback",
                                "tool_turn_empty_fallback",
                                "tool_result_fallback",
                            }
                            else {}
                        ),
                        **(
                            {"tool_silence_kind": tool_silence_kind}
                            if terminal_reason == "tool_turn_empty_fallback"
                            and tool_silence_kind
                            else {}
                        ),
                        **(
                            {"truncation_signal": suspected_truncated_signal}
                            if terminal_reason == "suspected_truncated_final"
                            else {}
                        ),
                        **(
                            {"reasoning_field_final_recovered": True}
                            if reasoning_field_final_recovered
                            else {}
                        ),
                    },
                )
                return

            assistant_tool_message = {
                "role": "assistant",
                "content": ac_clean,
                "tool_calls": tool_calls,
            }
            messages.append(assistant_tool_message)
            if not _is_system_trigger and str(ac_clean or "").strip():
                _chat_history_append_deduped(
                    session.chat_history,
                    {
                        "role": "assistant",
                        "content": ac_clean,
                        "metadata": {"turn_terminal": False},
                    },
                )

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
                    # Emit TOOL_CALL first so the desktop client has a pending card to merge
                    # the denied result into, rather than falling back to a bare bubble.
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
                        data={
                            "text": invalid_message,
                            "tool_call_id": tool_call_id,
                            "is_error": True,
                        },
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={
                            "name": tool_name,
                            "result": invalid_message,
                            "tool_call_id": tool_call_id,
                            "is_error": True,
                        },
                        agent_id=agent_id,
                    )
                    _record_tool_turn_outcome("failed")
                    continue
                # Policy deny + allowlist before hooks / confirm (align CC deny > hook ask).
                perm_deny = tool_denied_by_session_permissions(tool_name)
                if perm_deny:
                    denied_message = perm_deny
                    # Emit TOOL_CALL first so the desktop client has a pending card to merge
                    # the denied result into, rather than falling back to a bare bubble.
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
                        data={
                            "text": denied_message,
                            "tool_call_id": tool_call_id,
                            "is_error": True,
                        },
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={
                            "name": tool_name,
                            "result": denied_message,
                            "tool_call_id": tool_call_id,
                            "is_error": True,
                        },
                        agent_id=agent_id,
                    )
                    _record_tool_turn_outcome("failed")
                    continue
                if tool_name not in allowed_tool_names:
                    if is_tool_pending_next_round(
                        ts_ctx,
                        tool_name,
                        allowed_tool_names=allowed_tool_names,
                        full_openai_tools=full_tool_pool,
                    ):
                        denied_message = auto_load_deferred_tool(session, ts_ctx, tool_name)
                    else:
                        denied_message = f"工具 '{tool_name}' 不在当前允许列表中，已拒绝执行。"
                    # Emit TOOL_CALL first so the desktop client has a pending card to merge
                    # the denied/auto-loaded result into, rather than falling back to a bare bubble.
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
                        data={
                            "text": denied_message,
                            "tool_call_id": tool_call_id,
                            "is_error": True,
                        },
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={
                            "name": tool_name,
                            "result": denied_message,
                            "tool_call_id": tool_call_id,
                            "is_error": True,
                        },
                        agent_id=agent_id,
                    )
                    _record_tool_turn_outcome("failed")
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
                    _record_tool_turn_outcome("failed")
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
                            yield await self._finish_terminal_reply(
                                session,
                                clean_body=final_text,
                                terminal_reason="status_query_budget",
                                agent_id=agent_id,
                                is_system_trigger=_is_system_trigger,
                            )
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
                            yield await self._finish_terminal_reply(
                                session,
                                clean_body=final_text,
                                terminal_reason="status_query_cooldown",
                                agent_id=agent_id,
                                is_system_trigger=_is_system_trigger,
                            )
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
                            yield await self._finish_terminal_reply(
                                session,
                                clean_body=final_text,
                                terminal_reason="status_query_repeat",
                                agent_id=agent_id,
                                is_system_trigger=_is_system_trigger,
                            )
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
                            yield await self._finish_terminal_reply(
                                session,
                                clean_body=final_text,
                                terminal_reason="status_query_throttled",
                                agent_id=agent_id,
                                is_system_trigger=_is_system_trigger,
                            )
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
                            runtime_tool_context=ts_ctx,
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
                _note_public_tool_summary(tool_name, raw_result)
                _record_tool_turn_outcome(
                    _classify_tool_turn_outcome(tool_name, raw_result),
                    tool_name,
                )
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
                ok_flag = _tool_result_ok_flag(result)
                if ok_flag is True:
                    # Meta tools (create_avatar, delegate_to_avatar, ...) return
                    # {"ok": true}; a confirmed success must count as progress.
                    logical_progress = True
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
                    _success_digest = _build_loop_halt_success_digest(session)
                    halt_prompt = (
                        "[system-halt] 运行时检测到连续工具调用无进展，已自动停止重试。\n"
                        f"触发原因：{loop_issue.message}\n"
                        f"【用户原始请求】{_original_task_snippet}\n"
                        "【本轮已确认完成的事实】（以下工具调用已成功返回，属于已完成事项，不得描述为失败或无进展）：\n"
                        f"{_success_digest or '（无）'}\n"
                        "⚠️ 严格要求：回答必须紧扣上面的【用户原始请求】，不得切换、发明或扩展到任何其它话题（例如不要自行转为配置教程、产品对比等与原始请求无关的主题）。\n"
                        "请用中文 3-6 句直接对用户说明：\n"
                        "1) 若【本轮已确认完成的事实】非空，必须先明确告知这些事项已经成功完成；\n"
                        "2) 再说明本轮为何被自动停止（如后续重复调用已存在的对象等）以及尚未完成的部分；\n"
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
                                    max_tokens=800,
                                    timeout=request_timeout_seconds,
                                    **_chat_temperature_kwargs(model_name, provider_name),
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
                    synced_session_message_count = len(session.agent_messages)
                    yield await self._finish_terminal_reply(
                        session,
                        clean_body=summary_text,
                        terminal_reason="loop_halt",
                        agent_id=agent_id,
                        is_system_trigger=_is_system_trigger,
                        extra_final={
                            "loop_halt": True,
                            "detector": loop_issue.detector,
                        },
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
