# SP15: RL 训练核 M5 — 多卡扩展（torchrun/FSDP/LoRA + 尺寸配方）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 P1 训练核从单进程扩展到多卡：torchrun 环境解析 + DDP/FSDP 模型包装 + 最小 LoRA（27B 在 8×4090 上唯一可行的训练路径）+ 显存可行性尺寸配方。**全部代码本机（Mac CPU）可测**——分布式用真·双进程 gloo 门钉死，DDP 用 CPU 真跑，FSDP 用 mock 钉调用契约；GPU 真机验证走冒烟脚本（机子到位零代码改动）。

**硬件现实核查（已修正，recipes.py 测试钉死这套数字）:**
| 目标 | 8×4090 24G（消费级） | 8×A100/H100 80G |
|---|---|---|
| 8B 全参 GRPO | 舒适（18G/卡 < 20.4G 预算） | 舒适 |
| 27B LoRA GRPO | **可行**（FSDP 分片 13.5G/卡，无 NVLink 慢） | 舒适 |
| 27B 全参 GRPO | 不行（60.75G/卡） | 可行（60.75 < 68） |

（旧表"27B LoRA 不行"是错的：那是按数据并行每卡全权重算的；FSDP 分片冻结权重后 4090 可跑。）

**设计决策:**
- **不引入 peft/accelerate**：LoRA 60 行自研（控制参数命名，FSDP 友好，全量可测）；模型并行只做薄包装（`wrap_model` 三策略 none/ddp/fsdp）
- **`response_logprobs` 改批量前向**（Task 3）：一是 DDP 契约要求每次 backward 只对应一个带梯度 forward（逐样本循环 forward 会触发 "Expected to have finished reduction" 错误）；二是真模型 8B 逐样本前向慢一个数量级。因果模型右侧 padding 不影响前缀位置 logits，数值等价由对拍测试钉死
- **分布式语义**：数据并行——每个 rank 分片 prompt、本地 rollout、本地 loss，DDP/FSDP 在 backward 自动同步梯度（等价于把 world 当扩展 batch）；指标用 all_reduce_mean 聚合到 rank 0
- **FSDP 用 use_orig_params=True**：保留原参数名（LoRA 收集 / checkpoint / AdamW 直接可用）

**Tech Stack:** Python 3.13 + torch 2.12（本机已装，gloo CPU 分布式可用）。零新依赖。

---

## 铁律（每个子代理必须遵守）

1. 测试命令一律：`python3 -m pytest tests/rl/<file>.py -v -o addopts="--import-mode=importlib"`（pyproject 的 addopts 引用了缺失的 pytest-cov，必须覆盖）
2. `git add` 只加本任务明确列出的文件路径，**严禁 `git add -A` / `git add .`**（工作区有大量无关脏文件：harness-lab/、FinnewsHunter、draft_*/ 等）
3. 测试文件 basename 全仓唯一（本计划新增：test_distributed.py / test_lora.py / test_parallel.py / test_recipes.py / `_dist_worker.py` 非 collect 文件）
4. TDD：先写测试确认失败 → 最小实现 → 确认通过 → commit
5. 在仓库根目录 `/Users/damonli/myWork/AgenticX` 下执行一切命令

---

### Task 1: distributed.py — torchrun 环境解析 + 进程组助手（真·双进程门）

**Files:**
- Create: `agenticx/rl/distributed.py`
- Create: `tests/rl/test_distributed.py`
- Create: `tests/rl/_dist_worker.py`（下划线开头，pytest 不收集）

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_distributed.py
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

from agenticx.rl.distributed import (
    DistInfo, all_reduce_mean, barrier, gather_objects, init_distributed,
    is_main, parse_dist_env, shutdown,
)

_REPO = Path(__file__).resolve().parents[2]
_WORKER = Path(__file__).resolve().parent / "_dist_worker.py"


def test_parse_dist_env_absent(monkeypatch):
    monkeypatch.delenv("WORLD_SIZE", raising=False)
    assert parse_dist_env() is None


def test_parse_dist_env_single(monkeypatch):
    monkeypatch.setenv("WORLD_SIZE", "1")
    assert parse_dist_env() is None


