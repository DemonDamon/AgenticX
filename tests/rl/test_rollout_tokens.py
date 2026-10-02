# tests/rl/test_rollout_tokens.py
"""SP24 token-native 轨迹层单测：三投影语义 + 单调性判据（对齐 JAZ RolloutRecorder 设计）。

钉死:
  1. 单调多轮 flat: ids/mask/logprobs 拼接正确，仅采样段 mask=1
  2. 非单调（thinking 段剥离/上下文编辑）: to_flat 抛错、to_pieces 切段、to_turn_samples 永可解
  3. 单调性按 stamp 身份而非内容: 同 ids 重新渲染不开链
  4. sampled=None（非策略采样）: mask 恒 0，不参与单调前缀
  5. logprobs 长度不匹配即构造失败
  6. TokenRollout 刻意无 reward 字段; RSITrajectory.rollout_id 对齐 + 旧数据向后兼容
"""
from __future__ import annotations

import dataclasses

import pytest

from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
from agenticx.rl.rollout import (NonMonotoneRolloutError, TokenRollout,
                                 TokenStamp)


def _monotone_two_turn() -> TokenRollout:
    """turn0: system+user 条件, 采样 3 token; turn1: 追加 tool 结果, 采样 2 token。"""
    sys_s = TokenStamp.mint("system", (1, 2))
    usr_s = TokenStamp.mint("user", (3,))
    s0 = TokenStamp.mint("assistant", (10, 11, 12))
    r = TokenRollout(rollout_id="r-mono", model="test")
    r.add_turn((sys_s, usr_s), s0, (-0.1, -0.2, -0.3))
    tool_s = TokenStamp.mint("tool", (20,))
    s1 = TokenStamp.mint("assistant", (13, 14))
    r.add_turn((sys_s, usr_s, s0, tool_s), s1, (-0.4, -0.5))
    return r


# --------------------------------------------------------------------- flat

def test_flat_monotone_concatenation():
    flat = _monotone_two_turn().to_flat()
    # ids = 1,2,3 | 10,11,12 | 20 | 13,14
    assert flat.ids == (1, 2, 3, 10, 11, 12, 20, 13, 14)
    assert flat.loss_mask == (0, 0, 0, 1, 1, 1, 0, 1, 1)
    assert flat.logprobs == (0, 0, 0, -0.1, -0.2, -0.3, 0, -0.4, -0.5)
    assert flat.rollout_id == "r-mono" and flat.finished == "completed"


def test_flat_empty_rollout():
    flat = TokenRollout("r-empty", "test").to_flat()
    assert flat.ids == () and flat.loss_mask == () and flat.logprobs == ()


# ------------------------------------------------------- 非单调三投影语义

def _stripped_rollout() -> TokenRollout:
    """thinking 模型形态: turn1 的上下文剥离了 turn0 的采样段（重新渲染 system/user）。"""
    sys_s = TokenStamp.mint("system", (1, 2))
    usr_s = TokenStamp.mint("user", (3,))
    s0 = TokenStamp.mint("assistant", (10, 11))
    r = TokenRollout(rollout_id="r-strip", model="test")
    r.add_turn((sys_s, usr_s), s0, (-0.1, -0.2))
    # 同内容重新 mint → 新身份，且不含 s0（推理段被剥离）
    sys2 = TokenStamp.mint("system", (1, 2))
    usr2 = TokenStamp.mint("user", (3,))
    s1 = TokenStamp.mint("assistant", (13,))
    r.add_turn((sys2, usr2), s1, (-0.3,))
    return r


def test_scalar_logprob_normalized():
    """logprobs=(-0.3)（float）应归一化为单元素元组而非长度校验崩溃。"""
    r = TokenRollout("r-scalar", "test")
    r.add_turn((TokenStamp.mint("system", (1,)),), TokenStamp.mint("a", (9,)), -0.3)
    assert r.to_turn_samples()[0].logprobs == (-0.3,)


def test_flat_raises_on_non_monotone():
    with pytest.raises(NonMonotoneRolloutError, match="r-strip"):
        _stripped_rollout().to_flat()


