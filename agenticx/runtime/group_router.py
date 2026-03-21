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
# Max @-mention follow-up hops per user turn (feitan @machi -> machi -> …).
GROUP_MENTION_FOLLOWUP_HOPS = 2

_META_AT_SUFFIX = r"(?=[\s\u3000\u4e00-\u9fff，。！？、：:；;,.!?\[\]（）()【】\"'「」]|$)"


def user_addresses_meta_leader(user_input: str, meta_label: str) -> bool:
    """True if the user is clearly addressing the group coordinator (not only @id)."""
    text = (user_input or "").strip()
    if not text:
        return False
    norm = text.replace("＠", "@")
    low = norm.casefold()
    labels: list[str] = []
    ml = str(meta_label or "").strip()
    if ml:
        labels.append(ml)
    for alias in (META_LEADER_NAME, "meta-agent", "meta agent"):
        if alias and alias not in labels:
            labels.append(alias)
    for lab in labels:
        l = lab.strip().casefold()
        if not l:
            continue
        at_m = re.search("@" + re.escape(l) + _META_AT_SUFFIX, low, flags=re.IGNORECASE)
        if at_m:
            return True
        if low.startswith(l):
            tail = low[len(l) : len(l) + 1]
            if not tail:
                return True
            if l.isascii() and tail.isascii() and (tail.isalnum() or tail == "_"):
                continue
            return True
        if l.isascii() and len(l) >= 2:
            if re.search(r"(?<![\w])" + re.escape(l) + r"(?![\w])", low, flags=re.IGNORECASE):
                return True
        elif l in low:
            idx = low.find(l)
            before = low[idx - 1] if idx > 0 else " "
            after = low[idx + len(l) : idx + len(l) + 1] if idx >= 0 else ""
            if before.isalnum() and before.isascii():
                continue
            if after and after.isascii() and after.isalnum():
                continue
            return True
    return False


