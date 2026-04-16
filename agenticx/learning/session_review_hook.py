#!/usr/bin/env python3
"""Post-session skill review hook — Hermes-style auto-creation.

After a session ends, if observation signals indicate a complex enough
workflow, spawns a background LLM call that reviews the conversation and
autonomously calls ``skill_manage`` to create or update skills.

No intermediate ``pending_skills.json`` — the review agent writes skills
directly, matching the hermes-agent architecture.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from agenticx.learning.analyzer import (
    SessionSignals,
    extract_signals,
    load_session_observations,
)
from agenticx.runtime.hooks import AgentHook

logger = logging.getLogger("agenticx.learning")

DEFAULT_NUDGE_INTERVAL = 10
DEFAULT_MIN_TOOL_CALLS = 5
_MAX_REVIEW_ITERATIONS = 3
_HISTORY_TAIL = 20
_MSG_CONTENT_LIMIT = 600

_SKILL_REVIEW_PROMPT = (
    "Review the conversation above and consider saving or updating a skill.\n\n"
    "Focus on:\n"
    "- Non-trivial approaches that required trial and error\n"
    "- User corrections that reveal a preferred method\n"
    "- Reusable workflows or patterns worth remembering\n\n"
    "If a relevant skill already exists, update it with skill_manage(action='patch').\n"
    "Otherwise, create a new skill with skill_manage(action='create').\n"
    "If nothing is worth saving, respond with: Nothing to save."
)

_REVIEW_SYSTEM_PROMPT = (
    "You are a skill reviewer. Identify reusable approaches from completed "
    "conversations and save them as skills using the skill_manage tool.\n\n"
    "Skills are stored as ~/.agenticx/skills/<name>/SKILL.md. Rules:\n"
    "- Only save genuinely reusable, non-trivial approaches\n"
    "- Skill names: lowercase-with-hyphens (e.g. 'fix-node-pty-rebuild')\n"
    "- Content: actionable step-by-step instructions, not conversation summaries\n"
    "- If a similar skill already exists in the list below, patch it instead of creating a duplicate\n"
    "- If nothing worth saving, just say 'Nothing to save.'"
)

_SKILL_MANAGE_TOOL_DEF = {
    "type": "function",
    "function": {
        "name": "skill_manage",
        "description": "Create or update a reusable skill document (SKILL.md).",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["create", "patch"],
                    "description": "create = new skill, patch = update existing",
                },
                "name": {
                    "type": "string",
                    "description": "Skill directory name (lowercase-with-hyphens)",
                },
                "content": {
                    "type": "string",
                    "description": "Full SKILL.md content (required for create)",
                },
                "old_string": {
                    "type": "string",
                    "description": "Text to find in existing SKILL.md (for patch)",
                },
                "new_string": {
                    "type": "string",
                    "description": "Replacement text (for patch)",
                },
            },
            "required": ["action", "name"],
        },
    },
}


def _learning_enabled() -> bool:
    try:
        from agenticx.learning.config import get
        return bool(get("enabled", True))
    except Exception:
        flag = os.getenv("AGX_LEARNING_ENABLED", "1").strip().lower()
        return flag in {"1", "true", "on", "yes"}


def _load_learning_config() -> dict[str, Any]:
    try:
        from agenticx.learning.config import get_learning_config
        return get_learning_config()
    except Exception:
        return {}


def _truncate_content(content: Any, limit: int = _MSG_CONTENT_LIMIT) -> str:
    text = str(content or "")
    if len(text) <= limit:
        return text
    return text[:limit] + "…(truncated)"


def _truncate_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep user/assistant messages only, truncate long content."""
    out: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "")
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content")
        if content is None:
            continue
        out.append({"role": role, "content": _truncate_content(content)})
    return out


def _list_existing_skills() -> list[str]:
    root = Path.home() / ".agenticx" / "skills"
    if not root.is_dir():
        return []
    return sorted(
        d.name for d in root.iterdir()
        if d.is_dir() and (d / "SKILL.md").is_file()
    )


