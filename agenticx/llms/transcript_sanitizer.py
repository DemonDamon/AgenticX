#!/usr/bin/env python3
"""Provider-aware transcript sanitization.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List
import re


@dataclass
class TranscriptPolicy:
    provider: str
    enforce_turn_alternation: bool = False
    merge_consecutive_user_turns: bool = False
    sanitize_tool_schema: bool = False
    strip_refusal_triggers: bool = False


PROVIDER_POLICIES: Dict[str, TranscriptPolicy] = {
    "anthropic": TranscriptPolicy(
        provider="anthropic",
        enforce_turn_alternation=True,
        merge_consecutive_user_turns=True,
        strip_refusal_triggers=True,
    ),
    "google": TranscriptPolicy(
        provider="google",
        enforce_turn_alternation=True,
        sanitize_tool_schema=True,
    ),
    "openai": TranscriptPolicy(provider="openai"),
    "ollama": TranscriptPolicy(provider="ollama"),
}


class TranscriptSanitizer:
    """Run minimal transcript hygiene before each LLM call."""

    REFUSAL_PATTERNS = [
        re.compile(r"\bdo\s+not\s+answer\b", re.IGNORECASE),
        re.compile(r"\brefuse\b", re.IGNORECASE),
        re.compile(r"\bpolicy\s+violation\b", re.IGNORECASE),
    ]

    def sanitize(self, messages: List[Dict[str, Any]], provider: str) -> List[Dict[str, Any]]:
        policy = self._resolve_policy(provider)
        result = self._drop_invalid_roles(messages)

        if policy.strip_refusal_triggers:
            result = self._strip_refusal_triggers(result)
        if policy.merge_consecutive_user_turns:
            result = self._merge_consecutive_user_turns(result)
        if policy.enforce_turn_alternation:
            result = self._enforce_turn_alternation(result)
        if policy.sanitize_tool_schema:
            result = self._sanitize_tool_schema(result)
        return result

    def _resolve_policy(self, provider: str) -> TranscriptPolicy:
        p = provider.lower()
        for key, policy in PROVIDER_POLICIES.items():
            if key in p:
                return policy
        return TranscriptPolicy(provider=provider)

    def _drop_invalid_roles(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        allowed = {"system", "user", "assistant", "tool"}
        return [m for m in messages if m.get("role") in allowed and "content" in m]

    def _strip_refusal_triggers(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        sanitized: List[Dict[str, Any]] = []
        for msg in messages:
            content = str(msg.get("content", ""))
            for pattern in self.REFUSAL_PATTERNS:
                content = pattern.sub("", content)
            cloned = dict(msg)
            cloned["content"] = content.strip()
            sanitized.append(cloned)
        return sanitized

    def _merge_consecutive_user_turns(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not messages:
            return messages
        merged: List[Dict[str, Any]] = []
        for msg in messages:
            if merged and merged[-1].get("role") == "user" and msg.get("role") == "user":
                merged[-1]["content"] = f"{merged[-1].get('content', '')}\n{msg.get('content', '')}".strip()
            else:
                merged.append(dict(msg))
        return merged

    def _enforce_turn_alternation(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not messages:
            return messages
        fixed: List[Dict[str, Any]] = [messages[0]]
        for msg in messages[1:]:
            if msg.get("role") == fixed[-1].get("role"):
                continue
            fixed.append(msg)
        return fixed

    def _sanitize_tool_schema(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        cleaned: List[Dict[str, Any]] = []
        for msg in messages:
            cloned = dict(msg)
            if "tools" in cloned and isinstance(cloned["tools"], list):
                normalized = []
                for tool in cloned["tools"]:
                    if not isinstance(tool, dict):
                        continue
                    normalized.append(
                        {
                            "name": tool.get("name", "unknown_tool"),
                            "description": tool.get("description", ""),
                            "parameters": tool.get("parameters", {}),
                        }
                    )
                cloned["tools"] = normalized
            cleaned.append(cloned)
        return cleaned
