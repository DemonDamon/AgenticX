# tests/trajectory/test_scheduler.py
"""SP22 探索调度器单测: 错误三分类 / 四维动作回放 / 平台期止损与赦免 /
infra 不老化 / 浪费调用 / evolve_loop 接线（含已否定清单）。

回放语义钉死（Dream-RSI 对齐）:
  1. 种子调度器在有突破分支的森林上: 早停省预算, 得分高于死磕型
  2. infra 失败不老化健康度 → 分支持续被聚焦直到通过
  3. algorithm 连续失败推进平台期 → 分支被止损放弃（含"迟来的通过"被
     错过的代价——止损是 recall/效率的交换, 论文同款）
  4. 对已揭示完的分支继续投入 = 浪费调用（平台期惩罚的回放等价物）
  5. 调度器与 evolve_loop/PolicyRegistry 完全兼容（SP21 deny-list 生效）

注意: 顺序敏感用例直接构造 AttemptNode（attempt_id 决定揭示顺序）;
from_trajectories 按 trajectory_id（哈希）排序, 顺序不可控, 只用于
分类集成测试。
"""
from __future__ import annotations

import pytest

from agenticx.learning.trajectory.evolution import PolicyRegistry, compile_policy
from agenticx.learning.trajectory.forest import (
    AttemptNode, TaskTree, TrialForest, classify_error,
)
from agenticx.learning.trajectory.scheduler import (
    SEED_SCHEDULER_SOURCE, replay_evaluate_scheduler, scheduler_evolve,
)
from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory

# ------------------------------------------------------- 确定性节点工厂

def _node(task: str, seq: int, *, passed: bool = False, label: float = 0.0,
          error_class: str | None = None) -> AttemptNode:
    return AttemptNode(
        attempt_id=f"{task}-{seq:03d}", task_id=task, model="m",
        status="pass" if passed else "fail",
        reward_label=1.0 if passed else label,
        n_steps=2, total_est_tokens=8, steps=[],
        error_class=error_class or ("none" if passed else "algorithm"))


def _forest(*specs: tuple[str, list[dict]]) -> TrialForest:
    """specs: (task_id, [attempt kwargs 列表]) — attempt_id 序号即揭示顺序。"""
    trees: dict[str, TaskTree] = {}
    for task, attempts in specs:
        trees[task] = TaskTree(
            task_id=task,
            attempts=[_node(task, i, **kw) for i, kw in enumerate(attempts)])
    return TrialForest(trees=trees)


# ------------------------------------------------------------ 错误三分类

_PASS_MSGS = [{"role": "user", "content": "go"},
              {"role": "tool", "content": "ok done"}]
_INFRA_MSGS = [{"role": "user", "content": "go"},
               {"role": "tool", "content": "error: ConnectionError: harbor refused"}]
_ALGO_MSGS = [{"role": "user", "content": "go"},
              {"role": "tool", "content": "error: AssertionError: expected 21 got 20"}]


def _traj(task: str, sess: str, *, passed: bool = False,
          msgs: list | None = None) -> RSITrajectory:
    return RSITrajectory(
        source="history", task_id=task, session_id=f"{task}-{sess}",
        model="m", status="pass" if passed else "fail",
        reward=RewardRecord(label=1.0 if passed else 0.0),
        messages=msgs if msgs is not None else (_PASS_MSGS if passed else _ALGO_MSGS))


def test_classify_error_categories():
    assert classify_error(_INFRA_MSGS) == "infra"
    assert classify_error(_ALGO_MSGS) == "algorithm"
    assert classify_error(_PASS_MSGS) == "none"
    for content in ("error: FileNotFoundError: config.yaml",
                    "error: CUDA out of memory",
                    "error: DimensionMismatch at layer 3",
                    "error: docker pull rate limit exceeded",
                    "error: compilation failed: missing -DFOO"):
        assert classify_error(
            [{"role": "tool", "content": content}]) == "infra", content
    for content in ("error: tests failed: 2 of 5",
                    "error: verifier rejected: wrong output"):
        assert classify_error(
            [{"role": "tool", "content": content}]) == "algorithm", content


def test_classify_error_algo_wins_over_infra():
    """混合报错以判真信号为准（验证器说错就是方向失败）。"""
    mixed = _INFRA_MSGS + [{"role": "tool",
                            "content": "error: AssertionError: boom"}]
    assert classify_error(mixed) == "algorithm"


def test_attempt_node_error_class_populated():
    node = AttemptNode.from_trajectory(_traj("T", "1", msgs=_INFRA_MSGS))
    assert node.error_class == "infra"
    # 旧记录（无 error_class 字段）向后兼容
    d = node.to_dict()
    d.pop("error_class")
    assert AttemptNode.from_dict(d).error_class == "none"


# ------------------------------------------------------------ 回放模拟

SEED = compile_policy(SEED_SCHEDULER_SOURCE)

BURN_B = compile_policy(
    'NAME = "burn_b"\ndef act(obs, ctx):\n    return ("B", 2, 1, False)\n')


def test_seed_beats_never_stop_on_mixed_forest():
    """A 首试即过, B 全算法失败: 种子聚焦 A 后止损; 死磕 B 零通过烧光预算。"""
    forest = _forest(("A", [{"passed": True}]),
                     ("B", [{}] * 5))
    s_seed = replay_evaluate_scheduler(SEED, forest, call_budget=20)
    s_burn = replay_evaluate_scheduler(BURN_B, forest, call_budget=20)
    assert s_seed.passed_tasks == ("A",)
    assert s_seed.calls_spent < 20            # 主动结题, 不烧光预算
    assert s_burn.branches_passed == 0        # 从不聚焦 A → 零通过
    assert s_burn.calls_spent == 20
    assert s_seed.score() > s_burn.score()