class SessionReviewHook(AgentHook):
    """Post-session review — spawns background LLM to auto-create/update skills.

    Registered at priority=-50 (lowest) to run after memory_hook and
    session_summary_hook.
    """

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        if not _learning_enabled():
            return
        if not self._should_review(session):
            return
        asyncio.create_task(self._run_review(session))

    def _should_review(self, session: Any) -> bool:
        """Check nudge interval and min tool calls thresholds."""
        config = _load_learning_config()
        interval = int(config.get("nudge_interval", DEFAULT_NUDGE_INTERVAL))
        min_calls = int(config.get("min_tool_calls", DEFAULT_MIN_TOOL_CALLS))

        turns_since_skill = getattr(session, "_turns_since_skill_manage", interval + 1)
        total_tool_calls = getattr(session, "_total_tool_calls", 0)

        if turns_since_skill < interval:
            return False
        if total_tool_calls < min_calls:
            return False
        return True

    async def _run_review(self, session: Any) -> None:
        """Load observations, check complexity, then spawn review agent."""
        try:
            session_id = str(
                getattr(session, "session_id", "") or getattr(session, "id", "") or ""
            ).strip()
            if not session_id:
                logger.debug("No session_id available, skipping review")
                return

            session_dir = Path.home() / ".agenticx" / "sessions" / session_id
            observations = load_session_observations(session_dir)

            if not observations:
                logger.debug("No observations for session %s, skipping review", session_id)
                return

            signals = extract_signals(observations)

            if not signals.is_complex:
                logger.debug(
                    "Session %s not complex enough for skill review (%d calls, %d tools)",
                    session_id, signals.tool_call_count, signals.unique_tools,
                )
                return

            await self._run_skill_review_agent(session, signals)

        except Exception:
            logger.warning("Skill review failed", exc_info=True)

    async def _run_skill_review_agent(
        self, session: Any, signals: SessionSignals
    ) -> None:
        """Background LLM call that reviews conversation and calls skill_manage."""
        from agenticx.cli.agent_tools import _skill_manage_enabled, _tool_skill_manage

        if not _skill_manage_enabled():
            logger.debug("skill_manage disabled, skipping review agent")
            return

        provider_name = str(getattr(session, "provider_name", "") or "").strip()
        model_name = str(getattr(session, "model_name", "") or "").strip()
        if not model_name:
            logger.debug("No model configured, skipping review agent")
            return

        history = list(getattr(session, "agent_messages", []) or [])
        truncated = _truncate_history(history[-_HISTORY_TAIL:])
        if not truncated:
            return

        existing = _list_existing_skills()
        system = _REVIEW_SYSTEM_PROMPT
        if existing:
            system += f"\n\nExisting skills: {', '.join(existing[:50])}"

        signals_text = (
            f"Session stats: {signals.tool_call_count} tool calls, "
            f"{signals.unique_tools} unique tools, "
            f"{signals.error_count} errors, "
            f"{signals.error_recovery_count} recoveries, "
            f"success rate {signals.success_rate:.0%}"
        )

        messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
        messages.extend(truncated)
        messages.append({
            "role": "user",
            "content": f"{signals_text}\n\n{_SKILL_REVIEW_PROMPT}",
        })

        litellm_model = f"{provider_name}/{model_name}" if provider_name else model_name

        try:
            import litellm
        except ImportError:
            logger.debug("litellm not available, skipping review agent")
            return

        for iteration in range(_MAX_REVIEW_ITERATIONS):
            try:
                response = await litellm.acompletion(
                    model=litellm_model,
                    messages=messages,
                    tools=[_SKILL_MANAGE_TOOL_DEF],
                    tool_choice="auto",
                    max_tokens=2048,
                    temperature=0.2,
                )
            except Exception:
                logger.debug("Review LLM call failed (iter %d)", iteration, exc_info=True)
                return

            choice = response.choices[0]
            assistant_msg = choice.message
            tool_calls = getattr(assistant_msg, "tool_calls", None) or []

            if not tool_calls:
                text = str(getattr(assistant_msg, "content", "") or "")
                logger.debug("Review agent (iter %d): %s", iteration, text[:200])
                return

            tc_dicts = []
            for tc in tool_calls:
                tc_dicts.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                })
            messages.append({"role": "assistant", "content": None, "tool_calls": tc_dicts})

            for tc in tool_calls:
                if tc.function.name != "skill_manage":
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": tc.function.name,
                        "content": "ERROR: only skill_manage is available",
                    })
                    continue

                try:
                    args = json.loads(tc.function.arguments)
                except (json.JSONDecodeError, ValueError):
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": "skill_manage",
                        "content": "ERROR: invalid JSON arguments",
                    })
                    continue

                result = _tool_skill_manage(args, session=None)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": "skill_manage",
                    "content": result,
                })
                logger.info(
                    "Review agent skill_manage: action=%s name=%s → %s",
                    args.get("action"), args.get("name"), result[:200],
                )

        logger.debug("Review agent reached max iterations (%d)", _MAX_REVIEW_ITERATIONS)
