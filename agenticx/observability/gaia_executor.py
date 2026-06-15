#!/usr/bin/env python3
"""Execute GAIA tasks against a configured LLM provider.

Author: Damon Li
"""

from __future__ import annotations

import time
from typing import Any

from agenticx.core.task import Task
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.observability.gaia_model_registry import GaiaModelSelection, resolve_gaia_model


_GAIA_SYSTEM_PROMPT = (
    "You are an expert assistant solving GAIA benchmark questions. "
    "Provide accurate, concise answers following the question constraints. "
    "When you finish reasoning, end with exactly one line in this format:\n"
    "FINAL ANSWER: [your final answer]\n"
    "Put only the final answer text after 'FINAL ANSWER:' with no extra commentary."
)


def build_gaia_user_prompt(task: Task) -> str:
    """Build user prompt for one GAIA task."""
    lines = [task.description.strip()]
    context = task.context or {}
    attachment = context.get("attachment_path")
    if attachment:
        lines.append("")
        lines.append(f"Attached file path (if needed): {attachment}")
    level = context.get("level")
    if level is not None:
        lines.append(f"GAIA level: {level}")
    return "\n".join(lines)


def execute_gaia_task(
    task: Task,
    *,
    model: str,
    provider: str | None = None,
    request_timeout: float | None = None,
) -> dict[str, Any]:
    """Run one GAIA task through ProviderResolver and return benchmark row payload."""
    started = time.perf_counter()
    selection: GaiaModelSelection | None = None
    try:
        selection = resolve_gaia_model(model, provider_override=provider)
        llm = ProviderResolver.resolve(
            provider_name=selection.provider,
            model=selection.model,
        )
        messages = [
            {"role": "system", "content": _GAIA_SYSTEM_PROMPT},
            {"role": "user", "content": build_gaia_user_prompt(task)},
        ]
        invoke_kwargs: dict[str, Any] = {}
        if request_timeout is not None and request_timeout > 0:
            invoke_kwargs["timeout"] = request_timeout
        response = llm.invoke(messages, **invoke_kwargs)
        content = getattr(response, "content", response)
        raw_output = str(content or "").strip()
        if not raw_output:
            raise ValueError("empty model response")
        elapsed = time.perf_counter() - started
        return {
            "success": True,
            "result": raw_output,
            "execution_time": elapsed,
            "provider": selection.provider,
            "model": selection.model,
            "error": None,
        }
    except Exception as exc:
        elapsed = time.perf_counter() - started
        return {
            "success": False,
            "result": "",
            "execution_time": elapsed,
            "provider": selection.provider if selection else (provider or ""),
            "model": selection.model if selection else model,
            "error": str(exc),
        }
