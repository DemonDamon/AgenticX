"""长时程 SLO 指标（SP30 T5）——人工干预率 / 断点恢复率 / 未采集率。

行业对标：OpenAI「Research acceleration」(2026-09) 披露过去六个月成功完成的
4–8h 研究任务中 50%+ 至少一次人工干预。我们的口径：

- 长任务代理口径：tool_calls >= LONG_TASK_TOOL_THRESHOLD（默认 40）或
  metadata.wall_seconds >= 4h，满足其一（TB 轨迹普遍无墙钟，报告须注明
  这是代理口径）
- 干预率：长任务中 human_interventions >= 1 的占比；缺键轨迹进 unknown，
  unknown_rate 显式上报（倒逼采集补齐，与归因账本 unknown 分区同思路）
- 样本 < MIN_SAMPLE 全部指标照算但 underpowered=True（报告标灰）

metadata 保留键约定见 learning/trajectory/schema.py（SP30 T5）：
human_interventions / wall_seconds / checkpoints / resume_attempts /
resume_completed——全部可选；缺失=unknown 不许填 0 冒充。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

LONG_TASK_TOOL_THRESHOLD = 40          # 代理口径：≈40 次工具调用视作长任务
LONG_TASK_WALL_SECONDS = 4 * 3600      # 或墙钟 ≥4h（OpenAI 4–8h 任务口径）
MIN_SAMPLE = 10


@dataclass
class RsiSlo:
    total: int = 0
    long_task_count: int = 0
    intervention_rate: float | None = None
    unknown_rate: float | None = None
    resume_success_rate: float | None = None
    checkpoint_coverage: float | None = None
    underpowered: bool = False
    detail: dict[str, Any] = field(default_factory=dict)


def _is_long_task(traj) -> bool:
    if len(getattr(traj, "tool_calls", []) or []) >= LONG_TASK_TOOL_THRESHOLD:
        return True
    wall = (getattr(traj, "metadata", None) or {}).get("wall_seconds")
    return isinstance(wall, (int, float)) and wall >= LONG_TASK_WALL_SECONDS


def compute_slo(trajectories: list) -> RsiSlo:
    trajs = list(trajectories)
    slo = RsiSlo(total=len(trajs))
    long_tasks = [t for t in trajs if _is_long_task(t)]
    slo.long_task_count = len(long_tasks)
    if not long_tasks:
        return slo
    slo.underpowered = len(long_tasks) < MIN_SAMPLE

    # 干预率（分母只算已采集 human_interventions 的轨迹）
    known = [t for t in long_tasks
             if isinstance((t.metadata or {}).get("human_interventions"),
                           (int, float))]
    unknown = len(long_tasks) - len(known)
    slo.unknown_rate = unknown / len(long_tasks)
    if known:
        intervened = sum(1 for t in known
                         if (t.metadata or {}).get("human_interventions", 0) >= 1)
        slo.intervention_rate = intervened / len(known)

    # 断点恢复率（有 resume_attempts 的轨迹中 resume_completed>=1 占比）
    resumed = [t for t in long_tasks
               if isinstance((t.metadata or {}).get("resume_attempts"),
                             (int, float))
               and (t.metadata or {}).get("resume_attempts", 0) >= 1]
    if resumed:
        ok = sum(1 for t in resumed
                 if (t.metadata or {}).get("resume_completed", 0) >= 1)
        slo.resume_success_rate = ok / len(resumed)

    # checkpoint 覆盖率（长任务中有 checkpoints>0 的占比）
    with_cp = sum(1 for t in long_tasks
                  if (t.metadata or {}).get("checkpoints", 0) and True)
    slo.checkpoint_coverage = with_cp / len(long_tasks)

    slo.detail = {
        "n_long": len(long_tasks),
        "n_known_intervention": len(known),
        "n_unknown_intervention": unknown,
        "n_resumed": len(resumed),
        "threshold_tools": LONG_TASK_TOOL_THRESHOLD,
        "threshold_wall_seconds": LONG_TASK_WALL_SECONDS,
        "proxy_note": "tool_calls 阈值是长任务的代理口径（TB 轨迹普遍无墙钟）",
    }
    return slo


def render_markdown(slo: RsiSlo) -> str:
    def _fmt(v, pct=True):
        if v is None:
            return "N/A"
        return f"{v:.1%}" if pct else str(v)

    lines = [
        "# 长时程 SLO 报告（SP30 T5）",
        "",
        f"- 轨迹总数: {slo.total}（长任务 {slo.long_task_count}，"
        f"代理口径: ≥{LONG_TASK_TOOL_THRESHOLD} 次工具调用或墙钟 ≥4h）",
        f"- 人工干预率: {_fmt(slo.intervention_rate)}"
        f"{'（样本不足，标灰）' if slo.underpowered else ''}",
        f"- 未采集率（human_interventions 缺键）: {_fmt(slo.unknown_rate)}"
        "——未采集≠无干预，倒逼采集补齐",
        f"- 断点恢复成功率: {_fmt(slo.resume_success_rate)}",
        f"- checkpoint 覆盖率: {_fmt(slo.checkpoint_coverage)}",
        "",
        "行业锚点：OpenAI 2026-09——4–8h 成功任务 50%+ 至少一次人工干预。",
    ]
    return "\n".join(lines) + "\n"
