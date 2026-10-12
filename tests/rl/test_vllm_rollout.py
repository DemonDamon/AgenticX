# tests/rl/test_vllm_rollout.py
from pathlib import Path
from types import SimpleNamespace

import pytest
import torch
from transformers import GPT2Config, GPT2LMHeadModel

from agenticx.rl.rollout import RolloutSample
from agenticx.rl.vllm_rollout import VLLMRolloutEngine, _try_import_vllm


class FakeEngine:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def generate(self, prompts, sampling_params):
        self.calls.append(("generate", prompts, sampling_params))
        return self.results

    def collective_rpc(self, method, args=()):
        files = sorted(p.name for p in Path(args[0]).iterdir())
        self.calls.append(("rpc", method, files))
        return True


def _seq(token_ids, logps):
    return SimpleNamespace(
        token_ids=token_ids,
        logprobs=[{tok: SimpleNamespace(logprob=lp)}
                  for tok, lp in zip(token_ids, logps)])


def _req(seqs):
    return SimpleNamespace(outputs=seqs)


def test_generate_parses_vllm_outputs_in_group_order():
    r1 = _req([_seq([5, 6], [-0.1, -0.2]), _seq([7], [-0.3]),
               _seq([8, 9, 10], [-0.4, -0.5, -0.6])])
    r2 = _req([_seq([11], [-0.7])] * 3)
    eng = VLLMRolloutEngine("fake-path", engine=FakeEngine([r1, r2]))
    samples = eng.generate([[1, 2], [3]], n_samples=3, max_new_tokens=4)
    assert len(samples) == 6
    assert samples[0].prompt_ids.tolist() == [1, 2]
    assert samples[0].response_ids.tolist() == [5, 6]
    assert torch.allclose(samples[0].old_logprobs, torch.tensor([-0.1, -0.2]))
    assert samples[3].prompt_ids.tolist() == [3]
    assert samples[5].response_ids.tolist() == [11]
    assert all(isinstance(s, RolloutSample) for s in samples)


def test_generate_passes_sampling_params_and_eos():
    eng = VLLMRolloutEngine("fake-path", engine=FakeEngine([_req([_seq([1], [-0.1])])]))
    eng.generate([[2]], n_samples=2, max_new_tokens=8, temperature=0.7, eos_id=9)
    _, prompts, sp = eng.engine.calls[0]
    assert prompts == [{"prompt_token_ids": [2]}]
    assert sp["n"] == 2 and sp["max_tokens"] == 8 and sp["temperature"] == 0.7
    assert sp["logprobs"] == 0 and sp["stop_token_ids"] == [9]


def test_generate_without_eos_omits_stop():
    eng = VLLMRolloutEngine("fake-path", engine=FakeEngine([_req([_seq([1], [-0.1])])]))
    eng.generate([[2]], n_samples=1, max_new_tokens=4)
    _, _, sp = eng.engine.calls[0]
    assert "stop_token_ids" not in sp


def test_sync_weights_saves_model_and_calls_rpc():
    lm = GPT2LMHeadModel(GPT2Config(n_embd=32, n_layer=1, n_head=4, vocab_size=128))
    fe = FakeEngine([])
    eng = VLLMRolloutEngine("fake-path", engine=fe)
    eng.sync_weights(lm)
    rpcs = [c for c in fe.calls if c[0] == "rpc"]
    assert len(rpcs) == 1
    assert rpcs[0][1] == "update_weights_from_disk"
    assert "config.json" in rpcs[0][2]
    assert any(f.endswith(".safetensors") for f in rpcs[0][2])


@pytest.mark.skipif(_try_import_vllm() is not None, reason="真机装了 vllm 时跳过")
def test_engine_requires_vllm_or_injection():
    with pytest.raises(ImportError):
        VLLMRolloutEngine("some-path")       # 未注入 engine 且本机无 vllm
