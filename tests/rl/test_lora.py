# tests/rl/test_lora.py
import pytest
import torch
from torch import nn

from agenticx.rl.lora import (
    LoRALinear, inject_lora, lora_state_dict, load_lora_state_dict,
    mark_only_lora_trainable, trainable_parameters,
)
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM
from agenticx.rl.trainer import GRPOTrainer


class _Block(nn.Module):
    def __init__(self):
        super().__init__()
        self.q_proj = nn.Linear(32, 32)
        self.o_proj = nn.Linear(32, 32)
        self.fc = nn.Linear(32, 32)

    def forward(self, x):
        return self.fc(self.o_proj(self.q_proj(x)))


def test_inject_replaces_only_matching_linears():
    m = _Block()
    n = inject_lora(m)
    assert n == 2
    assert isinstance(m.q_proj, LoRALinear) and isinstance(m.o_proj, LoRALinear)
    assert isinstance(m.fc, nn.Linear) and not isinstance(m.fc, LoRALinear)


def test_lora_is_identity_at_init():
    torch.manual_seed(0)
    m = _Block()
    x = torch.randn(3, 32)
    y0 = m(x)
    inject_lora(m)
    assert torch.allclose(m(x), y0, atol=1e-6)      # B=0 → 起步零增量


def test_mark_only_lora_trainable():
    m = _Block()
    inject_lora(m)
    n = mark_only_lora_trainable(m)
    assert n == 4                                     # 2 层 × (A, B)
    trainable = {k for k, p in m.named_parameters() if p.requires_grad}
    assert trainable == {"q_proj.lora_A", "q_proj.lora_B",
                         "o_proj.lora_A", "o_proj.lora_B"}
    assert len(trainable_parameters(m)) == 4


def test_lora_bad_rank_rejected():
    m = _Block()
    with pytest.raises(ValueError):
        LoRALinear(m.q_proj, rank=0)


def test_grpo_step_updates_only_adapters():
    """LoRA 训练闭环: 一步 GRPO 后基座权重逐位不变，adapter 离开初始值。"""
    torch.manual_seed(0)
    lm = TinyLM()
    inject_lora(lm, rank=8, target_patterns=("head",))
    mark_only_lora_trainable(lm)
    base_w_before = lm.head.base.weight.detach().clone()
    emb_before = lm.emb.weight.detach().clone()

    def reward_fn(p, r):
        return float((r == 7).sum().item())

    tr = GRPOTrainer(lm, LocalRolloutEngine(lm), reward_fn, lr=1e-2,
                     optimizer=torch.optim.AdamW(trainable_parameters(lm), lr=1e-2))
    m = tr.train_step([[1, 2, 3]], n_samples=8, max_new_tokens=6)
    assert m["n_samples"] == 8 and torch.isfinite(torch.tensor(m["loss"]))
    assert torch.equal(lm.head.base.weight.detach(), base_w_before)
    assert torch.equal(lm.emb.weight.detach(), emb_before)
    assert (lm.head.lora_B.detach().abs() > 0).any()   # B 从 0 变非零


def test_lora_state_dict_roundtrip():
    torch.manual_seed(1)
    m1 = _Block()
    torch.manual_seed(1)                                # 同 seed → 同基座
    m2 = _Block()
    inject_lora(m1, rank=4)
    inject_lora(m2, rank=4)
    with torch.no_grad():
        m1.q_proj.lora_B.normal_()
    x = torch.randn(2, 32)
    assert not torch.allclose(m1(x), m2(x))
    load_lora_state_dict(m2, lora_state_dict(m1))
    assert torch.allclose(m1(x), m2(x))
