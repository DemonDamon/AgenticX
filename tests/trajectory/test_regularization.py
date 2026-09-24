# tests/trajectory/test_regularization.py
"""SP21 经验层正则化单测：泄漏筛查 / 回放验收与剪枝 / 已否定清单 / 考试单次验证。

钉死（对齐 RRSI 三失败模式的对策语义）:
  1. 泄漏: 他人任务ID、绝对路径、长 hex、host:port 拒绝; 自己任务ID 放行
  2. 回放门: 错误模式与失败强相关才入库; δ≈0 的噪声模式被拒/被剪
  3. 考试污染: heldout 任务来源教训直接拒绝; 库内有则验证抛异常
  4. 单次验证: marker 落盘, 第二次调用拒绝, force 留痕
  5. deny-list: 被否决变体同指纹跳过（evaluate 调用数减少）, 持久化

vote_key 归一化口径: "error: P boom" → "error:p boom"（小写、去冒号后空格）。
"""
from __future__ import annotations

import json
from types import SimpleNamespace as NS

import pytest

from agenticx.learning.trajectory.evolution import (
    SEED_POLICY_SOURCE, PolicyRegistry, evolve_loop)
from agenticx.learning.trajectory.memory import ExperienceMemory, Lesson
from agenticx.learning.trajectory.regularization import (
    admission_gate, heldout_report_once, prune_with_replay, replay_stats,
    screen_leakage, screen_lessons)


# ---------------------------------------------------------------- 轨迹工厂

def traj(task, status, *tool_msgs):
    messages = [{"role": "tool", "content": m} for m in tool_msgs]
    return NS(task_id=task, status=status, messages=messages)


# P 模式: 出现组全失败（0/3）, 未出现组 4/5 通过 → δ=-0.8 强判别
# Q 模式: 出现组 1/2 通过, 未出现组 3/6 通过 → δ=0.0 纯噪声
TRJS = [
    traj("T-1", "fail", "error: P boom"),
    traj("T-1", "fail", "error: P boom"),
    traj("T-1", "fail", "error: P boom"),
    traj("T-1", "pass", "all good"),
    traj("T-2", "fail", "error: Q flaky"),
    traj("T-2", "pass", "error: Q flaky"),
    traj("T-3", "pass", "clean A"),
    traj("T-3", "pass", "clean B"),
]
SPLIT = {"train": ["T-1", "T-2", "T-3"], "heldout": ["HELD-01"]}


# ---------------------------------------------------------------- 泄漏筛查

def test_screen_leakage_rejects_foreign_task_id():
    l = Lesson("T-A", "contrastive_failure", "先读 PROJ-H-03 的 yaml 再动手")
    r = screen_leakage(l, known_task_ids={"PROJ-H-03", "T-A"})
    assert not r.ok
    assert any("他人任务ID" in x for x in r.reasons)


def test_screen_leakage_allows_own_task_id():
    l = Lesson("PROJ-H-03", "contrastive_failure", "PROJ-H-03 需先读 yaml 再动手")
    assert screen_leakage(l, known_task_ids={"PROJ-H-03"}).ok


def test_screen_leakage_rejects_env_specific_markers():
    for content in ("配置在 /tmp/agent-x/config.yaml",
                    "密钥 a1b2c3d4e5f60718293a0b1c 出现即失败",
                    "服务挂在 harbor-1.macaron.im:8080 上"):
        r = screen_leakage(Lesson("T-A", "failure_pattern", content))
        assert not r.ok, content


def test_screen_lessons_partition():
    ls = [Lesson("T-A", "success_note", "此任务曾成功通过"),
          Lesson("T-A", "failure_pattern", "路径 /tmp/x 报错"),
          Lesson("T-A", "failure_pattern", "网络超时重试即可")]
    passed, rejected = screen_lessons(ls)
    assert [l.kind for l in passed] == ["success_note", "failure_pattern"]
    assert len(rejected) == 1


# ---------------------------------------------------------------- 回放验收

