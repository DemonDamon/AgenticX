#!/usr/bin/env python3
"""Group-chat routing engine for WeChat-style multi-agent conversations.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Callable, Dict, List, Sequence

_log = logging.getLogger(__name__)

from agenticx.avatar.registry import AvatarRegistry
from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime
from agenticx.runtime import AsyncClarifyGate, AsyncConfirmGate
from agenticx.runtime.events import EventType
from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_facts import (
    GroupExecutionFacts,
    build_group_execution_facts,
    format_zero_exec_fallback,
    render_facts_block,
)
from agenticx.runtime.harden_flags import (
    group_intent_max_tokens,
    group_meta_direct_tools_enabled,
    group_meta_reply_max_tokens,
    group_review_max_retries,
)
from agenticx.runtime.group_workflow import (
    GroupWorkflowError,
    WorkflowMember,
    WorkflowStageRecord,
    build_review_prompt,
    build_rework_prompt,
    parse_review_decision,
    persist_member_runtime_state,
    render_execution_dossier,
    render_review_for_group,
    restore_member_runtime_state,
    select_reviewer,
    write_group_deliverable,
)
from agenticx.runtime.prompts.current_time import build_current_time_block
from agenticx.branding import DEFAULT_META_PRODUCT_LABEL, LEGACY_META_LABELS

META_LEADER_AGENT_ID = "__meta__"
META_LEADER_NAME = "组长"
# Shown when the meta PM completion comes back with no visible content.
# Must NOT read like a progress report: an empty completion is a model/runtime
# condition, not a statement about project status.
_META_EMPTY_REPLY_NOTICE = (
    "这轮我没有产出内容（模型回复长度上限可能被推理占满）。"
    "请再发一次，或直接 @ 对应成员派活，例如「@程基岩 先搭一个能飞能撞的原型」。"
)
# Max @-mention follow-up hops per user turn.
# Can be overridden in ~/.agenticx/config.yaml under group_chat.mention_hops.
_DEFAULT_MENTION_HOPS = 2

# Maximum workers per group team session (maps to WorkforcePattern workers list).
MAX_WORKERS_PER_GROUP = 5
# Maximum subtasks the TaskPlannerAgent may produce.
MAX_DECOMPOSE_SUBTASKS = 10


def _get_mention_hops() -> int:
    """Read group_chat.mention_hops from config.yaml, default 2."""
    try:
        from agenticx.cli.config_manager import ConfigManager
        raw = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH) or {}
        val = raw.get("group_chat", {}).get("mention_hops")
        if isinstance(val, int) and 1 <= val <= 10:
            return val
    except Exception:
        pass
    return _DEFAULT_MENTION_HOPS


# Keep the module-level name for backward-compat callers that import it directly.
GROUP_MENTION_FOLLOWUP_HOPS = _DEFAULT_MENTION_HOPS


def resolve_studio_session_id(base_session: Any) -> str:
    """Resolve the studio chat UUID from a StudioSession-like object.

    ``StudioSession`` has no ``session_id`` field; the chat handler attaches
    ``_session_id`` / ``_usage_owner_session_id``. Prefer those over a bare
    ``session_id`` attribute (tests / mocks may set the latter).
    """
    for key in ("_session_id", "_usage_owner_session_id", "session_id"):
        val = str(getattr(base_session, key, "") or "").strip()
        if val:
            return val
    return ""


# Heuristic markers that hint a complex multi-step task suitable for Workforce
# task-board orchestration.  We deliberately keep this rule-based (no LLM call)
# so the fast path stays fast: simple questions remain on the single-LLM
# intelligent route.
_MULTISTEP_MARKERS_CN: tuple[str, ...] = (
    "然后",
    "接着",
    "再",
    "之后",
    "先后",
    "并且",
    "同时",
    "并行",
    "分别",
    "逐步",
    "分步",
    "步骤",
    "第一步",
    "第二步",
    "拆分",
    "分解",
    "调研",
    "研究",
)
# Bigram/ordering markers — must contain BOTH halves to count as a step pair.
_MULTISTEP_BIGRAMS_CN: tuple[tuple[str, str], ...] = (
    ("先", "后"),
    ("先", "再"),
    ("一", "二"),
    ("1)", "2)"),
    ("1.", "2."),
    ("1、", "2、"),
)
# Strong markers explicitly imply multi-step orchestration regardless of length.
_MULTISTEP_STRONG_MARKERS_CN: tuple[str, ...] = (
    "步骤",
    "第一步",
    "第二步",
    "拆分",
    "分解",
    "分步",
    "并行",
)
_MULTISTEP_MIN_LENGTH_FOR_WEAK = 20  # Weak markers require some prose around them.

# Explicit collaboration language should enter the reviewed team workflow even
# when the request does not contain ordering words such as “先/再”.  These are
# intentionally phrase-level markers so greetings like “大家好” remain cheap.
_COLLABORATIVE_TEAM_MARKERS_CN: tuple[str, ...] = (
    "大家讨论",
    "你们讨论",
    "一起讨论",
    "共同讨论",
    "分别分析",
    "各自分析",
    "一起分析",
    "共同分析",
    "交叉评审",
    "互相评审",
    "共同完成",
    "团队协作",
    "头脑风暴",
    "集思广益",
    "专家会诊",
    "开会讨论",
    "辩论一下",
)
_COLLABORATIVE_TEAM_PATTERNS_CN: tuple[str, ...] = (
    r"(?:大家|你们|各位|成员们|多个分身|几个分身).{0,10}(?:讨论|商量|分析|评审|提意见|给出意见)",
    r"(?:分别|各自|从各自角度).{0,10}(?:分析|回答|评估|判断|给出)",
)

# A collaborative discussion is not automatically an execution request.  Keep
# this distinction explicit so the Workforce path can fan out viewpoints
# without inventing implementation, deployment, or PoC work.
_ANALYSIS_ONLY_MARKERS_CN: tuple[str, ...] = (
    "分析",
    "对比",
    "比较",
    "竞品",
    "区别",
    "差异",
    "研究",
    "调研",
    "讨论",
    "评审",
    "评估",
    "总结",
    "视角",
    "观点",
    "优缺点",
    "利弊",
    "选型",
)
_ANALYSIS_ONLY_MARKERS_EN: tuple[str, ...] = (
    "analyze",
    "analyse",
    "analysis",
    "compare",
    "comparison",
    "competitor",
    "difference",
    "research",
    "discuss",
    "review",
    "evaluate",
)
_EXECUTION_PATTERNS_CN: tuple[str, ...] = (
    # Imperative/continuation cues prevent nouns such as “运行机制” and
    # “部署架构” from being mistaken for a request to run anything.
    r"(?:请|帮我|麻烦|直接|现在|接下来|然后|之后|以后|接着|并|再|先|开始)\s*"
    r"(?:执行|实现|开发|部署|上线|搭建|创建|运行|安装|验证|落地|接入|提交|发布|启动)",
    r"(?:请|帮我|麻烦|直接|现在|接下来|然后|之后|以后|接着|并|再|先|开始)?\s*"
    r"(?:写|修改|改|开发)\s*(?:一下|一段|一个|个)?\s*"
    r"(?:代码|脚本|功能|demo|PoC|原型)(?:验证|测试|运行|检查)?"
    r"(?=$|[\s\u3000，。！？、；;：:])",
    r"(?:执行|实现|部署|上线|搭建|创建|运行|安装|验证|落地|接入|提交|发布|启动)\s*"
    r"(?:一下|一个|个|这|该|此|这个|上述|方案|功能|代码|脚本|demo|PoC|原型|任务|流程|服务|项目|测试|命令)"
    r"(?=$|[\s\u3000，。！？、；;：:])",
    r"(?:拉仓库|克隆仓库|clone)\s*(?:下来|一下|到|这个)?",
    r"(?:用|通过|拿)\s*(?:一个|个)?\s*(?:PoC|demo|原型)\s*(?:验证|测试|跑)",
)
_EXECUTION_PATTERNS_EN: tuple[str, ...] = (
    r"\b(?:please|help me|go ahead|now|then|next|directly)\s+"
    r"(?:execute|implement|build|deploy|install|create|run|write|modify|start|launch|commit|publish)\b",
    r"\b(?:write|modify|build|create)\s+(?:a|an|the)?\s*"
    r"(?:code|script|demo|poc|prototype|feature)\b",
    r"\b(?:deploy|install|execute|implement|launch|publish|commit|run)\s+"
    r"(?:a|an|the|this|that)?\s*(?:poc|prototype|service|feature|plan|project|app|application|change|task|test|tests|command)\b",
    r"\b(?:clone|git\s+clone)\b",
)

_ANALYSIS_ONLY_SCOPE = """## 本轮范围：只做分析讨论（最高优先级）
- 只围绕用户当前问题提供事实、比较、不同视角、风险和不确定性分析。
- 不得把分析自行扩展成实施任务、代码修改、安装、部署、上线或 PoC；不得声称已安排或将要执行这些动作。
- 可以提出非执行性的判断或待确认项，但不能凭空新增目标、交付物或后续项目。
- 如果上下文里出现旧的计划、PoC 或部署内容，只把它们当作背景，不得继续推进；优先回答当前用户问题。
""".strip()

# Open-call markers — phrases where the user is broadcasting a question to the
# group rather than addressing one specific role. When matched and no member is
# explicitly @-mentioned, we prefer Near (the meta leader / project manager)
# to answer first and optionally point to one relevant member, instead of
# silently picking a single member via single-target route_to.
_OPEN_CALL_MARKERS_CN: tuple[str, ...] = (
    "群里谁",
    "谁能",
    "谁来",
    "谁知道",
    "哪位",
    "有人能",
    "有人知道",
    "请问群里",
    "在线的兄弟",
    "在线的同学",
)


def _is_open_call_question(user_input: str) -> bool:
    """Heuristic detector for "broadcast to group" style questions.

    Examples that should match (return True):
        - "群里谁能一句话说下 X 主要干啥的？"
        - "哪位帮我看下 ..."
        - "有人能讲讲 Y 吗？"

    Examples that should NOT match (return False):
        - "@小滴 帮我看下 X"
        - "machi 你觉得 X 怎么样"
        - "X 是什么？"
    """
    text = (user_input or "").strip()
    if not text:
        return False
    for marker in _OPEN_CALL_MARKERS_CN:
        if marker in text:
            return True
    return False


_PROGRESS_QUERY_MARKERS_CN = (
    "干活了吗",
    "干了吗",
    "怎么样了",
    "进展",
    "进度",
    "做完了吗",
    "完成了吗",
    "到哪了",
    "什么情况",
    "有结果了吗",
)


def _is_progress_query(user_input: str) -> bool:
    """True when the user is asking for execution progress rather than new work."""
    text = (user_input or "").strip()
    if not text:
        return False
    for marker in _PROGRESS_QUERY_MARKERS_CN:
        if marker in text:
            return True
    return False


def _append_zero_exec_fallback(reply: GroupReply, facts: GroupExecutionFacts) -> GroupReply:
    line = format_zero_exec_fallback(facts)
    body = str(reply.content or "").rstrip()
    if line in body:
        return reply
    reply.content = f"{body}\n{line}" if body else line
    return reply


def _is_complex_multistep_task(user_input: str) -> bool:
    """Heuristic detector for complex multi-step tasks.

    Returns True if the message looks like it should be decomposed into
    subtasks and orchestrated by the Workforce path; False for simple
    questions / chitchat.

    The heuristic is intentionally conservative: false negatives (a complex
    task slipping through to legacy intelligent) are acceptable; false
    positives (a simple question wrongly routed to Workforce) are NOT,
    because they incur token overhead and unnecessary task decomposition.
    """
    text = (user_input or "").strip()
    if not text:
        return False

    # Strong markers fire regardless of length.
    for marker in _MULTISTEP_STRONG_MARKERS_CN:
        if marker in text:
            return True

    # Bigram ordering markers (e.g. "先...后..." / "1)...2)") fire regardless of length.
    for first, second in _MULTISTEP_BIGRAMS_CN:
        idx_first = text.find(first)
        if idx_first == -1:
            continue
        idx_second = text.find(second, idx_first + len(first))
        if idx_second != -1:
            return True

    # Weak markers require some prose to avoid matching short questions
    # like "再来一个" / "然后呢".
    if len(text) < _MULTISTEP_MIN_LENGTH_FOR_WEAK:
        return False
    for marker in _MULTISTEP_MARKERS_CN:
        if marker in text:
            return True
    return False


def _is_collaborative_team_request(user_input: str) -> bool:
    """True for an explicit request that several group members collaborate."""
    text = (user_input or "").strip()
    if not text:
        return False
    if any(marker in text for marker in _COLLABORATIVE_TEAM_MARKERS_CN):
        return True
    return any(re.search(pattern, text) for pattern in _COLLABORATIVE_TEAM_PATTERNS_CN)


def _is_analysis_only_request(user_input: str) -> bool:
    """Return True for research/discussion turns without explicit execution intent."""
    text = (user_input or "").strip()
    if not text:
        return False
    lowered = text.casefold()
    has_analysis_marker = any(
        marker in text for marker in _ANALYSIS_ONLY_MARKERS_CN
    ) or any(marker in lowered for marker in _ANALYSIS_ONLY_MARKERS_EN)
    if not has_analysis_marker:
        return False
    has_explicit_execution = any(
        re.search(pattern, text, flags=re.IGNORECASE)
        for pattern in _EXECUTION_PATTERNS_CN
    ) or any(
        re.search(pattern, lowered) for pattern in _EXECUTION_PATTERNS_EN
    )
    return not has_explicit_execution


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
    for alias in (META_LEADER_NAME, "meta-agent", "meta agent", *LEGACY_META_LABELS):
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


def _group_chat_tools(*, analysis_only: bool = False) -> Sequence[Dict[str, Any]]:
    blocked = {"delegate_to_avatar"}
    tools = [
        tool
        for tool in STUDIO_TOOLS
        if tool.get("function", {}).get("name") not in blocked
    ]
    if not analysis_only:
        return tools

    # Discussion turns may still need evidence gathering, but must not expose
    # mutating tools such as file_write, shell execution, skill installation, or
    # delegation.  Keep this allow-list deliberately narrow.
    readonly_names = {
        "file_read",
        "skill_list",
        "scratchpad_read",
        "memory_search",
        "session_search",
        "list_files",
        "liteparse",
        "knowledge_search",
        "knowledge_synthesize",
        "web_search",
        "web_fetch",
        "view_image",
        "show_widget",
        "get_current_datetime",
        "list_data_sources",
        "code_outline",
        "lsp_goto_definition",
        "lsp_find_references",
        "lsp_hover",
        "lsp_diagnostics",
    }
    return [
        tool
        for tool in tools
        if tool.get("function", {}).get("name") in readonly_names
    ]


_GROUP_MEMBER_RUNTIME_FLAG_ATTRS = (
    "_thinking_enabled",
    "_reasoning_effort",
    "kb_retrieval_mode",
)


def _copy_group_member_runtime_flags(base_session: Any, local_session: Any) -> None:
    """Copy pane thinking / KB flags onto the per-member turn session."""
    for attr in _GROUP_MEMBER_RUNTIME_FLAG_ATTRS:
        if hasattr(base_session, attr):
            setattr(local_session, attr, getattr(base_session, attr))


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
    # Structured fields for graph projection / member activity side panel.
    graph_run_id: str = ""
    graph_node_id: str = ""
    tool_name: str = ""
    tool_phase: str = ""  # "calling" | "done" | ""
    tool_call_id: str = ""
    clarify_options: List[str] = field(default_factory=list)
    clarify_allow_free_text: bool = True
    # Team workflow semantics for the desktop group-chat timeline.
    # These fields are optional so legacy routing keeps the same behaviour.
    workflow_role: str = ""  # leader | executor | reviewer | system
    workflow_task_id: str = ""
    workflow_attempt: int = 0
    workflow_status: str = ""


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
        clarify_gate_factory: Callable[[str], "AsyncClarifyGate"] | None = None,
    ) -> None:
        self.avatar_registry = avatar_registry
        self.llm_factory = llm_factory
        self.max_tool_rounds = max(1, int(max_tool_rounds))
        label = str(meta_leader_display_name or "").strip()
        self._meta_leader_label = label or DEFAULT_META_PRODUCT_LABEL
        self._confirm_gate_factory = confirm_gate_factory
        self._clarify_gate_factory = clarify_gate_factory

    @staticmethod
    def _typing_event(
        agent_id: str,
        avatar_name: str,
        *,
        workflow_role: str = "",
        workflow_task_id: str = "",
        workflow_attempt: int = 0,
    ) -> GroupReply:
        return GroupReply(
            agent_id=agent_id,
            avatar_name=avatar_name,
            avatar_url="",
            content="",
            skipped=True,
            event_type="group_typing",
            workflow_role=workflow_role,
            workflow_task_id=workflow_task_id,
            workflow_attempt=max(0, int(workflow_attempt or 0)),
        )

    def _graph_member_labels(self, group_avatar_ids: Sequence[str]) -> Dict[str, str]:
        """avatar_id → display name for Run Graph node labels (not hex ids)."""
        labels: Dict[str, str] = {META_LEADER_AGENT_ID: self._meta_leader_label}
        for aid in group_avatar_ids:
            sid = str(aid or "").strip()
            if not sid:
                continue
            avatar = self.avatar_registry.get_avatar(sid)
            name = str(getattr(avatar, "name", "") or "").strip() if avatar else ""
            if name:
                labels[sid] = name
        return labels

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
        for legacy in LEGACY_META_LABELS:
            m[str(legacy).casefold()] = META_LEADER_AGENT_ID
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
        graph_run_id: str = "",
        graph_node_id: str = "",
    ) -> GroupReply:
        """Build one progress event row for group chat streaming."""
        return GroupReply(
            agent_id=agent_id,
            avatar_name=avatar_name,
            avatar_url=avatar_url,
            content=str(text or "").strip(),
            skipped=True,
            event_type="group_progress",
            graph_run_id=str(graph_run_id or "").strip(),
            graph_node_id=str(graph_node_id or "").strip(),
        )

    @staticmethod
    def _runtime_event_to_progress_text(event_type: str, data: Dict[str, Any]) -> str:
        """Map runtime event to user-visible progress text."""
        et = str(event_type or "")
        if et == EventType.ROUND_START.value:
            # No chat-line for round start — frontend shows the expert label +
            # stream placeholder instead of a noisy "开始处理任务..." row.
            return ""
        if et == EventType.TOOL_CALL.value:
            tool_name = str(data.get("name", "") or data.get("tool_name", "") or "tool")
            # Keep status scannable; args belong in side-panel detail, not the line.
            return f"正在调用工具：{tool_name}"
        if et == EventType.TOOL_RESULT.value:
            tool_name = str(data.get("name", "") or data.get("tool_name", "") or "tool")
            # Result body belongs to the assistant reply / side panel detail, not the
            # one-line status. Keep the status row scannable.
            return f"工具已完成：{tool_name}"
        if et == EventType.CONFIRM_REQUIRED.value:
            question = str(data.get("question", "") or "").strip()
            if question:
                return f"等待确认后继续执行：{question}"
            return "等待确认后继续执行"
        if et == EventType.CLARIFICATION_REQUIRED.value:
            prompt = str(data.get("prompt", "") or "").strip()
            return prompt or "等待你的输入后继续"
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
    def _should_enqueue_runtime_event(event_type: str, progress_text: str) -> bool:
        """HITL events must enqueue even when the progress line is empty."""
        group_evt = GroupChatRouter._runtime_event_to_group_event_type(event_type)
        if group_evt in {"group_blocked", "group_clarification"}:
            return True
        return bool(str(progress_text or "").strip())

    @staticmethod
    def _should_forward_progress(reply: "GroupReply") -> bool:
        """Stream filter: keep HITL rows even if content was stripped."""
        if str(getattr(reply, "event_type", "") or "") in {"group_blocked", "group_clarification"}:
            return True
        return bool(str(getattr(reply, "content", "") or "").strip())

    @staticmethod
    def _runtime_event_to_tool_step(event_type: str, data: Dict[str, Any]) -> Dict[str, str]:
        """Structured tool step for graph projection (no long previews)."""
        et = str(event_type or "")
        if et == EventType.TOOL_CALL.value:
            phase = "calling"
        elif et == EventType.TOOL_RESULT.value:
            phase = "done"
        else:
            return {}
        tool_name = str(data.get("name", "") or data.get("tool_name", "") or "tool")
        call_id = str(data.get("id", "") or data.get("tool_call_id", "") or "")
        return {"tool_name": tool_name, "tool_phase": phase, "tool_call_id": call_id}

    @staticmethod
    def _graph_run_id_of(base_session: StudioSession) -> str:
        pad = getattr(base_session, "scratchpad", None)
        if not isinstance(pad, dict):
            return ""
        return str(pad.get("graph_run_id") or "").strip()

    @staticmethod
    def _graph_node_id_for_agent(agent_id: str) -> str:
        aid = str(agent_id or "").strip()
        if not aid:
            return ""
        if aid.startswith("agent:"):
            return aid
        return f"agent:{aid}"

    @staticmethod
    def _runtime_event_to_group_event_type(event_type: str) -> str:
        """Map runtime event type to group progress event type."""
        et = str(event_type or "")
        if et == EventType.CONFIRM_REQUIRED.value:
            return "group_blocked"
        if et == EventType.CLARIFICATION_REQUIRED.value:
            return "group_clarification"
        return "group_progress"

    def _graph_sse_reply(self, etype: str, data: Dict[str, Any]) -> GroupReply:
        """Wrap a graph.* payload as a skipped GroupReply for chat SSE passthrough."""
        return GroupReply(
            agent_id=META_LEADER_AGENT_ID,
            avatar_name="Graph",
            avatar_url="",
            content=json.dumps(data, ensure_ascii=False),
            skipped=True,
            event_type=str(etype),
        )

    def _project_a2a_message_edge(
        self,
        *,
        base_session: StudioSession,
        group_id: str,
        group_avatar_ids: Sequence[str],
        source_agent_id: str,
        target_agent_id: str,
        summary: str = "",
    ) -> List[GroupReply]:
        """Persist MESSAGE edge on presence/workforce run and return SSE replies."""
        try:
            from agenticx.runtime.graph.social import (
                ensure_presence_run,
                message_edge_events,
                note_debate_edge,
                upsert_message_edge,
            )
            from agenticx.runtime.graph.store import get_default_store

            pad = getattr(base_session, "scratchpad", None)
            if not isinstance(pad, dict):
                pad = {}
                try:
                    setattr(base_session, "scratchpad", pad)
                except Exception:
                    return []
            existing = str(pad.get("graph_run_id") or "").strip() or None
            member_labels = self._graph_member_labels(group_avatar_ids)
            run = ensure_presence_run(
                session_id=resolve_studio_session_id(base_session),
                group_id=group_id,
                member_ids=list(group_avatar_ids) + [META_LEADER_AGENT_ID],
                store=get_default_store(),
                existing_run_id=existing,
                member_labels=member_labels,
            )
            pad["graph_run_id"] = run.run_id
            src = (
                f"agent:{source_agent_id}"
                if not str(source_agent_id).startswith("agent:")
                else str(source_agent_id)
            )
            tgt = (
                f"agent:{target_agent_id}"
                if not str(target_agent_id).startswith("agent:")
                else str(target_agent_id)
            )
            edge = upsert_message_edge(run, source=src, target=tgt, label="mention")
            get_default_store().save(run, bump_version=True)
            note_debate_edge(pad, source=src, target=tgt)
            out: List[GroupReply] = []
            for ev in message_edge_events(run, edge, summary=summary):
                et = str(ev.get("type") or "graph.edge_flow")
                out.append(self._graph_sse_reply(et, ev))
            return out
        except Exception:
            return []

    def _project_h2a_fanout(
        self,
        *,
        base_session: StudioSession,
        group_id: str,
        group_avatar_ids: Sequence[str],
        target_agent_ids: Sequence[str],
    ) -> List[GroupReply]:
        try:
            from agenticx.runtime.graph.social import (
                ensure_presence_run,
                note_debate_edge,
                project_h2a_fanout,
            )
            from agenticx.runtime.graph.store import get_default_store

            pad = getattr(base_session, "scratchpad", None)
            if not isinstance(pad, dict):
                pad = {}
                try:
                    setattr(base_session, "scratchpad", pad)
                except Exception:
                    return []
            existing = str(pad.get("graph_run_id") or "").strip() or None
            member_labels = self._graph_member_labels(group_avatar_ids)
            run = ensure_presence_run(
                session_id=resolve_studio_session_id(base_session),
                group_id=group_id,
                member_ids=list(group_avatar_ids) + [META_LEADER_AGENT_ID],
                store=get_default_store(),
                existing_run_id=existing,
                member_labels=member_labels,
            )
            pad["graph_run_id"] = run.run_id
            edges, events = project_h2a_fanout(
                run, target_agent_ids, member_labels=member_labels
            )
            for edge in edges:
                note_debate_edge(pad, source=edge.source, target=edge.target)
            get_default_store().save(run, bump_version=True)
            return [
                self._graph_sse_reply(str(ev.get("type") or "graph.edge_updated"), ev)
                for ev in events
            ]
        except Exception:
            return []

    def _maybe_yield_debate_nudge(self, base_session: StudioSession) -> List[GroupReply]:
        try:
            from agenticx.runtime.graph.social import maybe_debate_nudge

            pad = getattr(base_session, "scratchpad", None)
            if not isinstance(pad, dict):
                return []
            text = maybe_debate_nudge(pad)
            if not text:
                return []
            return [
                GroupReply(
                    agent_id=META_LEADER_AGENT_ID,
                    avatar_name=self._meta_leader_label,
                    avatar_url="",
                    content=text,
                    skipped=True,
                    event_type="graph.debate_nudge",
                )
            ]
        except Exception:
            return []

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
        # Selection-rule converge policy can suppress A2A mention hops.
        try:
            from agenticx.runtime.graph.intervene import effective_mention_hops

            pad = getattr(base_session, "scratchpad", None)
            if isinstance(pad, dict):
                hops = effective_mention_hops(pad, hops)
        except Exception:
            pass
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
            for ge in self._project_a2a_message_edge(
                base_session=base_session,
                group_id=group_id,
                group_avatar_ids=group_avatar_ids,
                source_agent_id=str(reply.agent_id),
                target_agent_id=str(tid),
                summary=(reply.content or "")[:80],
            ):
                yield ge
            for nudge in self._maybe_yield_debate_nudge(base_session):
                yield nudge
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

        def _once(budget: int) -> tuple[str, str]:
            try:
                response = llm.invoke(
                    messages,
                    temperature=temperature,
                    max_tokens=budget,
                )
            except TypeError:
                response = llm.invoke(messages)
            text = self._extract_text(response)
            reason = ""
            choices = getattr(response, "choices", None) or []
            if choices:
                reason = str(getattr(choices[0], "finish_reason", "") or "")
            return text, reason

        text, finish_reason = _once(max_tokens)
        if not text.strip() and finish_reason.lower() == "length":
            retry_budget = min(int(max_tokens) * 2, 8000)
            _log.warning(
                "group_router: empty completion truncated by budget "
                "(finish_reason=length, max_tokens=%s); retrying with %s",
                max_tokens,
                retry_budget,
            )
            text, finish_reason = _once(retry_budget)
        return text

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

    def _collect_group_execution_facts(self, base_session: StudioSession) -> GroupExecutionFacts:
        history = getattr(base_session, "chat_history", None)
        if not isinstance(history, list):
            history = []
        taskspaces = getattr(base_session, "taskspaces", None)
        if not isinstance(taskspaces, list):
            taskspaces = []
        avatar_ids = getattr(base_session, "__group_avatar_ids", None) or []
        return build_group_execution_facts(
            chat_history=history,
            members=self._avatar_member_summary(avatar_ids),
            taskspaces=taskspaces,
            session_id=resolve_studio_session_id(base_session),
        )

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
                max_tokens=group_intent_max_tokens(),
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
        if not payload:
            _log.warning(
                "group_router: intent JSON unparsable (text_len=%s); "
                "falling back to meta_direct",
                len(str(text or "")),
            )
        action = str(payload.get("action", "") or "").strip().lower()
        raw_targets = payload.get("target_ids", [])
        if not isinstance(raw_targets, list):
            raw_targets = []
        target_ids = [str(x).strip() for x in raw_targets if str(x).strip() in member_ids]
        reason = str(payload.get("reason", "") or "").strip() or (
            "intent_parse_failed" if not payload else "llm_decision"
        )
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
        facts: GroupExecutionFacts | None = None,
        delivery_mode: bool = False,
    ) -> GroupReply:
        members_summary = GroupChatContext.render_members_summary(
            self._avatar_member_summary(getattr(base_session, "__group_avatar_ids", []) or [])
        )
        if facts is None:
            facts = self._collect_group_execution_facts(base_session)
        facts_block = render_facts_block(facts)
        provider = getattr(base_session, "provider_name", None)
        model = getattr(base_session, "model_name", None)
        local_user_input = user_input
        if quoted_content.strip():
            local_user_input = f"{user_input}\n\n[用户引用内容]\n{quoted_content.strip()}"
        u = str(user_display_name or "").strip() or "用户"
        analysis_only = getattr(base_session, "_group_analysis_only", False) is True
        if delivery_mode:
            if analysis_only:
                reply_style = (
                    "这是只做分析讨论的团队收口轮次。你必须基于执行档案整合不同视角，"
                    "不得把分析结论升级成执行计划。\n"
                )
                length_rules = (
                    "## 分析收口结构（必须遵守）\n"
                    "- 先给与用户问题直接对应的结论，再整合各视角的共识、分歧和证据边界。\n"
                    "- 单列未决风险和无法验证的边界；不要新增 PoC、部署、实现或其他执行任务。\n"
                    "- 不要强行补可执行的下一步；如确有必要，只列为待用户确认的事项。\n\n"
                )
            else:
                reply_style = (
                    "这是经过成员执行和独立审核的团队交付轮次。你必须基于执行档案做负责人收口，"
                    "不能把完整产出压缩成普通闲聊。\n"
                )
                length_rules = (
                    "## 交付结构（必须遵守）\n"
                    "- 先给明确结论，再整合各阶段通过版本。\n"
                    "- 单列审核状态、未决风险和无法验证的边界；失败阶段不得包装成完成。\n"
                    "- 给出可执行的下一步；避免重复成员原话，但保留关键事实和必要细节。\n\n"
                )
            progress_rules = (
                "## 进展陈述规则（团队交付）\n"
                "- 用户问题中的「团队执行档案」与上方「群工作台事实」共同构成本轮权威事实。\n"
                "- 若两者对本轮节点执行状态存在冲突，以带 task_id、审核状态和产出的执行档案为准；"
                "不得用泛化的历史投影覆盖本轮记录。\n"
                "- failed / blocked / cancelled 阶段必须明说未闭环；没有产物时不得虚构完成度。\n\n"
            )
        else:
            if analysis_only:
                reply_style = "这是只做分析讨论的群聊收口：短、清晰、严格围绕用户问题，不主动转入执行。\n"
                length_rules = (
                    "## 分析回复长度（必须遵守）\n"
                    "- 默认 2–6 句或少量要点，优先给结论、证据、分歧和风险。\n"
                    "- 不主动写实施方案、PoC、部署步骤或执行清单；不要为了显得完整而新增目标。\n\n"
                )
            else:
                reply_style = "默认像微信群聊里的组长发言：短、清晰、可执行，先给结论再补关键点。\n"
                length_rules = (
                    "## 回复长度（必须遵守）\n"
                    "- 默认短聊：通常 2–6 句或少量要点，不要主动写长报告、完整验收表、大段 Markdown 表格。\n"
                    "- 仅当用户明确要求报告/验收清单/完整方案/详细对照表，或问题本身必须交付长文材料时，"
                    "才展开长篇；展开前可先一句说明「下面按验收项展开」。\n"
                    "- 未明确要求长文时：用要点概括关键结论 + 下一步，把细表留给用户追问。\n\n"
                )
            progress_rules = (
                "## 进展陈述规则（必须遵守）\n"
                "- 只能依据上方「群工作台事实」陈述执行进展；事实块之外的进展一律不得声称。\n"
                "- 若某成员列在「从未执行过」，必须明说该成员还没开始，禁止描述其产出、完成度或草稿状态。\n"
                "- 无产出文件时，禁止给出「已跑通」「写了一半」「出了第一版」这类具体完成度描述。\n"
                "- 你自己或他人在历史消息里的「计划 / 安排 / 将要」不等于已执行，不得当作进展复述。\n\n"
            )
        prompt = (
            f"你是群聊「{group_name}」的项目经理兼组长。\n"
            f"{reply_style}"
            "你可以综合所有成员最近发言给出全局判断。\n"
            "禁止输出工具调用细节。\n"
            f"{length_rules}"
            f"人类提问者显示名：{u}。请直接对该用户作答（可用「你」或其显示名），不要无故把主答对象换成 @ 某位分身，除非在明确指派后续跟进。\n\n"
            f"群成员:\n{members_summary}\n\n"
            f"{facts_block}\n\n"
            f"{progress_rules}"
            f"最近群聊上下文:\n{context.render_recent_dialogue()}\n\n"
            f"用户问题:\n{local_user_input}\n\n"
            f"{extra_instruction.strip()}\n"
            f"{_ANALYSIS_ONLY_SCOPE if analysis_only else ''}\n"
        )
        text = await self._call_llm_text(
            provider=provider,
            model=model,
            prompt=prompt,
            temperature=0.2,
            max_tokens=(
                max(4_000, group_meta_reply_max_tokens())
                if delivery_mode
                else group_meta_reply_max_tokens()
            ),
        )
        final_text = text.strip()
        if not final_text:
            _log.warning(
                "group_router: meta PM reply empty after retry; emitting no-output notice"
            )
            final_text = _META_EMPTY_REPLY_NOTICE
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
        append_to_context: bool = True,
    ) -> GroupReply:
        analysis_only = getattr(base_session, "_group_analysis_only", False) is True
        addressing = self._group_user_addressing_rules(user_display_name)
        if avatar_id == META_LEADER_AGENT_ID:
            avatar_name = self._meta_leader_label
            avatar_role = "Group Leader"
            avatar_prompt = (
                "你是群聊组长兼项目经理。优先用工具（搜索、查文档）研究问题后给出有信号量的短答复；"
                "仅在真正需要专业成员动手执行时才 @ 委派。"
                "默认微信群短聊风格；仅用户明确要报告/清单/长文时才展开。不要输出工具调用细节。"
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
        _copy_group_member_runtime_flags(base_session, local_session)
        try:
            restore_member_runtime_state(
                base_session,
                local_session,
                group_id=group_id,
                avatar_id=avatar_id,
            )
        except Exception as exc:
            _log.warning(
                "group member context restore failed group=%s avatar=%s: %s",
                group_id,
                avatar_id,
                exc,
            )

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
            f"{build_current_time_block()}"
            "## 行为要求\n"
            "- 你是微信群聊中的一个成员，遵循自然对话风格。\n"
            f"{force_rule}"
            "- 若需要回答，请直接给完整答案，不要流式、不分段。\n"
            "- 默认短聊：像真人在微信群里说话——先结论，再补 2–5 个关键点；"
            "不要主动输出长报告、完整验收清单、大段对照表或说明书式长文。\n"
            "- 仅当用户明确要「报告 / 验收清单 / 完整方案 / 详细表格 / 长文」，"
            "或当前问题显然是在交付文档材料时，才仔细展开长篇；否则保持短回复，细项留给追问。\n"
            "- 回答有执行性，贴合你的角色职责；能一句话说清就不要写成章节。\n"
            "- 你能看到其他成员最近发言，可基于上下文补充或纠正。\n"
            "- 查看「最近群聊上下文」，若已有成员提出了相同的澄清问题，不要重复；"
            "给出你独特的专业判断、不同视角，或主动用工具查找答案。\n"
            "- 当你能通过搜索等工具找到答案时，优先研究后直接给出结论，而非反问用户。\n\n"
            f"## 你的长期指令\n{avatar_prompt or '(无)'}\n\n"
            f"## 最近群聊上下文\n{dialogue_context}\n"
        )
        if analysis_only:
            system_prompt = f"{system_prompt}\n\n{_ANALYSIS_ONLY_SCOPE}\n"
        # Graph Runtime interventions queued on the owner session scratchpad.
        try:
            from agenticx.runtime.graph.intervene import consume_graph_directives

            owner_pad = getattr(base_session, "scratchpad", None)
            if isinstance(owner_pad, dict):
                gdirs = consume_graph_directives(owner_pad, str(avatar_id))
                if gdirs:
                    joined = "\n".join(f"- {d}" for d in gdirs)
                    system_prompt = (
                        f"{system_prompt}\n"
                        "## Graph intervention (authoritative)\n"
                        f"{joined}\n"
                    )
        except Exception:
            pass
        if quoted_content.strip():
            local_user_input = f"{user_input}\n\n[用户引用内容]\n{quoted_content.strip()}"
        else:
            local_user_input = user_input

        confirm_gate = (
            self._confirm_gate_factory(avatar_id)
            if self._confirm_gate_factory is not None
            else AsyncConfirmGate()
        )
        clarify_gate = (
            self._clarify_gate_factory(avatar_id)
            if self._clarify_gate_factory is not None
            else AsyncClarifyGate()
        )
        runtime = AgentRuntime(
            llm,
            confirm_gate,
            max_tool_rounds=self.max_tool_rounds,
            clarify_gate=clarify_gate,
        )
        graph_run_id = self._graph_run_id_of(base_session)
        graph_node_id = self._graph_node_id_for_agent(avatar_id)
        if progress_queue is not None:
            progress_queue.put_nowait(
                self._progress_reply(
                    agent_id=avatar_id,
                    avatar_name=avatar_name,
                    avatar_url=avatar_url,
                    text="已接收任务，正在分析...",
                    graph_run_id=graph_run_id,
                    graph_node_id=graph_node_id,
                )
            )
        final_text = ""
        error_text = ""

        async def _runtime_events() -> AsyncGenerator[Any, None]:
            try:
                async for runtime_event in runtime.run_turn(
                    local_user_input,
                    local_session,
                    should_stop=lambda: self._should_stop(should_stop),
                    agent_id=avatar_id,
                    tools=_group_chat_tools(analysis_only=analysis_only),
                    system_prompt=system_prompt,
                    usage_session_id=str(
                        getattr(base_session, "_usage_owner_session_id", "") or ""
                    ),
                    usage_avatar_id=str(avatar_id or ""),
                ):
                    yield runtime_event
            finally:
                try:
                    persist_member_runtime_state(
                        base_session,
                        local_session,
                        group_id=group_id,
                        avatar_id=avatar_id,
                    )
                except Exception as exc:
                    _log.warning(
                        "group member context persist failed group=%s avatar=%s: %s",
                        group_id,
                        avatar_id,
                        exc,
                    )

        async for event in _runtime_events():
            if progress_queue is not None:
                progress_text = self._runtime_event_to_progress_text(event.type, event.data)
                group_evt_type = self._runtime_event_to_group_event_type(event.type)
                if self._should_enqueue_runtime_event(event.type, progress_text):
                    confirm_request_id = (
                        str(event.data.get("id", "") or "")
                        if group_evt_type in ("group_blocked", "group_clarification")
                        else ""
                    )
                    tool_step = self._runtime_event_to_tool_step(event.type, event.data)
                    raw_opts = event.data.get("options") if group_evt_type == "group_clarification" else None
                    clarify_options = (
                        [str(o).strip() for o in raw_opts if str(o).strip()]
                        if isinstance(raw_opts, list)
                        else []
                    )
                    progress_queue.put_nowait(
                        GroupReply(
                            agent_id=avatar_id,
                            avatar_name=avatar_name,
                            avatar_url=avatar_url,
                            content=progress_text
                            or str(event.data.get("prompt", "") or event.data.get("question", "") or "").strip()
                            or "等待你的输入后继续",
                            skipped=True,
                            event_type=group_evt_type,
                            confirm_request_id=confirm_request_id,
                            graph_run_id=graph_run_id,
                            graph_node_id=graph_node_id,
                            tool_name=tool_step.get("tool_name", ""),
                            tool_phase=tool_step.get("tool_phase", ""),
                            tool_call_id=tool_step.get("tool_call_id", ""),
                            clarify_options=clarify_options,
                            clarify_allow_free_text=event.data.get("allow_free_text") is not False,
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
        if append_to_context:
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
        append_to_context: bool = True,
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
                append_to_context=append_to_context,
            )
        )
        while not task.done():
            try:
                progress = await asyncio.wait_for(queue.get(), timeout=0.2)
                if self._should_forward_progress(progress):
                    yield progress
            except asyncio.TimeoutError:
                continue
        while not queue.empty():
            progress = queue.get_nowait()
            if self._should_forward_progress(progress):
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
        analysis_only = getattr(base_session, "_group_analysis_only", False) is True
        # ── Auto-dispatch to Workforce path for complex multi-step tasks ──────
        # If the user did NOT @-mention anyone AND the message looks like a
        # multi-step task AND we have at least 2 members, hand off to the
        # team / Workforce path so the user gets structured task decomposition
        # without having to choose a routing strategy.
        explicit_member_mentions = [m for m in mention_set if m in valid_members]
        if (
            not explicit_member_mentions
            and META_LEADER_AGENT_ID not in mention_set
            and len(valid_members) >= 2
            and (
                _is_complex_multistep_task(user_input)
                or _is_collaborative_team_request(user_input)
            )
        ):
            async for reply in self._run_team_turn(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                group_avatar_ids=group_avatar_ids,
                user_input=user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
                user_display_name=user_display_name,
                analysis_only=analysis_only,
            ):
                yield reply
            return
        # ── Open-call broadcast questions go to Near first ─────────────────
        # When the user is broadcasting to the group ("群里谁能…", "哪位…")
        # without naming anyone, prefer the meta leader (Near) as the
        # primary responder and let her optionally point to one relevant
        # member at the end. This avoids silently funnelling every open
        # question to a single member via single-target route_to.
        if (
            not explicit_member_mentions
            and META_LEADER_AGENT_ID not in mention_set
            and len(valid_members) >= 1
            and _is_open_call_question(user_input)
        ):
            context.clear_active_thread()
            for ge in self._project_h2a_fanout(
                base_session=base_session,
                group_id=group_id,
                group_avatar_ids=group_avatar_ids,
                target_agent_ids=[META_LEADER_AGENT_ID],
            ):
                yield ge
            yield self._typing_event(META_LEADER_AGENT_ID, self._meta_leader_label)
            if await self._should_stop(should_stop):
                return
            pm = await self._run_meta_project_manager_reply(
                base_session=base_session,
                context=context,
                group_name=group_name,
                user_input=user_input,
                quoted_content=quoted_content,
                extra_instruction=(
                    "用户在群里发起的是开放性提问（『群里谁能…』『哪位…』），请你以项目经理身份"
                    "**直接给出一句到三句话的核心答案**；如确实存在某位成员更适合补充细节，"
                    "可在结尾追加一行『需要 XX 的细节可以问 @某某』，不要把主答交给成员。"
                ),
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
                hops=_get_mention_hops(),
                responded_this_turn=responded_this_turn,
            ):
                yield fu
            return
        if META_LEADER_AGENT_ID in mention_set:
            context.clear_active_thread()
            for ge in self._project_h2a_fanout(
                base_session=base_session,
                group_id=group_id,
                group_avatar_ids=group_avatar_ids,
                target_agent_ids=[META_LEADER_AGENT_ID],
            ):
                yield ge
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
                hops=_get_mention_hops(),
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
            for ge in self._project_h2a_fanout(
                base_session=base_session,
                group_id=group_id,
                group_avatar_ids=group_avatar_ids,
                target_agent_ids=[META_LEADER_AGENT_ID],
            ):
                yield ge
            yield self._typing_event(META_LEADER_AGENT_ID, self._meta_leader_label)
            if await self._should_stop(should_stop):
                return
            facts = self._collect_group_execution_facts(base_session)
            extra_instruction = "请从项目经理视角直接回答。"
            zero_exec_progress = _is_progress_query(user_input) and not facts.has_any_execution
            if zero_exec_progress:
                extra_instruction = (
                    "本会话尚无任何成员实际执行记录，请如实说明还没开始，"
                    "不要描述任何产出或完成度。\n"
                    + extra_instruction
                )
            if group_meta_direct_tools_enabled():
                pm = None
                async for pm_evt in self._run_one_target_stream(
                    base_session=base_session,
                    context=context,
                    group_id=group_id,
                    group_name=group_name,
                    avatar_id=META_LEADER_AGENT_ID,
                    user_input=user_input,
                    quoted_content=quoted_content,
                    should_stop=should_stop,
                    force_reply=True,
                    user_display_name=user_display_name,
                ):
                    if (
                        zero_exec_progress
                        and pm_evt.event_type in {"group_reply", "group_skipped"}
                    ):
                        pm_evt = _append_zero_exec_fallback(pm_evt, facts)
                    yield pm_evt
                    if pm_evt.event_type in {"group_reply", "group_skipped"}:
                        pm = pm_evt
                if pm is None:
                    return
            else:
                pm = await self._run_meta_project_manager_reply(
                    base_session=base_session,
                    context=context,
                    group_name=group_name,
                    user_input=user_input,
                    quoted_content=quoted_content,
                    extra_instruction=extra_instruction,
                    user_display_name=user_display_name,
                    facts=facts,
                )
                if zero_exec_progress:
                    pm = _append_zero_exec_fallback(pm, facts)
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
                hops=_get_mention_hops(),
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
        # H2A fan-out: project human→agent MESSAGE edges for God-View.
        if primary_targets:
            for ge in self._project_h2a_fanout(
                base_session=base_session,
                group_id=group_id,
                group_avatar_ids=group_avatar_ids,
                target_agent_ids=primary_targets,
            ):
                yield ge
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
                hops=_get_mention_hops(),
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
                hops=_get_mention_hops(),
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
            hops=_get_mention_hops(),
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
            hops=_get_mention_hops(),
            responded_this_turn=responded_this_turn,
        ):
            yield fu

    # ──────────────────────────────────────────────────────────────────────────
    # Team routing path (routing == "team")
    # Hybrid stack: WorkforcePattern for *planning*, AgentRuntime for *execution*.
    # See docs/adr/0002-group-chat-workforce-bridge.md for rationale.
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _build_planning_agent(name: str, role: str, goal: str) -> "Any":
        """Construct a lightweight core.Agent for the planning layer (decompose/assign)."""
        from agenticx.core.agent import Agent
        return Agent(name=name, role=role, goal=goal, organization_id="agenticx")

    @staticmethod
    def _workforce_event_to_group_reply(
        evt: Any,
        *,
        agent_id: str = META_LEADER_AGENT_ID,
        avatar_name: str = "组长",
        avatar_url: str = "",
    ) -> "GroupReply":
        """Map a WorkforceEvent to a GroupReply so the existing SSE pipeline can stream it."""
        from agenticx.collaboration.workforce.events import WorkforceEvent
        if not isinstance(evt, WorkforceEvent):
            return GroupReply(
                agent_id=agent_id,
                avatar_name=avatar_name,
                avatar_url=avatar_url,
                content=str(evt),
                skipped=True,
                event_type="workforce.unknown",
            )
        data = evt.data or {}
        # Derive readable content for the UI from common data fields.
        content = (
            data.get("text")
            or data.get("result")
            or data.get("task_description")
            or data.get("error")
            or ""
        )
        agent_id_override = evt.agent_id or agent_id
        # Map action → event_type namespace for frontend classification.
        event_type = f"workforce.{evt.action.value}"
        return GroupReply(
            agent_id=agent_id_override,
            avatar_name=avatar_name,
            avatar_url=avatar_url,
            content=str(content).strip(),
            skipped=False,
            event_type=event_type,
            workflow_role=("leader" if agent_id_override == META_LEADER_AGENT_ID else "system"),
            workflow_task_id=str(evt.task_id or ""),
            workflow_status=str(evt.action.value or ""),
        )

    async def _run_team_turn(
        self,
        *,
        base_session: StudioSession,
        context: "GroupChatContext",
        group_id: str,
        group_name: str,
        group_avatar_ids: Sequence[str],
        user_input: str,
        quoted_content: str,
        should_stop: Callable[[], Any],
        user_display_name: str = "我",
        analysis_only: bool = False,
    ) -> AsyncGenerator[GroupReply, None]:
        """Bridge routing="team" to WorkforcePattern (planning) + AgentRuntime (execution).

        Hybrid stack strategy (see ADR 0002):
        - Planning layer (decompose_task + assign_tasks): WorkforcePattern / AgentExecutor
        - Execution layer (per-subtask): existing _run_one_target / AgentRuntime
        """
        from agenticx.collaboration.workforce.workforce_pattern import WorkforcePattern
        from agenticx.collaboration.workforce.events import WorkforceEventBus, WorkforceEvent, WorkforceAction
        from agenticx.collaboration.workforce.coordinator import CoordinatorAgent
        from agenticx.collaboration.workforce.task_planner import TaskPlannerAgent
        from agenticx.collaboration.task_lock import get_or_create_task_lock
        from agenticx.core.agent import Agent
        from agenticx.core.task import Task

        provider = getattr(base_session, "provider_name", None)
        model = getattr(base_session, "model_name", None)
        llm = self.llm_factory(provider or None, model or None)
        analysis_only = bool(
            analysis_only
            or getattr(base_session, "_group_analysis_only", False) is True
        )
        setattr(base_session, "_group_analysis_only", analysis_only)

        # ── 1. TaskLock (session-scoped project state) ─────────────────────
        _sid_for_lock = resolve_studio_session_id(base_session) or str(group_id or "")
        task_lock = get_or_create_task_lock(
            project_id=f"group::{group_id}::{_sid_for_lock}"
        )
        task_lock.add_conversation("user", user_input)

        # ── 2. WorkforceEventBus ────────────────────────────────────────────
        event_bus = WorkforceEventBus()
        relay_queue: asyncio.Queue[GroupReply] = asyncio.Queue()

        def _on_event(evt: WorkforceEvent) -> None:
            # resolve avatar_name from agent_id when possible
            av_name = self._meta_leader_label
            aid = evt.agent_id or META_LEADER_AGENT_ID
            if aid not in (META_LEADER_AGENT_ID, None):
                av = self.avatar_registry.get_avatar(aid)
                if av:
                    av_name = str(getattr(av, "name", "") or aid)
            reply = self._workforce_event_to_group_reply(
                evt, agent_id=aid, avatar_name=av_name
            )
            relay_queue.put_nowait(reply)

        event_bus.subscribe(_on_event)

        # ── 3. Construct planning-layer Agents (lightweight, for decompose/assign) ──
        coordinator_agent = Agent(
            name=self._meta_leader_label,
            role="Group Coordinator",
            goal=(
                f"Coordinate tasks in group '{group_name}' and assign them to team members. "
                "At the start of each complex task, use task_experience_retrieve to check for "
                "reusable lessons from previous sessions. After completing a task, use "
                "task_experience_learn to record key findings for future reference."
            ),
            organization_id="agenticx",
        )
        planner_agent = Agent(
            name="TaskPlanner",
            role="Task Planner",
            goal="Decompose complex requests into self-contained subtasks",
            organization_id="agenticx",
        )

        # Map up to MAX_WORKERS_PER_GROUP avatars to Worker objects.
        valid_member_ids = [
            str(aid).strip() for aid in group_avatar_ids
            if str(aid).strip()
        ][:MAX_WORKERS_PER_GROUP]

        worker_agents: list[Agent] = []
        worker_id_to_avatar_id: dict[str, str] = {}
        workflow_members: list[WorkflowMember] = []

        for avatar_id in valid_member_ids:
            av = self.avatar_registry.get_avatar(avatar_id)
            av_name = str(getattr(av, "name", "") or avatar_id) if av else avatar_id
            av_role = str(getattr(av, "role", "") or "General Assistant") if av else "General Assistant"
            av_goal = str(getattr(av, "system_prompt", "") or "Execute assigned tasks")[:200]
            w_agent = Agent(
                id=avatar_id,
                name=av_name,
                role=av_role,
                goal=av_goal,
                organization_id="agenticx",
            )
            worker_agents.append(w_agent)
            worker_id_to_avatar_id[avatar_id] = avatar_id
            workflow_members.append(
                WorkflowMember(
                    avatar_id=avatar_id,
                    name=av_name,
                    role=av_role,
                    prompt=av_goal,
                )
            )

        if not worker_agents:
            # Fallback: nothing to orchestrate, skip team mode.
            yield GroupReply(
                agent_id=META_LEADER_AGENT_ID,
                avatar_name=self._meta_leader_label,
                avatar_url="",
                content="群聊没有成员，无法启动 Team 模式。",
                skipped=False,
                event_type="group_reply",
            )
            return

        # ── 4. Build WorkforcePattern (planning layer only) ─────────────────
        pattern = WorkforcePattern(
            coordinator_agent=coordinator_agent,
            task_agent=planner_agent,
            workers=worker_agents,
            llm_provider=llm,
            event_bus=event_bus,
        )
        worker_instances = pattern.worker_instances

        # ── 5. Emit WORKFORCE_STARTED ───────────────────────────────────────
        event_bus.publish(WorkforceEvent(
            action=WorkforceAction.WORKFORCE_STARTED,
            data={
                "group_name": group_name,
                "member_count": len(worker_instances),
                "mode": "discussion" if analysis_only else "execution",
            },
        ))

        # Drain relay_queue helper
        async def _drain_relay() -> None:
            while not relay_queue.empty():
                yield relay_queue.get_nowait()

        async for r in _drain_relay():
            yield r

        # ── 6. Planning: decompose ──────────────────────────────────────────
        planner_task_description = user_input
        if analysis_only:
            planner_task_description = (
                f"{_ANALYSIS_ONLY_SCOPE}\n\n"
                f"## 原始用户问题\n{user_input}\n\n"
                "请只拆成围绕原始问题的独立分析视角；不要生成实现、部署、PoC、安装或其他执行子任务。"
            )
        main_task = Task(
            description=planner_task_description,
            expected_output=(
                "Independent discussion analysis"
                if analysis_only
                else "Group task execution result"
            ),
        )
        collaborative_request = _is_collaborative_team_request(user_input)
        try:
            subtasks = await pattern.decompose_task(main_task)
        except Exception as exc:
            yield GroupReply(
                agent_id=META_LEADER_AGENT_ID,
                avatar_name=self._meta_leader_label,
                avatar_url="",
                content="",
                skipped=False,
                error=f"任务分解失败: {exc}",
                event_type="group_reply",
                workflow_role="leader",
                workflow_status="decompose_failed",
            )
            return

        async for r in _drain_relay():
            yield r

        if not subtasks and collaborative_request:
            subtasks = [
                Task(
                    id=f"{main_task.id}_collaboration",
                    description=user_input,
                    expected_output="Independent professional analysis",
                    dependencies=[],
                )
            ]

        if not subtasks:
            # No subtasks: let the meta leader handle it directly.
            pm = await self._run_meta_project_manager_reply(
                base_session=base_session,
                context=context,
                group_name=group_name,
                user_input=user_input,
                quoted_content=quoted_content,
                extra_instruction="以项目经理身份直接回答，无需分解任务。",
                user_display_name=user_display_name,
            )
            pm.workflow_role = "leader"
            pm.workflow_status = "direct"
            yield pm
            event_bus.publish(WorkforceEvent(action=WorkforceAction.WORKFORCE_STOPPED, data={}))
            return

        # Cap subtasks.
        if len(subtasks) > MAX_DECOMPOSE_SUBTASKS:
            subtasks = subtasks[:MAX_DECOMPOSE_SUBTASKS]

        # An explicit “discuss / analyse independently” request must not collapse
        # into one executor merely because the planner returned one broad task.
        # Expand that broad task into role-specific, parallel first passes and
        # pin one to each member; the normal reviewer gate will cross-check them.
        forced_collaboration_assignments: dict[str, str] = {}
        if collaborative_request and len(subtasks) == 1 and len(worker_instances) >= 2:
            broad_task = subtasks[0]
            independent_subtasks: list[Task] = []
            for index, (worker, member) in enumerate(
                zip(worker_instances, workflow_members),
                start=1,
            ):
                task_id = f"{broad_task.id}_perspective_{index}"
                independent_subtasks.append(
                    Task(
                        id=task_id,
                        description=(
                            (
                                f"{_ANALYSIS_ONLY_SCOPE}\n\n"
                                if analysis_only
                                else ""
                            )
                            + f"独立首轮（{member.name} / {member.role or '专业成员'}视角）："
                            "在不依赖其他成员结论的前提下，独立分析并给出可验证、可交付的完整意见。\n\n"
                            f"原始请求：{user_input}"
                        ),
                        expected_output="Independent professional analysis",
                        dependencies=[],
                    )
                )
                forced_collaboration_assignments[task_id] = str(worker.id)
            subtasks = independent_subtasks[:MAX_DECOMPOSE_SUBTASKS]

        # ── 7. Planning: assign ─────────────────────────────────────────────
        try:
            assignment_map = await pattern.coordinator.assign_tasks(
                tasks=subtasks,
                workers=worker_instances,
            )
        except Exception:
            # Fallback: round-robin
            assignment_map = {
                st.id: worker_instances[i % len(worker_instances)].id
                for i, st in enumerate(subtasks)
            }

        if forced_collaboration_assignments:
            assignment_map.update(forced_collaboration_assignments)
        elif collaborative_request and len(subtasks) >= 2 and len(worker_instances) >= 2:
            assigned_workers = {
                str(assignment_map.get(subtask.id, "") or "") for subtask in subtasks
            }
            assigned_workers.discard("")
            if len(assigned_workers) < 2:
                # Preserve the coordinator's choices unless they accidentally
                # collapse an explicit collaboration request onto one member.
                for subtask, worker in zip(subtasks, worker_instances):
                    assignment_map[subtask.id] = str(worker.id)

        async for r in _drain_relay():
            yield r

        # Emit TASK_ASSIGNED for each subtask.
        for subtask in subtasks:
            worker_id = assignment_map.get(subtask.id)
            if worker_id:
                event_bus.publish(WorkforceEvent(
                    action=WorkforceAction.TASK_ASSIGNED,
                    task_id=subtask.id,
                    agent_id=worker_id,
                    data={
                        "task_description": subtask.description,
                        "assignee": worker_id,
                    },
                ))

        async for r in _drain_relay():
            yield r

        # ── 8. Execution: Graph DAG scheduler + AgentRuntime per node ───────
        # Hybrid stack preserved (ADR 0002): Workforce plans; AgentRuntime executes.
        from agenticx.runtime.graph.compiler import compile_workforce_run
        from agenticx.runtime.graph.models import ArtifactRef, GraphNode
        from agenticx.runtime.graph.scheduler import execute_group_run
        from agenticx.runtime.graph.store import get_default_store

        responded_this_turn: set[str] = set()
        subtask_by_id = {str(st.id): st for st in subtasks}
        subtask_index_by_id = {str(st.id): index for index, st in enumerate(subtasks)}
        stage_records_by_id: dict[str, WorkflowStageRecord] = {}
        member_runtime_locks: dict[str, asyncio.Lock] = {
            member.avatar_id: asyncio.Lock() for member in workflow_members
        }
        member_runtime_locks[META_LEADER_AGENT_ID] = asyncio.Lock()
        review_max_retries = group_review_max_retries()
        session_id = resolve_studio_session_id(base_session)
        if not session_id:
            _log.warning(
                "workforce graph compile missing studio session_id group_id=%s; "
                "refusing to bind GraphRun.session_id to group_id",
                group_id,
            )
        graph_run = compile_workforce_run(
            session_id=session_id,
            group_id=group_id,
            subtasks=subtasks,
            assignment_map={str(k): str(v) for k, v in assignment_map.items()},
        )
        graph_run.meta.update(
            {
                "collaborative_request": collaborative_request,
                "independent_first_passes": bool(forced_collaboration_assignments),
                "discussion_mode": "analysis" if analysis_only else "execution",
                "analysis_only": analysis_only,
            }
        )
        try:
            scratch = getattr(base_session, "scratchpad", None)
            if isinstance(scratch, dict):
                scratch["graph_run_id"] = graph_run.run_id
        except Exception:
            pass

        graph_event_queue: asyncio.Queue[GroupReply] = asyncio.Queue()

        def _on_graph_event(etype: str, data: dict) -> None:
            import json as _json
            node = data.get("node") if isinstance(data, dict) else None
            agent_id = META_LEADER_AGENT_ID
            if isinstance(node, dict) and node.get("agent_id"):
                agent_id = str(node.get("agent_id"))
            graph_event_queue.put_nowait(
                GroupReply(
                    agent_id=agent_id,
                    avatar_name="Graph",
                    avatar_url="",
                    content=_json.dumps(data, ensure_ascii=False),
                    skipped=True,
                    event_type=str(etype),
                )
            )

        async def _drain_graph_events() -> None:
            while not graph_event_queue.empty():
                yield graph_event_queue.get_nowait()

        def _member_identity(avatar_id: str) -> tuple[str, str]:
            if avatar_id == META_LEADER_AGENT_ID:
                return self._meta_leader_label, ""
            avatar = self.avatar_registry.get_avatar(avatar_id)
            if avatar is None:
                return avatar_id, ""
            return (
                str(getattr(avatar, "name", "") or avatar_id),
                str(getattr(avatar, "avatar_url", "") or ""),
            )

        async def _node_runner(node: GraphNode):
            st = subtask_by_id.get(node.id)
            desc = (st.description if st is not None else node.task_text) or node.task_text
            worker_id = str(node.agent_id or assignment_map.get(node.id, "") or "")
            avatar_id = worker_id_to_avatar_id.get(worker_id, worker_id) or META_LEADER_AGENT_ID
            executor_name, _executor_url = _member_identity(avatar_id)
            dependency_outputs: dict[str, str] = {}
            for dependency_id in graph_run.depends_sources(node.id):
                dependency_record = stage_records_by_id.get(dependency_id)
                if dependency_record is not None and dependency_record.final_output.strip():
                    dependency_outputs[dependency_id] = dependency_record.final_output[:12_000]

            stage_record = WorkflowStageRecord(
                task_id=node.id,
                description=desc,
                executor_id=avatar_id,
                executor_name=executor_name,
                dependency_outputs=dependency_outputs,
            )
            stage_records_by_id[node.id] = stage_record

            event_bus.publish(WorkforceEvent(
                action=WorkforceAction.TASK_STARTED,
                task_id=node.id,
                agent_id=avatar_id,
                data={"task_description": desc},
            ))
            async for r in _drain_relay():
                yield r
            async for r in _drain_graph_events():
                yield r

            subtask_input = (
                f"{_ANALYSIS_ONLY_SCOPE}\n\n{desc}"
                if analysis_only
                else desc
            )
            if quoted_content.strip():
                subtask_input = f"{subtask_input}\n\n[用户引用内容]\n{quoted_content.strip()}"
            if dependency_outputs:
                handoff = "\n\n".join(
                    f"### {dependency_id}\n{output}"
                    for dependency_id, output in dependency_outputs.items()
                )
                subtask_input = (
                    f"{subtask_input}\n\n"
                    "## 已审核上游交接（必须作为本阶段输入）\n"
                    f"{handoff}"
                )
            if node.directives:
                joined = "\n".join(f"- {d}" for d in node.directives)
                subtask_input = (
                    f"{subtask_input}\n\n## Graph intervention (authoritative)\n{joined}"
                )

            candidate_input = subtask_input
            retries_used = 0
            task_index = subtask_index_by_id.get(node.id, 0)
            reviewer = select_reviewer(
                workflow_members,
                executor_id=avatar_id,
                task_index=task_index,
            )
            reviewer_id = reviewer.avatar_id if reviewer is not None else META_LEADER_AGENT_ID
            reviewer_name, reviewer_url = _member_identity(reviewer_id)
            stage_record.reviewer_id = reviewer_id
            stage_record.reviewer_name = reviewer_name

            while True:
                if await self._should_stop(should_stop):
                    stage_record.status = "cancelled"
                    stage_record.failure_reason = "用户已中止团队任务。"
                    raise asyncio.CancelledError

                yield self._typing_event(
                    avatar_id,
                    executor_name,
                    workflow_role="executor",
                    workflow_task_id=node.id,
                    workflow_attempt=retries_used + 1,
                )
                candidate_reply: GroupReply | None = None
                executor_lock = member_runtime_locks.setdefault(avatar_id, asyncio.Lock())
                async with executor_lock:
                    async for target_evt in self._run_one_target_stream(
                        base_session=base_session,
                        context=context,
                        group_id=group_id,
                        group_name=group_name,
                        avatar_id=avatar_id,
                        user_input=candidate_input,
                        quoted_content="",
                        should_stop=should_stop,
                        force_reply=True,
                        user_display_name=user_display_name,
                    ):
                        target_evt.workflow_role = "executor"
                        target_evt.workflow_task_id = node.id
                        target_evt.workflow_attempt = retries_used + 1
                        yield target_evt
                        if target_evt.event_type in {"group_reply", "group_skipped"}:
                            candidate_reply = target_evt

                if (
                    candidate_reply is None
                    or candidate_reply.skipped
                    or not str(candidate_reply.content or "").strip()
                ):
                    reason = (
                        str(candidate_reply.error or "").strip()
                        if candidate_reply is not None
                        else "no response"
                    ) or "no response"
                    stage_record.status = "failed"
                    stage_record.failure_reason = f"执行者未产生候选结果：{reason}"
                    node.meta.update(
                        {
                            "review_status": "failed_before_review",
                            "failure_reason": stage_record.failure_reason,
                        }
                    )
                    event_bus.publish(WorkforceEvent(
                        action=WorkforceAction.TASK_FAILED,
                        task_id=node.id,
                        agent_id=avatar_id,
                        data={"error": stage_record.failure_reason},
                    ))
                    async for r in _drain_relay():
                        yield r
                    raise GroupWorkflowError(stage_record.failure_reason)

                candidate_output = str(candidate_reply.content or "").strip()
                stage_record.attempts.append(candidate_output)

                review_prompt = build_review_prompt(
                    original_request=user_input,
                    task_description=desc,
                    dependency_outputs=dependency_outputs,
                    candidate_output=candidate_output,
                    executor_name=executor_name,
                )
                if analysis_only:
                    review_prompt = (
                        f"{_ANALYSIS_ONLY_SCOPE}\n\n"
                        "审核重点是候选产出是否紧扣原始分析问题、证据是否充分、"
                        "是否把不同视角混淆或引入无关执行目标；不要要求实施方案、PoC 或部署步骤。\n\n"
                        f"{review_prompt}"
                    )
                yield self._typing_event(
                    reviewer_id,
                    reviewer_name,
                    workflow_role="reviewer",
                    workflow_task_id=node.id,
                    workflow_attempt=retries_used + 1,
                )
                raw_review_reply: GroupReply | None = None
                reviewer_lock = member_runtime_locks.setdefault(reviewer_id, asyncio.Lock())
                async with reviewer_lock:
                    async for review_evt in self._run_one_target_stream(
                        base_session=base_session,
                        context=context,
                        group_id=group_id,
                        group_name=group_name,
                        avatar_id=reviewer_id,
                        user_input=review_prompt,
                        quoted_content="",
                        should_stop=should_stop,
                        force_reply=True,
                        user_display_name=user_display_name,
                        append_to_context=False,
                    ):
                        review_evt.workflow_role = "reviewer"
                        review_evt.workflow_task_id = node.id
                        review_evt.workflow_attempt = retries_used + 1
                        if review_evt.event_type in {"group_reply", "group_skipped"}:
                            raw_review_reply = review_evt
                        else:
                            yield review_evt

                raw_review_text = (
                    str(raw_review_reply.content or "").strip()
                    if raw_review_reply is not None
                    else ""
                )
                decision = parse_review_decision(raw_review_text)
                stage_record.reviews.append(decision)
                review_text = render_review_for_group(decision)
                visible_review = GroupReply(
                    agent_id=reviewer_id,
                    avatar_name=reviewer_name,
                    avatar_url=reviewer_url,
                    content=review_text,
                    skipped=False,
                    event_type="group_reply",
                    graph_run_id=graph_run.run_id,
                    graph_node_id=self._graph_node_id_for_agent(reviewer_id),
                    workflow_role="reviewer",
                    workflow_task_id=node.id,
                    workflow_attempt=retries_used + 1,
                    workflow_status=decision.status.value,
                )
                context.append_agent(
                    agent_id=reviewer_id,
                    agent_name=reviewer_name,
                    text=review_text,
                    avatar_url=reviewer_url,
                )
                yield visible_review

                node.meta.update(
                    {
                        "reviewer_id": reviewer_id,
                        "reviewer_name": reviewer_name,
                        "review_status": decision.status.value,
                        "review_summary": decision.summary[:500],
                        "review_issues": [
                            {
                                "severity": issue.severity,
                                "problem": issue.problem[:500],
                                "fix": issue.fix[:500],
                            }
                            for issue in decision.issues[:10]
                        ],
                    }
                )

                if decision.accepted:
                    stage_record.final_output = candidate_output
                    stage_record.status = decision.status.value
                    self._record_turn_response(responded_this_turn, candidate_reply)
                    task_lock.add_conversation("assistant", candidate_output)
                    event_bus.publish(WorkforceEvent(
                        action=WorkforceAction.TASK_COMPLETED,
                        task_id=node.id,
                        agent_id=avatar_id,
                        data={
                            "result": candidate_output[:500],
                            "review_status": decision.status.value,
                            "reviewer_id": reviewer_id,
                        },
                    ))
                    async for r in _drain_relay():
                        yield r
                    return

                if retries_used >= review_max_retries:
                    stage_record.status = "failed"
                    stage_record.failure_reason = (
                        f"独立审核连续 {len(stage_record.reviews)} 次未通过：{decision.summary}"
                    )
                    node.meta["failure_reason"] = stage_record.failure_reason
                    event_bus.publish(WorkforceEvent(
                        action=WorkforceAction.TASK_FAILED,
                        task_id=node.id,
                        agent_id=avatar_id,
                        data={
                            "error": stage_record.failure_reason,
                            "review_status": decision.status.value,
                            "reviewer_id": reviewer_id,
                        },
                    ))
                    async for r in _drain_relay():
                        yield r
                    raise GroupWorkflowError(stage_record.failure_reason)

                retries_used += 1
                node.retry_count = retries_used
                candidate_input = build_rework_prompt(
                    original_request=user_input,
                    task_description=desc,
                    previous_output=candidate_output,
                    decision=decision,
                    attempt_number=retries_used,
                    dependency_outputs=dependency_outputs,
                )
                if analysis_only:
                    candidate_input = f"{_ANALYSIS_ONLY_SCOPE}\n\n{candidate_input}"

        max_parallel = min(4, max(1, len(worker_instances)))
        async for item in execute_group_run(
            graph_run,
            runner=_node_runner,
            on_event=_on_graph_event,
            store=get_default_store(),
            max_parallel=max_parallel,
            should_stop=should_stop,
        ):
            yield item
            async for r in _drain_graph_events():
                yield r

        async for r in _drain_graph_events():
            yield r

        ordered_stage_records: list[WorkflowStageRecord] = []
        for subtask in subtasks:
            task_id = str(subtask.id)
            existing_record = stage_records_by_id.get(task_id)
            if existing_record is not None:
                ordered_stage_records.append(existing_record)
                continue
            assigned_id = str(assignment_map.get(task_id, "") or "")
            assigned_avatar_id = worker_id_to_avatar_id.get(assigned_id, assigned_id)
            assigned_name, _assigned_url = _member_identity(assigned_avatar_id)
            graph_node = graph_run.nodes.get(task_id)
            graph_status = (
                str(getattr(getattr(graph_node, "status", None), "value", "") or "")
                if graph_node is not None
                else "blocked"
            )
            if graph_status in {"pending", "ready", "running", "paused"}:
                graph_status = "blocked"
            ordered_stage_records.append(
                WorkflowStageRecord(
                    task_id=task_id,
                    description=str(subtask.description or ""),
                    executor_id=assigned_avatar_id,
                    executor_name=assigned_name,
                    status=graph_status or "blocked",
                    failure_reason="上游阶段未通过或任务在执行前被中止。",
                )
            )

        graph_run.meta.update(
            {
                "review_gate_enabled": True,
                "workflow_reviewed": all(
                    bool(record.reviews) for record in ordered_stage_records
                ),
                "workflow_complete": all(
                    record.status in {"pass", "pass_with_risk"}
                    for record in ordered_stage_records
                ),
                "workflow_stages": [
                    {
                        "task_id": record.task_id,
                        "executor_id": record.executor_id,
                        "reviewer_id": record.reviewer_id,
                        "status": record.status,
                        "attempts": len(record.attempts),
                        "failure_reason": record.failure_reason[:500],
                    }
                    for record in ordered_stage_records
                ],
            }
        )

        # ── 9. Leader summary + durable deliverable ─────────────────────────
        if not await self._should_stop(should_stop):
            yield self._typing_event(
                META_LEADER_AGENT_ID,
                self._meta_leader_label,
                workflow_role="leader",
            )
            execution_dossier = render_execution_dossier(ordered_stage_records)
            summary_prompt = (
                f"{_ANALYSIS_ONLY_SCOPE if analysis_only else ''}\n\n"
                f"## 原始用户请求\n{user_input}\n\n"
                "## 团队执行档案（权威输入）\n"
                f"{execution_dossier}\n\n"
                "请以团队负责人身份完成最终交付。阶段状态为 failed / blocked / cancelled 时，"
                "必须明确列为未闭环项，不得声称所有任务已经完成。"
            )
            pm = await self._run_meta_project_manager_reply(
                base_session=base_session,
                context=context,
                group_name=group_name,
                user_input=summary_prompt,
                quoted_content="",
                extra_instruction=(
                    "以执行档案为唯一阶段事实来源，整合通过版本；"
                    + (
                        "单列审核风险、证据边界和未决项，不新增执行计划。"
                        if analysis_only
                        else "单列审核风险、验证边界、未闭环项和下一步。"
                    )
                ),
                user_display_name=user_display_name,
                delivery_mode=True,
            )
            pm.workflow_role = "leader"
            pm.workflow_status = "final"
            final_answer_without_artifact = str(pm.content or "")
            deliverable_path = None
            try:
                deliverable_path = write_group_deliverable(
                    group_id=group_id,
                    group_name=group_name,
                    original_request=user_input,
                    run_id=graph_run.run_id,
                    records=ordered_stage_records,
                    final_answer=final_answer_without_artifact,
                )
                graph_run.artifacts.append(
                    ArtifactRef(
                        id=f"artifact_{graph_run.run_id}_{len(graph_run.artifacts) + 1}",
                        node_id=META_LEADER_AGENT_ID,
                        kind="report",
                        path_or_uri=str(deliverable_path),
                        summary=f"{group_name}团队协作交付",
                    )
                )
                graph_run.meta["deliverable_path"] = str(deliverable_path)
                pm.content = (
                    f"{final_answer_without_artifact.rstrip()}\n\n"
                    f"协作产物已保存：`{deliverable_path}`"
                )
            except Exception as exc:
                _log.warning(
                    "group workflow deliverable persist failed group=%s run=%s: %s",
                    group_id,
                    graph_run.run_id,
                    exc,
                )
                pm.content = (
                    f"{final_answer_without_artifact.rstrip()}\n\n"
                    f"协作结果已生成，但产物文件保存失败：{str(exc)[:300]}"
                )

            try:
                get_default_store().save(graph_run, bump_version=True)
            except Exception as exc:
                _log.warning(
                    "group workflow graph metadata persist failed run=%s: %s",
                    graph_run.run_id,
                    exc,
                )

            # _run_meta_project_manager_reply already appended the pre-artifact
            # text. Replace that tail so restart/reload sees the same message as SSE.
            history = getattr(base_session, "chat_history", None)
            if isinstance(history, list):
                for message in reversed(history):
                    if not isinstance(message, dict):
                        continue
                    message_agent_id = str(
                        message.get("agent_id") or message.get("sender_id") or ""
                    )
                    if message_agent_id == META_LEADER_AGENT_ID:
                        message["content"] = pm.content
                        break
            yield pm
            task_lock.add_conversation("assistant", pm.content or "")

        # ── 10. WORKFORCE_STOPPED ───────────────────────────────────────────
        event_bus.publish(WorkforceEvent(action=WorkforceAction.WORKFORCE_STOPPED, data={}))
        async for r in _drain_relay():
            yield r

    # ──────────────────────────────────────────────────────────────────────────

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
        analysis_only = _is_analysis_only_request(user_input)
        # Turn-local scope is also consumed by legacy member/meta paths so an
        # explicit @-mention cannot silently regain mutating tools.
        setattr(base_session, "_group_analysis_only", analysis_only)
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
        if routing == "team":
            async for reply in self._run_team_turn(
                base_session=base_session,
                context=context,
                group_id=group_id,
                group_name=group_name,
                group_avatar_ids=group_avatar_ids,
                user_input=user_input,
                quoted_content=quoted_content,
                should_stop=should_stop,
                user_display_name=udn,
                analysis_only=analysis_only,
            ):
                yield reply
            return
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
        progress_q: asyncio.Queue[GroupReply] = asyncio.Queue()
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
                    progress_queue=progress_q,
                )
            )
            for aid in targets
        ]
        parallel_replies: list[GroupReply] = []
        pending = set(tasks)

        def _drain_progress() -> list[GroupReply]:
            drained: list[GroupReply] = []
            while True:
                try:
                    evt = progress_q.get_nowait()
                except asyncio.QueueEmpty:
                    break
                if self._should_forward_progress(evt):
                    drained.append(evt)
            return drained

        while pending:
            for evt in _drain_progress():
                yield evt
            if await self._should_stop(should_stop):
                for t in pending:
                    t.cancel()
                break
            done, pending = await asyncio.wait(
                pending, timeout=0.2, return_when=asyncio.FIRST_COMPLETED
            )
            for t in done:
                try:
                    r = t.result()
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
                    continue
                self._record_turn_response(responded_this_turn, r)
                parallel_replies.append(r)
                yield r
        for evt in _drain_progress():
            yield evt
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
                hops=_get_mention_hops(),
                responded_this_turn=responded_this_turn,
            ):
                yield fu
