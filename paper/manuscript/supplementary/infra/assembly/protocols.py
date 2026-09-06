#!/usr/bin/env python3
"""TeamBench 团队产出装配协议（assembly protocol）。

背景：v0.1 runner 把"最后一个角色的输出"当作团队交付物，导致前 N-1 个角色
的产出被丢弃，而打分标准要求整份交付物。这使得 CTR 主要反映"末位角色是否
承担整合职责"，而非协作质量本身。

本模块把装配方式提升为显式的受控变量，四种协议：
  last        —— 取末位角色输出（复现 v0.1 行为，作为对照臂）
  concat      —— 按角色顺序确定性拼接，零额外 LLM 调用
  integrator  —— 追加一个整合角色，接收全部角色的完整输出，产出整份交付物
  blackboard  —— 角色按章节写入共享黑板，最终渲染黑板（无额外 LLM 调用）
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

RoleOutput = Tuple[str, str]   # (role_name, content)

ASSEMBLY_PROTOCOLS = ("last", "concat", "integrator", "blackboard")


def assemble(
    protocol: str,
    role_outputs: List[RoleOutput],
    task: Dict[str, Any],
    llm_call: Optional[Callable[..., Dict[str, Any]]] = None,
    seed: Optional[int] = None,
    char_budget: int = 4000,
) -> Tuple[str, Dict[str, int]]:
    """把角色产出装配为团队最终交付物。

    返回 (final_artifact_text, extra_usage)。
    extra_usage 形如 {"prompt_tokens":int,"completion_tokens":int,"llm_calls":int}，
    integrator 协议会产生额外开销，其余协议为全 0——务必计入 CO/TR 统计。
    """
    if protocol not in ASSEMBLY_PROTOCOLS:
        raise ValueError(f"unknown assembly protocol: {protocol}")
    zero = {"prompt_tokens": 0, "completion_tokens": 0, "llm_calls": 0}

    if not role_outputs:
        return "", zero

    if protocol == "last":
        return role_outputs[-1][1], zero

    if protocol == "concat":
        return _assemble_concat(role_outputs), zero

    if protocol == "blackboard":
        return _assemble_blackboard(role_outputs, task), zero

    if protocol == "integrator":
        if llm_call is None:
            raise ValueError("integrator protocol requires llm_call")
        return _assemble_integrator(role_outputs, task, llm_call, seed, char_budget)

    raise AssertionError("unreachable")


# ── concat ────────────────────────────────────────────────────────────
def _assemble_concat(role_outputs: List[RoleOutput]) -> str:
    """确定性拼接：保留每个角色的完整产出，用角色名作为分节标题。"""
    parts = []
    for name, content in role_outputs:
        body = (content or "").strip()
        if not body:
            continue
        parts.append(f"## {name}\n\n{body}")
    return "\n\n".join(parts)


# ── blackboard ────────────────────────────────────────────────────────
def _assemble_blackboard(role_outputs: List[RoleOutput], task: Dict[str, Any]) -> str:
    """按 verification.required_sections 的规范章节槽位归位。

    每个角色输出中若含某个规范章节的标题，则该章节内容归入对应槽位；
    未匹配到任何槽位的内容进入"其他"。同一槽位被多个角色写入时按角色顺序拼接。
    """
    sections = task.get("verification", {}).get("required_sections") or []
    slots: Dict[str, List[str]] = {s: [] for s in sections}
    leftovers: List[str] = []

    for name, content in role_outputs:
        if not content:
            continue
        chunks = _split_by_headings(content)
        for heading, body in chunks:
            hit = None
            for s in sections:
                if _heading_matches(heading, s):
                    hit = s
                    break
            if hit is not None:
                slots[hit].append(body.strip())
            else:
                leftovers.append(f"### {heading}\n{body.strip()}" if heading else body.strip())

    parts = []
    for s in sections:
        body = "\n\n".join(x for x in slots[s] if x)
        parts.append(f"## {s}\n\n{body}" if body else f"## {s}\n\n（本节无内容）")
    if leftovers:
        parts.append("## 其他\n\n" + "\n\n".join(leftovers))
    return "\n\n".join(parts)


_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*$", re.M)


def _split_by_headings(text: str) -> List[Tuple[str, str]]:
    """把 markdown 文本按标题切成 (heading, body) 列表。无标题时返回 [("", text)]。"""
    matches = list(_HEADING_RE.finditer(text))
    if not matches:
        return [("", text)]
    out: List[Tuple[str, str]] = []
    if matches[0].start() > 0:
        head = text[: matches[0].start()].strip()
        if head:
            out.append(("", head))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out.append((m.group(2).strip(), text[start:end]))
    return out


def _norm(s: str) -> str:
    return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]+", "", s or "").lower()


def _heading_matches(heading: str, section: str) -> bool:
    """标题与规范章节是否匹配：规范化后互为子串即算命中。"""
    h, s = _norm(heading), _norm(section)
    if not h or not s:
        return False
    return h == s or s in h or h in s


# ── integrator ────────────────────────────────────────────────────────
_INTEGRATOR_SYSTEM = (
    "你是团队的总装配员。下面给出团队各角色的完整交付物，"
    "请把它们整合成一份完整、无重复、结构规范的最终交付物。"
    "要求：(1) 严格覆盖任务要求的全部章节，章节标题使用给定的规范名称，完全一致；"
    "(2) 保留各角色产出中的全部实质信息，尤其是清单、数值、条目，不得遗漏；"
    "(3) 去除角色之间的重复内容与过程性寒暄；"
    "(4) 只输出最终交付物本身，不要输出整合说明。"
)


def _answer_block_instruction(task: Dict[str, Any]) -> str:
    """与 runner 的同名逻辑一致：任务声明 answer_block_schema 时追加答案块要求。"""
    schema = (task.get("verification") or {}).get("answer_block_schema")
    if not schema:
        return ""
    fields = json.dumps(schema, ensure_ascii=False)
    return ("\n\n【结构化答案块】请在交付物末尾附加一个 ```json 代码块，字段如下（缺一不可）：\n"
            f"{fields}\n该块用于自动核验，字段名必须完全一致。")


def _assemble_integrator(
    role_outputs: List[RoleOutput],
    task: Dict[str, Any],
    llm_call: Callable[..., Dict[str, Any]],
    seed: Optional[int],
    char_budget: int,
) -> Tuple[str, Dict[str, int]]:
    sections = task.get("verification", {}).get("required_sections") or []
    sec_hint = (
        f"\n\n【必须包含的章节，标题必须与此完全一致】\n{json.dumps(sections, ensure_ascii=False)}"
        if sections else ""
    )
    blocks = []
    for name, content in role_outputs:
        # 关键：这里绝不截断。上游截断正是 v0.1 的信息损失来源之一。
        blocks.append(f"--- {name} 的交付物 ---\n{content or '（空）'}")
    user = (
        f"总体任务：{task.get('description','')}"
        f"{sec_hint}\n\n"
        f"【字数约束】最终交付物不超过 {char_budget} 字。"
        f"{_answer_block_instruction(task)}\n\n"
        f"各角色交付物如下：\n\n" + "\n\n".join(blocks)
    )
    r = llm_call(
        _INTEGRATOR_SYSTEM, user, seed=seed,
        label=f"{task.get('task_id','?')} assemble-integrator",
    )
    usage = {
        "prompt_tokens": r.get("prompt_tokens", 0),
        "completion_tokens": r.get("completion_tokens", 0),
        "llm_calls": 1,
    }
    return r.get("content", ""), usage
