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


# ---- SP11 追加：真架构闭环 + 离线引擎权重同步钩子 ----
from agenticx.rl.hf_rollout import HFRolloutEngine
from transformers import GPT2Config, GPT2LMHeadModel


def _tiny_gpt2():
    torch.manual_seed(0)
    cfg = GPT2Config(n_embd=32, n_layer=1, n_head=4, vocab_size=128,
                     bos_token_id=1, eos_token_id=2,
                     resid_pdrop=0.0, embd_pdrop=0.0, attn_pdrop=0.0)
    return GPT2LMHeadModel(cfg)


def test_grpo_learns_on_real_attention_arch():
    """GRPO 闭环在真注意力架构（GPT2，dropout=0 对齐 LLM RL 实践）上成立。"""
    torch.manual_seed(0)
    lm = _tiny_gpt2()
    eng = HFRolloutEngine(lm)
    target = 7
    tr = GRPOTrainer(lm, eng, lambda p, r: float((r == target).sum().item()),
                     lr=5e-3)
    prompts = [[10, 11, 12], [4, 5]]
    first = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    for _ in range(59):
        last = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    assert last["reward_mean"] > first["reward_mean"] + 1.0
    assert last["reward_mean"] > 2.0


def test_trainer_syncs_offline_engine_weights():
    """rollout 引擎带 sync_weights（vLLM 离线模式）时，每步训练后同步一次。"""
    lm = TinyLM()
    local = LocalRolloutEngine(lm)
    synced = []

    class OfflineEngine:
        def generate(self, prompts, *, n_samples, max_new_tokens,
                     temperature=1.0, eos_id=None):
            return local.generate(prompts, n_samples=n_samples,
                                  max_new_tokens=max_new_tokens,
                                  temperature=temperature, eos_id=eos_id)

        def sync_weights(self, model):
            synced.append(model)

    tr = GRPOTrainer(lm, OfflineEngine(), lambda p, r: 0.0, lr=1e-3)
    tr.train_step([[1, 2]], n_samples=2, max_new_tokens=3)
    assert synced == [lm]                # 恰好一次，传的是训练模型本体


# ---- SP13 追加：episode 级 GRPO ----
from dataclasses import dataclass, field

from agenticx.rl.rollout import RolloutSample as _RS


@dataclass
class _Episode:
    """harbor_rollout.Episode 的鸭子类型替身（task/reward/segments 同构）。"""
    task: str
    reward: float
    segments: list = field(default_factory=list)


def _ep(task, reward, segs):
    return _Episode(task=task, reward=reward, segments=segs)


def _seg(ctx, resp):
    return _RS(prompt_ids=torch.tensor(ctx, dtype=torch.long),
               response_ids=torch.tensor(resp, dtype=torch.long),
               old_logprobs=torch.zeros(len(resp), dtype=torch.float32))


def test_grouped_episode_advantage_by_task():
    from agenticx.rl.trainer import grouped_episode_advantage
    # task A: rewards [1,0] → [+1,-1]；task B: [0.5,0.5] → [0,0]
    adv = grouped_episode_advantage([1.0, 0.0, 0.5, 0.5],
                                    ["a", "a", "b", "b"])
    assert np.allclose(adv, [1.0, -1.0, 0.0, 0.0])


def test_train_step_episodes_loss_finite_and_grads():
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    eps = []
    for task in ["t1", "t2"]:
        for _ in range(2):
            segs = eng.generate([[1, 2, 3]], n_samples=1, max_new_tokens=4)
            eps.append(_ep(task, 1.0 if len(eps) % 2 == 0 else 0.0, segs))
    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=1e-3)
    m = tr.train_step_episodes(eps)
    assert np.isfinite(m["loss"]) and m["n_episodes"] == 4
    assert m["n_tokens"] > 0


def test_train_step_episodes_learns_multitask():
    """多任务多段 episode 的 GRPO 闭环学习门。"""
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    target = 7
    prompts = {"t1": [1, 2, 3], "t2": [4, 5]}

    def reward_of(segs):
        return float(sum((s.response_ids == target).sum().item() for s in segs))

    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=5e-3)
    first = None
    for _ in range(60):
        eps = []
        for task, p in prompts.items():
            for _k in range(4):
                segs = eng.generate([p], n_samples=1, max_new_tokens=6)
                eps.append(_ep(task, reward_of(segs), segs))
        m = tr.train_step_episodes(eps)
        first = first if first is not None else m
    assert m["reward_mean"] > first["reward_mean"] + 1.0
    assert m["reward_mean"] > 2.0


def test_train_step_episodes_shaping_hook():
    """shaping 钩子替换默认优势：置零 shaper + kl_beta=0 → loss=0。"""
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    eps = [_ep("t", float(i % 2), eng.generate([[1, 2]], n_samples=1,
                                                max_new_tokens=4))
           for i in range(2)]
    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=1e-3)
    m = tr.train_step_episodes(eps, shaping=lambda rewards, tasks: [0.0] * len(rewards))
    assert m["loss"] == 0.0
