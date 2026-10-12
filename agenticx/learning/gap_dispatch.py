# agenticx/learning/gap_dispatch.py
"""能力缺口派发器（SP30 T4）——「能力拓展自顶向下」的软件触发器。

对标 SeeAct/穆尧：上层从失败聚类中发现能力缺口，向下派发学习任务。
本模块只产提案（datasets/gap_queue/），人工 review 后才进任务池——
不自动开训、不自动改任何线上组件。

覆盖判定口径（宁松勿漏，提案由人审）：
- 聚类：复用 trajectory/memory.vote_key（异常类型级归一）
- 覆盖：账本中 winrate>=0.6 且 support>=3 的经验，其 ref 去前缀后的词元
  与聚类代表片段词元有交集 → 判覆盖，不派发
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass, field

from .attribution import AttributionLedger
from .trajectory.memory import vote_key
from .trajectory.schema import RSITrajectory

COVER_WINRATE = 0.6
COVER_SUPPORT = 3
_VERIFIER_SUSPECT_PAT = re.compile(
    r"(assert|expected|mismatch|verifier|score)", re.IGNORECASE)


@dataclass
class GapProposal:
    proposal_id: str
    cluster_key: str
    sample_messages: list[str]
    failure_count: int
    task_ids: list[str]
    covering_refs: list[str]
    suggested_action: str          # collect_more | new_skill | verifier_suspect
    created_at: str
    status: str = "proposed"

    def to_dict(self) -> dict:
        return asdict(self)


def _tokens(text: str) -> set[str]:
    return {w for w in re.split(r"[^a-z0-9]+", text.lower()) if len(w) >= 4}


def _covering_refs(cluster_rep: str, ledger: AttributionLedger) -> list[str]:
    """高胜率经验中 ref 词元与失败片段词元有交集的（关键词关联，宁松勿漏）。"""
    rep_tokens = _tokens(cluster_rep)
    if not rep_tokens:
        return []
    out = []
    for r in ledger.rows:
        if r.winrate < COVER_WINRATE or r.support < COVER_SUPPORT:
            continue
        if _tokens(r.ref) & rep_tokens:
            out.append(r.ref)
    return out


def _failure_evidence(traj: RSITrajectory) -> list[str]:
    """失败证据片段：tool 报错 → 失败工具调用摘要 → 末条 assistant 兜底。"""
    snippets = []
    for m in traj.messages:
        if isinstance(m, dict) and m.get("role") == "tool":
            content = str(m.get("content") or "").strip()
            if "error" in content.lower()[:200]:
                snippets.append(content[:120])
    if not snippets:
        snippets = [c.result_summary[:120] for c in traj.tool_calls
                    if c.ok is False and c.result_summary]
    if not snippets:
        for m in reversed(traj.messages):
            if isinstance(m, dict) and m.get("role") == "assistant":
                content = str(m.get("content") or "").strip()
                if content:
                    snippets = [content[:120]]
                break
    return snippets


def find_gaps(trajectories: list[RSITrajectory],
              ledger: AttributionLedger, *,
              min_cluster: int = 3) -> list[GapProposal]:
    """失败轨迹聚类 → 无覆盖的高频聚类变提案。"""
    clusters: dict[str, dict] = {}
    for t in trajectories:
        if t.status != "fail" and t.reward.label != 0.0:
            continue
        for snippet in _failure_evidence(t):
            key = vote_key(snippet)
            c = clusters.setdefault(key, {"rep": snippet, "count": 0,
                                          "tasks": [], "samples": []})
            c["count"] += 1
            if t.task_id not in c["tasks"]:
                c["tasks"].append(t.task_id)
            if snippet not in c["samples"]:
                c["samples"].append(snippet)

    proposals: list[GapProposal] = []
    for key, c in sorted(clusters.items(), key=lambda kv: -kv[1]["count"]):
        if c["count"] < min_cluster:
            continue
        covering = _covering_refs(c["rep"], ledger)
        if covering:
            continue                      # 有高胜率经验覆盖 → 不是缺口
        action = ("verifier_suspect"
                  if _VERIFIER_SUSPECT_PAT.search(c["rep"]) else "new_skill")
        payload = f"{key}|{c['count']}|{'|'.join(c['tasks'])}"
        proposals.append(GapProposal(
            proposal_id=hashlib.sha256(payload.encode()).hexdigest()[:12],
            cluster_key=key,
            sample_messages=c["samples"][:3],
            failure_count=c["count"],
            task_ids=c["tasks"][:20],
            covering_refs=[],
            suggested_action=action,
            created_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        ))
    return proposals
