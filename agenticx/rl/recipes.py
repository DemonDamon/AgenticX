# agenticx/rl/recipes.py
"""尺寸配方（P1 · M5）：参数量 × 显存 → 训练方法可行性判定与推荐配置。

内存模型（FSDP FULL_SHARD，bf16 混合精度，AdamW）:
  全参: 权重2 + 梯度2 + fp32 master 4 + m 4 + v 4 = 16 B/param
  LoRA: 冻结权重 2 B/param（adapter 及其优化器状态量级可忽略）
  KL 参考模型: 额外 2 B/param（bf16 副本; 不开 KL 时为 0）
  激活值: 梯度检查点可压，走 15% 显存预留，不单独建模。
"""
from __future__ import annotations

from dataclasses import dataclass

BYTES_FULL_PER_PARAM = 16.0
BYTES_LORA_PER_PARAM = 2.0
BYTES_REF_PER_PARAM = 2.0

QWEN_MODEL_PARAMS: dict[str, float] = {
    "qwen3-0.6b": 0.6e9,
    "qwen3-8b": 8e9,
    "qwen3.8-27b": 27e9,
}

HARDWARE: dict[str, tuple[int, int]] = {          # 名字 -> (n_gpus, 单卡显存 GB)
    "single-24g": (1, 24),
    "8x4090": (8, 24),
    "8xa100-80g": (8, 80),
}


@dataclass(frozen=True)
class Feasibility:
    feasible: bool
    per_gpu_gb: float
    budget_gb: float
    margin_gb: float              # budget - per_gpu（负 = 放不下）


@dataclass(frozen=True)
class Recipe:
    method: str                   # "full" | "lora" | "infeasible"
    feasible: bool
    lora_rank: int | None
    group_size: int
    micro_batch: int
    grad_checkpoint: bool
    engine: str
    per_gpu_gb: float
    notes: str


def memory_feasibility(params: float, method: str, n_gpus: int, gpu_mem_gb: float,
                       *, kl_ref: bool = True, reserve: float = 0.15) -> Feasibility:
    if method == "full":
        b = params * BYTES_FULL_PER_PARAM
    elif method == "lora":
        b = params * BYTES_LORA_PER_PARAM
    else:
        raise ValueError(f"method 需为 full/lora, got {method!r}")
    if kl_ref:
        b += params * BYTES_REF_PER_PARAM
    per_gpu = b / n_gpus / 1e9
    budget = gpu_mem_gb * (1.0 - reserve)
    return Feasibility(per_gpu <= budget, round(per_gpu, 2), round(budget, 2),
                       round(budget - per_gpu, 2))


def recommend(params: float, n_gpus: int, gpu_mem_gb: float, *,
              kl_ref: bool = True) -> Recipe:
    """先试全参、放不下退 LoRA、再不行判 infeasible。"""
    full = memory_feasibility(params, "full", n_gpus, gpu_mem_gb, kl_ref=kl_ref)
    if full.feasible:
        return Recipe("full", True, None, 8, 4, params >= 8e9, "vllm",
                      full.per_gpu_gb, "AdamW bf16 混合精度")
    lora = memory_feasibility(params, "lora", n_gpus, gpu_mem_gb, kl_ref=kl_ref)
    if lora.feasible:
        return Recipe("lora", True, 16, 8, 8, True, "vllm", lora.per_gpu_gb,
                      "FSDP 分片冻结权重 + adapter 训练（无 NVLink，慢但可行）")
    return Recipe("infeasible", False, None, 8, 4, True, "vllm", lora.per_gpu_gb,
                  "换更大显存或更多卡")