def test_pieces_split_on_edit():
    pieces = _stripped_rollout().to_pieces()
    assert len(pieces) == 2
    # 每段内部各自单调，段间共享 rollout_id
    assert all(p.rollout_id == "r-strip" for p in pieces)
    assert pieces[0].ids == (1, 2, 3, 10, 11)
    assert pieces[0].loss_mask == (0, 0, 0, 1, 1)
    assert pieces[1].ids == (1, 2, 3, 13)
    assert pieces[1].loss_mask == (0, 0, 0, 1)


def test_turn_samples_always_resolve():
    ts = _stripped_rollout().to_turn_samples()
    assert len(ts) == 2
    assert ts[0].condition_ids == (1, 2, 3)
    assert ts[0].sampled_ids == (10, 11)
    assert ts[0].logprobs == (-0.1, -0.2)
    assert ts[1].condition_ids == (1, 2, 3)
    assert ts[1].sampled_ids == (13,)
    assert all(t.rollout_id == "r-strip" for t in ts)


def test_identity_not_content_decides_monotonicity():
    """同 ids 重新渲染（新 message_id）且位置替换原 stamp → 非单调。"""
    s0 = TokenStamp.mint("system", (1,))
    r = TokenRollout("r-ident", "test")
    r.add_turn((s0,), TokenStamp.mint("assistant", (9,)), (-0.1,))
    s0_rerender = TokenStamp.mint("system", (1,))  # 同内容、不同身份
    r.add_turn((s0_rerender,), TokenStamp.mint("assistant", (8,)), (-0.2,))
    with pytest.raises(NonMonotoneRolloutError):
        r.to_flat()


# ----------------------------------------------------- sampled=None 语义

def test_non_policy_sampled_stamp_masks_zero():
    """few-shot 示例（sent 中的 assistant 消息）mask 恒 0，不因角色是 assistant 而计分。"""
    r = TokenRollout("r-exemplar", "test")
    sys_s = TokenStamp.mint("system", (1,))
    exemplar = TokenStamp.mint("assistant", (7, 8))  # few-shot 示例：在 sent 中但非采样
    a0 = TokenStamp.mint("assistant", (9,))
    r.add_turn((sys_s, exemplar), a0, (-0.1,))
    tool_s = TokenStamp.mint("tool", (20,))
    a1 = TokenStamp.mint("assistant", (10,))
    r.add_turn((sys_s, exemplar, a0, tool_s), a1, (-0.2,))
    flat = r.to_flat()
    assert flat.ids == (1, 7, 8, 9, 20, 10)
    assert flat.loss_mask == (0, 0, 0, 1, 0, 1)


def test_logprob_length_mismatch_rejected():
    with pytest.raises(ValueError, match="长度不一致"):
        from agenticx.rl.rollout import TurnRecord
        TurnRecord(turn=0, sent=(), sampled=TokenStamp.mint("a", (1, 2)),
                   logprobs=(-0.1,))


# ------------------------------------------------------- reward 解耦约定

def test_rollout_has_no_reward_field():
    names = {f.name for f in dataclasses.fields(TokenRollout)}
    assert "reward" not in names, "轨迹是事实，reward 是判断——由驱动侧按 rollout_id 对齐"


def test_trajectory_rollout_id_roundtrip_and_backcompat():
    r = _monotone_two_turn()
    traj = RSITrajectory(
        source="harbor-tb40", task_id="t1", session_id="s1", model="test",
        status="pass", reward=RewardRecord(label=1.0), messages=[],
        rollout_id=r.rollout_id,
    )
    d = traj.to_dict()
    assert d["rollout_id"] == "r-mono"
    back = RSITrajectory.from_dict(d)
    assert back.rollout_id == "r-mono"
    # 旧格式（无 rollout_id 键）加载不炸，默认空
    d_old = {k: v for k, v in d.items() if k not in ("rollout_id", "trajectory_id")}
    assert RSITrajectory.from_dict(d_old).rollout_id == ""