def test_replay_stats_delta_sign():
    sp = replay_stats("error:p boom", TRJS, min_attempts=3)
    assert sp.n_with == 3 and sp.n_with_passed == 0
    assert sp.pass_rate_without == pytest.approx(4 / 5)
    assert sp.delta == pytest.approx(-0.8)
    assert sp.sufficient
    sq = replay_stats("error:q flaky", TRJS, min_attempts=2)
    assert sq.delta == pytest.approx(0.0)           # 噪声: 无判别力
    # 样本量门
    assert not replay_stats("error:p boom", TRJS[:2], min_attempts=3).sufficient


def test_admission_gate_three_doors():
    lessons = [
        Lesson("T-1", "contrastive_failure", "error: P boom"),   # 过三门
        Lesson("T-1", "failure_pattern", "error: Q flaky"),       # δ=0 拒
        Lesson("T-1", "failure_pattern", "error: R rare"),        # 样本不足拒
        Lesson("T-1", "success_note", "此任务曾成功通过"),          # 免回放门
        Lesson("HELD-01", "failure_pattern", "error: P boom"),    # 考试污染拒
    ]
    g = admission_gate(lessons, TRJS, split=SPLIT, min_delta=0.15,
                       min_attempts=2)
    assert [l.kind for l in g.admitted] == ["contrastive_failure",
                                            "success_note"]
    reasons = [why for _, why in g.rejected]
    assert any("not_discriminative" in x for x in reasons)
    assert any("insufficient_samples" in x for x in reasons)
    assert any("eval_task_contamination" in x for x in reasons)


def test_admission_gate_task_scope():
    """task_ids 限定统计范围: 考试轨迹不得参与选择环节的门计算。"""
    trjs = TRJS + [traj("HELD-01", "fail", "error: P boom")]
    g = admission_gate(
        [Lesson("T-1", "contrastive_failure", "error: P boom")],
        trjs, task_ids={"T-1", "T-2", "T-3"}, min_attempts=2)
    assert len(g.admitted) == 1
    assert g.stats["error:p boom"].n_with == 3   # HELD-01 的轨迹没被算进来


# ---------------------------------------------------------------- 剪枝

def test_prune_with_replay_removes_noise_and_leak(tmp_path):
    lessons = [
        Lesson("T-1", "contrastive_failure", "error: P boom"),
        Lesson("T-1", "failure_pattern", "error: Q flaky"),
        Lesson("T-1", "failure_pattern", "见 /tmp/agent-x/config.yaml"),
    ]
    m = ExperienceMemory(tmp_path / "mem.json")
    m.add(lessons, round_no=1)
    report = prune_with_replay(m, TRJS, min_delta=0.15, min_attempts=2)
    assert report.n_before == 3 and report.n_after == 1
    kinds = {r[2].split("(")[0].split(":")[0] for r in report.removed}
    assert "not_discriminative" in kinds and "leakage" in kinds
    assert [l.kind for l in m.all_lessons()] == ["contrastive_failure"]


def test_prune_complexity_cap_keeps_high_vote(tmp_path):
    # 同错误模式在两个任务复现: 第二任务教训票数高, cap=1 时活下来
    lessons = [
        Lesson("T-1", "contrastive_failure", "error: P boom"),
        Lesson("T-2", "contrastive_failure", "error: P boom"),
    ]
    m = ExperienceMemory(tmp_path / "mem.json")
    m.add(lessons, round_no=1)
    report = prune_with_replay(m, TRJS, min_delta=0.15, min_attempts=2,
                               max_active=1)
    assert report.n_after == 1
    assert report.removed[0][2] == "complexity_cap"
    assert m.all_lessons()[0].task_id == "T-2"


def test_prune_works_on_frozen_memory(tmp_path):
    """剪枝是质量治理不是新学习: 冻结库可剪（add 仍被拒）。"""
    m = ExperienceMemory(tmp_path / "mem.json")
    m.add([Lesson("T-1", "failure_pattern", "error: Q flaky")], round_no=1)
    m.freeze()
    report = prune_with_replay(m, TRJS, min_delta=0.15, min_attempts=2)
    assert report.n_after == 0
    with pytest.raises(RuntimeError, match="冻结"):
        m.add([Lesson("T-1", "success_note", "x")], round_no=2)


