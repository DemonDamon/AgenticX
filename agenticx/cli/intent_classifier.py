#!/usr/bin/env python3
"""Intent classifier for studio conversational routing.

Author: Damon Li
"""

from __future__ import annotations

from enum import Enum
import re
from typing import Optional

from agenticx.llms.base import BaseLLMProvider


class IntentType(str, Enum):
    """Supported user intents in studio."""

    GENERATE_CODE = "GENERATE_CODE"
    MODIFY_CODE = "MODIFY_CODE"
    CHAT = "CHAT"
    QUESTION = "QUESTION"
    UNCLEAR = "UNCLEAR"


class IntentClassifier:
    """Two-layer classifier: rule-based first, then LLM fallback."""

    _GENERATE_KEYWORDS = (
        "创建",
        "新建",
        "生成",
        "写一个",
        "搭建",
        "实现",
        "开发",
        "build",
        "create",
        "generate",
        "scaffold",
        "bootstrap",
        "from scratch",
    )
    _MODIFY_KEYWORDS = (
        "修改",
        "加一个",
        "加上",
        "改一下",
        "改成",
        "调整",
        "优化",
        "增加",
        "添加",
        "补充",
        "扩展",
        "完善",
        "修复",
        "重构",
        "update",
        "change",
        "modify",
        "add",
        "improve",
        "enhance",
        "extend",
        "refactor",
        "fix",
    )
    _QUESTION_KEYWORDS = (
        "是什么",
        "什么是",
        "怎么",
        "如何",
        "为什么",
        "区别",
        "支持哪些",
        "如何使用",
        "介绍",
        "解释",
        "是什么",
        "what is",
        "how to",
        "why",
        "difference",
        "explain",
        "support",
        "supported",
        "llm",
    )
    _CODE_KEYWORDS = (
        "代码",
        "python",
        "agent",
        "workflow",
        "skill",
        "tool",
        "函数",
        "脚本",
        "类",
    )

    _LLM_INTENT_MAP = {
        "GENERATE": IntentType.GENERATE_CODE,
        "GENERATE_CODE": IntentType.GENERATE_CODE,
        "MODIFY": IntentType.MODIFY_CODE,
        "MODIFY_CODE": IntentType.MODIFY_CODE,
        "CHAT": IntentType.CHAT,
        "QUESTION": IntentType.QUESTION,
        "UNCLEAR": IntentType.UNCLEAR,
    }

    def __init__(self, provider: Optional[BaseLLMProvider] = None):
        self.provider = provider

    def classify_intent(self, text: str) -> IntentType:
        """Classify user input into studio intent type."""
        normalized = text.strip()
        if not normalized:
            return IntentType.UNCLEAR
        if normalized.startswith("/"):
            return IntentType.UNCLEAR

        lowered = normalized.lower()
        if self._contains_keyword(lowered, self._QUESTION_KEYWORDS):
            return IntentType.QUESTION
        if self._contains_keyword(lowered, self._GENERATE_KEYWORDS):
            return IntentType.GENERATE_CODE
        if self._contains_keyword(lowered, self._MODIFY_KEYWORDS):
            return IntentType.MODIFY_CODE

        has_code_keyword = self._contains_keyword(lowered, self._CODE_KEYWORDS)
        if len(normalized) < 6 and not has_code_keyword:
            return IntentType.CHAT
        if normalized.endswith(("?", "？")) and not has_code_keyword:
            return IntentType.CHAT

        if self.provider is None:
            return IntentType.UNCLEAR
        return self._classify_by_llm(normalized)

    @staticmethod
    def _contains_keyword(text: str, keywords: tuple[str, ...]) -> bool:
        return any(keyword in text for keyword in keywords)

    def _classify_by_llm(self, text: str) -> IntentType:
        messages = [
            {
                "role": "system",
                "content": "你是意图分类器，只输出一个词：GENERATE/MODIFY/CHAT/QUESTION/UNCLEAR",
            },
            {"role": "user", "content": text},
        ]
        try:
            response = self.provider.invoke(messages, temperature=0)
        except Exception:
            return IntentType.UNCLEAR
        return self._parse_llm_intent(response.content)

    def _parse_llm_intent(self, raw: str) -> IntentType:
        """Parse LLM output token into a supported intent."""
        normalized = raw.strip().upper()
        if not normalized:
            return IntentType.UNCLEAR

        tokens = re.findall(r"[A-Z_]+", normalized)
        for token in tokens:
            mapped = self._map_llm_token(token)
            if mapped is not None:
                return mapped

        compact = re.sub(r"[^A-Z_]", "", normalized)
        mapped = self._map_llm_token(compact)
        if mapped is not None:
            return mapped

        return IntentType.UNCLEAR

    def _map_llm_token(self, token: str) -> Optional[IntentType]:
        if not token:
            return None
        if token in self._LLM_INTENT_MAP:
            return self._LLM_INTENT_MAP[token]
        if token.startswith("GENERATE"):
            return IntentType.GENERATE_CODE
        if token.startswith("MODIFY"):
            return IntentType.MODIFY_CODE
        if token.startswith("QUESTION"):
            return IntentType.QUESTION
        if token.startswith("CHAT"):
            return IntentType.CHAT
        if token.startswith("UNCLEAR"):
            return IntentType.UNCLEAR
        return None
