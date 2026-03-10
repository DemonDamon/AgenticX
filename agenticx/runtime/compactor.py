#!/usr/bin/env python3
"""Context compactor for long-horizon agent sessions."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Sequence, Tuple


def _stringify_message(msg: Dict[str, Any]) -> str:
    role = str(msg.get("role", "unknown"))
    content = str(msg.get("content", ""))
    return f"[{role}] {content}".strip()


class ContextCompactor:
    """Compact older conversation history into a short summary block."""

    def __init__(
        self,
        llm: Any,
        *,
        threshold_messages: int = 20,
        threshold_chars: int = 48_000,
        retain_recent_messages: int = 8,
    ) -> None:
        self.llm = llm
        self.threshold_messages = max(8, threshold_messages)
        self.threshold_chars = max(4_000, threshold_chars)
        self.retain_recent_messages = max(4, retain_recent_messages)

    def _should_compact(self, messages: Sequence[Dict[str, Any]]) -> bool:
        if len(messages) > self.threshold_messages:
            return True
        total_chars = sum(len(str(item.get("content", ""))) for item in messages)
        return total_chars > self.threshold_chars

    def _build_compaction_prompt(self, messages_to_compact: Sequence[Dict[str, Any]]) -> str:
        lines = [
            "请将以下对话压缩成用于后续推理的精炼上下文。",
            "必须包含：关键决策、关键工具结果、关键文件改动、当前待办与风险。",
            "输出中文，长度控制在 400 字以内，使用条目式。",
            "",
            "原始上下文：",
        ]
        for item in messages_to_compact:
            lines.append(_stringify_message(item))
        return "\n".join(lines)

    async def _summarize(self, messages_to_compact: Sequence[Dict[str, Any]]) -> str:
        prompt = self._build_compaction_prompt(messages_to_compact)
        try:
            response = await asyncio.to_thread(
                self.llm.invoke,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=400,
            )
            text = str(getattr(response, "content", "") or "").strip()
            if text:
                return text
        except Exception:
            pass
        # Fallback when summarization model call fails.
        snippets = [_stringify_message(item)[:160] for item in messages_to_compact[-12:]]
        return "；".join(snippets)[:700]

    async def maybe_compact(
        self,
        messages: Sequence[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], bool, str, int]:
        """Compact old messages and return compacted messages.

        Returns:
            (new_messages, did_compact, summary, compacted_count)
        """
        copied = list(messages)
        if not self._should_compact(copied):
            return copied, False, "", 0
        if len(copied) <= self.retain_recent_messages:
            return copied, False, "", 0
        compacted_count = len(copied) - self.retain_recent_messages
        to_compact = copied[:compacted_count]
        retained = copied[compacted_count:]
        summary = await self._summarize(to_compact)
        compacted_message = {
            "role": "system",
            "content": (
                f"[compacted] 已压缩 {compacted_count} 条历史消息，以下为摘要：\n"
                f"{summary}"
            ),
        }
        return [compacted_message, *retained], True, summary, compacted_count
