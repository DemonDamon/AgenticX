# agenticx/rl/parallel.py
"""模型并行包装（P1 · M5）：DDP / FSDP 薄适配 + 数据分片。

纪律: FSDP/DDP 真实包装只在分布式环境触发; 本机（CPU/MPS）单测通过
monkeypatch _fsdp_wrap/_ddp_wrap 钉死调用契约。CPU+gloo 的 DDP 可真跑
（scripts/rl_smoke_m5.py --cpu），FSDP 真机验证走 GPU 冒烟。
"""
from __future__ import annotations

from typing import Sequence

import torch
from torch import nn

from .distributed import DistInfo

STRATEGIES = ("none", "ddp", "fsdp")


def shard(items: Sequence, dist_info: DistInfo) -> list:
    """按 rank 轮转分片: items[rank::world_size]；单进程返回全量。"""
    items = list(items)
    if not dist_info.distributed:
        return items
    return items[dist_info.rank::dist_info.world_size]


def _ddp_wrap(model: nn.Module, dist_info: DistInfo) -> nn.Module:
    """真实 DDP 包装（分布式时被 wrap_model 调用; CPU/gloo 亦可运行）。"""
    from torch.nn.parallel import DistributedDataParallel as DDP
    device_ids = [dist_info.local_rank] if torch.cuda.is_available() else None
    return DDP(model, device_ids=device_ids)


def _fsdp_wrap(model: nn.Module, dist_info: DistInfo, *, bf16: bool) -> nn.Module:
    """真实 FSDP 包装（FULL_SHARD 全分片; GPU 真机路径）。

    use_orig_params=True: 保留原参数名与参数对象——LoRA 收集、AdamW、
    checkpoint 都直接可用。mixed_precision 仅在 bf16 时启用。
    """
    from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
    from torch.distributed.fsdp import MixedPrecision
    mp = None
    if bf16:
        mp = MixedPrecision(param_dtype=torch.bfloat16,
                            reduce_dtype=torch.bfloat16,
                            buffer_dtype=torch.bfloat16)
    return FSDP(model, mixed_precision=mp,
                device_id=(torch.device("cuda", dist_info.local_rank)
                           if torch.cuda.is_available() else None),
                use_orig_params=True)


def wrap_model(model: nn.Module, strategy: str, dist_info: DistInfo, *,
               bf16: bool = False) -> nn.Module:
    """按策略包装模型用于多卡训练。'none' 原样返回（单卡）。"""
    if strategy not in STRATEGIES:
        raise ValueError(f"未知并行策略 {strategy!r}，可选 {STRATEGIES}")
    if strategy == "none":
        return model
    if not dist_info.distributed:
        raise ValueError(f"策略 {strategy!r} 需要分布式环境（torchrun 启动）")
    if strategy == "ddp":
        return _ddp_wrap(model, dist_info)
    return _fsdp_wrap(model, dist_info, bf16=bf16)