def expand_mentions_with_meta_leader(
    user_input: str,
    mentioned_avatar_ids: Sequence[str],
    meta_label: str,
) -> List[str]:
    out = [str(x).strip() for x in mentioned_avatar_ids if str(x).strip()]
    if META_LEADER_AGENT_ID in out:
        return out
    if user_addresses_meta_leader(user_input, meta_label):
        out.append(META_LEADER_AGENT_ID)
    return out


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
    confirm_request_id: str = ""


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
        meta_leader_display_name: str | None = None,
        confirm_gate_factory: Callable[[str], "AsyncConfirmGate"] | None = None,
    ) -> None:
        self.avatar_registry = avatar_registry
        self.llm_factory = llm_factory
        self.max_tool_rounds = max(1, int(max_tool_rounds))
        label = str(meta_leader_display_name or "").strip()
        self._meta_leader_label = label or "Machi"
        self._confirm_gate_factory = confirm_gate_factory

    @staticmethod
    def _typing_event(agent_id: str, avatar_name: str) -> GroupReply:
        return GroupReply(
            agent_id=agent_id,
            avatar_name=avatar_name,
            avatar_url="",
            content="",
            skipped=True,
            event_type="group_typing",
        )

    def _group_user_addressing_rules(self, user_display_name: str) -> str:
        u = str(user_display_name or "").strip() or "用户"
        ml = self._meta_leader_label
        return (
            "## 对谁说话\n"
            f"- 人类提问者在上下文中以「{u}」标注；请直接对 ta 回答，可用「你」或其显示名。\n"
            f"- 用户点名你或 @ 你时，主答对象必须是该人类用户，不要改口去 @{ml} 或 @ 组长 当作主说话对象。\n"
            f"- 不要随意 @{ml} 、@组长 作为客套开场；仅当你确实需要组长统筹协调、汇总或转手任务时才 @。\n"
            "- 需要其他成员补充时，可在答复中 @ 对方；系统会尽量让对方接着发言。\n"
        )

    def _build_group_mention_name_map(self, group_avatar_ids: Sequence[str]) -> Dict[str, str]:
        m: Dict[str, str] = {}
        for aid in group_avatar_ids:
            sid = str(aid).strip()
            if not sid:
                continue
            avatar = self.avatar_registry.get_avatar(sid)
            name = str(getattr(avatar, "name", "") or "").strip().casefold() if avatar else ""
            if name:
                m[name] = sid
            if re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,63}", sid):
                m[sid.casefold()] = sid
        ml = str(self._meta_leader_label or "").strip().casefold()
        if ml:
            m[ml] = META_LEADER_AGENT_ID
        m[META_LEADER_NAME.casefold()] = META_LEADER_AGENT_ID
        return m

    def _mention_targets_in_text(
        self,
        text: str,
        *,
        speaker_id: str,
        group_avatar_ids: Sequence[str],
    ) -> List[str]:
        raw = str(text or "").replace("＠", "@")
        tokens = re.findall(r"@([^\s@\n，,。！？、；;]+)", raw)
        name_map = self._build_group_mention_name_map(group_avatar_ids)
        seen: set[str] = set()
        out: list[str] = []
        for t in tokens:
            key = str(t or "").strip().casefold()
            key = re.sub(r"[\s，,。！？、；;:：．.）)】」』\"'》>]+$", "", key)
            if not key:
                continue
            tid = name_map.get(key)
            if not tid or tid == speaker_id or tid in seen:
                continue
            seen.add(tid)
            out.append(tid)
        return out

    def _plain_targets_in_text(
        self,
        text: str,
        *,
        group_avatar_ids: Sequence[str],
    ) -> List[str]:
        """Detect direct member mentions without '@' marker."""
        raw = str(text or "").strip()
        if not raw:
            return []
        low = raw.casefold()
        name_map = self._build_group_mention_name_map(group_avatar_ids)
        allowed = {str(x).strip() for x in group_avatar_ids if str(x).strip()}
        allowed.add(META_LEADER_AGENT_ID)
        seen: set[str] = set()
        out: list[str] = []
        for key, tid in name_map.items():
            if tid not in allowed or tid in seen:
                continue
            token = str(key or "").strip().casefold()
            if not token:
                continue
            found = False
            if token.isascii() and len(token) >= 3:
                pattern = r"(?<![A-Za-z0-9_])" + re.escape(token) + r"(?![A-Za-z0-9_])"
                found = re.search(pattern, low, flags=re.IGNORECASE) is not None
            elif not token.isascii():
                found = token in low
            if not found:
                continue
            seen.add(tid)
            out.append(tid)
        return out

    def _followup_prompt_for_mention(
        self,
        *,
        speaker_name: str,
        cited_body: str,
        user_display_name: str,
    ) -> str:
        u = str(user_display_name or "").strip() or "用户"
        body = str(cited_body or "").strip()[:6000]
        return (
            f"[群聊协作] 你在群内被 @ 提及，请直接对用户「{u}」回答（系统要求你必须回复，禁止只输出 __SKIP__）。\n"
            "- 禁止以「收到 @xxx 的提示/转接」之类开场。\n"
            "- 查看「最近群聊上下文」，避免重复他人已说过的内容；补充你的专业判断或用可用工具研究。\n"
            "- 若对方在委派调研/实现/拍板，给出可执行答复或计划。\n"
            f"- 不要随意 @{self._meta_leader_label} 客套开场；仅确实需要组长介入时再 @。\n\n"
            f"--- 触发 @ 的消息（来自 {speaker_name}）---\n{body}"
        )

    @staticmethod
    def _record_turn_response(responded_this_turn: set[str], reply: GroupReply) -> None:
        """Track agents who already produced a visible reply in this user turn."""
        if reply.skipped:
            return
        aid = str(reply.agent_id or "").strip()
        if not aid:
            return
        if reply.content.strip() or str(reply.error or "").strip():
            responded_this_turn.add(aid)

    @staticmethod
    def _progress_reply(
        *,
        agent_id: str,
        avatar_name: str,
        avatar_url: str,
        text: str,
    ) -> GroupReply:
        """Build one progress event row for group chat streaming."""
        return GroupReply(
            agent_id=agent_id,
            avatar_name=avatar_name,
            avatar_url=avatar_url,
            content=str(text or "").strip(),
            skipped=True,
            event_type="group_progress",
        )

    @staticmethod
    def _runtime_event_to_progress_text(event_type: str, data: Dict[str, Any]) -> str:
        """Map runtime event to user-visible progress text."""
        et = str(event_type or "")
        if et == EventType.ROUND_START.value:
            return "开始处理任务..."
        if et == EventType.TOOL_CALL.value:
            tool_name = str(data.get("name", "") or data.get("tool_name", "") or "tool")
            return f"正在调用工具：{tool_name}"
        if et == EventType.TOOL_RESULT.value:
            tool_name = str(data.get("name", "") or data.get("tool_name", "") or "tool")
            return f"工具已完成：{tool_name}"
        if et == EventType.CONFIRM_REQUIRED.value:
            question = str(data.get("question", "") or "").strip()
            if question:
                return f"等待确认后继续执行：{question}"
            return "等待确认后继续执行"
        if et == EventType.SUBAGENT_STARTED.value:
            sub_name = str(data.get("name", "") or data.get("agent_name", "") or "子任务")
            return f"已启动子任务：{sub_name}"
        if et == EventType.SUBAGENT_PROGRESS.value:
            return str(data.get("summary", "") or data.get("text", "") or "子任务进行中...")
        if et == EventType.SUBAGENT_COMPLETED.value:
            return "子任务已完成，正在汇总结果"
        if et == EventType.SUBAGENT_ERROR.value:
            return str(data.get("text", "") or "子任务执行失败，正在处理")
        return ""

    @staticmethod
    def _runtime_event_to_group_event_type(event_type: str) -> str:
        """Map runtime event type to group progress event type."""
        if str(event_type or "") == EventType.CONFIRM_REQUIRED.value:
            return "group_blocked"
        return "group_progress"

    async def _emit_mention_follow_ups(
        self,
        *,
        reply: GroupReply,
        group_avatar_ids: Sequence[str],
        base_session: StudioSession,
        context: GroupChatContext,
        group_id: str,
        group_name: str,
        should_stop: Callable[[], Any],
        user_display_name: str,
        hops: int,
        responded_this_turn: set[str],
    ) -> AsyncGenerator[GroupReply, None]:
        if hops <= 0:
            return
        if reply.skipped or not str(reply.content or "").strip():
            return
        for tid in self._mention_targets_in_text(
            reply.content,
            speaker_id=reply.agent_id,
            group_avatar_ids=group_avatar_ids,
        ):
            if tid in responded_this_turn:
                continue
            if await self._should_stop(should_stop):
                return
            if tid == META_LEADER_AGENT_ID:
                ty_name = self._meta_leader_label
            else:
                av = self.avatar_registry.get_avatar(tid)
                ty_name = str(getattr(av, "name", "") or tid) if av else tid
            yield self._typing_event(tid, ty_name)
            if await self._should_stop(should_stop):
                return
            sub_reply: GroupReply | None = None
            async for sub_evt in self._run_one_target_stream(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                avatar_id=tid,
                user_input=self._followup_prompt_for_mention(
                    speaker_name=reply.avatar_name,
                    cited_body=reply.content,
                    user_display_name=user_display_name,
                ),
                quoted_content="",
                should_stop=should_stop,
                force_reply=True,
                user_display_name=user_display_name,
            ):
                yield sub_evt
                if sub_evt.event_type in {"group_reply", "group_skipped"}:
                    sub_reply = sub_evt
            if sub_reply is None:
                continue
            self._record_turn_response(responded_this_turn, sub_reply)
            async for extra in self._emit_mention_follow_ups(
                reply=sub_reply,
                group_avatar_ids=group_avatar_ids,
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                should_stop=should_stop,
                user_display_name=user_display_name,
                hops=hops - 1,
                responded_this_turn=responded_this_turn,
            ):
                yield extra

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
        member_mentions = [x for x in valid_members if x in mention_set]
        if META_LEADER_AGENT_ID in mention_set:
            return [META_LEADER_AGENT_ID, *member_mentions]
        if member_mentions:
            return member_mentions
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
            f"- 用户点名组长/项目经理（含称呼「{self._meta_leader_label}」「{META_LEADER_NAME}」、@同名、或 meta-agent）=> meta_direct。\n"
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
        user_display_name: str = "我",
    ) -> GroupReply:
        members_summary = GroupChatContext.render_members_summary(
            self._avatar_member_summary(getattr(base_session, "__group_avatar_ids", []) or [])
        )
        provider = getattr(base_session, "provider_name", None)
        model = getattr(base_session, "model_name", None)
        local_user_input = user_input
        if quoted_content.strip():
            local_user_input = f"{user_input}\n\n[用户引用内容]\n{quoted_content.strip()}"
        u = str(user_display_name or "").strip() or "用户"
        prompt = (
            f"你是群聊「{group_name}」的项目经理兼组长。\n"
            "你需要像项目经理向团长汇报一样回答：简洁、清晰、可执行。\n"
            "你可以综合所有成员最近发言给出全局判断。\n"
            "禁止输出工具调用细节。\n\n"
            f"人类提问者显示名：{u}。请直接对该用户作答（可用「你」或其显示名），不要无故把主答对象换成 @ 某位分身，除非在明确指派后续跟进。\n\n"
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
            agent_name=self._meta_leader_label,
            text=final_text,
            avatar_url="",
        )
        return GroupReply(
            agent_id=META_LEADER_AGENT_ID,
            avatar_name=self._meta_leader_label,
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
        user_display_name: str = "我",
        progress_queue: asyncio.Queue[GroupReply] | None = None,
    ) -> GroupReply:
        addressing = self._group_user_addressing_rules(user_display_name)
        if avatar_id == META_LEADER_AGENT_ID:
            avatar_name = self._meta_leader_label
            avatar_role = "Group Leader"
            avatar_prompt = (
                "你是群聊组长兼项目经理。优先用工具（搜索、查文档）研究问题后给出有信号量的答复；"
                "仅在真正需要专业成员动手执行时才 @ 委派。保持简洁可执行，不要输出工具调用细节。"
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
            f"{addressing}\n"
            "## 行为要求\n"
            "- 你是微信群聊中的一个成员，遵循自然对话风格。\n"
            f"{force_rule}"
            "- 若需要回答，请直接给完整答案，不要流式、不分段。\n"
            "- 回答简洁、有执行性，贴合你的角色职责。\n"
            "- 你能看到其他成员最近发言，可基于上下文补充或纠正。\n"
            "- 查看「最近群聊上下文」，若已有成员提出了相同的澄清问题，不要重复；"
            "给出你独特的专业判断、不同视角，或主动用工具查找答案。\n"
            "- 当你能通过搜索等工具找到答案时，优先研究后直接给出结论，而非反问用户。\n\n"
            f"## 你的长期指令\n{avatar_prompt or '(无)'}\n\n"
            f"## 最近群聊上下文\n{dialogue_context}\n"
        )
        if quoted_content.strip():
            local_user_input = f"{user_input}\n\n[用户引用内容]\n{quoted_content.strip()}"
        else:
            local_user_input = user_input

        confirm_gate = (
            self._confirm_gate_factory(avatar_id)
            if self._confirm_gate_factory is not None
            else AsyncConfirmGate()
        )
        runtime = AgentRuntime(
            llm,
            confirm_gate,
            max_tool_rounds=self.max_tool_rounds,
        )
        if progress_queue is not None:
            progress_queue.put_nowait(
                self._progress_reply(
                    agent_id=avatar_id,
                    avatar_name=avatar_name,
                    avatar_url=avatar_url,
                    text="已接收任务，正在分析...",
                )
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
            if progress_queue is not None:
                progress_text = self._runtime_event_to_progress_text(event.type, event.data)
                if progress_text:
                    group_evt_type = self._runtime_event_to_group_event_type(event.type)
                    confirm_request_id = (
                        str(event.data.get("id", "") or "")
                        if group_evt_type == "group_blocked"
                        else ""
                    )
                    progress_queue.put_nowait(
                        GroupReply(
                            agent_id=avatar_id,
                            avatar_name=avatar_name,
                            avatar_url=avatar_url,
                            content=progress_text,
                            skipped=True,
                            event_type=group_evt_type,
                            confirm_request_id=confirm_request_id,
                        )
                    )
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

    async def _run_one_target_stream(
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
        user_display_name: str = "我",
    ) -> AsyncGenerator[GroupReply, None]:
        """Stream target progress events, then final reply/skipped."""
        queue: asyncio.Queue[GroupReply] = asyncio.Queue()
        task = asyncio.create_task(
            self._run_one_target(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                avatar_id=avatar_id,
                user_input=user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
                force_reply=force_reply,
                user_display_name=user_display_name,
                progress_queue=queue,
            )
        )
        while not task.done():
            try:
                progress = await asyncio.wait_for(queue.get(), timeout=0.2)
                if str(progress.content or "").strip():
                    yield progress
            except asyncio.TimeoutError:
                continue
        while not queue.empty():
            progress = queue.get_nowait()
            if str(progress.content or "").strip():
                yield progress
        yield await task

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
        user_display_name: str = "我",
    ) -> AsyncGenerator[GroupReply, None]:
        valid_members = [str(x).strip() for x in group_avatar_ids if str(x).strip()]
        mention_set = {str(i).strip() for i in mentioned_avatar_ids if str(i).strip()}
        responded_this_turn: set[str] = set()
        if META_LEADER_AGENT_ID in mention_set:
            context.clear_active_thread()
            yield self._typing_event(META_LEADER_AGENT_ID, self._meta_leader_label)
            if await self._should_stop(should_stop):
                return
            meta_user_input = (
                f"{user_input}\n\n[系统提示] 用户点名由你（组长）回答，请直接对用户作答。"
            )
            pm_reply: GroupReply | None = None
            async for pm_evt in self._run_one_target_stream(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                avatar_id=META_LEADER_AGENT_ID,
                user_input=meta_user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
                force_reply=True,
                user_display_name=user_display_name,
            ):
                yield pm_evt
                if pm_evt.event_type in {"group_reply", "group_skipped"}:
                    pm_reply = pm_evt
            if pm_reply is None:
                return
            self._record_turn_response(responded_this_turn, pm_reply)
            async for fu in self._emit_mention_follow_ups(
                reply=pm_reply,
                group_avatar_ids=group_avatar_ids,
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                should_stop=should_stop,
                user_display_name=user_display_name,
                hops=GROUP_MENTION_FOLLOWUP_HOPS,
                responded_this_turn=responded_this_turn,
            ):
                yield fu
            return
        explicit = [x for x in valid_members if x in mention_set]
        decision = await self._analyze_intent(
            base_session=base_session,
            context=context,
            group_name=group_name,
            group_avatar_ids=valid_members,
            user_input=user_input,
            explicit_targets=explicit,
        )
        if explicit and decision.action == "meta_direct":
            decision = IntentDecision(
                action="route_to",
                target_ids=list(explicit),
                reason=f"{decision.reason}|explicit_member_override",
            )
        if decision.action == "meta_direct":
            context.clear_active_thread()
            yield self._typing_event(META_LEADER_AGENT_ID, self._meta_leader_label)
            if await self._should_stop(should_stop):
                return
            pm = await self._run_meta_project_manager_reply(
                base_session=base_session,
                context=context,
                group_name=group_name,
                user_input=user_input,
                quoted_content=quoted_content,
                extra_instruction="请从项目经理视角直接回答。",
                user_display_name=user_display_name,
            )
            yield pm
            self._record_turn_response(responded_this_turn, pm)
            async for fu in self._emit_mention_follow_ups(
                reply=pm,
                group_avatar_ids=group_avatar_ids,
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                should_stop=should_stop,
                user_display_name=user_display_name,
                hops=GROUP_MENTION_FOLLOWUP_HOPS,
                responded_this_turn=responded_this_turn,
            ):
                yield fu
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
            if target == META_LEADER_AGENT_ID:
                ty_name = self._meta_leader_label
            else:
                av = self.avatar_registry.get_avatar(target)
                ty_name = str(getattr(av, "name", "") or target) if av else target
            yield self._typing_event(target, ty_name)
            if await self._should_stop(should_stop):
                return
            reply: GroupReply | None = None
            async for target_evt in self._run_one_target_stream(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                avatar_id=target,
                user_input=user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
                force_reply=(target in explicit),
                user_display_name=user_display_name,
            ):
                yield target_evt
                if target_evt.event_type in {"group_reply", "group_skipped"}:
                    reply = target_evt
            if reply is None:
                continue
            self._record_turn_response(responded_this_turn, reply)
            async for fu in self._emit_mention_follow_ups(
                reply=reply,
                group_avatar_ids=group_avatar_ids,
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                should_stop=should_stop,
                user_display_name=user_display_name,
                hops=GROUP_MENTION_FOLLOWUP_HOPS,
                responded_this_turn=responded_this_turn,
            ):
                yield fu
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
            yield self._typing_event(META_LEADER_AGENT_ID, self._meta_leader_label)
            if await self._should_stop(should_stop):
                return
            pm = await self._run_meta_project_manager_reply(
                base_session=base_session,
                context=context,
                group_name=group_name,
                user_input=user_input,
                quoted_content=quoted_content,
                extra_instruction="请直接兜底回答用户问题。",
                user_display_name=user_display_name,
            )
            yield pm
            self._record_turn_response(responded_this_turn, pm)
            async for fu in self._emit_mention_follow_ups(
                reply=pm,
                group_avatar_ids=group_avatar_ids,
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                should_stop=should_stop,
                user_display_name=user_display_name,
                hops=GROUP_MENTION_FOLLOWUP_HOPS,
                responded_this_turn=responded_this_turn,
            ):
                yield fu
            return
        nudge_avatar = self.avatar_registry.get_avatar(nudge_target)
        nudge_name = str(getattr(nudge_avatar, "name", "") or nudge_target)
        nudge_text = f"@{nudge_name} 团长刚才的问题需要你来回答，请直接给出进度和下一步。"
        context.append_agent(
            agent_id=META_LEADER_AGENT_ID,
            agent_name=self._meta_leader_label,
            text=nudge_text,
            avatar_url="",
        )
        nudge_reply = GroupReply(
            agent_id=META_LEADER_AGENT_ID,
            avatar_name=self._meta_leader_label,
            avatar_url="",
            content=nudge_text,
            skipped=False,
            event_type="group_nudge",
        )
        yield nudge_reply
        self._record_turn_response(responded_this_turn, nudge_reply)
        if await self._should_stop(should_stop):
            return
        nudge_av = self.avatar_registry.get_avatar(nudge_target)
        nudge_ty = str(getattr(nudge_av, "name", "") or nudge_target) if nudge_av else nudge_target
        yield self._typing_event(nudge_target, nudge_ty)
        if await self._should_stop(should_stop):
            return
        retry_reply: GroupReply | None = None
        async for retry_evt in self._run_one_target_stream(
            base_session=base_session,
            context=context,
            group_id=group_id,
            group_name=group_name,
            avatar_id=nudge_target,
            user_input=user_input,
            quoted_content=quoted_content,
            should_stop=should_stop,
            force_reply=True,
            user_display_name=user_display_name,
        ):
            yield retry_evt
            if retry_evt.event_type in {"group_reply", "group_skipped"}:
                retry_reply = retry_evt
        if retry_reply is None:
            return
        self._record_turn_response(responded_this_turn, retry_reply)
        async for fu in self._emit_mention_follow_ups(
            reply=retry_reply,
            group_avatar_ids=group_avatar_ids,
            base_session=base_session,
            context=context,
            group_id=group_id,
            group_name=group_name,
            should_stop=should_stop,
            user_display_name=user_display_name,
            hops=GROUP_MENTION_FOLLOWUP_HOPS,
            responded_this_turn=responded_this_turn,
        ):
            yield fu
        if not retry_reply.skipped and retry_reply.content.strip():
            context.bump_active_thread(
                partner_id=retry_reply.agent_id,
                partner_name=retry_reply.avatar_name,
                last_topic=user_input[:120],
            )
            return
        yield self._typing_event(META_LEADER_AGENT_ID, self._meta_leader_label)
        if await self._should_stop(should_stop):
            return
        pm = await self._run_meta_project_manager_reply(
            base_session=base_session,
            context=context,
            group_name=group_name,
            user_input=user_input,
            quoted_content=quoted_content,
            extra_instruction="目标成员未响应，请你作为组长兜底回答。",
            user_display_name=user_display_name,
        )
        yield pm
        self._record_turn_response(responded_this_turn, pm)
        async for fu in self._emit_mention_follow_ups(
            reply=pm,
            group_avatar_ids=group_avatar_ids,
            base_session=base_session,
            context=context,
            group_id=group_id,
            group_name=group_name,
            should_stop=should_stop,
            user_display_name=user_display_name,
            hops=GROUP_MENTION_FOLLOWUP_HOPS,
            responded_this_turn=responded_this_turn,
        ):
            yield fu

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
        quoted_message_id: str = "",
        should_stop: Callable[[], Any],
        user_display_name: str | None = None,
    ) -> AsyncGenerator[GroupReply, None]:
        scratchpad = getattr(base_session, "scratchpad", None)
        if not isinstance(scratchpad, dict):
            scratchpad = {}
            setattr(base_session, "scratchpad", scratchpad)
        setattr(base_session, "__group_avatar_ids", list(group_avatar_ids))
        context = GroupChatContext(base_session, max_items=24)
        udn = str(user_display_name or "").strip() or "我"
        context.append_user(
            user_input,
            sender_name=udn,
            quoted_message_id=quoted_message_id,
            quoted_content=quoted_content,
        )
        resolved_mentions = expand_mentions_with_meta_leader(
            user_input,
            mentioned_avatar_ids,
            self._meta_leader_label,
        )
        plain_mentions = self._plain_targets_in_text(
            user_input,
            group_avatar_ids=group_avatar_ids,
        )
        for tid in plain_mentions:
            if tid not in resolved_mentions:
                resolved_mentions.append(tid)
        if routing == "intelligent":
            async for reply in self._run_intelligent_turn(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                group_avatar_ids=group_avatar_ids,
                mentioned_avatar_ids=resolved_mentions,
                user_input=user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
                user_display_name=udn,
            ):
                yield reply
            return
        targets = self.pick_targets(
            group_id=group_id,
            group_avatar_ids=group_avatar_ids,
            routing=routing,
            mentioned_avatar_ids=resolved_mentions,
            scratchpad=scratchpad,
        )
        if not targets:
            return

        force_reply_targets = {str(x).strip() for x in resolved_mentions if str(x).strip()}
        responded_this_turn: set[str] = set()
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
                    user_display_name=udn,
                )
            )
            for aid in targets
        ]
        parallel_replies: list[GroupReply] = []
        for coro in asyncio.as_completed(tasks):
            if await self._should_stop(should_stop):
                for t in tasks:
                    t.cancel()
                break
            try:
                r = await coro
                self._record_turn_response(responded_this_turn, r)
                parallel_replies.append(r)
                yield r
            except Exception as exc:
                err_reply = GroupReply(
                    agent_id="unknown",
                    avatar_name="unknown",
                    avatar_url="",
                    content="",
                    skipped=False,
                    error=str(exc),
                )
                self._record_turn_response(responded_this_turn, err_reply)
                parallel_replies.append(err_reply)
                yield err_reply
        for r in parallel_replies:
            if r.error:
                continue
            async for fu in self._emit_mention_follow_ups(
                reply=r,
                group_avatar_ids=group_avatar_ids,
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                should_stop=should_stop,
                user_display_name=udn,
                hops=GROUP_MENTION_FOLLOWUP_HOPS,
                responded_this_turn=responded_this_turn,
            ):
                yield fu

