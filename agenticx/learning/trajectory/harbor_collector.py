"""从 harbor job 目录解析 trial → RSITrajectory（②采集层，harbor 源）。

trial 结构（已验证）: jobs/<job>/<task>__<hash>/{config.json, result.json,
agent/agenticx.trajectory.json}
"""
from __future__ import annotations

import glob
import json
from pathlib import Path
from typing import Iterator

from .schema import DecisionStep, RewardRecord, RSITrajectory, ToolCallRecord

def _load_json(path: Path):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return None

def _extract_tool_calls(messages: list[dict]) -> list[ToolCallRecord]:
    """从消息中提取工具调用序列（OpenAI 格式），按 tool_call_id 配对结果。

    防御式解析：字段缺失/格式漂移时跳过该条而非崩溃。
    """
    calls: list[ToolCallRecord] = []
    pending: dict[str, ToolCallRecord] = {}
    for m in messages:
        if not isinstance(m, dict):
            continue
        for tc in m.get("tool_calls") or []:
            fn = tc.get("function") or {}
            name = fn.get("name") or "unknown"
            args = fn.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {"_raw": args[:200]}
            rec = ToolCallRecord(name=name, arguments=args if isinstance(args, dict) else {})
            calls.append(rec)
            if tc.get("id"):
                pending[tc["id"]] = rec
        if m.get("role") == "tool" and m.get("tool_call_id") in pending:
            rec = pending[m["tool_call_id"]]
            content = str(m.get("content") or "")
            rec.result_summary = content[:500]
            rec.ok = "error" not in content.lower()[:200]
    return calls

def _lineage(tool_calls: list[ToolCallRecord], reward: RewardRecord) -> list[DecisionStep]:
    steps = [DecisionStep(kind="tool_call", ref=c.name, note="") for c in tool_calls]
    steps.append(DecisionStep(kind="verification", ref=reward.source,
                              note=f"label={reward.label}"))
    return steps

def collect_trial(trial_dir: Path) -> RSITrajectory | None:
    trial_dir = Path(trial_dir)
    result = _load_json(trial_dir / "result.json")
    traj = _load_json(trial_dir / "agent" / "agenticx.trajectory.json")
    if result is None or traj is None:
        return None
    vr = (result.get("verifier_result") or {}).get("rewards") or {}
    label = float(vr.get("reward", -1.0))
    if label < 0:
        return None
    status = "pass" if label >= 1.0 else ("fail" if label <= 0.0 else "partial")
    messages = [m for m in (traj.get("messages") or []) if isinstance(m, dict)]
    tool_calls = _extract_tool_calls(messages)
    reward = RewardRecord(label=label, source="verifier", components={"verifier": label})
    cfg = _load_json(trial_dir / "config.json") or {}
    task_name = result.get("task_name") or cfg.get("task", {}).get("name", "").split("/")[-1]
    model = traj.get("model") or "unknown"
    return RSITrajectory(
        source="harbor-tb40",
        task_id=task_name,
        session_id=str(trial_dir),
        model=model,
        status=status,
        reward=reward,
        messages=messages,
        tool_calls=tool_calls,
        decision_lineage=_lineage(tool_calls, reward),
        token_usage=traj.get("totals") or {},
        created_at=result.get("started_at") or "",
        metadata={"agent": traj.get("agent"), "iterations": traj.get("iterations"),
                  "job": trial_dir.parent.name, "verifier_raw": vr},
    )

def collect_jobs(jobs_dir: Path, job_pattern: str = "*tb40*") -> Iterator[RSITrajectory]:
    """遍历 jobs/<job>/<trial>/，job_pattern 过滤（默认排除 broken-tb21mix 旧实验）。"""
    for trial in sorted(glob.glob(f"{Path(jobs_dir)}/{job_pattern}/*/")):
        t = collect_trial(Path(trial))
        if t is not None:
            yield t
