"""Pure mapping between TypeSafe System One answers and group-chat intent."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

META_LEADER_AGENT_ID = "__meta__"

JEV_ACTION_CHOICES = ("route_to", "meta_direct", "continue_thread", "open_floor")
ACTION_CRITERIA = {
    "route_to": "Exactly one member's duty clearly matches this user message.",
    "meta_direct": "Global / PM / Near / Machi / Meta, or no single member owns it.",
    "continue_thread": "Follow-up to the current thread partner.",
    "open_floor": "Casual chat with no duty; members may stay silent.",
}
TARGET_NONE = "none"
ROLE_SNIPPET_MAX = 80
CRITERIA_MAX = 255
NOUL_YES = 0.7
NOUL_NO = 0.3
ACTION_LABEL_ZH = {
    "route_to": "派给成员",
    "meta_direct": "Near 作答",
    "continue_thread": "续聊",
    "open_floor": "开放麦",
}
GATE_LABEL_ZH = {
    "auto": "自动",
    "review": "建议复核",
}
FALLBACK_CAUSE_ZH = {
    "jev_no_key": "未配置密钥",
    "jev_timeout": "超时",
    "jev_http": "请求失败",
    "jev_fallback_llm": "置信不足",
    "jev_soft_timeout": "判定较慢",
    "jev_fallback_meta": "已回落 Near",
}
HARD_FALLBACK_REASONS = frozenset({"jev_no_key", "jev_timeout", "jev_http"})


def is_jev_hard_fallback(reason: str) -> bool:
    return str(reason or "").strip() in HARD_FALLBACK_REASONS


def format_jev_fallback_line(reason: str) -> str:
    code = str(reason or "").strip()
    if code == "jev_fallback_llm":
        return "改走主模型 · 置信不足"
    if code == "jev_soft_timeout":
        return "改走主模型 · 判定较慢"
    if code == "jev_fallback_meta":
        return "改走 Near · 已回落 Near"
    cause = FALLBACK_CAUSE_ZH.get(code, code or "未采用")
    return f"未采用 · {cause}"


def format_jev_content_line(
    *,
    source: str,
    model: str,
    action: str,
    target_label: str,
    confidence: float | None,
    gate: str,
    fallback_reason: str,
) -> str:
    """One-line history / degraded-UI summary. Must contain the literal 'Jev'."""
    if source != "jev":
        if fallback_reason == "jev_no_key":
            return "Jev 未配置密钥，已走原路由"
        if fallback_reason == "jev_fallback_llm":
            return "Jev 改走主模型（置信不足），已回落主模型"
        if fallback_reason == "jev_soft_timeout":
            return "Jev 改走主模型（判定较慢），已回落主模型"
        if fallback_reason == "jev_fallback_meta":
            return "Jev 改走 Near（已回落 Near）"
        cause = FALLBACK_CAUSE_ZH.get(fallback_reason, fallback_reason or "未采用")
        dest = "Near" if fallback_reason == "jev_fallback_meta" else "主模型"
        return f"Jev 未采用（{cause}），已回落{dest}"
    action_zh = ACTION_LABEL_ZH.get(action, action)
    who = target_label or "Near"
    pct = "" if confidence is None else f"{int(round(confidence * 100))}%"
    gate_zh = GATE_LABEL_ZH.get(gate, gate)
    model_id = model or "jev-latest"
    return f"Jev（{model_id}）→ {action_zh} {who} · {pct} · {gate_zh}"


def format_jev_kb_content_line(
    *,
    source: str,
    model: str,
    search: bool,
    fallback_reason: str = "",
) -> str:
    """KB auto gate summary. Must contain the literal 'Jev'."""
    if source != "jev":
        if fallback_reason == "jev_no_key":
            return "Jev 未配置密钥，已走原路由"
        cause = FALLBACK_CAUSE_ZH.get(fallback_reason, fallback_reason or "未采用")
        return f"Jev 未采用（{cause}）"
    verb = "检索知识库" if search else "跳过检索"
    model_id = model or "jev-latest"
    return f"Jev（{model_id}）→ {verb}"


def member_role_snippet(name: str, role: str) -> str:
    text = str(role or "").strip() or str(name or "").strip()
    if len(text) > ROLE_SNIPPET_MAX:
        return text[:ROLE_SNIPPET_MAX]
    return text


def _clip_criteria(text: str) -> str:
    value = str(text or "").strip()
    if len(value) > CRITERIA_MAX:
        return value[:CRITERIA_MAX]
    return value


def build_group_routing_questions(
    members: Sequence[Mapping[str, str]],
) -> dict[str, Any]:
    target_criteria: dict[str, str] = {}
    for item in members:
        avatar_id = str(item.get("id") or "").strip()
        if not avatar_id:
            continue
        name = str(item.get("name") or avatar_id).strip() or avatar_id
        role = member_role_snippet(name, str(item.get("role") or ""))
        target_criteria[avatar_id] = _clip_criteria(f"{name}: {role}")
    target_criteria[TARGET_NONE] = "No single member; Meta or open floor."
    return {
        "action": {
            "type": "choice",
            "instructions": "Who should handle this group user message? Pick one.",
            "criteria": dict(ACTION_CRITERIA),
        },
        "target": {
            "type": "choice",
            "instructions": (
                "If exactly one member should speak, which member id? "
                "Use none when Meta should answer or the floor is open."
            ),
            "criteria": target_criteria,
        },
        "requires_execution": {
            "type": "noul",
            "instructions": (
                "Does the user want create, modify, run, install, download, "
                "search-verify, write files, inspect a repo, or produce an artifact "
                "this turn? Progress-only questions are no."
            ),
            "criteria": {
                "true": "Executable ask this turn.",
                "false": "Explain / greet / progress-only.",
            },
        },
    }


def build_group_routing_state(
    *,
    group_name: str,
    members: Sequence[Mapping[str, str]],
    active_thread: str,
    recent_dialogue: str,
    user_message: str,
) -> dict[str, Any]:
    cleaned_members: list[dict[str, str]] = []
    for item in members:
        avatar_id = str(item.get("id") or "").strip()
        if not avatar_id:
            continue
        name = str(item.get("name") or avatar_id).strip() or avatar_id
        cleaned_members.append(
            {
                "id": avatar_id,
                "name": name,
                "role": member_role_snippet(name, str(item.get("role") or "")),
            }
        )
    return {
        "group_name": str(group_name or ""),
        "members": cleaned_members,
        "active_thread": str(active_thread or "none"),
        "recent_dialogue": str(recent_dialogue or ""),
        "user_message": str(user_message or ""),
    }


def ensure_meta_member(
    members: Sequence[Mapping[str, str]],
    *,
    meta_name: str,
    meta_role: str = "项目经理",
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen = False
    for item in members:
        row = {
            "id": str(item.get("id") or "").strip(),
            "name": str(item.get("name") or "").strip(),
            "role": str(item.get("role") or "").strip(),
        }
        if not row["id"]:
            continue
        if row["id"] == META_LEADER_AGENT_ID:
            seen = True
            row["name"] = row["name"] or meta_name
            row["role"] = row["role"] or meta_role
        out.append(row)
    if not seen:
        out.insert(
            0,
            {
                "id": META_LEADER_AGENT_ID,
                "name": str(meta_name or "Near").strip() or "Near",
                "role": str(meta_role or "项目经理").strip() or "项目经理",
            },
        )
    return out


def decide_gate(confidence: float | None, *, act_above: float, review_above: float) -> str:
    if confidence is None:
        return "abstain"
    if confidence >= act_above:
        return "auto"
    if confidence >= review_above:
        return "review"
    return "abstain"


def map_noul_execution(noul: float | None, user_input: str) -> bool:
    from agenticx.runtime.group_router import _looks_like_execution_request

    if noul is None:
        return _looks_like_execution_request(user_input)
    if noul >= NOUL_YES:
        return True
    if noul <= NOUL_NO:
        return False
    return _looks_like_execution_request(user_input)


@dataclass
class JevIntentMap:
    ok: bool
    action: str = ""
    target_ids: list[str] = field(default_factory=list)
    requires_execution: bool = False
    confidence: float | None = None
    probabilities: dict[str, float] | None = None
    gate: str = ""
    reason: str = ""
    noul_execution: float | None = None
    model: str = ""
    fallback_reason: str = ""

    def adopted(self) -> bool:
        return self.ok and self.gate in {"auto", "review"}


def _as_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _probability_map(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, Mapping):
        return None
    out: dict[str, float] = {}
    for key, value in raw.items():
        num = _as_float(value)
        if num is None:
            continue
        out[str(key)] = num
    return out or None


def map_jev_to_intent(
    response: Mapping[str, Any],
    *,
    member_ids: Iterable[str],
    user_input: str,
    act_above: float = 0.8,
    review_above: float = 0.5,
) -> JevIntentMap:
    answers = response.get("answers")
    if not isinstance(answers, Mapping):
        return JevIntentMap(ok=False, fallback_reason="jev_http")
    action_ans = answers.get("action")
    target_ans = answers.get("target")
    noul_ans = answers.get("requires_execution")
    if not isinstance(action_ans, Mapping):
        return JevIntentMap(ok=False, fallback_reason="jev_http")
    action = str(action_ans.get("choice") or "").strip()
    if action not in JEV_ACTION_CHOICES:
        return JevIntentMap(ok=False, fallback_reason="jev_http")
    valid_ids = {str(x).strip() for x in member_ids if str(x).strip()}
    valid_ids.discard(META_LEADER_AGENT_ID)
    target_choice = ""
    if isinstance(target_ans, Mapping):
        target_choice = str(target_ans.get("choice") or "").strip()
    target_ids: list[str] = []
    if action == "route_to":
        if target_choice in valid_ids:
            target_ids = [target_choice]
        else:
            action = "meta_direct"
            target_ids = []
    elif action == "continue_thread" and target_choice in valid_ids:
        target_ids = [target_choice]
    noul = None
    if isinstance(noul_ans, Mapping):
        noul = _as_float(noul_ans.get("noul"))
    confidence = _as_float(action_ans.get("confidence"))
    gate = decide_gate(confidence, act_above=act_above, review_above=review_above)
    reason = "jev_review" if gate == "review" else "jev"
    model = str(response.get("model") or "").strip()
    return JevIntentMap(
        ok=True,
        action=action,
        target_ids=target_ids,
        requires_execution=map_noul_execution(noul, user_input),
        confidence=confidence,
        probabilities=_probability_map(action_ans.get("probabilities")),
        gate=gate,
        reason=reason,
        noul_execution=noul,
        model=model,
    )
