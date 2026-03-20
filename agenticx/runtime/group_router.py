#!/usr/bin/env python3
"""Group-chat routing engine for WeChat-style multi-agent conversations.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import inspect
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Callable, Dict, List, Sequence

from agenticx.avatar.registry import AvatarRegistry
from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime
from agenticx.runtime import AsyncConfirmGate
from agenticx.runtime.events import EventType
from agenticx.runtime.group_context import GroupChatContext

META_LEADER_AGENT_ID = "__meta__"
META_LEADER_NAME = "组长"


def _group_chat_tools() -> Sequence[Dict[str, Any]]:
    blocked = {"delegate_to_avatar"}
    return [
        tool
        for tool in STUDIO_TOOLS
        if tool.get("function", {}).get("name") not in blocked
    ]


@dataclass
class GroupReply:
    agent_id: str
    avatar_name: str
    avatar_url: str
    content: str
    skipped: bool = False
    error: str = ""


class GroupChatRouter:
    """Route one user input to one-or-many avatars based on group strategy."""

    def __init__(
        self,
        *,
        avatar_registry: AvatarRegistry,
        llm_factory: Callable[[str | None, str | None], Any],
        max_tool_rounds: int,
    ) -> None:
        self.avatar_registry = avatar_registry
        self.llm_factory = llm_factory
        self.max_tool_rounds = max(1, int(max_tool_rounds))

    def pick_targets(
        self,
        *,
        group_id: str,
        group_avatar_ids: Sequence[str],
        routing: str,
        mentioned_avatar_ids: Sequence[str],
        scratchpad: dict[str, Any],
    ) -> List[str]:
        valid_members = [str(x).strip() for x in group_avatar_ids if str(x).strip()]
        mention_set = {str(x).strip() for x in mentioned_avatar_ids if str(x).strip()}
        explicit_targets = [x for x in valid_members if x in mention_set]
        if explicit_targets:
            return explicit_targets
        if routing == "round-robin" and valid_members:
            key = f"group_round_robin::{group_id}"
            idx = int(scratchpad.get(key, 0) or 0)
            selected = valid_members[idx % len(valid_members)]
            scratchpad[key] = idx + 1
            return [selected]
        if routing == "meta-routed":
            return [META_LEADER_AGENT_ID, *valid_members]
        # For user-directed without explicit @: broadcast all.
        return valid_members

    async def run_group_turn(
        self,
        *,
        base_session: StudioSession,
        group_id: str,
        group_name: str,
        routing: str,
        group_avatar_ids: Sequence[str],
        mentioned_avatar_ids: Sequence[str],
        user_input: str,
        quoted_content: str,
        should_stop: Callable[[], Any],
    ) -> AsyncGenerator[GroupReply, None]:
        scratchpad = getattr(base_session, "scratchpad", None)
        if not isinstance(scratchpad, dict):
            scratchpad = {}
            setattr(base_session, "scratchpad", scratchpad)
        context = GroupChatContext(base_session, max_items=24)
        context.append_user(user_input)
        targets = self.pick_targets(
            group_id=group_id,
            group_avatar_ids=group_avatar_ids,
            routing=routing,
            mentioned_avatar_ids=mentioned_avatar_ids,
            scratchpad=scratchpad,
        )
        if not targets:
            return

        force_reply_targets = {str(x).strip() for x in mentioned_avatar_ids if str(x).strip()}

        async def _should_stop() -> bool:
            try:
                value = should_stop()
                if inspect.isawaitable(value):
                    return bool(await value)
                return bool(value)
            except Exception:
                return False

        async def _run_one(avatar_id: str) -> GroupReply:
            if avatar_id == META_LEADER_AGENT_ID:
                avatar_name = META_LEADER_NAME
                avatar_role = "Group Leader"
                avatar_prompt = (
                    "你是群聊组长。优先给出高信号、可执行的方案；"
                    "如需更多信息可提出澄清问题。保持简洁，不要输出工具调用细节。"
                )
                avatar_url = ""
                provider = getattr(base_session, "provider_name", None)
                model = getattr(base_session, "model_name", None)
            else:
                avatar = self.avatar_registry.get_avatar(avatar_id)
                if avatar is None:
                    return GroupReply(
                        agent_id=avatar_id,
                        avatar_name=avatar_id,
                        avatar_url="",
                        content="",
                        skipped=True,
                        error=f"unknown avatar_id: {avatar_id}",
                    )
                avatar_name = str(getattr(avatar, "name", "") or avatar_id)
                avatar_role = str(getattr(avatar, "role", "") or "").strip()
                avatar_prompt = str(getattr(avatar, "system_prompt", "") or "").strip()
                avatar_url = str(getattr(avatar, "avatar_url", "") or "")
                provider = str(getattr(avatar, "default_provider", "") or "") or getattr(base_session, "provider_name", None)
                model = str(getattr(avatar, "default_model", "") or "") or getattr(base_session, "model_name", None)
            llm = self.llm_factory(provider or None, model or None)

            local_session = StudioSession(provider_name=provider, model_name=model)
            local_session.workspace_dir = getattr(base_session, "workspace_dir", None)
            local_session.context_files = dict(getattr(base_session, "context_files", {}) or {})
            local_session.taskspaces = list(getattr(base_session, "taskspaces", []) or [])
            setattr(local_session, "_team_manager", getattr(base_session, "_team_manager", None))
            setattr(local_session, "_session_manager", getattr(base_session, "_session_manager", None))
            setattr(local_session, "__group_chat_mode", True)

            dialogue_context = context.render_recent_dialogue()
            should_force = avatar_id in force_reply_targets
            force_rule = (
                "- 本轮用户明确 @ 了你，你必须给出明确回复。\n"
                if should_force
                else "- 若本轮问题与你职责无关，请只输出 __SKIP__（不要输出任何解释）。\n"
            )
            system_prompt = (
                f"你是群聊数字分身：{avatar_name}\n"
                f"角色：{avatar_role or 'General Assistant'}\n"
                f"所在群聊：{group_name}\n"
                f"群聊ID：{group_id}\n\n"
                "## 行为要求\n"
                "- 你是微信群聊中的一个成员，遵循自然对话风格。\n"
                f"{force_rule}"
                "- 若需要回答，请直接给完整答案，不要流式、不分段。\n"
                "- 回答简洁、有执行性，贴合你的角色职责。\n"
                "- 你能看到其他成员最近发言，可基于上下文补充或纠正。\n\n"
                f"## 你的长期指令\n{avatar_prompt or '(无)'}\n\n"
                f"## 最近群聊上下文\n{dialogue_context}\n"
            )
            if quoted_content.strip():
                local_user_input = f"{user_input}\n\n[用户引用内容]\n{quoted_content.strip()}"
            else:
                local_user_input = user_input

            runtime = AgentRuntime(
                llm,
                AsyncConfirmGate(),
                max_tool_rounds=self.max_tool_rounds,
            )
            final_text = ""
            error_text = ""
            async for event in runtime.run_turn(
                local_user_input,
                local_session,
                should_stop=_should_stop,
                agent_id=avatar_id,
                tools=_group_chat_tools(),
                system_prompt=system_prompt,
            ):
                if event.type == EventType.FINAL.value:
                    final_text = str(event.data.get("text", "") or "").strip()
                elif event.type == EventType.ERROR.value:
                    error_text = str(event.data.get("text", "") or "").strip()
            skipped = (not final_text) or final_text == "__SKIP__"
            if skipped and not error_text:
                return GroupReply(
                    agent_id=avatar_id,
                    avatar_name=avatar_name,
                    avatar_url=avatar_url,
                    content="",
                    skipped=True,
                )
            if error_text and not final_text:
                return GroupReply(
                    agent_id=avatar_id,
                    avatar_name=avatar_name,
                    avatar_url=avatar_url,
                    content="",
                    skipped=False,
                    error=error_text,
                )
            reply = GroupReply(
                agent_id=avatar_id,
                avatar_name=avatar_name,
                avatar_url=avatar_url,
                content=final_text,
                skipped=False,
            )
            context.append_agent(
                agent_id=avatar_id,
                agent_name=avatar_name,
                text=final_text,
                avatar_url=avatar_url,
            )
            return reply

        tasks = [asyncio.create_task(_run_one(aid)) for aid in targets]
        for coro in asyncio.as_completed(tasks):
            if await _should_stop():
                for t in tasks:
                    t.cancel()
                break
            try:
                yield await coro
            except Exception as exc:
                yield GroupReply(
                    agent_id="unknown",
                    avatar_name="unknown",
                    avatar_url="",
                    content="",
                    skipped=False,
                    error=str(exc),
                )

