# agenticx/learning/trajectory/scheduler.py
"""探索调度器（SP22 · Dream-RSI 四维动作空间的形式化）。

论文（arXiv 2609.14858）把长程探索策略形式化为树遍历调度, 调度器每轮
只做四件事: 选节点 / 定并发 / 设深度 / 下止损。P0.5 的回放评估
（replay.evaluate_policy）是"attempt 内逐步"的 continue/abort 策略,
分支间调度退化为顺序——本模块把缺失的那一层补上, 粒度 = 分支（任务）。

回放语义（零成本模拟器的诚实边界）:
  - 分支 = 任务; 分支的"已记录 attempt 序列"按 attempt_id 顺序揭示。
  - 调度器花一次调用在分支上 = 揭示该分支下一条已记录 attempt 的结果。
    只能重排/重访/剪枝历史, 不能凭空产生未探索的真值（论文边界二）。
  - 分支已揭示完还继续投入 = 浪费调用（wasted）。这是平台期惩罚的回放
    等价物: 论文批评的"第 3 步就走平还把 11 步跑满"在回放里表现为
    对已走平分支的无效投入。
  - 分支突破（出现 pass）即撤深度锁——论文实测最优策略在突破后主动
    压低后续尝试, 不做无谓深挖。

分支健康度与赦免（论文附录避坑规则的落地）:
  - infra 失败（网络/容器/显存/维度错等可修复失误）不老化健康度
    （steps_since_improve 不增）——"单次出现不允许关停分支"。
  - 任意进展（部分 reward 提升或 pass）清零 steps_since_improve——
    分支赦免: 早期失败后只要出现进展即撤销死亡标记, 调度器可重新聚焦。
  - algorithm 失败（断言/验证器判真失败）才推进平台期计数。

策略代码形态与 evolve_loop 完全兼容（NAME + act(obs, ctx)）, 可直接
进 PolicyRegistry 演化（含 SP21 已否定清单）。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .evolution import (
    PolicyRegistry, compile_policy, evolve_loop, mutate_policy_source,
)
from .forest import AttemptNode, TrialForest

# ---------------------------------------------------------------- 观测/动作

@dataclass
class BranchStats:
    """单分支的可观测历史（不含未揭示信息, 防回泄未来）。"""
    task_id: str
    attempts: int                # 已揭示 attempt 数
    passes: int
    best_reward: float
    infra_fails: int             # infra 类失败数（不计入健康度）
    algo_fails: int              # algorithm 类失败数
    steps_since_improve: int     # 距上次进展的 attempt 数（infra 不老化）
    last_error_class: str = "none"


@dataclass(frozen=True)
class SchedulerObs:
    round_no: int
    budget_remaining: int        # 剩余调用配额
    branches: tuple[BranchStats, ...]


@dataclass(frozen=True)
class SchedulerCtx:
    round_no: int
    budget_remaining: int


def _normalize_action(action) -> tuple[str, int, int, bool]:
    """动作归一: (focus, batch, depth, stop) 四元组或同键 dict。

    focus=分支 task_id; batch=本轮并发揭示数; depth=深度锁轮数;
    stop=True 表示主动结题（空批次, 不再消耗预算）。
    """
    if isinstance(action, dict):
        try:
            focus, batch, depth = action["focus"], action["batch"], action["depth"]
            stop = bool(action.get("stop", False))
        except KeyError as e:
            raise TypeError(f"调度动作 dict 缺字段: {e}") from e
    else:
        try:
            focus, batch, depth, stop = action
        except (TypeError, ValueError):
            raise TypeError(
                "调度动作须为 (focus, batch, depth, stop) 四元组或同键 dict")
    return str(focus), max(1, int(batch)), max(1, int(depth)), bool(stop)


# ---------------------------------------------------------------- 回放模拟

@dataclass
class _BranchState:
    queue: list[AttemptNode]                 # 未揭示的已记录 attempt
    stats: BranchStats

    def reveal(self, node: AttemptNode) -> None:
        s = self.stats
        s.attempts += 1
        if node.passed:
            s.passes += 1
            s.best_reward = max(s.best_reward, 1.0)
            s.steps_since_improve = 0        # 赦免: 进展清零健康度计数
            s.last_error_class = "none"
            return
        s.last_error_class = node.error_class
        if node.reward_label > s.best_reward:
            s.best_reward = node.reward_label
            s.steps_since_improve = 0        # 部分奖励提升也是进展（赦免）
        elif node.error_class == "infra":
            s.infra_fails += 1               # 可修复失误: 不老化分支
        else:
            s.algo_fails += 1
            s.steps_since_improve += 1


@dataclass(frozen=True)
class SchedulerScore:
    n_branches: int
    passed_tasks: tuple[str, ...]
    calls_spent: int
    wasted_calls: int

    @property
    def branches_passed(self) -> int:
        return len(self.passed_tasks)

    def score(self) -> float:
        """与 replay.forest_score 同形: 通过优先, 调用数为 tiebreak。"""
        return self.branches_passed * 10000 - self.calls_spent


def replay_evaluate_scheduler(policy, forest: TrialForest, *,
                              call_budget: int = 20,
                              max_rounds: int = 64) -> SchedulerScore:
    """调度器在已记录森林上的零成本回放评估。

    每轮: 构造 SchedulerObs → policy.act → 归一动作 → 消耗预算揭示
    对应分支的已记录 attempt（深度锁内每轮 batch 条, 突破即撤锁）。
    """
    state: dict[str, _BranchState] = {}
    for tid, tree in forest.trees.items():
        state[tid] = _BranchState(
            queue=list(tree.attempts),
            stats=BranchStats(task_id=tid, attempts=0, passes=0,
                              best_reward=0.0, infra_fails=0, algo_fails=0,
                              steps_since_improve=0))
    calls = wasted = 0
    rounds = 0
    while calls < call_budget and rounds < max_rounds:
        obs = SchedulerObs(
            round_no=rounds, budget_remaining=call_budget - calls,
            branches=tuple(s.stats for s in state.values()))
        action = policy.act(obs, SchedulerCtx(
            round_no=rounds, budget_remaining=call_budget - calls))
        focus, batch, depth, stop = _normalize_action(action)
        rounds += 1
        if stop:
            break
        s = state.get(focus)
        if s is None:
            # 未知分支: 策略没看 obs, 整批浪费
            spend = min(batch * depth, call_budget - calls)
            calls += spend
            wasted += spend
            continue
        for _ in range(depth):
            if calls >= call_budget:
                break
            for _ in range(batch):
                if calls >= call_budget:
                    break
                calls += 1
                if s.queue:
                    s.reveal(s.queue.pop(0))
                else:
                    wasted += 1        # 已走平分支的无效投入（平台期惩罚）
            if s.stats.passes:
                break                  # 突破即撤深度锁, 主动节省算力
    passed = tuple(sorted(tid for tid, s in state.items() if s.stats.passes))
    return SchedulerScore(n_branches=len(state), passed_tasks=passed,
                          calls_spent=calls, wasted_calls=wasted)


# ---------------------------------------------------------------- 种子与演化

SEED_SCHEDULER_SOURCE = '''\
NAME = "seed_plateau_switch"
def act(obs, ctx):
    """种子调度器（四维动作的启发式基线）。

    选节点: 未通过且未平台期的分支里挑健康度最好的;
    定并发: 批 2; 设深度: 1 轮一决策（保持自适应）; 下止损: 无可做分支
    或预算耗尽即主动结题。平台期 = 连续 3 次算法性无提升（infra 失败
    不计入——回放语义已保证, 见 scheduler 模块文档）。
    """
    if obs.budget_remaining <= 0:
        return ("", 1, 1, True)
    todo = [b for b in obs.branches
            if b.best_reward < 1.0 and b.steps_since_improve < 3]
    if not todo:
        return ("", 1, 1, True)
    b = min(todo, key=lambda x: x.steps_since_improve)
    return (b.task_id, 2, 1, False)
'''


def scheduler_evolve(registry: PolicyRegistry, forest: TrialForest, *,
                     call_budget: int | None = None, n_iters: int = 3,
                     propose_fn: Callable[[str, str], str] | None = None,
                     min_improve: float = 0.0):
    """把调度器接进 evolve_loop（Dreaming-based Policy Improvement）。

    评估 = 回放评分; 策略崩溃/动作非法 → -inf（evolve_loop 会将其按
    "无提升"入已否定清单, 不再消耗预算）。train/eval 隔离纪律由调用方
    保证（传入的 forest 应已过滤为 train 区）。
    """
    if call_budget is None:
        call_budget = max(8, 4 * len(forest.trees))

    def evaluate_fn(policy) -> float:
        try:
            return replay_evaluate_scheduler(
                policy, forest, call_budget=call_budget).score()
        except Exception:
            return float("-inf")

    if registry.current() is None:
        seed = compile_policy(SEED_SCHEDULER_SOURCE)
        v = registry.register(SEED_SCHEDULER_SOURCE,
                              score=evaluate_fn(seed), lineage="seed")
        registry.promote(v)
    return evolve_loop(registry, evaluate_fn=evaluate_fn,
                       propose_fn=propose_fn or
                       (lambda cur, fb: mutate_policy_source(cur)),
                       n_iters=n_iters, min_improve=min_improve)
