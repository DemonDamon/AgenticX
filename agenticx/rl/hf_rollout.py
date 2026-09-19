# agenticx/rl/hf_rollout.py
"""transformers 真模型 rollout（P1 · M2）：MPS/CPU/GPU 通用，KV-cache 采样。

与 LocalRolloutEngine 同协议，可直接换入 GRPOTrainer。
old_logprobs = log_softmax(raw_logits / temperature)[tok]；warpers 全关
（top_k=0, top_p=1.0），故 temperature=1.0 时与训练 forward 逐元素一致
（KV-cache 与全序列 forward 的 fp32 浮点差 < 1e-4，由测试钉死）。
response_ids 含终止符 eos（若触发）；eos_id=None 时用 config.eos_token_id。
"""
from __future__ import annotations

import torch

from .rollout import RolloutSample


class HFRolloutEngine:
    """对 transformers CausalLM 做 rollout（逐 sample 单序列，无 padding）。"""

    def __init__(self, lm):
        self.lm = lm

    @torch.no_grad()
    def generate(self, prompts, *, n_samples, max_new_tokens,
                 temperature=1.0, eos_id=None):
        device = next(self.lm.parameters()).device
        eos = eos_id if eos_id is not None else getattr(
            self.lm.config, "eos_token_id", None)
        was_training = self.lm.training
        self.lm.eval()
        try:
            out: list[RolloutSample] = []
            for prompt in prompts:
                for _ in range(n_samples):
                    ids = torch.tensor(prompt, dtype=torch.long,
                                       device=device).unsqueeze(0)
                    kw = dict(
                        input_ids=ids, attention_mask=torch.ones_like(ids),
                        max_new_tokens=max_new_tokens,
                        eos_token_id=eos,
                        pad_token_id=eos if eos is not None else 0,
                        output_logits=True, return_dict_in_generate=True)
                    if temperature and temperature > 0:
                        kw.update(do_sample=True, temperature=temperature,
                                  top_k=0, top_p=1.0)
                    else:
                        kw.update(do_sample=False)
                    gen = self.lm.generate(**kw)
                    new_ids = gen.sequences[0, ids.shape[1]:]
                    scale = temperature if (temperature and temperature > 0) else 1.0
                    logps = []
                    for t, tok in enumerate(new_ids.tolist()):
                        raw = gen.logits[t][0].float()
                        logps.append(float(torch.log_softmax(raw / scale, dim=-1)[tok]))
                    out.append(RolloutSample(
                        prompt_ids=ids[0].detach().cpu(),
                        response_ids=new_ids.detach().cpu(),
                        old_logprobs=torch.tensor(logps, dtype=torch.float32)))
            return out
        finally:
            self.lm.train(was_training)
