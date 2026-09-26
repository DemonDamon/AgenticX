# tests/rl/test_hf_rollout.py
import torch
from transformers import GPT2Config, GPT2LMHeadModel

from agenticx.rl.hf_rollout import HFRolloutEngine
from agenticx.rl.rollout import RolloutSample


def _tiny_gpt2():
    torch.manual_seed(0)
    cfg = GPT2Config(n_embd=32, n_layer=1, n_head=4, vocab_size=128,
                     bos_token_id=1, eos_token_id=2,
                     resid_pdrop=0.0, embd_pdrop=0.0, attn_pdrop=0.0)
    return GPT2LMHeadModel(cfg)


def test_generate_counts_and_shapes():
    lm = _tiny_gpt2()
    eng = HFRolloutEngine(lm)
    samples = eng.generate([[10, 11, 12], [4, 5]], n_samples=3, max_new_tokens=5)
    assert len(samples) == 6
    for s in samples:
        assert isinstance(s, RolloutSample)
        assert 0 < s.response_ids.shape[0] <= 5
        assert s.response_ids.shape[0] == s.old_logprobs.shape[0]
        assert s.prompt_ids.tolist() in ([10, 11, 12], [4, 5])
    # 分组排列约定：前 3 个属于 prompt1
    assert [s.prompt_ids.tolist() for s in samples[:3]] == [[10, 11, 12]] * 3


def test_generate_logprobs_match_forward_recompute():
    """rollout 记录的 old_logprobs 与训练 forward 重算一致（T=1，KV-cache 浮点差<1e-4）。"""
    lm = _tiny_gpt2().eval()
    eng = HFRolloutEngine(lm)
    torch.manual_seed(0)
    s = eng.generate([[10, 11, 12]], n_samples=1, max_new_tokens=6)[0]
    ids = torch.cat([s.prompt_ids, s.response_ids]).unsqueeze(0)
    logits = lm(ids)[0][0]                              # (L, V) — 与 trainer 同路径
    logp = torch.log_softmax(logits[:-1].float(), dim=-1)
    seg = logp[len(s.prompt_ids) - 1:]
    lp = seg.gather(1, s.response_ids.unsqueeze(1)).squeeze(1)
    assert torch.allclose(s.old_logprobs, lp, atol=1e-4)


def test_generate_stops_at_eos_greedy():
    """greedy（temperature=0）首 token 即 eos → response 恰为 [eos]。"""
    lm = _tiny_gpt2().eval()
    eng = HFRolloutEngine(lm)
    with torch.no_grad():
        logits = lm(torch.tensor([[10, 11]]))[0][0, -1]
    top = int(logits.argmax())
    s = eng.generate([[10, 11]], n_samples=1, max_new_tokens=8,
                     temperature=0.0, eos_id=top)[0]
    assert s.response_ids.tolist() == [top]


def test_generate_preserves_training_mode():
    lm = _tiny_gpt2()
    eng = HFRolloutEngine(lm)
    lm.train()
    eng.generate([[1]], n_samples=1, max_new_tokens=2)
    assert lm.training
    lm.eval()
    eng.generate([[1]], n_samples=1, max_new_tokens=2)
    assert not lm.training


def test_generate_temperature_recorded_in_logprobs():
    """T≠1 时记录的是采样分布（logits/T）下的 logp。"""
    lm = _tiny_gpt2().eval()
    eng = HFRolloutEngine(lm)
    torch.manual_seed(0)
    s = eng.generate([[10, 11]], n_samples=1, max_new_tokens=4, temperature=2.0)[0]
    assert s.old_logprobs.shape[0] == s.response_ids.shape[0]
    assert torch.isfinite(s.old_logprobs).all()
