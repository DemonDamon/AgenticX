# tests/rl/test_rollout.py
import torch

from agenticx.rl.rollout import LocalRolloutEngine, RolloutSample, TinyLM


def test_tinylm_forward_shape():
    lm = TinyLM()
    logits = lm(torch.tensor([[1, 2, 3]]))
    assert logits.shape == (1, 3, TinyLM.vocab_size)


def test_generate_counts_and_lengths():
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    samples = eng.generate([[1, 2, 3], [4, 5]], n_samples=3, max_new_tokens=5)
    assert len(samples) == 6
    for s in samples:
        assert isinstance(s, RolloutSample)
        assert s.response_ids.shape == (5,)
        assert s.old_logprobs.shape == (5,)
        assert s.prompt_ids.tolist() in ([1, 2, 3], [4, 5])


def test_generate_logprobs_match_forward_recompute():
    """rollout 记录的 old_logprobs 必须与训练 forward 重算逐元素一致（ratio=1 起点）。"""
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    s = eng.generate([[1, 2, 3]], n_samples=1, max_new_tokens=6)[0]
    ids = torch.cat([s.prompt_ids, s.response_ids]).unsqueeze(0)
    logits = lm(ids)[0]                                  # (L, V)
    logp = torch.log_softmax(logits[:-1], dim=-1)
    seg = logp[len(s.prompt_ids) - 1:]                   # 预测 response 各 token 的位置
    lp = seg.gather(1, s.response_ids.unsqueeze(1)).squeeze(1)
    assert torch.allclose(s.old_logprobs, lp, atol=1e-5)


def test_generate_stops_at_eos():
    torch.manual_seed(0)
    lm = TinyLM()
    eos = TinyLM.vocab_size - 1
    lm.head.bias.data[eos] = 20.0                        # eos 概率压倒性
    eng = LocalRolloutEngine(lm)
    s = eng.generate([[1, 2]], n_samples=1, max_new_tokens=8, eos_id=eos)[0]
    assert s.response_ids.tolist() == [eos]              # 第一个 token 即停


def test_generate_preserves_training_mode():
    lm = TinyLM()
    lm.train()
    eng = LocalRolloutEngine(lm)
    eng.generate([[1]], n_samples=1, max_new_tokens=2)
    assert lm.training                                    # rollout 不偷改模式