# ---------------------------------------------------------- 考试单次验证

def test_heldout_report_once(tmp_path):
    m = ExperienceMemory(tmp_path / "mem.json")
    m.add([Lesson("T-1", "contrastive_failure", "error: P boom")], round_no=1)
    marker = tmp_path / "marker.json"
    trjs = TRJS + [traj("HELD-01", "fail", "error: P boom")]
    rep = heldout_report_once(m, trjs, split=SPLIT, marker_path=marker)
    assert rep["n_lessons"] == 1
    assert rep["n_eval_trajectories"] == 1
    assert any(g["vote_key"] == "error:p boom" for g in rep["groups"])
    assert marker.exists()
    # 第二次直接拒绝
    with pytest.raises(RuntimeError, match="已执行过"):
        heldout_report_once(m, trjs, split=SPLIT, marker_path=marker)
    # force 重放留痕
    rep2 = heldout_report_once(m, trjs, split=SPLIT, marker_path=marker,
                               force=True)
    assert rep2["forced_rerun_of"] == rep["timestamp"]


def test_heldout_report_blocks_eval_sourced_lessons(tmp_path):
    m = ExperienceMemory(tmp_path / "mem.json")
    m.add([Lesson("HELD-01", "failure_pattern", "error: X")], round_no=1)
    with pytest.raises(RuntimeError, match="考试任务来源"):
        heldout_report_once(m, [], split=SPLIT,
                            marker_path=tmp_path / "m.json")


# ---------------------------------------------------------- 已否定清单

def test_registry_deny_fingerprint_persisted(tmp_path):
    reg = PolicyRegistry(tmp_path / "reg.json")
    reg.register(SEED_POLICY_SOURCE, score=0.5, lineage="seed")
    reg.promote(1)
    src = 'NAME = "v2"\ndef act(obs, ctx):\n    return "continue"\n'
    reg.deny(src, 0.4, "no_improvement")
    assert reg.is_denied(src)
    # 排版不敏感: 空白归一化后同指纹
    assert reg.is_denied(
        'NAME = "v2"\n def act(obs, ctx):\n  return "continue"\n')
    # 持久化: 重新加载仍在
    reg2 = PolicyRegistry(tmp_path / "reg.json")
    assert reg2.is_denied(src)
    assert len(reg2.denied()) == 1


def test_evolve_loop_denied_skips_evaluate(tmp_path):
    reg = PolicyRegistry(tmp_path / "reg.json")
    reg.register(SEED_POLICY_SOURCE, score=0.5, lineage="seed")
    reg.promote(1)
    calls = {"n": 0}
    fixed = 'NAME = "fixed"\ndef act(obs, ctx):\n    return "continue"\n'

    rep = evolve_loop(reg, lambda p: calls.__setitem__("n", calls["n"] + 1)
                      or 0.3,                    # 无提升
                      lambda c, f: fixed, n_iters=3)
    assert rep.rejected == 3 and calls["n"] == 1   # 只评估一次, 其余跳过
    assert len(reg.denied()) == 1
    # track_denied=False 回到旧行为: 每轮都评估
    calls["n"] = 0
    rep2 = evolve_loop(reg, lambda p: calls.__setitem__("n", calls["n"] + 1)
                       or 0.3, lambda c, f: fixed, n_iters=2,
                       track_denied=False)
    assert calls["n"] == 2


def test_evolve_loop_accepts_improvement(tmp_path):
    reg = PolicyRegistry(tmp_path / "reg.json")
    reg.register(SEED_POLICY_SOURCE, score=0.5, lineage="seed")
    reg.promote(1)
    good = 'NAME = "better"\ndef act(obs, ctx):\n    return "continue"\n'
    rep = evolve_loop(reg, lambda p: 0.9, lambda c, f: good, n_iters=1)
    assert rep.accepted == 1 and rep.best_version == 2
    assert reg.current()["score"] == 0.9
    assert not reg.is_denied(good)              # 接受的变体不进 deny
    data = json.loads((tmp_path / "reg.json").read_text())
    assert data["denied"] == []
