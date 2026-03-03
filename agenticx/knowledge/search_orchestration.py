#!/usr/bin/env python3
"""Knowledge search orchestration with force/intent modes.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, List, Optional

from agenticx.knowledge.document import Document
from agenticx.knowledge.knowledge import Knowledge


class KnowledgeRecognitionMode(str, Enum):
    """Knowledge recognition strategy."""

    FORCE = "force"
    INTENT = "intent"


@dataclass
class KnowledgeSearchResult:
    documents: List[Document]
    query_used: str
    mode: KnowledgeRecognitionMode
    intent_detected: bool


class KnowledgeSearchOrchestrator:
    """Orchestrates KB search behavior based on configured recognition mode."""

    DEFAULT_INTENT_PROMPT = (
        "You are deciding if knowledge base search is needed.\n"
        "User message: {message}\n"
        "Reply with XML: <need_search>true</need_search> or "
        "<need_search>false</need_search>"
    )

    def __init__(
        self,
        knowledge: Knowledge,
        mode: KnowledgeRecognitionMode = KnowledgeRecognitionMode.FORCE,
        llm_provider: Optional[Any] = None,
        intent_prompt_template: Optional[str] = None,
    ) -> None:
        self.knowledge = knowledge
        self.mode = mode
        self.llm_provider = llm_provider
        self.intent_prompt_template = intent_prompt_template or self.DEFAULT_INTENT_PROMPT

    async def search(
        self,
        user_message: str,
        top_k: int = 5,
    ) -> KnowledgeSearchResult:
        if self.mode == KnowledgeRecognitionMode.FORCE:
            docs = await self.knowledge.search(user_message, limit=top_k)
            return KnowledgeSearchResult(
                documents=docs,
                query_used=user_message,
                mode=KnowledgeRecognitionMode.FORCE,
                intent_detected=True,
            )

        if self.llm_provider is None:
            docs = await self.knowledge.search(user_message, limit=top_k)
            return KnowledgeSearchResult(
                documents=docs,
                query_used=user_message,
                mode=KnowledgeRecognitionMode.FORCE,
                intent_detected=True,
            )

        try:
            should_search = await self._analyze_intent(user_message)
        except Exception:
            docs = await self.knowledge.search(user_message, limit=top_k)
            return KnowledgeSearchResult(
                documents=docs,
                query_used=user_message,
                mode=KnowledgeRecognitionMode.FORCE,
                intent_detected=True,
            )
        if should_search:
            docs = await self.knowledge.search(user_message, limit=top_k)
            return KnowledgeSearchResult(
                documents=docs,
                query_used=user_message,
                mode=KnowledgeRecognitionMode.INTENT,
                intent_detected=True,
            )

        return KnowledgeSearchResult(
            documents=[],
            query_used=user_message,
            mode=KnowledgeRecognitionMode.INTENT,
            intent_detected=False,
        )

    async def _analyze_intent(self, user_message: str) -> bool:
        prompt = self.intent_prompt_template.format(message=user_message)
        response = await self.llm_provider.ainvoke(prompt)
        raw = _extract_response_text(response).strip()

        match = re.search(r"<need_search>\s*(true|false)\s*</need_search>", raw, re.IGNORECASE)
        if match:
            return match.group(1).lower() == "true"

        lowered = raw.lower()
        if "true" in lowered and "false" not in lowered:
            return True
        return False


def _extract_response_text(response: Any) -> str:
    if response is None:
        return ""
    if isinstance(response, str):
        return response
    content = getattr(response, "content", None)
    if isinstance(content, str):
        return content
    choices = getattr(response, "choices", None)
    if isinstance(choices, list) and choices:
        first = choices[0]
        choice_content = getattr(first, "content", None)
        if isinstance(choice_content, str):
            return choice_content
    return str(response)