def test_parse_dist_env_multi(monkeypatch):
    monkeypatch.setenv("WORLD_SIZE", "4")
    monkeypatch.setenv("RANK", "3")
    monkeypatch.delenv("LOCAL_RANK", raising=False)
    assert parse_dist_env() == (3, 4, 3)          # LOCAL_RANK 缺省回退 rank%world
    monkeypatch.setenv("LOCAL_RANK", "1")
    assert parse_dist_env() == (3, 4, 1)


def test_helpers_noop_when_single_process():
    d = DistInfo(0, 1, 0, False, None)
    assert is_main(d)
    assert all_reduce_mean(3.5, d) == 3.5
    assert gather_objects({"a": 1}, d) == [{"a": 1}]
    barrier(d)          # 不炸
    shutdown(d)         # 不炸


def test_init_distributed_single_process(monkeypatch):
    monkeypatch.delenv("WORLD_SIZE", raising=False)
    d = init_distributed(backend="gloo")
    assert (d.rank, d.world_size, d.distributed) == (0, 1, False)


def test_two_process_gloo_gate(tmp_path):
    """真·双进程分布式门: 子进程走 env→init_process_group→通信→shutdown 全链路
    （与 torchrun 注入的环境变量路径完全一致）。"""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    out = tmp_path / "result.json"
    env = {**os.environ, "WORLD_SIZE": "2", "MASTER_ADDR": "127.0.0.1",
           "MASTER_PORT": str(port)}
    procs = []
    for rank in (0, 1):
        procs.append(subprocess.Popen(
            [sys.executable, str(_WORKER), "--out", str(out)],
            env={**env, "RANK": str(rank), "LOCAL_RANK": str(rank)},
            cwd=str(_REPO), stdout=subprocess.PIPE, stderr=subprocess.PIPE))
    for p in procs:
        _, err = p.communicate(timeout=180)
        assert p.returncode == 0, err.decode()
    data = json.loads(out.read_text())
    assert data["mean_rank"] == 0.5                     # all_reduce_mean(0,1)=0.5
    assert data["gathered"] == [{"rank": 0}, {"rank": 1}]
    assert data["world_size"] == 2 and data["backend"] == "gloo"
