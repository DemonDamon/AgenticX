#!/usr/bin/env python3
"""Computer Use Resolver — screen-level task execution via vision model.

Implements the screenshot -> analyze -> act -> repeat loop for
OS-level GUI task completion. This is the universal fallback resolver.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Protocol

from agenticx.tools.fallback_chain import ToolResolver

logger = logging.getLogger(__name__)


class VisionModel(Protocol):
    """Protocol for vision models that analyze screenshots."""

    async def analyze_screenshot(
        self,
        screenshot_b64: str,
        task_intent: str,
        action_history: list,
    ) -> Dict[str, Any]:
        """Analyze screenshot and return next action.

        Expected return format:
        {
            "action": "click_at" | "type_text" | "scroll" | "wait" | "done",
            "params": { ... },
            "reasoning": "...",
            "task_complete": bool,
        }
        """
        ...


class ComputerUseResolver(ToolResolver):
    """Universal fallback resolver using screenshot + vision model + GUI actions.

    Core loop:
    1. Take screenshot
    2. Send to vision model with task intent
    3. Execute returned action
    4. Repeat until task_complete or max_steps
    """

    def __init__(
        self,
        adapter: Any,
        vision_model: VisionModel,
        max_steps: int = 10,
    ) -> None:
        self._adapter = adapter
        self._vision = vision_model
        self._max_steps = max_steps

    async def can_handle(self, task_intent: str) -> bool:
        return True

    async def resolve(self, task_intent: str, **kwargs) -> str:
        action_history: list = []

        for step in range(self._max_steps):
            screenshot = await self._adapter.take_screenshot()

            analysis = await self._vision.analyze_screenshot(
                screenshot_b64=screenshot,
                task_intent=task_intent,
                action_history=action_history,
            )

            action = analysis.get("action", "done")
            params = analysis.get("params", {})
            reasoning = analysis.get("reasoning", "")
            task_complete = analysis.get("task_complete", False)

            logger.info(
                "Step %d/%d: action=%s, reasoning=%s",
                step + 1,
                self._max_steps,
                action,
                reasoning,
            )
            action_history.append(analysis)

            if action == "done":
                return f"Task completed after {step + 1} steps. Last action: {reasoning}"

            await self._execute_action(action, params)

            if task_complete:
                return f"Task completed after {step + 1} steps. Last action: {reasoning}"

        return (
            f"Task reached max steps ({self._max_steps}). "
            f"Last state: {action_history[-1].get('reasoning', '')}"
        )

    async def _execute_action(self, action: str, params: Dict[str, Any]) -> None:
        """Dispatch an action to the platform adapter."""
        if action == "click_at":
            await self._adapter.click_at(**params)
        elif action == "type_text":
            await self._adapter.type_text(**params)
        elif action == "scroll":
            await self._adapter.scroll(**params)
        elif action == "wait":
            await asyncio.sleep(params.get("seconds", 1))
        else:
            logger.warning("Unknown action: %s", action)
