# agenticx/learning/attribution.py
"""经验贡献归因账本（SP30 T2 · 规则版 Memory/Skill Credit Assignment）。

对标 MemoraX 的 Memory Credit Assignment，但不训记忆模型——只 join
「路由事件（带版本）× 任务结局」算 Beta(1,1) 平滑后验胜率：

- 输入：RSITrajectory（已标注，label>=0），只统计 decision_lineage 中的路由
  事件（memory_recall/skill_select/adapter_route）；同轨迹同 ref 去重（一票）
- partial（0<label<1）计 0.5 票量级的浮点分
- version=="unknown" 的行保留并在报告单列「待补埋点」——倒逼采集端补齐版本
- held-out 任务直接抛 HeldoutViolation（与 trainer.heldout 同红线）
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from agenticx.trainer.heldout import HeldoutViolation

from .trajectory.schema import ROUTING_KINDS, RSITrajectory

_SUPPORT_FLOOR = 5      # support 低于此值，报告标灰「证据不足」


@dataclass
class CreditRow:
    ref: str
    kind: str
    version: str
    uses: int
    pass_count: float
    fail_count: float
    first_seen: str = ""
    last_seen: str = ""

    @property
    def winrate(self) -> float:
        """Beta(1,1) 平滑后验胜率：(pass+1)/(uses+2)。"""
        return (self.pass_count + 1.0) / (self.uses + 2.0)

    @property
    def support(self) -> int:
        return self.uses

    @property
    def underpowered(self) -> bool:
        return self.uses < _SUPPORT_FLOOR


class AttributionLedger:
    """路由事件 × 结局 的累积账本。内存累计，save/load 落 JSON。"""

    def __init__(self, heldout_tasks: set[str] | None = None):
        self.heldout_tasks = set(heldout_tasks or ())
        self.rows: list[CreditRow] = []
        self._index: dict[str, CreditRow] = {}

    # ---------------------------------------------------------------- 摄入

    def credit(self, traj: RSITrajectory) -> int:
        """一条轨迹计入账本，返回实际计票的 ref 数。"""
        if traj.task_id in self.heldout_tasks:
            raise HeldoutViolation(
                f"task '{traj.task_id}' 在 held-out 考试集，禁止进入归因账本")
        label = traj.reward.label
        if label < 0:
            return 0                        # 未标注整条排除
        voted: set[str] = set()
        for step in traj.decision_lineage:
            if step.kind not in ROUTING_KINDS or step.ref in voted:
                continue
            voted.add(step.ref)
            row = self._index.get(step.ref)
            if row is None:
                row = CreditRow(ref=step.ref, kind=step.kind,
                                version=step.version or "unknown",
                                uses=0, pass_count=0.0, fail_count=0.0,
                                first_seen=traj.created_at or "",
                                last_seen=traj.created_at or "")
                self.rows.append(row)
                self._index[step.ref] = row
            row.uses += 1
            row.pass_count += label          # partial 计 0~1 浮点票
            row.fail_count += 1.0 - label
            if traj.created_at:
                row.last_seen = max(row.last_seen, traj.created_at)
        return len(voted)

    # ---------------------------------------------------------------- 查询

    def row(self, ref: str) -> CreditRow | None:
        return self._index.get(ref)

    @property
    def unknown_version_ratio(self) -> float:
        if not self.rows:
            return 0.0
        unk = sum(r.uses for r in self.rows if r.version == "unknown")
        total = sum(r.uses for r in self.rows)
        return unk / total if total else 0.0

    # ---------------------------------------------------------------- 落盘

    def save(self, out_dir: Path) -> Path:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        data_path = out_dir / "ledger.json"
        payload = {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "n_rows": len(self.rows),
            "unknown_version_ratio": round(self.unknown_version_ratio, 4),
            "rows": [asdict(r) | {"winrate": round(r.winrate, 4)}
                     for r in sorted(self.rows, key=lambda r: -r.uses)],
        }
        json.dump(payload, open(data_path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        (out_dir / "ledger.md").write_text(self._markdown(), encoding="utf-8")
        return data_path

    @classmethod
    def load(cls, out_dir: Path) -> "AttributionLedger":
        payload = json.load(open(Path(out_dir) / "ledger.json", encoding="utf-8"))
        led = cls()
        for d in payload.get("rows", []):
            row = CreditRow(ref=d["ref"], kind=d["kind"], version=d["version"],
                            uses=d["uses"], pass_count=d["pass_count"],
                            fail_count=d["fail_count"],
                            first_seen=d.get("first_seen", ""),
                            last_seen=d.get("last_seen", ""))
            led.rows.append(row)
            led._index[row.ref] = row
        return led

    # ---------------------------------------------------------------- 报告

    def _markdown(self) -> str:
        lines = [
            "# 经验贡献归因账本（SP30 T2）",
            "",
            f"- 经验条目: {len(self.rows)}",
            f"- unknown 版本占比: {self.unknown_version_ratio:.1%}（待补埋点）",
            "",
        ]
        solid = [r for r in self.rows if not r.underpowered]
        weak = [r for r in self.rows if r.underpowered]
        lines.append("## 高胜率经验（winrate 降序，support ≥ %d）" % _SUPPORT_FLOOR)
        lines += _table(sorted(solid, key=lambda r: -r.winrate)[:20])
        lines.append("")
        lines.append("## 拖后腿经验（winrate 升序，support ≥ %d）" % _SUPPORT_FLOOR)
        lines += _table(sorted(solid, key=lambda r: r.winrate)[:20])
        lines.append("")
        lines.append("## 证据不足（support < %d，标灰待积累）" % _SUPPORT_FLOOR)
        lines += _table(weak[:20])
        lines.append("")
        unk = [r for r in self.rows if r.version == "unknown"]
        lines.append("## 待补埋点（version=unknown）")
        lines += _table(unk[:20])
        return "\n".join(lines) + "\n"


def _table(rows: list[CreditRow]) -> list[str]:
    if not rows:
        return ["（空）"]
    out = ["| ref | kind | version | uses | winrate |", "|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r.ref} | {r.kind} | {r.version} | {r.uses} "
                   f"| {r.winrate:.3f} |")
    return out


def credit_trajectory(ledger: AttributionLedger, traj: RSITrajectory) -> int:
    """便捷入口：单条轨迹入账（tests/脚本直接调用）。"""
    return ledger.credit(traj)
