# tests/trainer/test_heldout.py
import pytest
from agenticx.trainer.heldout import heldout_split, assert_trainable, HeldoutViolation

def test_split_is_deterministic():
    s1 = heldout_split(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"], seed="v1")
    s2 = heldout_split(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"], seed="v1")
    assert s1.heldout == s2.heldout and s1.train == s2.train

def test_split_ratio_about_20pct():
    s = heldout_split([f"task-{i}" for i in range(50)], seed="v1")
    assert 5 <= len(s.heldout) <= 15
    assert set(s.train) | set(s.heldout) == {f"task-{i}" for i in range(50)}
    assert not set(s.train) & set(s.heldout)

def test_seed_changes_split():
    s1 = heldout_split([f"t{i}" for i in range(20)], seed="v1")
    s2 = heldout_split([f"t{i}" for i in range(20)], seed="v2")
    assert s1.heldout != s2.heldout

def test_guard_rejects_heldout_task():
    s = heldout_split(["t1", "t2"], seed="v1", ratio=1.0)   # 全 heldout，确定性
    with pytest.raises(HeldoutViolation):
        assert_trainable("t1", s)
    s2 = heldout_split(["t1", "t2"], seed="v1", ratio=0.0)  # 全可训练，确定性
    assert_trainable("t1", s2)  # 不抛即通过
