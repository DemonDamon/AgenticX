# agenticx/learning/trajectory/evolution.py
"""策略演化循环（P0.5 · Dream-RSI 的 Dreaming-based Policy Improvement 等价物）。

闭环：提议策略变体 → 回放模拟器批量评分（零推理成本）→ ≥当前分才 promote。
底层 agent/评测器/沙盒全冻结, 只演化策略源码——与论文同构。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .forest import StepFeatures
from .replay import AttemptContext

SEED_POLICY_SOURCE = '''\
NAME = "seed_error_streak_3"
def act(obs, ctx):
    """种子策略：连续 3 次工具失败即止损。"""
    if obs.consecutive_failures >= 3:
        return "abort"
    return "continue"
'''

@dataclass
class SimplePolicy:
    name: str
    fn: Callable[[StepFeatures, AttemptContext], str]

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str:
        return self.fn(obs, ctx)


def compile_policy(source: str) -> SimplePolicy:
    """把策略源码 exec 为可执行对象。源码须定义 NAME: str 与 act(obs, ctx) -> str。

    受控演化：源码由本循环的提议器产生（LLM/变异）, exec 命名空间仅注入
    StepFeatures/AttemptContext 两个类型, 不给 import/os 等能力。
    """
    ns: dict[str, Any] = {"StepFeatures": StepFeatures, "AttemptContext": AttemptContext}
    exec(compile(source, "<policy>", "exec"), ns)  # noqa: S102
    if "act" not in ns or not callable(ns["act"]) or "NAME" not in ns:
        raise ValueError("策略源码必须定义 NAME 与 act(obs, ctx)")
    return SimplePolicy(name=str(ns["NAME"]), fn=ns["act"])


class PolicyRegistry:
    """策略版本注册表：candidate → promoted, 与 ModelRegistry 同语义。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = self._load()
        self._versions: list[dict[str, Any]] = data.get("versions", [])
        self._promoted: int | None = data.get("promoted")

    def _load(self) -> dict[str, Any]:
        try:
            return json.load(open(self.path))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self) -> None:
        json.dump({"versions": self._versions, "promoted": self._promoted},
                  open(self.path, "w"), ensure_ascii=False, indent=2)

    def register(self, source: str, score: float, lineage: str) -> int:
        version = (self._versions[-1]["version"] + 1) if self._versions else 1
        self._versions.append({"version": version, "source": source,
                               "score": score, "lineage": lineage})
        self._save()
        return version

    def promote(self, version: int) -> None:
        if not any(v["version"] == version for v in self._versions):
            raise ValueError(f"未知策略版本 {version}")
        self._promoted = version
        self._save()

    def current(self) -> dict[str, Any] | None:
        if self._promoted is None:
            return None
        return next(v for v in self._versions if v["version"] == self._promoted)

    def versions(self) -> list[dict[str, Any]]:
        return list(self._versions)
