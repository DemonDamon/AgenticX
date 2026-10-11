# agenticx/learning/trajectory/evolution.py
"""策略演化循环（P0.5 · Dream-RSI 的 Dreaming-based Policy Improvement 等价物）。

闭环：提议策略变体 → 回放模拟器批量评分（零推理成本）→ ≥当前分才 promote。
底层 agent/评测器/沙盒全冻结, 只演化策略源码——与论文同构。
"""
from __future__ import annotations

import hashlib
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
    """策略版本注册表：candidate → promoted, 与 ModelRegistry 同语义。

    SP21 已否定清单（RRSI 归因机制）: 被回放否决的变体留指纹（normalize 后
    sha256）, evolve_loop 提前跳过——已否定假设不再消耗评估预算。
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = self._load()
        self._versions: list[dict[str, Any]] = data.get("versions", [])
        self._promoted: int | None = data.get("promoted")
        self._denied: list[dict[str, Any]] = data.get("denied", [])

    def _load(self) -> dict[str, Any]:
        try:
            return json.load(open(self.path))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self) -> None:
        json.dump({"versions": self._versions, "promoted": self._promoted,
                   "denied": self._denied},
                  open(self.path, "w"), ensure_ascii=False, indent=2)

    @staticmethod
    def fingerprint(source: str) -> str:
        """空白归一化后哈希——只对语义指纹, 不对排版。"""
        return hashlib.sha256(" ".join(source.split()).encode()).hexdigest()

    def deny(self, source: str, score: float, reason: str) -> None:
        fp = self.fingerprint(source)
        if any(d["fingerprint"] == fp for d in self._denied):
            return
        self._denied.append({"fingerprint": fp, "score": score,
                             "reason": reason})
        self._save()

    def is_denied(self, source: str) -> bool:
        fp = self.fingerprint(source)
        return any(d["fingerprint"] == fp for d in self._denied)

    def denied(self) -> list[dict[str, Any]]:
        return list(self._denied)

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


import re


@dataclass
class EvolutionReport:
    iterations: int
    accepted: int
    rejected: int
    best_score: float
    best_version: int


def evolve_loop(registry: PolicyRegistry,
                evaluate_fn: Callable[[Any], float],
                propose_fn: Callable[[str, str], str],
                n_iters: int = 5,
                min_improve: float = 0.0,
                track_denied: bool = True) -> EvolutionReport:
    """离线演化主循环（论文 Dreaming-based Policy Improvement）。

    evaluate_fn 只允许绑定 train 区任务树（SP7 隔离纪律）。
    择优规则：new_score > best + min_improve 才 register+promote。
    坏代码（语法错/缺 NAME/缺 act）与劣质变体一律丢弃, 不影响当前策略。
    SP21（RRSI）: track_denied 时被否决的变体进已否定清单, 同指纹提议
    后续迭代直接跳过（不再消耗 evaluate 预算, 归因可查）。
    """
    current = registry.current()
    if current is None:
        raise ValueError("注册表无 promoted 策略, 请先注册并 promote 种子策略")
    best_score, best_version = current["score"], current["version"]
    accepted = rejected = 0
    for _ in range(n_iters):
        proposal = propose_fn(current["source"], f"current_score={best_score}")
        if track_denied and registry.is_denied(proposal):
            rejected += 1                      # 已否定假设: 零成本跳过
            continue
        try:
            policy = compile_policy(proposal)
        except Exception:
            if track_denied:
                registry.deny(proposal, 0.0, "compile_error")
            rejected += 1
            continue
        score = evaluate_fn(policy)
        if score > best_score + min_improve:
            v = registry.register(proposal, score=score, lineage="evolved")
            registry.promote(v)
            best_score, best_version = score, v
            current = registry.current()
            accepted += 1
        else:
            if track_denied:
                registry.deny(proposal, score, "no_improvement")
            rejected += 1
    return EvolutionReport(n_iters, accepted, rejected, best_score, best_version)


def mutate_policy_source(source: str) -> str:
    """dry-run 提议器：把源码中第一个 `= <int>` 的整数字面量 +1（确定性爬坡）。"""
    m = re.search(r"=\s*(\d+)", source)
    if not m:
        return source
        # 无数字可变时原样返回, evolve_loop 会按"无提升"拒绝, 循环安全
    old, new = m.group(0), f"= {int(m.group(1)) + 1}"
    return source.replace(old, new, 1)


_PROPOSER_PROMPT = """你是探索策略优化器（Dream-RSI 式离线策略改进）。
当前策略源码与其在历史轨迹回放上的得分如下。请提出一个改进变体,
只输出一个 python 代码块（```python ... ```）, 代码必须定义:
NAME: str 与 act(obs, ctx) -> str（返回 "continue" 或 "abort"）。
可用类型: obs: StepFeatures(step, n_messages, n_tool_calls, tool_success_rate,
consecutive_failures, rounds_since_progress, est_tokens);
ctx: AttemptContext(task_id, attempt_index, attempts_remaining, spent_so_far)。

当前策略源码:
```python
{source}
```

{feedback}
"""


def _extract_code(text: str) -> str:
    m = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    return m.group(1).strip() if m else text.strip()


def make_llm_proposer(llm: Any) -> Callable[[str, str], str]:
    """用仓库 LLM provider 构造提议器：llm.invoke(prompt) -> LLMResponse(.content)。"""
    def propose(current_source: str, feedback: str) -> str:
        prompt = _PROPOSER_PROMPT.format(source=current_source, feedback=feedback)
        resp = llm.invoke(prompt)
        return _extract_code(getattr(resp, "content", "") or "")
    return propose
