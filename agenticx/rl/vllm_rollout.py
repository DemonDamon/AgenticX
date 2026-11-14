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
from pathlib import Path
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
    """RolloutEngine 协议的 vLLM 实现（SamplingParams.n 做组采样）。

    LoRA 飞轮模式（27B 训练用）：构造时传 enable_lora=True + max_lora_rank，
    generate 时透传 lora_request，每轮训练后走 sync_lora() 只热同步 2GB
    adapter（vLLM 原生 LoRA 能力），绝不走 sync_weights() 的 54GB 全量落盘。
    """

    def __init__(self, model_path: str, *, engine: Any = None,
                 dtype: str = "auto", gpu_memory_utilization: float = 0.85,
                 max_model_len: int = 4096, enable_lora: bool = False,
                 max_lora_rank: int = 64):
        self.model_path = model_path
        self.enable_lora = enable_lora
        if engine is None:
            vllm = _try_import_vllm()
            if vllm is None:
                raise ImportError(
                    "vLLM 未安装。GPU 机上 `pip install vllm` 后使用；"
                    "本机开发请注入 engine= 做测试，或改用 HFRolloutEngine。")
            kwargs = dict(dtype=dtype,
                          gpu_memory_utilization=gpu_memory_utilization,
                          max_model_len=max_model_len)
            if enable_lora:
                kwargs.update(enable_lora=True, max_lora_rank=max_lora_rank)
            engine = vllm.LLM(model=model_path, **kwargs)
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
                 temperature=1.0, eos_id=None, lora_request=None):
        sp = self._sampling_params(n_samples=n_samples,
                                   max_new_tokens=max_new_tokens,
                                   temperature=temperature, eos_id=eos_id)
        token_prompts = [{"prompt_token_ids": list(p)} for p in prompts]
        kwargs = {"sampling_params": sp}
        if lora_request is not None:
            kwargs["lora_request"] = lora_request
        results = self.engine.generate(token_prompts, **kwargs)
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
        """离线权重同步：HF 模型落盘 → vLLM worker 热加载（update_weights_from_disk）。

        仅适合小模型全参微调；27B LoRA 飞轮必须走 sync_lora()（2GB），
        走这条 54GB 落盘路会把 rollout 空窗拉到分钟级。
        """
        with tempfile.TemporaryDirectory(prefix="agenticx_rl_sync_") as td:
            model.save_pretrained(td)
            self.engine.collective_rpc("update_weights_from_disk", args=(td,))

    def sync_lora(self, peft_model, adapter_name: str,
                  save_dir: str | Path) -> str:
        """LoRA-only 权重热同步（27B 飞轮唯一合法路径，playbook §3.2）。

        adapter 落到 save_dir/adapter_name（持久目录，按轮次版本化——
        与 AdapterRegistry 及 runs/rsi-27b/adapters/ 布局对齐，回滚/审计
        都靠它；绝不用临时目录：惰性路径下临时文件会被清掉）。
        peft_model.save_pretrained 只写 ~2GB（基座不动），然后按 vLLM
        版本能力逐级尝试热加载：
        1. collective_rpc("load_lora_adapter") —— vLLM V1 worker RPC（RL 热更）；
        2. engine.add_adapter_lora —— V0 老接口；
        3. 惰性路径——什么都不预加载，把 adapter 路径交给下一轮
           generate 的 lora_request（vLLM 按 path 惰性注册，冒烟时验证）。

        返回实际路径标记（"v1_rpc" / "v0_api" / "lazy_request"），
        供冒烟日志核对哪条真正生效。
        """
        if not self.enable_lora:
            raise RuntimeError(
                "构造 VLLMRolloutEngine 时未开 enable_lora——"
                "LoRA 热同步需要 engine 以 enable_lora=True 启动")
        adapter_dir = Path(save_dir) / adapter_name
        peft_model.save_pretrained(str(adapter_dir))

        # 路 1: vLLM V1 worker RPC
        rpc = getattr(self.engine, "collective_rpc", None)
        if callable(rpc):
            try:
                rpc("load_lora_adapter", args=(str(adapter_dir),))
                self._active_adapter = str(adapter_dir)
                return "v1_rpc"
            except Exception:                         # noqa: BLE001
                pass                                  # 降级，别让一轮训练白训

        # 路 2: vLLM V0 add_adapter_lora
        add_api = getattr(self.engine, "add_adapter_lora", None)
        if callable(add_api):
            try:
                add_api(str(adapter_dir))
                self._active_adapter = str(adapter_dir)
                return "v0_api"
            except Exception:                         # noqa: BLE001
                pass

        # 路 3: 惰性路径——留给下一轮 generate 的 lora_request 消费
        self._active_adapter = str(adapter_dir)
        return "lazy_request"

    def lora_request(self, lora_id: int = 1):
        """构造下一轮 generate 用的 LoRARequest（惰性路径的另一半）。

        真机上返回 vllm.LoRARequest；本机 fake 路径返回轻量标记对象，
        断言用。lora_id 每轮 +1——vLLM 用 id 区分 adapter 版本，复用
        旧 id 会命中缓存不重新加载（飞轮致命坑）。
        """
        adapter = getattr(self, "_active_adapter", None)
        if adapter is None:
            return None
        vllm = _try_import_vllm()
        if vllm is not None and hasattr(vllm, "LoRARequest"):
            return vllm.LoRARequest("rsi_adapter", lora_id, adapter)
        return {"lora_name": "rsi_adapter", "lora_id": lora_id,
                "lora_path": adapter}