```

```python
# tests/rl/_dist_worker.py
#!/usr/bin/env python3
"""双进程分布式门的 worker（非测试文件，pytest 不收集）。

由 test_distributed.py 以独立进程启动（模拟 torchrun 注入的 env），
走 init_distributed → 通信 → shutdown 真实链路，结果写 JSON。
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agenticx.rl.distributed import (  # noqa: E402
    all_reduce_mean, barrier, gather_objects, init_distributed, shutdown,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--backend", default="gloo")
    args = ap.parse_args()
    try:
        d = init_distributed(backend=args.backend)
        mean_rank = all_reduce_mean(float(d.rank), d)
        gathered = gather_objects({"rank": d.rank}, d)
        barrier(d)
        result = {"rank": d.rank, "world_size": d.world_size,
                  "backend": d.backend, "mean_rank": mean_rank,
                  "gathered": gathered}
        if d.rank == 0:
            Path(args.out).write_text(json.dumps(result))
        barrier(d)
        shutdown(d)
        return 0
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 跑测试确认失败**（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**（6 PASS。注意 test_two_process_gloo_gate 启动两个子进程，~10-30s 属正常；若遇端口竞争偶发失败，重跑一次确认）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/distributed.py tests/rl/test_distributed.py tests/rl/_dist_worker.py
git commit -m "feat(rl): distributed init layer with two-process gloo gate (M5)"
```

---

### Task 2: lora.py — 最小 LoRA（零依赖 adapter）

**Files:**
- Create: `agenticx/rl/lora.py`
- Test: `tests/rl/test_lora.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_lora.py
import pytest
import torch
from torch import nn

from agenticx.lora_import_shim import *  # 占位行，勿抄——见下方正确 import
```

**（注意：上面这行是错误示例。正确文件头如下）**

```python
# tests/rl/test_lora.py
import pytest
import torch
from torch import nn

from agenticx.rl.lora import (
    LoRALinear, inject_lora, lora_state_dict, load_lora_state_dict,
    mark_only_lora_trainable, trainable_parameters,
)
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM
from agenticx.rl.trainer import GRPOTrainer


class _Block(nn.Module):
    def __init__(self):
        super().__init__()
        self.q_proj = nn.Linear(32, 32)
        self.o_proj = nn.Linear(32, 32)
        self.fc = nn.Linear(32, 32)

    def forward(self, x):
        return self.fc(self.o_proj(self.q_proj(x)))


def test_inject_replaces_only_matching_linears():
    m = _Block()
    n = inject_lora(m)
    assert n == 2
    assert isinstance(m.q_proj, LoRALinear) and isinstance(m.o_proj, LoRALinear)
    assert isinstance(m.fc, nn.Linear) and not isinstance(m.fc, LoRALinear)


def test_lora_is_identity_at_init():
    torch.manual_seed(0)
    m = _Block()
    x = torch.randn(3, 32)
    y0 = m(x)
    inject_lora(m)
    assert torch.allclose(m(x), y0, atol=1e-6)      # B=0 → 起步零增量


def test_mark_only_lora_trainable():
    m = _Block()
    inject_lora(m)
    n = mark_only_lora_trainable(m)
    assert n == 4                                     # 2 层 × (A, B)
    trainable = {k for k, p in m.named_parameters() if p.requires_grad}
    assert trainable == {"q_proj.lora_A", "q_proj.lora_B",
                         "o_proj.lora_A", "o_proj.lora_B"}
    assert len(trainable_parameters(m)) == 4


def test_lora_bad_rank_rejected():
    m = _Block()
    with pytest.raises(ValueError):
        LoRALinear(m.q_proj, rank=0)


def test_grpo_step_updates_only_adapters():
    """LoRA 训练闭环: 一步 GRPO 后基座权重逐位不变，adapter 离开初始值。"""
    torch.manual_seed(0)
    lm = TinyLM()
    inject_lora(lm, rank=8, target_patterns=("head",))
    mark_only_lora_trainable(lm)
    base_w_before = lm.head.base.weight.detach().clone()
    emb_before = lm.emb.weight.detach().clone()

    def reward_fn(p, r):
        return float((r == 7).sum().item())

    tr = GRPOTrainer(lm, LocalRolloutEngine(lm), reward_fn, lr=1e-2,
                     optimizer=torch.optim.AdamW(trainable_parameters(lm), lr=1e-2))
    m = tr.train_step([[1, 2, 3]], n_samples=8, max_new_tokens=6)
    assert m["n_samples"] == 8 and torch.isfinite(torch.tensor(m["loss"]))
    assert torch.equal(lm.head.base.weight.detach(), base_w_before)
    assert torch.equal(lm.emb.weight.detach(), emb_before)
    assert (lm.head.lora_B.detach().abs() > 0).any()   # B 从 0 变非零


def test_lora_state_dict_roundtrip():
    torch.manual_seed(1)
    m1 = _Block()
    torch.manual_seed(1)                                # 同 seed → 同基座
    m2 = _Block()
    inject_lora(m1, rank=4)
    inject_lora(m2, rank=4)
    with torch.no_grad():
        m1.q_proj.lora_B.normal_()
    x = torch.randn(2, 32)
    assert not torch.allclose(m1(x), m2(x))
    load_lora_state_dict(m2, lora_state_dict(m1))
    assert torch.allclose(m1(x), m2(x))
```

- [ ] **Step 2: 跑测试确认失败**（ImportError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/lora.py
"""最小 LoRA（P1 · M5）：零第三方依赖的 adapter 注入。

