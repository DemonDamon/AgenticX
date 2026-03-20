#!/usr/bin/env python3
"""Group-chat routing engine for WeChat-style multi-agent conversations.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
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
    event_type: str = "group_reply"


@dataclass
class IntentDecision:
    action: str
    target_ids: List[str]
    reason: str


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
        if routing == "intelligent":
            return []
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

    @staticmethod
    def _extract_text(response: Any) -> str:
        content = getattr(response, "content", response)
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            chunks: list[str] = []
            for item in content:
                if isinstance(item, str):
                    chunks.append(item)
                    continue
                if isinstance(item, dict):
                    maybe_text = item.get("text")
                    if isinstance(maybe_text, str):
                        chunks.append(maybe_text)
            return "\n".join(chunks).strip()
        return str(content or "").strip()

    @staticmethod
    def _extract_json_object(text: str) -> dict[str, Any]:
        raw = str(text or "").strip()
        if not raw:
            return {}
        fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, flags=re.DOTALL | re.IGNORECASE)
        if fenced:
            raw = fenced.group(1).strip()
        else:
            braced = re.search(r"\{.*\}", raw, flags=re.DOTALL)
            if braced:
                raw = braced.group(0).strip()
        try:
            parsed = json.loads(raw)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    async def _call_llm_text(
        self,
        *,
        provider: str | None,
        model: str | None,
        prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 600,
    ) -> str:
        llm = self.llm_factory(provider or None, model or None)
        messages = [{"role": "user", "content": prompt}]
        try:
            response = llm.invoke(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except TypeError:
            response = llm.invoke(messages)
        return self._extract_text(response)

    async def _should_stop(self, should_stop: Callable[[], Any]) -> bool:
        try:
            value = should_stop()
            if inspect.isawaitable(value):
                return bool(await value)
            return bool(value)
        except Exception:
            return False

    def _avatar_member_summary(self, group_avatar_ids: Sequence[str]) -> List[dict[str, str]]:
        members: List[dict[str, str]] = []
        for avatar_id in [str(x).strip() for x in group_avatar_ids if str(x).strip()]:
            avatar = self.avatar_registry.get_avatar(avatar_id)
            if avatar is None:
                continue
            members.append(
                {
                    "id": avatar_id,
                    "name": str(getattr(avatar, "name", "") or avatar_id),
                    "role": str(getattr(avatar, "role", "") or ""),
                }
            )
        return members

    async def _analyze_intent(
        self,
        *,
        base_session: StudioSession,
        context: GroupChatContext,
        group_name: str,
        group_avatar_ids: Sequence[str],
        user_input: str,
        explicit_targets: Sequence[str],
    ) -> IntentDecision:
        if explicit_targets:
            return IntentDecision(
                action="route_to",
                target_ids=[str(x).strip() for x in explicit_targets if str(x).strip()],
                reason="explicit_mention",
            )
        members = self._avatar_member_summary(group_avatar_ids)
        member_ids = {item["id"] for item in members}
        active_thread = context.get_active_thread()
        provider = getattr(base_session, "provider_name", None)
        model = getattr(base_session, "model_name", None)
        thread_line = (
            f"{active_thread.partner_name}({active_thread.partner_id}), "
            f"turn_count={active_thread.turn_count}, last_topic={active_thread.last_topic or '(none)'}"
            if active_thread is not None
            else "(none)"
        )
        prompt = (
            f"你是群聊「{group_name}」的隐形项目经理。\n"
            "请判断这条用户消息应由谁回复。只输出 JSON，不要输出解释。\n\n"
            "JSON schema:\n"
            "{\n"
            '  "action": "route_to" | "meta_direct" | "continue_thread",\n'
            '  "target_ids": ["avatar_id"],\n'
            '  "reason": "short_reason"\n'
            "}\n\n"
            f"群成员:\n{GroupChatContext.render_members_summary(members)}\n\n"
            f"当前线程:\n{thread_line}\n\n"
            f"最近群聊上下文:\n{context.render_recent_dialogue()}\n\n"
            f"用户消息:\n{user_input}\n\n"
            "规则:\n"
            "- 项目全局进度、跨角色总结问题 => meta_direct。\n"
            "- 明确属于某角色职责 => route_to。\n"
            "- 明显在追问上一位成员 => continue_thread。\n"
            "- 不确定时优先 route_to 最可能成员。"
        )
        try:
            text = await self._call_llm_text(
                provider=provider,
                model=model,
                prompt=prompt,
                temperature=0.1,
                max_tokens=280,
            )
        except Exception:
            if active_thread is not None and active_thread.partner_id in member_ids:
                return IntentDecision(
                    action="continue_thread",
                    target_ids=[active_thread.partner_id],
                    reason="intent_fallback_active_thread",
                )
            if members:
                return IntentDecision(
                    action="route_to",
                    target_ids=[members[0]["id"]],
                    reason="intent_fallback_first_member",
                )
            return IntentDecision(
                action="meta_direct",
                target_ids=[],
                reason="intent_fallback_meta_direct",
            )
        payload = self._extract_json_object(text)
        action = str(payload.get("action", "") or "").strip().lower()
        raw_targets = payload.get("target_ids", [])
        if not isinstance(raw_targets, list):
            raw_targets = []
        target_ids = [str(x).strip() for x in raw_targets if str(x).strip() in member_ids]
        reason = str(payload.get("reason", "") or "").strip() or "llm_decision"
        if action not in {"route_to", "meta_direct", "continue_thread"}:
            action = "route_to" if target_ids else "meta_direct"
        if action == "continue_thread":
            if active_thread is None or active_thread.partner_id not in member_ids:
                action = "route_to"
            else:
                target_ids = [active_thread.partner_id]
        if action == "route_to" and not target_ids and members:
            target_ids = [members[0]["id"]]
            reason = f"{reason}|fallback_first_member"
        return IntentDecision(action=action, target_ids=target_ids, reason=reason)

    async def _run_meta_project_manager_reply(
        self,
        *,
        base_session: StudioSession,
        context: GroupChatContext,
        group_name: str,
        user_input: str,
        extra_instruction: str = "",
        quoted_content: str = "",
    ) -> GroupReply:
        members_summary = GroupChatContext.render_members_summary(
            self._avatar_member_summary(getattr(base_session, "__group_avatar_ids", []) or [])
        )
        provider = getattr(base_session, "provider_name", None)
        model = getattr(base_session, "model_name", None)
        local_user_input = user_input
        if quoted_content.strip():
            local_user_input = f"{user_input}\n\n[用户引用内容]\n{quoted_content.strip()}"
        prompt = (
            f"你是群聊「{group_name}」的项目经理兼组长。\n"
            "你需要像项目经理向团长汇报一样回答：简洁、清晰、可执行。\n"
            "你可以综合所有成员最近发言给出全局判断。\n"
            "禁止输出工具调用细节。\n\n"
            f"群成员:\n{members_summary}\n\n"
            f"最近群聊上下文:\n{context.render_recent_dialogue()}\n\n"
            f"用户问题:\n{local_user_input}\n\n"
            f"{extra_instruction.strip()}\n"
        )
        text = await self._call_llm_text(
            provider=provider,
            model=model,
            prompt=prompt,
            temperature=0.2,
            max_tokens=900,
        )
        final_text = text.strip()
        if not final_text:
            final_text = "我先给出当前可确认的进展：暂无足够信息，请指明想看的模块或成员。"
        context.append_agent(
            agent_id=META_LEADER_AGENT_ID,
            agent_name=META_LEADER_NAME,
            text=final_text,
            avatar_url="",
        )
        return GroupReply(
            agent_id=META_LEADER_AGENT_ID,
            avatar_name=META_LEADER_NAME,
            avatar_url="",
            content=final_text,
            skipped=False,
            event_type="group_reply",
        )

    async def _run_one_target(
        self,
        *,
        base_session: StudioSession,
        context: GroupChatContext,
        group_id: str,
        group_name: str,
        avatar_id: str,
        user_input: str,
        quoted_content: str,
        should_stop: Callable[[], Any],
        force_reply: bool,
    ) -> GroupReply:
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
                    event_type="group_skipped",
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
        force_rule = (
            "- 本轮用户明确点名你，你必须给出明确回复。\n"
            if force_reply
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
            should_stop=lambda: self._should_stop(should_stop),
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
                event_type="group_skipped",
            )
        if error_text and not final_text:
            return GroupReply(
                agent_id=avatar_id,
                avatar_name=avatar_name,
                avatar_url=avatar_url,
                content="",
                skipped=False,
                error=error_text,
                event_type="group_reply",
            )
        reply = GroupReply(
            agent_id=avatar_id,
            avatar_name=avatar_name,
            avatar_url=avatar_url,
            content=final_text,
            skipped=False,
            event_type="group_reply",
        )
        context.append_agent(
            agent_id=avatar_id,
            agent_name=avatar_name,
            text=final_text,
            avatar_url=avatar_url,
        )
        return reply

    async def _run_intelligent_turn(
        self,
        *,
        base_session: StudioSession,
        context: GroupChatContext,
        group_id: str,
        group_name: str,
        group_avatar_ids: Sequence[str],
        mentioned_avatar_ids: Sequence[str],
        user_input: str,
        quoted_content: str,
        should_stop: Callable[[], Any],
    ) -> AsyncGenerator[GroupReply, None]:
        valid_members = [str(x).strip() for x in group_avatar_ids if str(x).strip()]
        explicit = [x for x in valid_members if x in {str(i).strip() for i in mentioned_avatar_ids if str(i).strip()}]
        decision = await self._analyze_intent(
            base_session=base_session,
            context=context,
            group_name=group_name,
            group_avatar_ids=valid_members,
            user_input=user_input,
            explicit_targets=explicit,
        )
        if decision.action == "meta_direct":
            context.clear_active_thread()
            yield await self._run_meta_project_manager_reply(
                base_session=base_session,
                context=context,
                group_name=group_name,
                user_input=user_input,
                quoted_content=quoted_content,
                extra_instruction="请从项目经理视角直接回答。",
            )
            return
        active_thread = context.get_active_thread()
        primary_targets = [x for x in decision.target_ids if x in valid_members]
        if decision.action == "continue_thread" and active_thread is not None:
            primary_targets = [active_thread.partner_id]
        if not primary_targets and valid_members:
            primary_targets = [valid_members[0]]
        if explicit:
            primary_targets = [x for x in primary_targets if x in explicit]
        else:
            primary_targets = primary_targets[:2]
        any_success = False
        for target in primary_targets:
            if await self._should_stop(should_stop):
                return
            reply = await self._run_one_target(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                avatar_id=target,
                user_input=user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
                force_reply=(target in explicit),
            )
            yield reply
            if not reply.skipped and reply.content.strip():
                any_success = True
                context.bump_active_thread(
                    partner_id=reply.agent_id,
                    partner_name=reply.avatar_name,
                    last_topic=user_input[:120],
                )
        if any_success:
            return
        nudge_target = primary_targets[0] if primary_targets else ""
        if not nudge_target:
            yield await self._run_meta_project_manager_reply(
                base_session=base_session,
                context=context,
                group_name=group_name,
                user_input=user_input,
                quoted_content=quoted_content,
                extra_instruction="请直接兜底回答用户问题。",
            )
            return
        nudge_avatar = self.avatar_registry.get_avatar(nudge_target)
        nudge_name = str(getattr(nudge_avatar, "name", "") or nudge_target)
        nudge_text = f"@{nudge_name} 团长刚才的问题需要你来回答，请直接给出进度和下一步。"
        context.append_agent(
            agent_id=META_LEADER_AGENT_ID,
            agent_name=META_LEADER_NAME,
            text=nudge_text,
            avatar_url="",
        )
        yield GroupReply(
            agent_id=META_LEADER_AGENT_ID,
            avatar_name=META_LEADER_NAME,
            avatar_url="",
            content=nudge_text,
            skipped=False,
            event_type="group_nudge",
        )
        if await self._should_stop(should_stop):
            return
        retry_reply = await self._run_one_target(
            base_session=base_session,
            context=context,
            group_id=group_id,
            group_name=group_name,
            avatar_id=nudge_target,
            user_input=user_input,
            quoted_content=quoted_content,
            should_stop=should_stop,
            force_reply=True,
        )
        yield retry_reply
        if not retry_reply.skipped and retry_reply.content.strip():
            context.bump_active_thread(
                partner_id=retry_reply.agent_id,
                partner_name=retry_reply.avatar_name,
                last_topic=user_input[:120],
            )
            return
        yield await self._run_meta_project_manager_reply(
            base_session=base_session,
            context=context,
            group_name=group_name,
            user_input=user_input,
            quoted_content=quoted_content,
            extra_instruction="目标成员未响应，请你作为组长兜底回答。",
        )

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
        setattr(base_session, "__group_avatar_ids", list(group_avatar_ids))
        context = GroupChatContext(base_session, max_items=24)
        context.append_user(user_input)
        if routing == "intelligent":
            async for reply in self._run_intelligent_turn(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                group_avatar_ids=group_avatar_ids,
                mentioned_avatar_ids=mentioned_avatar_ids,
                user_input=user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
            ):
                yield reply
            return
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
        tasks = [
            asyncio.create_task(
                self._run_one_target(
                    base_session=base_session,
                    context=context,
                    group_id=group_id,
                    group_name=group_name,
                    avatar_id=aid,
                    user_input=user_input,
                    quoted_content=quoted_content,
                    should_stop=should_stop,
                    force_reply=(aid in force_reply_targets),
                )
            )
            for aid in targets
        ]
        for coro in asyncio.as_completed(tasks):
            if await self._should_stop(should_stop):
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

