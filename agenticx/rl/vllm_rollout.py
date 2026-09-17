# agenticx/rl/vllm_rollout.py
"""vLLM rollout 引擎（P1 · M2）：GPU 机高速 rollout + 离线权重同步。

macOS 本机不装 vLLM：守卫式 import；单测注入 fake engine（sampling_params
以 dict 传递，真机自动升级为 vllm.SamplingParams）。真机验证清单见
plans/rsi/sp11-vllm-rollout.md 尾部。

语义注意: vLLM 的 token_ids 不含 stop token（HF 引擎含 eos），协议允许；
old_logprobs 取 vLLM logprobs=0 的采样分布 logp（含 temperature 效应）。
"""
from __future__ import annotations

import tempfile
from typing import Any

import torch

from .rollout import RolloutSample


def _try_import_vllm():
    try:
        import vllm
        return vllm
    except ImportError:
        return None


class VLLMRolloutEngine:
    """RolloutEngine 协议的 vLLM 实现（SamplingParams.n 做组采样）。"""

    def __init__(self, model_path: str, *, engine: Any = None,
                 dtype: str = "auto", gpu_memory_utilization: float = 0.85,
                 max_model_len: int = 4096):
        self.model_path = model_path
        if engine is None:
            vllm = _try_import_vllm()
            if vllm is None:
                raise ImportError(
                    "vLLM 未安装。GPU 机上 `pip install vllm` 后使用；"
                    "本机开发请注入 engine= 做测试，或改用 HFRolloutEngine。")
            engine = vllm.LLM(model=model_path, dtype=dtype,
                              gpu_memory_utilization=gpu_memory_utilization,
                              max_model_len=max_model_len)
        self.engine = engine

    def _sampling_params(self, *, n_samples, max_new_tokens, temperature, eos_id):
        kw = dict(n=n_samples, max_tokens=max_new_tokens,
                  temperature=temperature, logprobs=0)
        if eos_id is not None:
            kw["stop_token_ids"] = [eos_id]
        vllm = _try_import_vllm()
        if vllm is not None:
            return vllm.SamplingParams(**kw)
        return kw                        # fake engine 路径（本机测试）

    def generate(self, prompts, *, n_samples, max_new_tokens,
                 temperature=1.0, eos_id=None):
        sp = self._sampling_params(n_samples=n_samples,
                                   max_new_tokens=max_new_tokens,
                                   temperature=temperature, eos_id=eos_id)
        token_prompts = [{"prompt_token_ids": list(p)} for p in prompts]
        results = self.engine.generate(token_prompts, sampling_params=sp)
        out: list[RolloutSample] = []
        for prompt, req in zip(prompts, results):
            for seq in req.outputs:               # n_samples 个序列/提示词
                logps = [float(seq.logprobs[t][tok].logprob)
                         for t, tok in enumerate(seq.token_ids)]
                out.append(RolloutSample(
                    prompt_ids=torch.tensor(prompt, dtype=torch.long),
                    response_ids=torch.tensor(seq.token_ids, dtype=torch.long),
                    old_logprobs=torch.tensor(logps, dtype=torch.float32)))
        return out

    def sync_weights(self, model) -> None:
        """离线权重同步：HF 模型落盘 → vLLM worker 热加载（update_weights_from_disk）。"""
        with tempfile.TemporaryDirectory(prefix="agenticx_rl_sync_") as td:
            model.save_pretrained(td)
            self.engine.collective_rpc("update_weights_from_disk", args=(td,))
