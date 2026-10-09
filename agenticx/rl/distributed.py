# agenticx/rl/distributed.py
"""分布式启动层（P1 · M5）：torchrun 环境解析 + 进程组助手。

设计:
  - init_distributed 只认 torchrun 注入的 RANK/WORLD_SIZE/LOCAL_RANK 环境变量，
    world_size<=1（含未设置）时完全跳过 init_process_group——单进程零开销零行为差异。
  - backend='auto': nccl（CUDA 可用）否则 gloo；昇腾真机显式传 'hccl'。
  - CPU/gloo 路径在任何机器可真实测试（tests/rl/test_distributed.py 双进程门）。
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import torch
import torch.distributed as dist


@dataclass(frozen=True)
class DistInfo:
    rank: int
    world_size: int
    local_rank: int
    distributed: bool
    backend: str | None


def parse_dist_env() -> tuple[int, int, int] | None:
    """读 RANK/WORLD_SIZE/LOCAL_RANK；非分布式（缺 WORLD_SIZE 或 <=1）返回 None。"""
    ws = os.environ.get("WORLD_SIZE")
    if ws is None or int(ws) <= 1:
        return None
    world = int(ws)
    rank = int(os.environ.get("RANK", "0"))
    local = int(os.environ.get("LOCAL_RANK", str(rank % world)))
    return rank, world, local


def init_distributed(backend: str = "auto") -> DistInfo:
    """从 torchrun 环境初始化进程组；单进程直接返回（不碰 torch.distributed）。"""
    parsed = parse_dist_env()
    if parsed is None:
        return DistInfo(0, 1, 0, False, None)
    rank, world, local = parsed
    if backend == "auto":
        backend = "nccl" if torch.cuda.is_available() else "gloo"
    if not (dist.is_available() and dist.is_initialized()):
        dist.init_process_group(backend=backend, rank=rank, world_size=world)
    return DistInfo(rank, world, local, True, backend)


def is_main(d: DistInfo) -> bool:
    return d.rank == 0


def barrier(d: DistInfo) -> None:
    if d.distributed:
        dist.barrier()


def all_reduce_mean(value: float, d: DistInfo) -> float:
    """跨 rank 求均值；单进程原样返回。nccl 要求张量在 cuda 上。"""
    if not d.distributed:
        return float(value)
    device = torch.device("cuda") if d.backend == "nccl" else torch.device("cpu")
    t = torch.tensor([float(value)], dtype=torch.float64, device=device)
    dist.all_reduce(t, op=dist.ReduceOp.SUM)
    return float(t.item() / d.world_size)


def gather_objects(obj, d: DistInfo) -> list:
    """任意可 pickle 对象跨 rank 聚合（每个 rank 都拿到全量列表）。"""
    if not d.distributed:
        return [obj]
    out: list = [None] * d.world_size
    dist.all_gather_object(out, obj)
    return out


def shutdown(d: DistInfo) -> None:
    if d.distributed and dist.is_initialized():
        dist.destroy_process_group()