27B 在 8×4090 上唯一可行训练路径（FSDP 分片冻结权重 + adapter 训练）。
只做三件事: 包装 nn.Linear（冻结基座）、标准初始化（A kaiming / B 零 →
起步零增量）、adapter 参数命名与收集。不引入 peft——需要控制 FSDP 下的
参数命名，且 60 行内可完整测试。
"""
from __future__ import annotations

import math

import torch
from torch import nn

DEFAULT_TARGETS = ("q_proj", "k_proj", "v_proj", "o_proj",
                   "gate_proj", "up_proj", "down_proj")


class LoRALinear(nn.Module):
    """y = base(x) + (x @ A^T @ B^T) * (alpha/rank)；base 冻结，A/B 可训。"""

    def __init__(self, base: nn.Linear, rank: int = 16, alpha: float = 32.0):
        super().__init__()
        if rank <= 0:
            raise ValueError(f"rank 必须为正, got {rank}")
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)
        dt, dev = base.weight.dtype, base.weight.device
        self.lora_A = nn.Parameter(torch.empty(rank, base.in_features,
                                               dtype=dt, device=dev))
        self.lora_B = nn.Parameter(torch.zeros(base.out_features, rank,
                                               dtype=dt, device=dev))
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
        self.scaling = alpha / rank

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.base(x) + (x @ self.lora_A.T @ self.lora_B.T) * self.scaling


def inject_lora(model: nn.Module, *, rank: int = 16, alpha: float = 32.0,
                target_patterns: tuple[str, ...] = DEFAULT_TARGETS) -> int:
    """把名字以任一 pattern 结尾的 nn.Linear 替换为 LoRALinear，返回替换数。"""
    count = 0
    for name, mod in list(model.named_modules()):
        if isinstance(mod, nn.Linear) and name.endswith(target_patterns):
            _replace_child(model, name, LoRALinear(mod, rank=rank, alpha=alpha))
            count += 1
    return count


def _replace_child(root: nn.Module, dotted: str, new: nn.Module) -> None:
    parent = root
    parts = dotted.split(".")
    for p in parts[:-1]:
        parent = parent.get_submodule(p)
    setattr(parent, parts[-1], new)


def mark_only_lora_trainable(model: nn.Module) -> int:
    """全部冻结后仅放开名字含 lora_ 的参数，返回可训参数个数。"""
    for p in model.parameters():
        p.requires_grad_(False)
    n = 0
    for _, p in model.named_parameters():
        if "lora_" in _param_name(model, p):
            pass  # 占位，勿抄——正确实现见下
    return n
```

**（注意：mark_only_lora_trainable 上面是残缺占位。正确实现如下，直接用完整版）**

```python
def mark_only_lora_trainable(model: nn.Module) -> int:
    for p in model.parameters():
        p.requires_grad_(False)
    n = 0
    for name, p in model.named_parameters():
        if "lora_" in name:
            p.requires_grad_(True)
            n += 1
    return n


def trainable_parameters(model: nn.Module) -> list[nn.Parameter]:
    return [p for p in model.parameters() if p.requires_grad]


def lora_state_dict(model: nn.Module) -> dict[str, torch.Tensor]:
    return {k: v.detach().cpu() for k, v in model.state_dict().items()
            if "lora_" in k}


def load_lora_state_dict(model: nn.Module, sd: dict[str, torch.Tensor]) -> None:
    cur = lora_state_dict(model)
    if set(sd) != set(cur):
        raise KeyError(f"adapter 键不匹配: 缺 {sorted(set(cur) - set(sd))}, "
                       f"多 {sorted(set(sd) - set(cur))}")
    with torch.no_grad():
        for k, v in sd.items():
            tgt = model.get_parameter(k)
            tgt.copy_(v.to(tgt.device))
```

- [ ] **Step 4: 跑测试确认通过**（6 PASS。若 test_grpo_step_updates_only_adapters 因随机性断言失败——8 样本 reward 恰好全同导致零优势——把 torch.manual_seed 换成 1 或 2 再跑；失败必须先确认是这个原因才许改 seed）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/lora.py tests/rl/test_lora.py
git commit -m "feat(rl): minimal LoRA adapters with zero-delta init (M5)"
```

---

### Task 3: parallel.py + response_logprobs 批量化（DDP 契约前置）

**Files:**
- Create: `agenticx/rl/parallel.py`
- Modify: `agenticx/rl/trainer.py`（只改 `response_logprobs` 函数体）
- Test: `tests/rl/test_parallel.py`（新建）、`tests/rl/test_trainer.py`（追加 1 个测试）

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_parallel.py
import pytest
import torch
from torch import nn

from agenticx.rl.distributed import DistInfo
from agenticx.rl.parallel import shard, wrap_model

_D2 = DistInfo(0, 2, 0, True, "gloo")


def _lm():
    return nn.Linear(8, 8)


def test_shard_round_robin():
    assert shard(list(range(7)), DistInfo(0, 1, 0, False, None)) == list(range(7))
    assert shard(list(range(7)), _D2) == [0, 2, 4, 6]
    assert shard(list(range(7)), DistInfo(1, 2, 1, True, "gloo")) == [1, 3, 5]


def test_wrap_none_returns_model():
    m = _lm()
    assert wrap_model(m, "none", DistInfo(0, 1, 0, False, None)) is m


def test_wrap_requires_distributed_env():
    with pytest.raises(ValueError):
        wrap_model(_lm(), "ddp", DistInfo(0, 1, 0, False, None))
    with pytest.raises(ValueError):
        wrap_model(_lm(), "fsdp", DistInfo(0, 1, 0, False, None))


def test_wrap_unknown_strategy():
    with pytest.raises(ValueError):
        wrap_model(_lm(), "megatron", _D2)


def test_wrap_ddp_fsdp_contract(monkeypatch):
    """钉死调用契约: 真包装函数被 mock，验证透传参数与返回值。"""
    import agenticx.rl.parallel as P
    calls = {}
    m = _lm()

    def fake_ddp(model, dist_info):
        calls["ddp"] = (model is m, dist_info.world_size)
        return "DDP_WRAPPED"

    def fake_fsdp(model, dist_info, *, bf16):
        calls["fsdp"] = (model is m, dist_info.rank, bf16)
        return "FSDP_WRAPPED"

    monkeypatch.setattr(P, "_ddp_wrap", fake_ddp)
    assert wrap_model(m, "ddp", _D2) == "DDP_WRAPPED"
    assert calls["ddp"] == (True, 2)

    monkeypatch.setattr(P, "_fsdp_wrap", fake_fsdp)
    assert wrap_model(m, "fsdp", _D2, bf16=True) == "FSDP_WRAPPED"
    assert calls["fsdp"] == (True, 0, True)
```

追加到 `tests/rl/test_trainer.py` 末尾：

```python
def test_response_logprobs_batched_equals_per_sample():
    """批量前向 = 逐样本前向（右 padding 在因果模型下不影响前缀）——DDP 前置条件。"""
    torch.manual_seed(2)
    lm = TinyLM()
    samples = LocalRolloutEngine(lm).generate(
        [[1, 2], [3, 4, 5, 6]], n_samples=3, max_new_tokens=5)
    assert len(samples) == 6
    batched = response_logprobs(lm, samples, torch.device("cpu"))
    per = torch.cat([response_logprobs(lm, [s], torch.device("cpu"))
                     for s in samples])
    assert batched.shape == per.shape
    assert torch.allclose(batched.detach(), per, atol=1e-5)
```

- [ ] **Step 2: 跑测试确认失败**（parallel ImportError + batched 对拍 FAIL——当前实现逐样本前向，实际上这个对拍会**通过**，因为它比较的是同一实现；真正的门在 Step 3 改完后跑全量 trainer 测试不回归。此处以 parallel 测试失败为准入，对拍测试作为批量化改造的守护网）

- [ ] **Step 3: 实现**

```python
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
```

`trainer.py` 的 `response_logprobs` 整函数替换为（docstring 里的位置对齐语义不变）：

```python
def response_logprobs(lm: nn.Module, samples: list[RolloutSample],
                      device: torch.device) -> torch.Tensor:
    """当前 lm 对各 sample response 段的 token logp（带梯度，拼接为 (ΣLr,)）。

    批量实现: 右侧 padding 到同长一次前向（因果模型下 padding 不影响
    前缀位置 logits）。位置对齐: logits[i] 预测 token i+1，response token j
    （全局位置 P+j）的 logp 取自位置 P+j-1 的 log_softmax。
    DDP 契约: 每次 backward 只对应一个带梯度 forward——逐样本循环 forward
    会触发 DDP "Expected to have finished reduction" 错误，故必须批量化。
    """
    if not samples:
        return torch.zeros(0, device=device)
    lens = [s.prompt_ids.shape[0] + s.response_ids.shape[0] for s in samples]
    max_len = max(lens)
    ids = torch.zeros(len(samples), max_len, dtype=torch.long)      # 0 = pad
    for i, s in enumerate(samples):
        seq = torch.cat([s.prompt_ids, s.response_ids])
        ids[i, : seq.shape[0]] = seq
    ids = ids.to(device)
    logits = lm(ids)
    if hasattr(logits, "logits"):      # HF ModelOutput → (B, L, V)
        logits = logits.logits
    outs = []
    for i, s in enumerate(samples):
        logp = torch.log_softmax(logits[i, :-1], dim=-1)
        p, t = s.prompt_ids.shape[0], s.response_ids.shape[0]
        seg = logp[p - 1: p + t - 1]                   # (t, V)
        tgt = s.response_ids.to(device).unsqueeze(1)   # (t, 1)
        outs.append(seg.gather(1, tgt).squeeze(1))
    return torch.cat(outs)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
python3 -m pytest tests/rl/test_parallel.py tests/rl/test_trainer.py tests/rl/test_harbor_rollout.py tests/rl/test_replay_shaping.py -v -o addopts="--import-mode=importlib"
```
（parallel 5 PASS + trainer 全部含新对拍 + 消费 response_logprobs 的模块无回归）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/parallel.py agenticx/rl/trainer.py tests/rl/test_parallel.py tests/rl/test_trainer.py
git commit -m "feat(rl): DDP/FSDP wrapping + batched response logprobs (DDP contract)"
```

---

### Task 4: recipes.py — 显存可行性数学 + 尺寸配方

**Files:**
- Create: `agenticx/rl/recipes.py`
- Test: `tests/rl/test_recipes.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_recipes.py
from agenticx.rl.recipes import (
    HARDWARE, QWEN_MODEL_PARAMS, memory_feasibility, recommend,
)


def test_full_ft_memory_math():
    # 8B 全参 + KL ref: (16+2)*8e9/8 = 18 GB/卡 < 24*0.85=20.4
    f = memory_feasibility(8e9, "full", 8, 24)
    assert f.per_gpu_gb == 18.0 and f.feasible


def test_27b_full_infeasible_on_4090_feasible_on_a100():
    f = memory_feasibility(27e9, "full", 8, 24)
    assert not f.feasible and f.per_gpu_gb == 60.75
    assert memory_feasibility(27e9, "full", 8, 80).feasible   # 60.75 < 68


def test_27b_lora_feasible_on_8x4090():
    # (2+2)*27e9/8 = 13.5 < 20.4 —— 修正旧表: FSDP 分片下 27B LoRA 在 4090 可行
    f = memory_feasibility(27e9, "lora", 8, 24)
    assert f.feasible and f.per_gpu_gb == 13.5


def test_27b_lora_single_card_infeasible():
    assert not memory_feasibility(27e9, "lora", 1, 24).feasible  # 54 > 20.4


def test_recommend_falls_back_to_lora():
    r = recommend(27e9, 8, 24)
    assert r.method == "lora" and r.feasible and r.lora_rank == 16
    assert recommend(8e9, 8, 24).method == "full"
    assert recommend(27e9, 1, 24).method == "infeasible"


def test_no_kl_ref_reduces_memory():
    assert memory_feasibility(27e9, "lora", 8, 24, kl_ref=False).per_gpu_gb == 6.75


def test_catalog_present():
    assert QWEN_MODEL_PARAMS["qwen3.8-27b"] == 27e9
    assert HARDWARE["8x4090"] == (8, 24)
```

- [ ] **Step 2: 跑测试确认失败**（ImportError）

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**（7 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/recipes.py tests/rl/test_recipes.py
git commit -m "feat(rl): multi-GPU size recipes with memory feasibility math (M5)"
```

---

### Task 5: rl_smoke_m5.py — torchrun 冒烟门 + 路线图收尾

**Files:**
- Create: `scripts/rl_smoke_m5.py`
- Modify: `plans/rsi/sp9-rl-core.md`（仅 2 处：M5 行、硬件表 27B LoRA 行）

- [ ] **Step 1: 写脚本（完整内容如下）**

```python
#!/usr/bin/env python3
"""多卡训练冒烟（P1 · M5）：torchrun 入口，验证分布式 GRPO 训练路径。