def test_plateau_stoploss_and_infra_pardon():
    """algorithm 连续失败推进平台期 → 分支被放弃; infra 不老化 → 持续聚焦。

    C: 4 次 infra 失败后才通过——infra 失败不老化健康度, 种子一路挖到通过。
    D: 4 次 algorithm 失败后才通过——平台期止损放弃（"迟来的通过"被错过,
    这是止损的 recall/效率交换, 论文同款语义）。
    """
    forest = _forest(
        ("C", [{"error_class": "infra"}] * 4 + [{"passed": True}]),
        ("D", [{}] * 4 + [{"passed": True}]),
    )
    s = replay_evaluate_scheduler(SEED, forest, call_budget=40)
    assert "C" in s.passed_tasks              # infra 赦免: 一直被聚焦
    assert "D" not in s.passed_tasks          # 算法平台期: 被止损放弃


def test_partial_reward_resets_plateau():
    """部分 reward 提升也算进展（分支赦免）: 平台期计数清零, 分支不弃。"""
    forest = _forest(("E", [{}, {}, {"label": 0.5}, {}, {},
                             {"passed": True}]))
    s = replay_evaluate_scheduler(SEED, forest, call_budget=30)
    assert "E" in s.passed_tasks


def test_wasted_calls_on_exhausted_branch():
    """对已揭示完的分支继续投入 = 浪费（平台期惩罚的回放等价物）。"""
    forest = _forest(("A", [{}]))             # 1 条算法失败记录
    grind = compile_policy(
        'NAME = "grind_a"\ndef act(obs, ctx):\n    return ("A", 2, 2, False)\n')
    s = replay_evaluate_scheduler(grind, forest, call_budget=10)
    assert s.calls_spent == 10
    assert s.wasted_calls == 9                # 只有 1 条可揭示
    assert s.branches_passed == 0


def test_unknown_branch_wastes_whole_batch():
    forest = _forest(("A", [{"passed": True}]))
    lost = compile_policy(
        'NAME = "lost"\ndef act(obs, ctx):\n    return ("NOPE", 2, 2, False)\n')
    s = replay_evaluate_scheduler(lost, forest, call_budget=10)
    assert s.calls_spent == 10 and s.wasted_calls == 10
    assert s.branches_passed == 0


def test_pass_breaks_depth_lock():
    """分支突破即撤深度锁: 已通过分支不再吃满 depth×batch 的锁。"""
    forest = _forest(("A", [{"passed": True}]))
    smart = compile_policy(
        'NAME = "smart"\n'
        'def act(obs, ctx):\n'
        '    for b in obs.branches:\n'
        '        if b.task_id == "A" and b.passes:\n'
        '            return ("", 1, 1, True)\n'
        '    return ("A", 2, 5, False)\n')
    s = replay_evaluate_scheduler(smart, forest, call_budget=20)
    assert s.passed_tasks == ("A",)
    # 第 1 批揭示 pass + 并行第 2 调浪费; 锁在突破后立即撤除（否则烧 10）
    assert s.calls_spent == 2
    assert s.wasted_calls == 1


def test_dict_action_normalized():
    forest = _forest(("A", [{"passed": True}]))
    d = compile_policy(
        'NAME = "d"\ndef act(obs, ctx):\n'
        '    return {"focus": "A", "batch": 2, "depth": 1, "stop": False}\n')
    s = replay_evaluate_scheduler(d, forest, call_budget=6)
    assert s.passed_tasks == ("A",)


def test_bad_action_raises():
    forest = _forest(("A", [{"passed": True}]))
    bad = compile_policy('NAME = "bad"\ndef act(obs, ctx):\n    return "huh"\n')
    with pytest.raises(TypeError):
        replay_evaluate_scheduler(bad, forest, call_budget=6)


# --------------------------------------------------------- evolve 接线

def test_scheduler_evolve_registers_seed_and_denies_rejects(tmp_path):
    forest = _forest(("A", [{"passed": True}]),
                     ("B", [{}] * 5))
    reg = PolicyRegistry(tmp_path / "schedulers.json")
    rep = scheduler_evolve(reg, forest, call_budget=20, n_iters=3)
    assert reg.current() is not None
    assert reg.current()["lineage"] == "seed"     # 无提升 → 种子保持 promoted
    assert rep.best_score == pytest.approx(
        replay_evaluate_scheduler(SEED, forest, call_budget=20).score())
    assert len(reg.denied()) >= 1                # 无提升变体进已否定清单


def test_scheduler_evolve_bad_policy_gets_inf_and_denied(tmp_path):
    """崩溃/非法动作的调度器得 -inf, 按"无提升"入否定清单, 不炸循环。"""
    forest = _forest(("A", [{"passed": True}]))
    reg = PolicyRegistry(tmp_path / "schedulers.json")
    broken = 'NAME = "broken"\ndef act(obs, ctx):\n    return 1 / 0\n'
    rep = scheduler_evolve(reg, forest, call_budget=10, n_iters=2,
                           propose_fn=lambda cur, fb: broken)
    assert rep.rejected == 2
    assert any(d["reason"] == "no_improvement" for d in reg.denied())
