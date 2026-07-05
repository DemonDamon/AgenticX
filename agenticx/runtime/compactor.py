#!/usr/bin/env python3
"""Context compactor for long-horizon agent sessions.

Supports token-aware triggers, forced mid-turn compaction, micro-compaction of
tool results, session-memory extraction, and consecutive-failure circuit breaker.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

_log = logging.getLogger(__name__)

_MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

# Rough context window limits (chars used as proxy when model unknown).
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
    """Compact older conversation history into a short summary block."""

    def __init__(
        self,
        llm: Any,
        *,
        threshold_messages: int = 20,
        threshold_chars: int = 48_000,
        retain_recent_messages: int = 8,
        token_compact_ratio: float = 0.80,
    ) -> None:
        self.llm = llm
        self.threshold_messages = max(8, threshold_messages)
        self.threshold_chars = max(4_000, threshold_chars)
        self.retain_recent_messages = max(4, retain_recent_messages)
        self.token_compact_ratio = min(0.99, max(0.5, token_compact_ratio))
        self._consecutive_failures = 0
        self._tiktoken_encoder: Any = None
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

    def _get_context_window_chars(self, model: str) -> int:
        default_chars = _env_int("AGX_CONTEXT_WINDOW_CHARS", 96_000)
        m = (model or "").strip().lower()
        if not m:
            return default_chars
        for key, val in _MODEL_CONTEXT_CHARS_HINT.items():
            if key in m:
                return val * 4
        return default_chars

    def _should_compact_by_tokens(self, messages: Sequence[Dict[str, Any]], model: str) -> bool:
        if not messages:
            return False
        limit_chars = self._get_context_window_chars(model)
        est_tokens = self._estimate_token_usage(messages)
        limit_tokens = max(1024, int(limit_chars / 4))
        return est_tokens > limit_tokens * self.token_compact_ratio

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

    def _should_compact(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        model: str = "",
    ) -> bool:
        _prefix, tail = self._split_compacted_messages(messages)
        # After a prior compaction, only the post-summary tail decides whether to
        # roll forward — the compact block itself must not re-trigger every turn.
        eval_msgs = tail if _prefix is not None else messages
        if len(eval_msgs) <= self.retain_recent_messages:
            return False
        if _prefix is not None:
            min_tail_before_recompact = self.retain_recent_messages + max(
                1, self.min_new_messages_after_compact
            )
            if len(eval_msgs) <= min_tail_before_recompact:
                if model and self._should_compact_by_tokens(eval_msgs, model):
                    return True
                total_chars = sum(
                    len(_message_text_for_tokens(item))
                    for item in eval_msgs
                    if isinstance(item, dict)
                )
                # Keep a hard escape hatch for unusually verbose tails.
                if total_chars > self.threshold_chars * 2:
                    return True
                return False
        if model and self._should_compact_by_tokens(eval_msgs, model):
            return True
        if len(eval_msgs) > self.threshold_messages:
            return True
        total_chars = sum(len(_message_text_for_tokens(item)) for item in eval_msgs if isinstance(item, dict))
        return total_chars > self.threshold_chars

    def _split_for_compaction(
        self,
        working: Sequence[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Split working history without orphan tool rows at the retain boundary."""
        items = [m for m in working if isinstance(m, dict)]
        retain_n = self.retain_recent_messages
        if len(items) <= retain_n:
            return [], list(items)

        split_at = len(items) - retain_n

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
        messages_to_compact: Sequence[Dict[str, Any]],
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
            "3. 摘要必须覆盖 8 类信息：用户完整指令、任务模板、约束规则、已执行操作、错误与修复记录、进度追踪、当前状态、下一步动作。",
            "4. 输出中文，长度控制在 400 字以内，使用条目式，不要写客套话或解释。",
            "",
        ]
        if memory_prefix:
            lines.append(memory_prefix)
            lines.append("")
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

    async def _summarize(self, messages_to_compact: Sequence[Dict[str, Any]], memory_prefix: str = "") -> str:
        hard_constraints = self._extract_hard_constraints(messages_to_compact)
        prompt = self._build_compaction_prompt(messages_to_compact, memory_prefix=memory_prefix)
        try:
            response = await asyncio.to_thread(
                self.llm.invoke,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=400,
            )
            text = str(getattr(response, "content", "") or "").strip()
            text = self._sanitize_summary_text(text)
            if text and hard_constraints and (not self._summary_keeps_constraints(text, hard_constraints)):
                retry_prompt = (
                    prompt
                    + "\n\n补充要求：你刚才遗漏了用户硬约束。请重写摘要，并逐字包含以下片段：\n"
                    + "\n".join(f"- {item}" for item in hard_constraints)
                )
                retry_resp = await asyncio.to_thread(
                    self.llm.invoke,
                    [{"role": "user", "content": retry_prompt}],
                    temperature=0.0,
                    max_tokens=500,
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

    async def maybe_compact(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        force: bool = False,
        model: str = "",
    ) -> Tuple[List[Dict[str, Any]], bool, str, int, str]:
        """Compact old messages and return compacted messages.

        Returns:
            (new_messages, did_compact, summary, compacted_count, pending_question)
        """
        copied = [m for m in messages if isinstance(m, dict)]
        compact_block, tail = self._split_compacted_messages(copied)
        working = tail if compact_block is not None else copied
        if len(working) <= self.retain_recent_messages:
            return copied, False, "", 0, ""

        should = force or self._should_compact(copied, model=model)
        if not should:
            return copied, False, "", 0, ""

        if not force and self._consecutive_failures >= _MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES:
            _log.warning(
                "skipping auto compaction: %s consecutive failures",
                self._consecutive_failures,
            )
            return copied, False, "", 0, ""

        to_compact, retained = self._split_for_compaction(working)
        if not to_compact:
            return copied, False, "", 0, ""
        compacted_count = len(to_compact)
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
        summary = await self._summarize(to_compact, memory_prefix=memory_prefix)

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
        return [compacted_message, *retained], True, summary, compacted_count, pending_question