用法:
  任意机器 CPU 双进程（含 Mac，真·DDP 数据并行最小闭环）:
    torchrun --standalone --nproc-per-node=2 scripts/rl_smoke_m5.py --cpu
  8 卡 GPU 机（真机验证清单第一步，详见 plans/rsi/sp15-multi-gpu.md 尾部）:
    torchrun --standalone --nproc-per-node=8 scripts/rl_smoke_m5.py \
        --model Qwen/Qwen3-0.6B --strategy fsdp
    torchrun --standalone --nproc-per-node=8 scripts/rl_smoke_m5.py \
        --model Qwen/Qwen3.8-27B --lora --strategy fsdp

PASS 标准: 全部 loss 有限 + 通信自检（all_reduce_mean(rank)==(world-1)/2）
+ --lora 时训练后基座权重逐位不变。
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.distributed import (  # noqa: E402
    all_reduce_mean, barrier, init_distributed, is_main, shutdown,
)
from agenticx.rl.lora import (  # noqa: E402
    inject_lora, mark_only_lora_trainable, trainable_parameters,
)
from agenticx.rl.parallel import shard, wrap_model  # noqa: E402
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer  # noqa: E402


def _full_state_dict(module, strategy: str) -> dict:
    """收集完整 state_dict: fsdp 需要全 rank 集体调用 FULL_STATE_DICT 上下文。"""
    if strategy == "fsdp":
        from torch.distributed.fsdp import (FullyShardedDataParallel as FSDP,
                                            StateDictType)
        with FSDP.state_dict_type(module, StateDictType.FULL_STATE_DICT):
            return module.state_dict()
    return module.state_dict()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpu", action="store_true", help="TinyLM CPU 模式（任何机器可跑）")
    ap.add_argument("--model", default=None, help="HF 模型 id（GPU 模式）")
    ap.add_argument("--lora", action="store_true")
    ap.add_argument("--strategy", default=None, choices=["none", "ddp", "fsdp"])
    ap.add_argument("--steps", type=int, default=5)
    ap.add_argument("--n-samples", type=int, default=8)
    ap.add_argument("--max-new-tokens", type=int, default=6)
    ap.add_argument("--lr", type=float, default=5e-3)
    ap.add_argument("--out", default="/tmp/rl_smoke_m5_ckpt.pt")
    args = ap.parse_args()

    d = init_distributed()                     # auto: nccl(CUDA) / gloo(CPU)
    tag = f"[m5 r{d.rank}/{d.world_size}]"

    comm = all_reduce_mean(float(d.rank), d)   # 通信自检
    assert abs(comm - (d.world_size - 1) / 2.0) < 1e-6, f"{tag} 通信自检失败: {comm}"
    if is_main(d):
        print(f"{tag} dist ok backend={d.backend} comm_check={comm}")

    if args.cpu or args.model is None:
        lm = TinyLM(hidden=64)
        target = 7
        prompts = [[1, 2, 3], [4, 5], [6, 7], [8, 9]]
        lora_patterns = ("head",)
    else:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(args.model)
        lm = AutoModelForCausalLM.from_pretrained(args.model,
                                                  torch_dtype=torch.bfloat16)
        target = tok.encode(" the", add_special_tokens=False)[0]
        prompts = [tok.encode("The secret password is", add_special_tokens=False),
                   tok.encode("My favorite word is", add_special_tokens=False)]
        lora_patterns = ("q_proj", "k_proj", "v_proj", "o_proj")

    base_snapshot = None
    if args.lora:
        n = inject_lora(lm, rank=16, target_patterns=lora_patterns)
        mark_only_lora_trainable(lm)
        base_snapshot = {k: v.detach().clone()
                         for k, v in lm.state_dict().items() if "lora_" not in k}
        if is_main(d):
            print(f"{tag} lora injected: {n} layers")

    strategy = args.strategy
    if strategy is None:
        if args.cpu:
            strategy = "ddp" if d.distributed else "none"
        else:
            strategy = "fsdp" if d.distributed else "none"
    lm = wrap_model(lm, strategy, d, bf16=torch.cuda.is_available() and not args.cpu)
    if is_main(d):
        print(f"{tag} strategy={strategy} lora={args.lora}")

    my_prompts = shard(prompts, d) or prompts[:1]     # 卡多于 prompt 时兜底

    def reward_fn(p, r):
        return float((r == target).sum().item())

    params = trainable_parameters(lm) if args.lora else lm.parameters()
    tr = GRPOTrainer(lm, LocalRolloutEngine(lm), reward_fn, lr=args.lr,
                     optimizer=torch.optim.AdamW(params, lr=args.lr))

    t0 = time.time()
    metrics = {"loss": 0.0, "reward_mean": 0.0}
    for i in range(args.steps):
        m = tr.train_step(my_prompts, n_samples=args.n_samples,
                          max_new_tokens=args.max_new_tokens)
        metrics = {k: all_reduce_mean(v, d) for k, v in m.items()}
        if is_main(d):
            print(f"{tag} step {i+1}/{args.steps} loss={metrics['loss']:.4f} "
                  f"reward_mean={metrics['reward_mean']:.3f}")

    ok = all(math.isfinite(v) for v in metrics.values())
    if args.lora and base_snapshot is not None:
        cur = _full_state_dict(lm, strategy)     # fsdp: 集体调用，全 rank 都执行
        if is_main(d):
            bad = [k for k, v in base_snapshot.items()
                   if not torch.equal(cur[k].detach().cpu(), v)]
            if bad:
                ok = False
                print(f"{tag} FAIL: 基座权重被改动: {bad[:3]}")
            else:
                torch.save({k: v for k, v in cur.items() if "lora_" in k}, args.out)
                print(f"{tag} adapter 已保存: {args.out}")
    barrier(d)
    if is_main(d):
        print(f"{tag} {'PASS' if ok else 'FAIL'} "
              f"({time.time()-t0:.1f}s, strategy={strategy}, backend={d.backend})")
    shutdown(d)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 修改 `plans/rsi/sp9-rl-core.md`**

