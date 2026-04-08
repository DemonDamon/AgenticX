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

    def _should_compact(
        self,
        messages: Sequence[Dict[str, Any]],
        *,
        model: str = "",
    ) -> bool:
        if model and self._should_compact_by_tokens(messages, model):
            return True
        if len(messages) > self.threshold_messages:
            return True
        total_chars = sum(len(_message_text_for_tokens(item)) for item in messages if isinstance(item, dict))
        return total_chars > self.threshold_chars

    def micro_compact_tool_result(self, tool_name: str, result: str, budget: Optional[int] = None) -> str:
        """Condense verbose tool results preserving head/tail."""
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

    def _extract_session_memory(self, messages_to_compact: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
        memory: Dict[str, Any] = {
            "files_modified": [],
            "errors_encountered": [],
            "key_decisions": [],
            "tools_used_summary": {},
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
        return memory

    def _build_compaction_prompt(
        self,
        messages_to_compact: Sequence[Dict[str, Any]],
        *,
        memory_prefix: str = "",
    ) -> str:
        lines = [
            "请将以下对话压缩成用于后续推理的精炼上下文。",
            "必须包含：关键决策、关键工具结果、关键文件改动、当前待办与风险。",
            "输出中文，长度控制在 400 字以内，使用条目式。",
            "",
        ]
        if memory_prefix:
            lines.append(memory_prefix)
            lines.append("")
        lines.append("原始上下文：")
        for item in messages_to_compact:
            lines.append(_stringify_message(item))
        return "\n".join(lines)

    async def _summarize(self, messages_to_compact: Sequence[Dict[str, Any]], memory_prefix: str = "") -> str:
        prompt = self._build_compaction_prompt(messages_to_compact, memory_prefix=memory_prefix)
        try:
            response = await asyncio.to_thread(
                self.llm.invoke,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=400,
            )
            text = str(getattr(response, "content", "") or "").strip()
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
    ) -> Tuple[List[Dict[str, Any]], bool, str, int]:
        """Compact old messages and return compacted messages.

        Returns:
            (new_messages, did_compact, summary, compacted_count)
        """
        copied = [m for m in messages if isinstance(m, dict)]
        if len(copied) <= self.retain_recent_messages:
            return copied, False, "", 0

        should = force or self._should_compact(copied, model=model)
        if not should:
            return copied, False, "", 0

        if not force and self._consecutive_failures >= _MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES:
            _log.warning(
                "skipping auto compaction: %s consecutive failures",
                self._consecutive_failures,
            )
            return copied, False, "", 0

        compacted_count = len(copied) - self.retain_recent_messages
        to_compact = copied[:compacted_count]
        retained = copied[compacted_count:]
        memory = self._extract_session_memory(to_compact)
        try:
            memory_json = json.dumps(memory, ensure_ascii=False)
        except Exception:
            memory_json = str(memory)
        memory_prefix = f"[session_memory]{memory_json[:1800]}"
        summary = await self._summarize(to_compact, memory_prefix=memory_prefix)

        compacted_message = {
            "role": "system",
            "content": (
                f"{memory_prefix}\n\n"
                f"[compacted] 已压缩 {compacted_count} 条历史消息，以下为摘要：\n"
                f"{summary}"
            ),
        }
        return [compacted_message, *retained], True, summary, compacted_count
