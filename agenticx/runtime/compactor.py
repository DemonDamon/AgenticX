#!/usr/bin/env python3
"""Context compactor for long-horizon agent sessions.

Supports token-aware triggers, forced mid-turn compaction, micro-compaction of
tool results, session-memory extraction, and consecutive-failure circuit breaker.

Provider 无关是本模块的硬约束，不是待办
==========================================

compaction 必须在任何 provider 上都能跑——GLM、DeepSeek、Kimi、Qwen、Gemini，
不是 Anthropic 一家。以下能力因此**有意不做**：

- ``cache_edits``（Anthropic 私有 API）：在 provider 端删旧 tool result 而不改消息
  字节。只走 Anthropic 的 harness 能用它；主栈用不上，塞进来等于为一个 provider
  引入一层别的 provider 跑不了的路径。

- server-side context management（Anthropic context-1beta）：让 provider 自己在
  input_tokens 超阈值时清 thinking / tool uses。同样 Anthropic-only。

prune 改原文（mutation）是**有意选择**
---------------------------------------
prune 把旧 tool result 文本物理改写成 ``PRUNE_MARKER``，本地丢失原文。这不是不知
道"投影模式"（本地留 L0 原文、发 API 前投影成带 marker 的 L1 视图），而是因为：

1. token 压力触发下被 prune 的东西确实不需要了——阈值 2000 chars，只在窗口到
   0.8 时才动，丢掉本地副本的代价不大；
2. mutation 零运行时开销，投影是每轮发请求都要做的 O(N) 复制；
3. 投影的真正收益在"主动 prune"（不等压力就来投影）和"审计可回溯"两个场景，
   这两个需求目前都没到。将来做 L0/L1 分离（trace + 审计 + compaction 一起）
   时，prune 的投影规则只是 L1 上多一条规则，自然落地。

在那之前不要为了"先进"引入 Anthropic-only 的路径。

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from agenticx.runtime import compaction_journal as _journal
from agenticx.runtime.model_context_window import resolve_context_window

_log = logging.getLogger(__name__)

_MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

DEFAULT_THRESHOLD_MESSAGES = 200
DEFAULT_THRESHOLD_CHARS = 200_000
#: 摘要调用要预留多少 token。
#:
#: 从 20_000 降到 4_000：摘要现在**重放会话自己的前缀**（system prompt + 工具表 +
#: 被遮蔽区间的原文），新增的只有那条压缩指令和 400 token 的输出，前缀本身走的是
#: provider 的热缓存。原来那个 20k 是按"另起一个完整 prompt"估的，现在不成立了。
#: 这一项留着是因为它仍然是小窗口上的绝对安全网（见 _compute_autocompact_threshold）。
DEFAULT_SUMMARY_RESERVE_TOKENS = 4_000
DEFAULT_COMPACT_BUFFER_TOKENS = 13_000

#: 主触发规则：估算 token 达到 window 的这个比例就压缩。
#:
#: 原来只有"window − reserve − buffer"这条绝对式，跨窗口尺寸的表现差得离谱：128k 上
#: 是 0.74，32k 上只有 0.34，256k 上却到 0.87。比例式跨尺寸一致，绝对式退化成小窗口
#: 上的安全网（两者取更紧的那个，所以只会更早压缩，不会更晚）。
DEFAULT_COMPACT_TRIGGER_RATIO = 0.80

#: 保留多少：最近这个比例的 window 值得原样留着。
#:
#: 按 **token** 算而不是按消息条数。条数对不同形态的历史意义完全不同——8 条纯文本对话
#: 和 8 条塞满工具结果的消息差两个数量级，而窗口压力只认 token。
DEFAULT_RETAIN_SURFACE_RATIO = 0.16

#: 压力剪枝的预算。**必须比入库预算更紧才有意义**：
#: micro_compact_tool_result 在工具结果入库时就已经截到 AGX_MICRO_COMPACT_BUDGET
#: （默认 4000 字符），所以照搬一个 8192 的阈值会一条都命中不了、白跑一趟。
DEFAULT_PRUNE_THRESHOLD_CHARS = 2_000
DEFAULT_PRUNE_HEAD_CHARS = 1_200
DEFAULT_PRUNE_TAIL_CHARS = 400
PRUNE_MARKER = "\n\n[... 工具结果中段已剪除，需要完整内容请重新调用该工具 ...]\n\n"

#: 剪枝独自解除压力时的 trigger_reason。剪枝**不是摘要**：消息还在原位，只是过大的
#: 工具结果被剪掉了中段，所以调用方不能拿它当摘要来播报。
TOOL_RESULT_PRUNE_REASON = "tool_result_prune"


def prune_only_summary(pruned_messages: int, pruned_chars: int) -> str:
    """剪枝独自解除压力时的说明文案（既进 COMPACTION 事件也进可见通知）。"""
    return f"剪除了 {int(pruned_messages)} 条过大的工具结果（约 {int(pruned_chars)} 字符），未做摘要。"


def is_prune_only_result(did_compact: bool, compacted_count: int) -> bool:
    """``maybe_compact`` 的返回值是否表示"只剪枝、没摘要"。

    只看返回值、不读 ``last_trigger_reason``：后者是实例上的可变状态，两次调用之间
    会被覆盖，而返回值是调用方自己那一次的事实。
    """
    return bool(did_compact) and int(compacted_count) == 0

# Legacy char-proxy hints (escape-hatch / AGX_CONTEXT_WINDOW_CHARS only; not full-compact primary).
_MODEL_CONTEXT_CHARS_HINT: Dict[str, int] = {
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4-turbo": 128_000,
    "o1": 200_000,
    "o3": 200_000,
    "claude-3-5-sonnet": 200_000,
    "claude-sonnet-4": 200_000,
    "deepseek": 64_000,
    "glm-4": 128_000,
    "glm-5": 128_000,
}


def _env_int(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return default


def _env_float(key: str, default: float) -> float:
    raw = os.environ.get(key)
    if raw is None or not str(raw).strip():
        return default
    try:
        return float(str(raw).strip())
    except ValueError:
        return default


def _env_autocompact_pct() -> Optional[float]:
    raw = os.environ.get("AGX_AUTOCOMPACT_PCT", "").strip()
    if not raw:
        return None
    try:
        pct = float(raw)
    except ValueError:
        return None
    if 0.50 <= pct <= 0.99:
        return pct
    return None


def _compact_query_data_source_result(result: str, budget: int) -> str:
    """Trim time-series ``data`` arrays while preserving attribution and warnings."""
    text = str(result or "")
    if len(text) <= budget:
        return text
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    if not isinstance(parsed, dict):
        return text
    data = parsed.get("data")
    if not isinstance(data, list) or len(data) <= 10:
        return text
    original_len = len(data)
    head = data[:5]
    tail = data[-5:]
    parsed["data"] = head + [{"_truncated": f"... {original_len - 10} rows omitted ..."}] + tail
    warnings = parsed.get("warnings")
    if not isinstance(warnings, list):
        warnings = []
    warnings = list(warnings)
    warnings.append(f"data array truncated from {original_len} to 10 rows for context budget")
    parsed["warnings"] = warnings
    compact = json.dumps(parsed, ensure_ascii=False, default=str)
    if len(compact) <= budget:
        return compact
    return text


def _stringify_message(msg: Dict[str, Any]) -> str:
    role = str(msg.get("role", "unknown"))
    content = str(msg.get("content", ""))
    return f"[{role}] {content}".strip()


def _message_text_for_tokens(msg: Dict[str, Any]) -> str:
    parts: List[str] = []
    c = msg.get("content")
    if isinstance(c, str):
        parts.append(c)
    elif isinstance(c, list):
        for block in c:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
    tcs = msg.get("tool_calls")
    if isinstance(tcs, list):
        for tc in tcs:
            if isinstance(tc, dict):
                parts.append(json.dumps(tc, ensure_ascii=False))
    return "\n".join(parts)


_HARD_CONSTRAINT_PATTERNS = (
    re.compile(r"(必须[^。；\n]{0,120})"),
    re.compile(r"(不要[^。；\n]{0,120})"),
    re.compile(r"(始终[^。；\n]{0,120})"),
    re.compile(r"(must\s+[^.;\n]{0,120})", re.I),
    re.compile(r"(never\s+[^.;\n]{0,120})", re.I),
    re.compile(r"(always\s+[^.;\n]{0,120})", re.I),
)


class ContextCompactor:
    """Compact older conversation history into a short summary block.

    Full autocompact is primarily driven by model context-window token usage
    (shared ``resolve_context_window``). Message-count / char thresholds are
    escape hatches only.
    """

    def __init__(
        self,
        llm: Any,
        *,
        threshold_messages: Optional[int] = None,
        threshold_chars: Optional[int] = None,
        retain_recent_messages: int = 8,
        token_compact_ratio: float = DEFAULT_COMPACT_TRIGGER_RATIO,
    ) -> None:
        self.llm = llm
        if threshold_messages is None:
            threshold_messages = _env_int(
                "AGX_COMPACT_THRESHOLD_MESSAGES",
                DEFAULT_THRESHOLD_MESSAGES,
            )
        if threshold_chars is None:
            threshold_chars = _env_int(
                "AGX_COMPACT_THRESHOLD_CHARS",
                DEFAULT_THRESHOLD_CHARS,
            )
        self.threshold_messages = max(8, int(threshold_messages))
        self.threshold_chars = max(4_000, int(threshold_chars))
        self.retain_recent_messages = max(4, retain_recent_messages)
        # 主触发比例。这个字段以前挂着"deprecated / 不被使用"，现在它就是
        # _compute_autocompact_threshold 的主规则。
        self.token_compact_ratio = min(0.99, max(0.5, token_compact_ratio))
        self._consecutive_failures = 0
        self._tiktoken_encoder: Any = None
        self.last_trigger_reason: str = ""
        #: 上一次摘要是否用上了前缀重放（没用上说明回落到了单条 prompt）。
        self.last_summary_replayed_prefix: bool = False
        self._last_est_tokens: int = 0
        self._last_threshold: int = 0
        self._last_window: int = 0
        # Rolling compaction cooldown: after a successful compaction, require a
        # minimum growth in tail messages before compacting again, unless token
        # usage is already critically high.
        self.min_new_messages_after_compact = _env_int(
            "AGX_COMPACT_MIN_NEW_MESSAGES",
            6,
        )

    def _get_tiktoken_encoder(self) -> Any:
        if self._tiktoken_encoder is not None:
            return self._tiktoken_encoder
        try:
            import tiktoken

            self._tiktoken_encoder = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self._tiktoken_encoder = False
        return self._tiktoken_encoder

    def _estimate_token_usage(self, messages: Sequence[Dict[str, Any]]) -> int:
        enc = self._get_tiktoken_encoder()
        text = "\n".join(_message_text_for_tokens(m) for m in messages if isinstance(m, dict))
        if enc:
            try:
                return len(enc.encode(text))
            except Exception:
                pass
        return max(1, int(len(text) / 3.5))

    @staticmethod
    def _resolve_context_window_tokens(model: str, declared: Optional[int] = None) -> int:
        """Token-window limit shared with Desktop/Studio Context chip."""
        return int(resolve_context_window(model or None, declared))

    def _get_context_window_chars(self, model: str, declared: Optional[int] = None) -> int:
        """Legacy char proxy; not used for full-compact primary trigger."""
        window_tokens = self._resolve_context_window_tokens(model, declared)
        default_chars = _env_int("AGX_CONTEXT_WINDOW_CHARS", window_tokens * 4)
        m = (model or "").strip().lower()
        if not m:
            return default_chars
        for key, val in _MODEL_CONTEXT_CHARS_HINT.items():
            if key in m:
                return val * 4
        return default_chars

    def _compute_autocompact_threshold(self, window: int) -> int:
        """``min(window × ratio, window − reserve − buffer)``，env 只能再收紧。

        两条规则取更紧的那个：

        * **比例式**（主）跨窗口尺寸表现一致，是 routedContextWindow × 0.8。
        * **绝对式**（网）在小窗口上仍然要留够绝对余量——32k 窗口留 20% 只有 6.4k，
          不够摘要调用周转。

        取 min 而不是取其一，保证这条性质不变：任何配置只能让压缩**更早**发生，不会
        更晚。
        """
        window = max(1024, int(window))
        summary_reserve = _env_int(
            "AGX_COMPACT_SUMMARY_RESERVE_TOKENS",
            DEFAULT_SUMMARY_RESERVE_TOKENS,
        )
        buffer = _env_int("AGX_COMPACT_BUFFER_TOKENS", DEFAULT_COMPACT_BUFFER_TOKENS)
        effective = max(1024, window - min(summary_reserve, max(1, window // 4)))
        threshold = min(
            max(1, int(window * self.token_compact_ratio)),
            max(1, effective - buffer),
        )
        pct = _env_autocompact_pct()
        if pct is not None:
            # Only allow earlier compaction (tighter threshold), never later.
            threshold = min(threshold, max(1, int(effective * pct)))
        return max(1, int(threshold))

    def _retained_token_budget(self, window: int) -> int:
        """原样保留多少 token 的尾巴。"""
        ratio = _env_float("AGX_COMPACT_RETAIN_RATIO", DEFAULT_RETAIN_SURFACE_RATIO)
        ratio = min(0.6, max(0.02, ratio))
        return max(512, int(max(1024, int(window)) * ratio))

    def _token_threshold_exceeded(
        self,
        messages: Sequence[Dict[str, Any]],
        model: str,
        declared: Optional[int] = None,
    ) -> bool:
        if not messages:
            return False
        window = self._resolve_context_window_tokens(model, declared)
        threshold = self._compute_autocompact_threshold(window)
        est_tokens = self._estimate_token_usage(messages)
        self._last_window = window
        self._last_threshold = threshold
        self._last_est_tokens = est_tokens
        return est_tokens >= threshold

    def _should_compact_by_tokens(
        self,
        messages: Sequence[Dict[str, Any]],
        model: str,
        declared: Optional[int] = None,
    ) -> bool:
        """Backward-compatible alias for token-window primary trigger."""
        return self._token_threshold_exceeded(messages, model, declared)

    @staticmethod
    def _has_compacted_prefix(messages: Sequence[Dict[str, Any]]) -> bool:
        if not messages:
            return False
        first = messages[0]
        if not isinstance(first, dict):
            return False
        if str(first.get("role", "")).strip().lower() != "system":
            return False
        return "[compacted]" in str(first.get("content", "") or "")

    @classmethod
    def _split_compacted_messages(
        cls,
        messages: Sequence[Dict[str, Any]],
    ) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
        if cls._has_compacted_prefix(messages):
            prefix = messages[0] if isinstance(messages[0], dict) else None
            tail = [m for m in messages[1:] if isinstance(m, dict)]
            return prefix, tail
        return None, [m for m in messages if isinstance(m, dict)]

    @staticmethod
    def _extract_compacted_summary_text(compact_block: Dict[str, Any]) -> str:
        content = str(compact_block.get("content", "") or "")
        marker = "[compacted]"
        idx = content.find(marker)
        if idx < 0:
            return content.strip()[:1500]
        after_marker = content[idx:]
        parts = after_marker.split("\n", 1)
        if len(parts) < 2:
            return ""
        return parts[1].strip()[:1500]

    def _should_compact_with_reason(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        model: str = "",
        force: bool = False,
        declared_context_window: Optional[int] = None,
    ) -> Tuple[bool, str]:
        if force:
            return True, "force"
        _prefix, tail = self._split_compacted_messages(messages)
        # After a prior compaction, only the post-summary tail decides whether to
        # roll forward — the compact block itself must not re-trigger every turn.
        eval_msgs: List[Dict[str, Any]]
        if _prefix is not None:
            eval_msgs = list(tail)
        else:
            eval_msgs = [m for m in messages if isinstance(m, dict)]
        if len(eval_msgs) <= self.retain_recent_messages:
            return False, ""

        total_chars = sum(
            len(_message_text_for_tokens(item))
            for item in eval_msgs
            if isinstance(item, dict)
        )
        token_hit = self._token_threshold_exceeded(eval_msgs, model, declared_context_window)

        if _prefix is not None:
            min_tail_before_recompact = self.retain_recent_messages + max(
                1, self.min_new_messages_after_compact
            )
            if len(eval_msgs) <= min_tail_before_recompact:
                if token_hit:
                    return True, "cooldown_token_escape"
                # Keep a hard escape hatch for unusually verbose tails.
                if total_chars > self.threshold_chars * 2:
                    return True, "char_escape"
                return False, ""

        if token_hit:
            return True, "token_window"
        if len(eval_msgs) > self.threshold_messages:
            return True, "message_escape"
        if total_chars > self.threshold_chars:
            return True, "char_escape"
        return False, ""

    def _should_compact(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        model: str = "",
        declared_context_window: Optional[int] = None,
    ) -> bool:
        should, reason = self._should_compact_with_reason(
            messages,
            model=model,
            force=False,
            declared_context_window=declared_context_window,
        )
        if should:
            self.last_trigger_reason = reason
        return should

    def _tail_split_by_tokens(
        self,
        items: Sequence[Dict[str, Any]],
        retain_tokens: int,
    ) -> int:
        """从尾巴往前走，凑够 ``retain_tokens`` 为止，返回切点下标。

        按 token 而不是条数：8 条纯文本对话和 8 条塞满工具结果的消息差两个数量级，
        而窗口压力只认 token。仍然至少保留 ``retain_recent_messages`` 条，免得一条
        巨大的工具结果就把整段对话的上下文吃光。
        """
        used = 0
        index = len(items)
        while index > 0:
            used += self._estimate_token_usage([items[index - 1]])
            index -= 1
            if used >= retain_tokens:
                break
        floor = max(0, len(items) - self.retain_recent_messages)
        return min(index, floor)

    def _split_for_compaction(
        self,
        working: Sequence[Dict[str, Any]],
        *,
        retain_tokens: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Split working history without orphan tool rows at the retain boundary.

        ``retain_tokens`` 给了就按 token 走尾巴，否则回落到按条数（老行为，供不知道
        窗口大小的调用方使用）。
        """
        items = [m for m in working if isinstance(m, dict)]
        retain_n = self.retain_recent_messages
        if len(items) <= retain_n:
            return [], list(items)

        split_at = len(items) - retain_n
        if retain_tokens is not None:
            by_tokens = self._tail_split_by_tokens(items, retain_tokens)
            # by_tokens == 0 表示整段历史都还没到保留预算。token 触发时这本来就不该
            # 发生（阈值 0.8 远大于保留 0.16），但我们的触发器不止 token 一种：条数、
            # 字符数、以及 force 都会走到这里。那些情况下按 token 保留会变成"什么都
            # 不压"，所以回落到按条数——决定了要压就得真的压掉点什么。
            if by_tokens > 0:
                split_at = by_tokens

        # Never start retained segment with a tool message (assistant owner was compacted away).
        while split_at > 0 and str(items[split_at].get("role", "")).strip().lower() == "tool":
            split_at -= 1

        # If split lands on assistant+tool_calls, include contiguous tool responses in retained.
        if split_at < len(items) and str(items[split_at].get("role", "")).strip().lower() == "assistant":
            tool_calls = items[split_at].get("tool_calls") or []
            if tool_calls:
                j = split_at + 1
                while j < len(items) and str(items[j].get("role", "")).strip().lower() == "tool":
                    j += 1
                group_len = j - split_at
                if group_len > retain_n:
                    split_at = max(0, j - retain_n)
                    while split_at > 0 and str(items[split_at].get("role", "")).strip().lower() == "tool":
                        split_at -= 1

        to_compact = list(items[:split_at])
        retained = list(items[split_at:])
        return to_compact, retained

    # ---- 压力剪枝（无模型） ------------------------------------------------
    #
    # 摘要要花一次 LLM 调用，而且是在上下文最大的时候花。所以先跑一遍确定性的剪枝，
    # 重新计量；压力解除了就完全跳过摘要。
    #
    # 和 DeepSeek Harness 那版的区别有两处，都是被我们自己的形态逼出来的：
    #
    # 1. 阈值必须比**入库**预算更紧。micro_compact_tool_result 在工具结果进历史时就
    #    截到 4000 字符了，照搬一个 8192 的阈值一条都命中不了。
    # 2. **从旧往新剪，够了就停**，而不是把整个 surface 扫一遍。我们保留的尾巴是按
    #    token 算的连续区间，把最近那几条工具结果也剪掉等于自己削自己的近期上下文；
    #    从旧的开始剪，最近的能留多久留多久。

    _PRUNE_EXEMPT_TOOLS = frozenset({"show_widget", "query_data_source"})

    @classmethod
    def _prune_one_tool_message(
        cls,
        message: Dict[str, Any],
        *,
        threshold: int,
        head: int,
        tail: int,
    ) -> Optional[Dict[str, Any]]:
        """剪一条工具消息；不需要剪或不能剪时返回 ``None``。"""
        if str(message.get("role", "")).strip().lower() != "tool":
            return None
        name = str(message.get("name", "") or "").strip().lower()
        if name in cls._PRUNE_EXEMPT_TOOLS:
            # 结构化载荷截断之后不是"内容变少"，是渲染直接坏掉。
            return None
        content = message.get("content")
        if not isinstance(content, str) or len(content) <= threshold:
            return None
        if PRUNE_MARKER in content:
            return None  # 已经剪过，别越剪越碎
        pruned = dict(message)
        pruned["content"] = content[:head] + PRUNE_MARKER + content[-tail:]
        return pruned

    def prune_tool_results(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        target_tokens: Optional[int] = None,
        stop_when: Optional[Any] = None,
        threshold_chars: Optional[int] = None,
        head_chars: Optional[int] = None,
        tail_chars: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], int, int]:
        """确定性地剪除过大的工具结果中段，从旧往新。

        Args:
            target_tokens: 降到这个估算值以下就停手。``None`` 表示能剪的都剪。
            stop_when: 收当前消息列表、返回"可以停了"的判据。比 ``target_tokens``
                更准，因为触发压缩的不止 token 一条——字符数、消息条数都会触发，只
                盯着 token 停手会出现"剪了 0 条然后照样去摘要"。给了它就以它为准。

        Returns:
            ``(新消息列表, 剪掉的条数, 剪掉的字符数)``。
        """
        threshold = int(
            threshold_chars
            if threshold_chars is not None
            else _env_int("AGX_COMPACT_PRUNE_THRESHOLD_CHARS", DEFAULT_PRUNE_THRESHOLD_CHARS)
        )
        head = int(
            head_chars
            if head_chars is not None
            else _env_int("AGX_COMPACT_PRUNE_HEAD_CHARS", DEFAULT_PRUNE_HEAD_CHARS)
        )
        tail = int(
            tail_chars
            if tail_chars is not None
            else _env_int("AGX_COMPACT_PRUNE_TAIL_CHARS", DEFAULT_PRUNE_TAIL_CHARS)
        )
        # 剪完必须真的更小，否则就是白改一遍还让历史更难读。
        if head + len(PRUNE_MARKER) + tail >= threshold:
            return list(messages), 0, 0

        out = [m for m in messages if isinstance(m, dict)]
        pruned_count = 0
        chars_removed = 0
        def _relieved() -> bool:
            if stop_when is not None:
                try:
                    return bool(stop_when(out))
                except Exception:
                    return False
            if target_tokens is None:
                return False
            return self._estimate_token_usage(out) <= target_tokens

        for index, message in enumerate(out):
            if _relieved():
                break
            replacement = self._prune_one_tool_message(
                message, threshold=threshold, head=head, tail=tail
            )
            if replacement is None:
                continue
            chars_removed += len(message["content"]) - len(replacement["content"])
            out[index] = replacement
            pruned_count += 1
        return out, pruned_count, chars_removed

    def micro_compact_tool_result(self, tool_name: str, result: str, budget: Optional[int] = None) -> str:
        """Condense verbose tool results preserving head/tail."""
        name = str(tool_name or "").strip().lower()
        # Widget payloads are structured JSON + SVG/HTML; truncation breaks UI rendering.
        if name == "show_widget":
            return str(result or "")
        if name == "query_data_source":
            # Time-series data must stay complete for chart rendering: a
            # truncated OHLCV array both breaks the widget and triggers the
            # model to re-query in a loop. Give it a much larger dedicated
            # budget so a full 60–120 day window survives intact; only very
            # large payloads fall back to head/tail truncation.
            if budget is None:
                budget = _env_int("AGX_DATA_SOURCE_RESULT_BUDGET", 24000)
            return _compact_query_data_source_result(str(result or ""), budget)
        if budget is None:
            budget = _env_int("AGX_MICRO_COMPACT_BUDGET", 4000)
        text = str(result or "")
        if len(text) <= budget:
            return text
        head_len = max(200, budget // 3)
        tail_len = max(200, budget // 3)
        meta = f"[micro-compact tool={tool_name} original_chars={len(text)}]"
        return (
            f"{meta}\n"
            f"{text[:head_len]}\n"
            f"... truncated ({len(text) - head_len - tail_len} chars omitted) ...\n"
            f"{text[-tail_len:]}"
        )

    def _extract_pending_user_question(
        self, messages_to_compact: Sequence[Dict[str, Any]]
    ) -> str:
        """Extract the most recent user message that has not been fully answered (FR-5).

        Reverse scan messages to find the most recent user message where:
        - After the user message, there are only tool / assistant-with-tool_calls
        - No final assistant text response (role=assistant without tool_calls)

        Returns:
            The user query text if found, empty string otherwise.
            Result is capped at 4000 chars.
        """
        # Track if we've seen a "final" assistant response (without tool_calls)
        # while scanning backwards. If we see one before finding a user,
        # that means all users are answered.
        seen_final_assistant = False
        pending_question = ""

        for idx in range(len(messages_to_compact) - 1, -1, -1):
            msg = messages_to_compact[idx]
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role", "")).strip()

            if role == "assistant":
                tcs = msg.get("tool_calls")
                if not tcs:  # Final assistant text response - marks that previous user was answered
                    seen_final_assistant = True
                # If assistant has tool_calls, it doesn't answer the user - continue scanning
                continue

            if role == "user":
                if not seen_final_assistant:
                    # This user message has no final assistant response after it
                    content = str(msg.get("content", "") or "").strip()
                    if content:
                        pending_question = content[:4000]  # Cap at 4000 chars per FR-5
                        return pending_question  # Return the most recent unanswered user
                else:
                    # We found a user, but there was a final assistant after it
                    # This user was answered, so we stop scanning
                    return ""

        return pending_question

    def _extract_session_memory(self, messages_to_compact: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
        memory: Dict[str, Any] = {
            "files_modified": [],
            "errors_encountered": [],
            "key_decisions": [],
            "tools_used_summary": {},
            "pending_user_question": "",  # FR-5: Track pending user question
        }
        decision_kw = re.compile(
            r"(决定|采用|选择|方案|结论|放弃|取消|优先|必须|不要)",
            re.I,
        )
        files_set: set[str] = set()
        errors: List[str] = []
        decisions: List[str] = []
        tools_count: Dict[str, int] = {}

        for msg in messages_to_compact:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role", "")).strip()
            if role == "assistant":
                t = str(msg.get("content", "")).strip()
                if t and decision_kw.search(t) and len(t) < 400:
                    decisions.append(t[:300])
            if role == "tool":
                body = str(msg.get("content", ""))
                name = str(msg.get("name", "") or "")
                tools_count[name] = tools_count.get(name, 0) + 1
                if "ERROR:" in body or body.lstrip().startswith("ERROR"):
                    errors.append(f"{name}: {body[:200]}")
                for pat in ("OK: wrote ", "OK: edited "):
                    if pat in body:
                        part = body.split(pat, 1)[-1].split("\n", 1)[0].strip()
                        if part:
                            files_set.add(part[:500])
            tcs = msg.get("tool_calls")
            if isinstance(tcs, list):
                for tc in tcs:
                    if not isinstance(tc, dict):
                        continue
                    fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                    tname = str(fn.get("name", "") or "").strip()
                    if not tname:
                        continue
                    tools_count[tname] = tools_count.get(tname, 0) + 1
                    if tname in {"file_write", "file_edit"}:
                        try:
                            args = fn.get("arguments", "")
                            if isinstance(args, str):
                                parsed = json.loads(args) if args.strip().startswith("{") else {}
                            elif isinstance(args, dict):
                                parsed = args
                            else:
                                parsed = {}
                            p = str(parsed.get("path", "") or "").strip()
                            if p:
                                files_set.add(p[:500])
                        except Exception:
                            pass

        memory["files_modified"] = sorted(files_set)[:30]
        memory["errors_encountered"] = errors[:20]
        memory["key_decisions"] = decisions[:15]
        memory["tools_used_summary"] = dict(sorted(tools_count.items(), key=lambda x: -x[1])[:40])
        # FR-5: Extract pending user question
        memory["pending_user_question"] = self._extract_pending_user_question(messages_to_compact)
        return memory

    def _build_compaction_prompt(
        self,
        messages_to_compact: Optional[Sequence[Dict[str, Any]]],
        *,
        memory_prefix: str = "",
    ) -> str:
        # FR-A.1: Prompt 改为不暴露任何 [xxx] 形式的占位标签名给模型，
        # 避免弱模型（minimax-m2.x、glm-4-flash 等）误把它当成需要原样复述的
        # XML/HTML 标签并幻觉出 `[/xxx]` 闭合，从而污染后续上下文。
        lines = [
            "请将以下多条历史对话压缩成一段精炼摘要，用于后续推理。",
            "要求：",
            "1. 仅输出摘要正文，不要复述本指令、不要输出任何形如 `[xxx]` 或 `[/xxx]` 的标签。",
            "2. 必须逐字保留用户硬约束，尤其含有「必须 / 不要 / 始终 / must / never / always」的原句片段。",
            "3. 摘要必须覆盖：用户目标与硬约束、关键文件路径、错误与已尝试修复、当前进度与下一步、"
            "以及用户最近一条尚未被完整回答的原始问题（若存在）。",
            "4. 同时保留：用户完整指令、任务模板、约束规则、已执行操作、进度追踪、当前状态。",
            "5. 输出中文，长度控制在 400 字以内，使用条目式，不要写客套话或解释。",
            "",
        ]
        if memory_prefix:
            lines.append(memory_prefix)
            lines.append("")
        if messages_to_compact is None:
            # 重放形态：被遮蔽区间的原文已经作为真实消息在请求里了，这里只留指令。
            return "\n".join(lines).rstrip() + "\n\n请压缩本次对话中位于本条指令之前的全部内容。"
        lines.append("原始上下文：")
        for item in messages_to_compact:
            lines.append(_stringify_message(item))
        return "\n".join(lines)

    @staticmethod
    def _sanitize_summary_text(text: str) -> str:
        """Strip hallucinated `[xxx] ... [/xxx]` style wrappers from summary.

        FR-A.2: 部分弱模型会把 prompt 中提到的标签名（即便我们已经避免暴露）
        或自己幻觉的 `[pending_user_question]` 等，当成 XML 标签输出并配对
        `[/xxx]` 闭合标签。这里**仅剥外壳**：
        - 若整段被 `[/.../]` 包裹且内部完全等于 prompt 自身的指令文本，则丢弃；
        - 若内部含有真实摘要内容，则保留内部内容、剥掉外壳标签；
        - 多次迭代直到稳定。
        """
        if not text:
            return text
        # 已知的 prompt-leak 关键词：内部内容若主要是这类指令文本，整块视为污染。
        leak_keywords = (
            "请将以下对话压缩",
            "请将以下多条历史对话压缩",
            "压缩成用于后续推理",
            "must preserve",
            "highest priority",
        )
        # 形如 [tag] ... [/tag]，tag 由字母/数字/下划线/连字符组成
        wrapper_re = re.compile(
            r"\[(?P<tag>[A-Za-z][A-Za-z0-9_\-]*)\](?P<inner>[\s\S]*?)\[/(?P=tag)\]"
        )
        previous = None
        current = text
        # 上限 5 次防止极端嵌套死循环
        for _ in range(5):
            if previous == current:
                break
            previous = current

            def _replace(match: re.Match) -> str:
                inner = match.group("inner").strip()
                # 若内部主要是 prompt 自身的指令，整块丢弃
                if inner and any(kw in inner for kw in leak_keywords):
                    return ""
                # 否则只剥掉外壳标签，保留内部真实内容
                return inner

            current = wrapper_re.sub(_replace, current)
        # 再清理掉残留的孤立闭合标签（模型偶尔只给一半）
        current = re.sub(r"\[/[A-Za-z][A-Za-z0-9_\-]*\]", "", current)
        return current.strip()

    @staticmethod
    def _extract_hard_constraints(messages_to_compact: Sequence[Dict[str, Any]]) -> List[str]:
        """Extract user hard constraints for summary fidelity checks."""
        found: List[str] = []
        for msg in messages_to_compact:
            if not isinstance(msg, dict):
                continue
            if str(msg.get("role", "")).strip().lower() != "user":
                continue
            text = str(msg.get("content", "") or "")
            for pattern in _HARD_CONSTRAINT_PATTERNS:
                for match in pattern.findall(text):
                    item = str(match).strip()
                    if item and item not in found:
                        found.append(item)
        return found[:12]

    @staticmethod
    def _summary_keeps_constraints(summary: str, constraints: Sequence[str]) -> bool:
        if not constraints:
            return True
        summary_text = str(summary or "")
        for item in constraints:
            if item not in summary_text:
                return False
        return True

    def _build_summary_request(
        self,
        messages_to_compact: Sequence[Dict[str, Any]],
        *,
        memory_prefix: str,
        system_prompt: str,
        window: int,
    ) -> Tuple[List[Dict[str, Any]], bool]:
        """摘要请求的消息列表；第二个返回值表示是否用上了前缀重放。

        重放形态是：**会话自己的 system prompt + 被遮蔽区间的原文 + 一条压缩指令**。

        这么排是为了吃 provider 的热前缀缓存。原来的写法是另起一个 ``[{"role":
        "user", "content": <把整段历史序列化成一个大字符串>}]`` —— 前缀和真实请求
        完全不同，于是在**上下文最大的那一刻**必然全量重算。而被遮蔽区间本来就是真实
        对话的前缀，原样重放就能命中已经缓存的部分，新增的只有末尾那条指令。

        重放放不下时（典型是 provider 报了 context overflow 才强制压缩的情况）回落到
        老的单条 prompt 形态：那时缓存已经无所谓了，能算出摘要才是要紧的。
        """
        directive = self._build_compaction_prompt(None, memory_prefix=memory_prefix)
        replay: List[Dict[str, Any]] = []
        if system_prompt:
            replay.append({"role": "system", "content": system_prompt})
        replay.extend(dict(m) for m in messages_to_compact if isinstance(m, dict))
        replay.append({"role": "user", "content": directive})
        # 留出摘要输出的余量再判；差一点点就整段回落不划算。
        if self._estimate_token_usage(replay) + 600 <= max(1024, int(window)):
            return replay, True
        prompt = self._build_compaction_prompt(messages_to_compact, memory_prefix=memory_prefix)
        return [{"role": "user", "content": prompt}], False

    async def _invoke_summary(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        tools: Optional[Sequence[Dict[str, Any]]],
        max_tokens: int,
    ) -> Any:
        """调一次摘要。带上工具表——它是热前缀的一部分，去掉反而对不上缓存。"""
        kwargs: Dict[str, Any] = {"temperature": 0.0, "max_tokens": max_tokens}
        if tools:
            kwargs["tools"] = list(tools)
        try:
            return await asyncio.to_thread(self.llm.invoke, list(messages), **kwargs)
        except TypeError:
            if not tools:
                raise
            # provider 不认 tools=：宁可丢掉缓存对齐，也不能让摘要整个失败。
            kwargs.pop("tools", None)
            return await asyncio.to_thread(self.llm.invoke, list(messages), **kwargs)

    async def _summarize(
        self,
        messages_to_compact: Sequence[Dict[str, Any]],
        memory_prefix: str = "",
        *,
        system_prompt: str = "",
        tools: Optional[Sequence[Dict[str, Any]]] = None,
        window: int = 0,
    ) -> str:
        hard_constraints = self._extract_hard_constraints(messages_to_compact)
        request, replayed = self._build_summary_request(
            messages_to_compact,
            memory_prefix=memory_prefix,
            system_prompt=system_prompt,
            window=window or self._last_window or 128_000,
        )
        self.last_summary_replayed_prefix = replayed
        prompt = self._build_compaction_prompt(messages_to_compact, memory_prefix=memory_prefix)
        try:
            response = await self._invoke_summary(request, tools=tools, max_tokens=400)
            text = str(getattr(response, "content", "") or "").strip()
            text = self._sanitize_summary_text(text)
            if text and hard_constraints and (not self._summary_keeps_constraints(text, hard_constraints)):
                base_directive = str(request[-1].get("content", "")) if request else prompt
                retry_prompt = (
                    base_directive
                    + "\n\n补充要求：你刚才遗漏了用户硬约束。请重写摘要，并逐字包含以下片段：\n"
                    + "\n".join(f"- {item}" for item in hard_constraints)
                )
                retry_request = [*request[:-1], {"role": "user", "content": retry_prompt}]
                retry_resp = await self._invoke_summary(
                    retry_request, tools=tools, max_tokens=500
                )
                retry_text = str(getattr(retry_resp, "content", "") or "").strip()
                retry_text = self._sanitize_summary_text(retry_text)
                if retry_text and self._summary_keeps_constraints(retry_text, hard_constraints):
                    text = retry_text
                else:
                    snippets = [_stringify_message(item)[:160] for item in messages_to_compact[-12:]]
                    text = "；".join(snippets)[:700]
            if text:
                self._consecutive_failures = 0
                return text
            self._consecutive_failures += 1
        except Exception as exc:
            _log.warning("context compaction LLM call failed: %s", exc)
            self._consecutive_failures += 1
        snippets = [_stringify_message(item)[:160] for item in messages_to_compact[-12:]]
        return "；".join(snippets)[:700]

    def _process_lock_for(self, session: Any) -> asyncio.Lock:
        """同一进程内、同一会话的压缩互斥锁。

        和 ``compaction_journal`` 的文件锁不冲突，两者管的是不同的事：文件锁管**跨进程**
        和崩溃后的孤儿检测，这把锁管**同进程并发**。少了它，两个协程同时进 maybe_compact
        时文件锁只会互相"接管"（各记一条 warning 就放行），但两份摘要会打架——
        ``session.agent_messages`` 留下最后写的那份，另一份遮蔽掉的原文就永久丢了，
        而且是静默的。当前调用点碰巧是串行的，但"碰巧串行"是调用方的事实，不是这里的不变量。

        注意这把锁只保证两次压缩**不交错**，不会把等锁期间变陈旧的 ``messages`` 快照
        重新基线化——调用方传进来的是它自己那一份快照。
        """
        try:
            loop: Any = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        holder: Any = self if session is None else session
        attr = "_agx_compaction_lock"
        current = getattr(holder, attr, None)
        # 记住创建时的 loop：asyncio.Lock 在首次 await 时绑定 loop，跨 loop 复用会炸。
        # 生产里一个会话只活在一个 loop 上，但测试里 asyncio.run 会换 loop。
        if isinstance(current, tuple) and len(current) == 2 and current[0] is loop:
            return current[1]
        lock = asyncio.Lock()
        try:
            setattr(holder, attr, (loop, lock))
        except Exception:
            # session 不让写属性（__slots__ 之类）：退化成不互斥，但不能因此炸掉压缩。
            _log.debug("cannot cache compaction lock on session; falling back to unlocked")
        return lock

    async def maybe_compact(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        force: bool = False,
        model: str = "",
        declared_context_window: Optional[int] = None,
        session: Any = None,
        system_prompt: str = "",
        tools: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> Tuple[List[Dict[str, Any]], bool, str, int, str]:
        """Compact old messages and return compacted messages.

        Returns:
            (new_messages, did_compact, summary, compacted_count, pending_question)
        """
        async with self._process_lock_for(session):
            return await self._maybe_compact_body(
                messages,
                force=force,
                model=model,
                declared_context_window=declared_context_window,
                session=session,
                system_prompt=system_prompt,
                tools=tools,
            )

    async def _maybe_compact_body(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        force: bool,
        model: str,
        declared_context_window: Optional[int],
        session: Any,
        system_prompt: str,
        tools: Optional[Sequence[Dict[str, Any]]],
    ) -> Tuple[List[Dict[str, Any]], bool, str, int, str]:
        copied = [m for m in messages if isinstance(m, dict)]
        compact_block, tail = self._split_compacted_messages(copied)
        working = tail if compact_block is not None else copied
        if len(working) <= self.retain_recent_messages:
            self.last_trigger_reason = ""
            return copied, False, "", 0, ""

        should, reason = self._should_compact_with_reason(
            copied,
            model=model,
            force=force,
            declared_context_window=declared_context_window,
        )
        if not should:
            self.last_trigger_reason = ""
            return copied, False, "", 0, ""
        self.last_trigger_reason = reason

        if not force and self._consecutive_failures >= _MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES:
            _log.warning(
                "skipping auto compaction: %s consecutive failures",
                self._consecutive_failures,
            )
            return copied, False, "", 0, ""

        # 从这里开始动真格：先记账建锁，最后才释放。中途崩溃留下的是一个可检测的
        # 孤儿锁，而不是"看起来已经压完了"——压缩是破坏性的，把真实历史换成摘要之后
        # 那段原文就找不回来了，得让下一次启动看得见出过事。
        lock = _journal.begin(session, trigger=self.last_trigger_reason)
        try:
            return await self._compact_locked(
                copied,
                working,
                compact_block,
                lock=lock,
                force=force,
                model=model,
                declared_context_window=declared_context_window,
                system_prompt=system_prompt,
                tools=tools,
            )
        except Exception:
            _journal.end(lock, outcome="failed")
            raise

    async def _compact_locked(
        self,
        copied: List[Dict[str, Any]],
        working: List[Dict[str, Any]],
        compact_block: Optional[Dict[str, Any]],
        *,
        lock: Any,
        force: bool,
        model: str,
        declared_context_window: Optional[int],
        system_prompt: str,
        tools: Optional[Sequence[Dict[str, Any]]],
    ) -> Tuple[List[Dict[str, Any]], bool, str, int, str]:
        window = self._resolve_context_window_tokens(model, declared_context_window)
        threshold = self._compute_autocompact_threshold(window)

        # 第一步：无模型的确定性剪枝。摘要要花一次 LLM 调用，而且正好花在上下文最大的
        # 时候——能不花就别花。
        def _no_longer_needs_compaction(candidate: List[Dict[str, Any]]) -> bool:
            if force:
                # 强制压缩（provider 已经报了 overflow）不设早停：这时候能少多少是多少。
                return False
            should, _reason = self._should_compact_with_reason(
                candidate,
                model=model,
                force=False,
                declared_context_window=declared_context_window,
            )
            return not should

        pruned_all, pruned_n, pruned_chars = self.prune_tool_results(
            copied, stop_when=_no_longer_needs_compaction
        )
        if pruned_n:
            copied = pruned_all
            # 剪枝改的是消息内容不是结构，所以重新切一次已压缩前缀就够了。
            compact_block, tail = self._split_compacted_messages(copied)
            working = tail if compact_block is not None else copied

        # 第二步：重新计量。压力已经解除就完全跳过摘要。
        if pruned_n and _no_longer_needs_compaction(copied):
            self.last_trigger_reason = TOOL_RESULT_PRUNE_REASON
            _log.info(
                "context_compaction resolved_by_prune pruned=%s chars=%s est_tokens=%s threshold=%s",
                pruned_n,
                pruned_chars,
                self._estimate_token_usage(copied),
                threshold,
            )
            _journal.end(
                lock, outcome="pruned", pruned_messages=pruned_n, pruned_chars=pruned_chars
            )
            return (
                copied,
                True,
                prune_only_summary(pruned_n, pruned_chars),
                0,
                "",
            )

        to_compact, retained = self._split_for_compaction(
            working, retain_tokens=self._retained_token_budget(window)
        )
        if not to_compact:
            self.last_trigger_reason = TOOL_RESULT_PRUNE_REASON if pruned_n else ""
            _journal.end(
                lock,
                outcome="pruned" if pruned_n else "nothing-to-compact",
                pruned_messages=pruned_n,
            )
            if not pruned_n:
                return copied, False, "", 0, ""
            # 这条路径同样是"剪了但没摘要"，必须带上说明——否则调用方拿到空 summary，
            # 只能回落到通用的"已压缩 0 条"，正是要修掉的那句误导文案。
            return copied, True, prune_only_summary(pruned_n, pruned_chars), 0, ""
        compacted_count = len(to_compact)
        _log.info(
            "context_compaction trigger_reason=%s est_tokens=%s threshold=%s window=%s compacted_count=%s",
            self.last_trigger_reason,
            self._last_est_tokens,
            self._last_threshold,
            self._last_window,
            compacted_count,
        )
        memory = self._extract_session_memory(to_compact)

        # FR-6: Extract pending user question (hard-coded at top of content)
        pending_question = memory.get("pending_user_question", "")

        # NFR-7: Structured logging for compactor pending question
        if pending_question:
            _log.info(
                "compactor_pending_question_kept=true chars=%d",
                len(pending_question),
            )

        # Avoid duplicating pending_user_question in [session_memory] block:
        # it's already hard-coded at the top via [user-pending-question] line.
        memory_for_prefix = {k: v for k, v in memory.items() if k != "pending_user_question"}
        try:
            memory_json = json.dumps(memory_for_prefix, ensure_ascii=False)
        except Exception:
            memory_json = str(memory_for_prefix)
        prior_summary_prefix = ""
        if compact_block is not None:
            prior_text = self._extract_compacted_summary_text(compact_block)
            if prior_text:
                prior_summary_prefix = f"[prior_compacted_summary]\n{prior_text[:1200]}\n\n"
        memory_prefix = f"{prior_summary_prefix}[session_memory]{memory_json[:1800]}"
        summary = await self._summarize(
            to_compact,
            memory_prefix=memory_prefix,
            system_prompt=system_prompt,
            tools=tools,
            window=window,
        )

        # FR-6: Build compacted message with pending question hard-coded at top
        content_parts = []
        if pending_question:
            content_parts.append(f"[user-pending-question] {pending_question}")
            content_parts.append("")
        content_parts.append(memory_prefix)
        content_parts.append("")
        content_parts.append(f"[compacted] 已压缩 {compacted_count} 条历史消息，以下为摘要：")
        content_parts.append(summary)

        compacted_message = {
            "role": "system",
            "content": "\n\n".join(content_parts),
        }
        _journal.end(
            lock,
            outcome="summarized",
            compacted_count=compacted_count,
            pruned_messages=pruned_n,
            replayed_prefix=self.last_summary_replayed_prefix,
        )
        return [compacted_message, *retained], True, summary, compacted_count, pending_question