M5 行（第 13 行附近）：
```
- M5 (SP14): 多卡扩展（torchrun/FSDP）+ 尺寸配方
```
改为：
```
- M5 (SP15): ✅ 代码就绪 — distributed/lora/parallel/recipes + torchrun 冒烟（CPU 双进程门已过，FSDP 真机验证待 GPU 到位）
```

硬件表 27B LoRA 行：
```
| 27B LoRA GRPO | 不行（权重 54G 放不下） | 舒适 |
```
改为：
```
| 27B LoRA GRPO | 可行（FSDP 分片 ~13.5G/卡，无 NVLink 慢） | 舒适 |
```

- [ ] **Step 3: 本机验证（父代理亲自执行，子代理只备好文件）**

```bash
# CPU 双进程真·DDP 门（Mac 上可跑）
torchrun --standalone --nproc-per-node=2 scripts/rl_smoke_m5.py --cpu
# LoRA 路径同样过一遍
torchrun --standalone --nproc-per-node=2 scripts/rl_smoke_m5.py --cpu --lora
```

- [ ] **Step 4: Commit**

```bash
git add scripts/rl_smoke_m5.py plans/rsi/sp9-rl-core.md
git commit -m "feat(rl): torchrun multi-GPU smoke gate + M5 roadmap update"
```

---

## GPU 真机验证清单（机子到位后按序执行，零代码改动）

1. `python3 scripts/rl_smoke.py`（设备注册表 CUDA 路径）
2. `python3 scripts/rl_smoke_hf.py --model Qwen/Qwen3-0.6B`（单卡真模型 GRPO）
3. `torchrun --standalone --nproc-per-node=2 scripts/rl_smoke_m5.py --model Qwen/Qwen3-0.6B --strategy ddp`（双卡 DDP）
4. `torchrun --standalone --nproc-per-node=8 scripts/rl_smoke_m5.py --model Qwen/Qwen3-0.6B --strategy fsdp`（8 卡 FSDP）
5. `torchrun --standalone --nproc-per-node=8 scripts/rl_smoke_m5.py --model Qwen/Qwen3.8-27B --lora --strategy fsdp`（27B LoRA 终态门）
6. 通过后接 harbor 任务 reward（`rl_smoke_m4.py` 流程）跑真任务学习曲线

## 完成定义

- 全量回归：`python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib"` 全绿（基线 163，预计新增 ~19）
- 父代理亲自跑通两条 CPU torchrun 冒烟（含 --lora）
- 5 个功能提交 + 1 个计划提交推送至 `feat/rsi-data-flywheel`
