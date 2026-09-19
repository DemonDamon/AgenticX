"""任务集拆分守卫（SP18）：考试题禁止进训练侧。"""
import pytest
from agenticx.learning.trajectory.task_split import (
    assert_trainable_task, is_eval_task, load_split,
)


def test_load_split_from_checked_in_config():
    split = load_split()                      # 读 datasets/task_split.json
    assert len(split["train"]) + len(split["heldout"]) == len(set(
        split["train"]) | set(split["heldout"]))   # 无重复
    assert split["seed"] == "tb40-v1" and split["ratio"] == 0.2


def test_eval_task_rejected_loudly():
    split = load_split()
    eval_task = split["heldout"][0]
    assert is_eval_task(eval_task, split)
    with pytest.raises(Exception, match="held-out"):
        assert_trainable_task(eval_task, split)


def test_train_task_passes():
    split = load_split()
    assert not is_eval_task(split["train"][0], split)
    assert_trainable_task(split["train"][0], split)   # 不抛即过


def test_unknown_task_rejected():
    split = load_split()
    with pytest.raises(ValueError, match="不在任务名单"):
        assert_trainable_task("never-existed-task", split)
