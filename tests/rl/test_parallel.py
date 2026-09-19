# tests/rl/test_parallel.py
import pytest
import torch
from torch import nn

from agenticx.rl.distributed import DistInfo
from agenticx.rl.parallel import shard, wrap_model

_D2 = DistInfo(0, 2, 0, True, "gloo")


def _lm():
    return nn.Linear(8, 8)


def test_shard_round_robin():
    assert shard(list(range(7)), DistInfo(0, 1, 0, False, None)) == list(range(7))
    assert shard(list(range(7)), _D2) == [0, 2, 4, 6]
    assert shard(list(range(7)), DistInfo(1, 2, 1, True, "gloo")) == [1, 3, 5]


def test_wrap_none_returns_model():
    m = _lm()
    assert wrap_model(m, "none", DistInfo(0, 1, 0, False, None)) is m


def test_wrap_requires_distributed_env():
    with pytest.raises(ValueError):
        wrap_model(_lm(), "ddp", DistInfo(0, 1, 0, False, None))
    with pytest.raises(ValueError):
        wrap_model(_lm(), "fsdp", DistInfo(0, 1, 0, False, None))


def test_wrap_unknown_strategy():
    with pytest.raises(ValueError):
        wrap_model(_lm(), "megatron", _D2)


def test_wrap_ddp_fsdp_contract(monkeypatch):
    """钉死调用契约: 真包装函数被 mock，验证透传参数与返回值。"""
    import agenticx.rl.parallel as P
    calls = {}
    m = _lm()

    def fake_ddp(model, dist_info):
        calls["ddp"] = (model is m, dist_info.world_size)
        return "DDP_WRAPPED"

    def fake_fsdp(model, dist_info, *, bf16):
        calls["fsdp"] = (model is m, dist_info.rank, bf16)
        return "FSDP_WRAPPED"

    monkeypatch.setattr(P, "_ddp_wrap", fake_ddp)
    assert wrap_model(m, "ddp", _D2) == "DDP_WRAPPED"
    assert calls["ddp"] == (True, 2)

    monkeypatch.setattr(P, "_fsdp_wrap", fake_fsdp)
    assert wrap_model(m, "fsdp", _D2, bf16=True) == "FSDP_WRAPPED"
    assert calls["fsdp"] == (True, 0, True)
