# tests/rl/test_trainer.py
import numpy as np
import torch

from agenticx.rl import core_algos
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM
from agenticx.rl.trainer import GRPOTrainer, response_logprobs, torch_grpo_loss


def test_torch_loss_matches_numpy_core_algos():
    """对拍门：torch 公式与 M0 numpy 语义逐数值一致（kl_beta>0 + mask 混合场景）。"""
    rng = np.random.default_rng(0)
    logp = torch.tensor(rng.normal(size=6), dtype=torch.float64, requires_grad=True)
    old = torch.tensor(rng.normal(size=6), dtype=torch.float64)
    ref = torch.tensor(rng.normal(size=6), dtype=torch.float64)
    adv = torch.tensor(rng.normal(size=6), dtype=torch.float64)
    mask = torch.tensor([1.0, 1.0, 1.0, 0.0, 0.0, 1.0], dtype=torch.float64)

    t = torch_grpo_loss(logp, old, ref, adv, mask, clip_eps=0.2, kl_beta=0.04)
    n = core_algos.grpo_loss(
        logp.detach().numpy(), old.numpy(), ref.numpy(), adv.numpy(),
        mask.numpy(), clip_eps=0.2, kl_beta=0.04)
    assert abs(t.item() - n) < 1e-9

    t.backward()
    assert logp.grad is not None and torch.isfinite(logp.grad).all()


def test_torch_loss_zero_kl_beta_ignores_ref():
    rng = np.random.default_rng(1)
    args = [torch.tensor(rng.normal(size=4), dtype=torch.float64) for _ in range(4)]
    logp, old, ref, adv = args
    mask = torch.ones(4, dtype=torch.float64)
    a = torch_grpo_loss(logp, old, ref, adv, mask, kl_beta=0.0)
    b = torch_grpo_loss(logp, old, ref * 100.0, adv, mask, kl_beta=0.0)
    assert a.item() == b.item()


def test_response_logprobs_grad_flows():
    lm = TinyLM()
    s = LocalRolloutEngine(lm).generate([[1, 2]], n_samples=1, max_new_tokens=4)[0]
    lp = response_logprobs(lm, [s], torch.device("cpu"))
    assert lp.shape == (4,)
    lp.sum().backward()
    assert any(p.grad is not None for p in lm.parameters())


def test_trainer_learns_to_emit_target_token():
    """端到端闭环：GRPO 更新让 TinyLM 学会多吐 target token（bandit 语义升级版）。"""
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    target = 7

    def reward_fn(p, r):
        return float((r == target).sum().item())

    tr = GRPOTrainer(lm, eng, reward_fn, lr=5e-3)
    prompts = [[1, 2, 3], [4, 5]]
    first = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    for _ in range(59):
        last = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    assert last["reward_mean"] > first["reward_mean"] + 1.0
    assert last["reward_mean"] > 2.0            # 6 token 中至少 1/3 命中 target
    assert np.isfinite(first["loss"]) and np.isfinite(last["loss"])


def test_trainer_kl_beta_uses_frozen_ref():
    torch.manual_seed(0)
    lm = TinyLM()
    ref = TinyLM()
    ref.load_state_dict(lm.state_dict())
    for p in ref.parameters():
        p.requires_grad_(False)
    eng = LocalRolloutEngine(lm)
    tr = GRPOTrainer(lm, eng, lambda p, r: float(r.shape[0]),
                     lr=1e-3, kl_beta=0.05, ref_lm=ref)
    m = tr.train_step([[1, 2]], n_samples=4, max_new_tokens=5)
    assert np.isfinite(m["loss"])
    assert all(p.grad is None for p in ref.parameters())   # ref 冻结
