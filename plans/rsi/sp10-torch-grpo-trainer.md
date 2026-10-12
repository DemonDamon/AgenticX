# SP10: RL 训练核 M1 — torch GRPO 主循环 + 多硬件后端适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** M1 交付后端无关的 GRPO torch 训练核：`device.py`（CUDA/ROCm/MPS/昇腾 NPU 四后端探测 + dtype 策略）、`rollout.py`（RolloutEngine 协议 + TinyLM 本地 rollout）、`trainer.py`（GRPO 主循环，torch 公式与 M0 core_algos **逐项对拍钉死**）、`scripts/rl_smoke.py`（本机 MPS 真跑冒烟门）。真 GPU/昇腾机到位后无需改代码，只换设备探测结果。

**P1 路线图位置（M0✅ → **M1 本计划** → M2 vLLM rollout → M3 harbor env → M4 回放混合 GRPO+演化塑形 → M5 多卡）**

**硬件适配矩阵（用户决策：先写好适配，机子到位再真测）:**

| kind | 探测方式 | dtype 策略 | 真机验证状态 |
|---|---|---|---|
| cuda (NVIDIA) | `torch.cuda.is_available()` | bf16（`is_bf16_supported()` 否则 fp16） | 待 GPU 机 |
| cuda (ROCm-as-cuda, AMD) | 同上 + `torch.version.hip` 打标签 | 同 cuda | 待 AMD 卡 |
| npu (昇腾) | 守卫式 `import torch_npu`，失败跳过 | bf16 | 待昇腾机（装 torch_npu + CANN） |
| mps (Apple) | `torch.backends.mps.is_available()` | fp32 保守（fp16 可选手动） | **本机冒烟（Task 4）** |
| cpu | 兜底 | fp32 | CI 全量单测 |

**设计纪律:**
- M0 `core_algos.py`（numpy）钉死数学语义；本计划 `torch_grpo_loss` 用 torch 实现同公式，**对拍测试**保证数值一致（M0 语义真正被消费，M1 有梯度）。优势计算直接复用 `grpo_outcome_advantage`（numpy→tensor）。
- `LocalRolloutEngine.generate` 逐 token 采样并记录 old_logprobs；测试证明 rollout 时的 logp 与训练 forward 重算**逐元素一致**（ratio=1 起点成立）。
- rollout 分组约定：`for prompt: for _ in range(n_samples)` 连续排列，`grpo_outcome_advantage(rewards, group_size=n_samples)` 的 reshape 语义依赖此约定（代码注释注明）。
- 不做 MLX 第二训练栈（P2 选项）；Apple 路径走 PyTorch MPS。

**Tech Stack:** Python 3.13 + torch 2.12（本机已装，MPS 可用）+ numpy。pytest 命令一律 `-o addopts="--import-mode=importlib"`。

---

### Task 1: device.py — 设备注册表 + dtype 策略 + autocast 助手

**Files:**
- Create: `agenticx/rl/device.py`
- Test: `tests/rl/test_device.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_device.py
import pytest
import torch

from agenticx.rl.device import DeviceInfo, autocast_for, detect_device


def _mock_cuda(monkeypatch, *, bf16=True, name="NVIDIA A100", hip=None):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "current_device", lambda: 0)
    monkeypatch.setattr(torch.cuda, "get_device_name", lambda i: name)
    monkeypatch.setattr(torch.cuda, "is_bf16_supported", lambda: bf16)
    monkeypatch.setattr(torch.version, "hip", hip)


def test_detect_cpu_override():
    info = detect_device("cpu")
    assert info.kind == "cpu"
    assert info.dtype == torch.float32
    assert info.torch_device == torch.device("cpu")


def test_detect_override_table_covers_all_backends():
    assert detect_device("cuda").dtype == torch.bfloat16
    assert detect_device("npu").dtype == torch.bfloat16
    assert detect_device("mps").dtype == torch.float32


def test_detect_unknown_override_raises():
    with pytest.raises(ValueError):
        detect_device("tpu")


def test_detect_default_returns_valid_kind():
    # 本机真实探测：无 GPU 环境应落 mps 或 cpu
    info = detect_device()
    assert info.kind in ("cpu", "mps", "cuda", "npu")


def test_cuda_probe_prefers_bf16(monkeypatch):
    _mock_cuda(monkeypatch, bf16=True)
    info = detect_device()
    assert info.kind == "cuda" and info.bf16
    assert info.dtype == torch.bfloat16
    assert "A100" in info.name


def test_cuda_probe_fp16_fallback(monkeypatch):
    _mock_cuda(monkeypatch, bf16=False)
    info = detect_device()
    assert info.kind == "cuda" and not info.bf16
    assert info.dtype == torch.float16


def test_rocm_labelled_in_name(monkeypatch):
    _mock_cuda(monkeypatch, name="AMD Instinct MI300X", hip="6.2.4")
    info = detect_device()
    assert info.kind == "cuda"
    assert "ROCm" in info.name


def test_cuda_priority_over_mps(monkeypatch):
    # 本机 mps 真实可用，mock cuda 后应选 cuda
    _mock_cuda(monkeypatch)
    assert detect_device().kind == "cuda"


def test_npu_not_detected_without_torch_npu():
    # CI/本机未装 torch_npu：探测结果绝不能是 npu（守卫式导入不炸）
    assert detect_device().kind != "npu"


def test_autocast_cpu_is_noop():
    info = detect_device("cpu")
    with autocast_for(info):
        x = torch.ones(3)
    assert x.dtype == torch.float32


def test_autocast_cuda_disabled_constructs():
    # enabled=False 时无真 cuda 也不应炸
    info = detect_device("cuda")
    with autocast_for(info, enabled=False):
        pass


def test_device_info_is_frozen():
    info = detect_device("cpu")
    with pytest.raises(Exception):
        info.kind = "cuda"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_device.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/device.py
"""设备注册表（P1 · M1）：多硬件后端探测 + dtype 策略 + autocast 助手。

后端优先级: cuda(含 ROCm-as-cuda) > npu(昇腾) > mps(Apple) > cpu。
真机启用方式:
  - NVIDIA/AMD: 官方或 ROCm 版 torch，检测自动生效
  - 昇腾: pip install torch_npu + CANN toolkit（ASCEND_TOOLKIT_HOME），
    import torch_npu 会为 torch 打补丁挂上 torch.npu
  - Apple: pytorch>=2.0 自带 MPS
"""
from __future__ import annotations

from dataclasses import dataclass

import torch


@dataclass(frozen=True)
class DeviceInfo:
    kind: str           # "cuda" | "npu" | "mps" | "cpu"
    name: str           # 人读名（ROCm 会打标签）
    dtype: torch.dtype  # 推荐训练 dtype
    bf16: bool          # 是否支持 bf16

    @property
    def torch_device(self) -> torch.device:
        return torch.device(self.kind)


def _probe_cuda() -> DeviceInfo | None:
    if not torch.cuda.is_available():
        return None
    idx = torch.cuda.current_device()
    name = torch.cuda.get_device_name(idx)
    hip = getattr(torch.version, "hip", None)
    label = f"{name} [ROCm]" if hip else name
    bf16 = bool(torch.cuda.is_bf16_supported())
    dtype = torch.bfloat16 if bf16 else torch.float16
    return DeviceInfo("cuda", label, dtype, bf16)


def _probe_npu() -> DeviceInfo | None:
    try:
        import torch_npu  # noqa: F401  守卫式：未安装则静默跳过
    except Exception:
        return None
    npu = getattr(torch, "npu", None)
    if npu is None or not npu.is_available():
        return None
    try:
        name = npu.get_device_name(0)
    except Exception:
        name = "Ascend NPU"
    return DeviceInfo("npu", name, torch.bfloat16, True)


def _probe_mps() -> DeviceInfo | None:
    mps = getattr(torch.backends, "mps", None)
    if mps is None or not mps.is_available():
        return None
    return DeviceInfo("mps", "Apple Silicon (MPS)", torch.float32, False)


_OVERRIDES: dict[str, DeviceInfo] = {
    "cpu": DeviceInfo("cpu", "CPU", torch.float32, False),
    "cuda": DeviceInfo("cuda", "CUDA (forced)", torch.bfloat16, True),
    "npu": DeviceInfo("npu", "NPU (forced)", torch.bfloat16, True),
    "mps": DeviceInfo("mps", "MPS (forced)", torch.float32, False),
}


def detect_device(override: str | None = None) -> DeviceInfo:
    """探测可用训练设备；override 强制指定（"cpu"/"cuda"/"npu"/"mps"，CI 用）。"""
    if override is not None:
        if override not in _OVERRIDES:
            raise ValueError(f"未知设备类型 {override!r}，可选 {sorted(_OVERRIDES)}")
        return _OVERRIDES[override]
    for probe in (_probe_cuda, _probe_npu, _probe_mps):
        info = probe()
        if info is not None:
            return info
    return _OVERRIDES["cpu"]


def autocast_for(info: DeviceInfo, *, enabled: bool = True):
    """混合精度上下文：cuda/npu 用 autocast；mps/cpu 保守关闭（纯 fp32）。

    mps 的 fp16 属可选手动路径（教程级 matmul OK），训练核默认 fp32 求稳。
    """
    if info.kind == "cuda":
        return torch.autocast(device_type="cuda", dtype=info.dtype, enabled=enabled)
    if info.kind == "npu":
        return torch.autocast(device_type="npu", dtype=torch.bfloat16, enabled=enabled)
    return torch.autocast(device_type="cpu", enabled=False)
```

- [ ] **Step 4: 跑测试确认通过**（13 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/device.py tests/rl/test_device.py
git commit -m "feat(rl): multi-backend device registry — cuda/ROCm/npu/mps probing with dtype policy"
```

---

### Task 2: rollout.py — TinyLM + LocalRolloutEngine + RolloutEngine 协议

**Files:**
- Create: `agenticx/rl/rollout.py`
- Test: `tests/rl/test_rollout.py`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_rollout.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/rollout.py
"""Rollout 层（P1 · M1）：协议 + TinyLM 本地 rollout（CPU 单测 / MPS 冒烟）。

M2 将提供 vLLM rollout 引擎实现同一协议，训练核代码零改动。
分组约定: generate 按 `for prompt: for _ in range(n_samples)` 连续排列，
trainer 的 grpo_outcome_advantage(rewards, group_size=n_samples) 依赖此顺序。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import torch
from torch import nn


@dataclass
class RolloutSample:
    prompt_ids: torch.Tensor      # (Lp,) long, cpu
    response_ids: torch.Tensor    # (Lr,) long, cpu
    old_logprobs: torch.Tensor    # (Lr,) float32, cpu —— 采样时记录，供 ratio 用
    reward: float = 0.0


class RolloutEngine(Protocol):
    def generate(self, prompts: list[list[int]], *, n_samples: int,
                 max_new_tokens: int, temperature: float = 1.0,
                 eos_id: int | None = None) -> list[RolloutSample]: ...


class TinyLM(nn.Module):
    """最小可训练 LM（GRU）：vocab=32，CPU 毫秒级，用于单测与设备冒烟。"""

    vocab_size = 32

    def __init__(self, hidden: int = 64):
        super().__init__()
        self.emb = nn.Embedding(self.vocab_size, hidden, padding_idx=0)
        self.gru = nn.GRU(hidden, hidden, batch_first=True)
        self.head = nn.Linear(hidden, self.vocab_size)

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        """(B, L) -> logits (B, L, V)。"""
        out, _ = self.gru(self.emb(ids))
        return self.head(out)


class LocalRolloutEngine:
    """对任意 nn.Module LM 做朴素逐 token rollout：multinomial 采样并记录 logp。"""

    def __init__(self, lm: nn.Module):
        self.lm = lm

    @torch.no_grad()
    def generate(self, prompts, *, n_samples, max_new_tokens,
                 temperature=1.0, eos_id=None) -> list[RolloutSample]:
        device = next(self.lm.parameters()).device
        was_training = self.lm.training
        self.lm.eval()
        try:
            out: list[RolloutSample] = []
            for prompt in prompts:
                for _ in range(n_samples):
                    ids = torch.tensor(prompt, dtype=torch.long, device=device)
                    logps: list[float] = []
                    resp: list[int] = []
                    for _ in range(max_new_tokens):
                        logits = self.lm(ids.unsqueeze(0))[0, -1]
                        logp = torch.log_softmax(logits / temperature, dim=-1)
                        nxt = int(torch.multinomial(logp.exp(), 1).item())
                        logps.append(float(logp[nxt].item()))
                        resp.append(nxt)
                        if eos_id is not None and nxt == eos_id:
                            break
                        ids = torch.cat([ids, torch.tensor([nxt], device=device)])
                    out.append(RolloutSample(
                        prompt_ids=ids[: len(prompt)].detach().cpu(),
                        response_ids=torch.tensor(resp, dtype=torch.long),
                        old_logprobs=torch.tensor(logps, dtype=torch.float32),
                    ))
            return out
        finally:
            self.lm.train(was_training)
```

- [ ] **Step 4: 跑测试确认通过**（5 PASS）

注意 `test_generate_logprobs_match_forward_recompute` 若因浮点路径差异不过（atol 1e-5 应充分，GRU 无 dropout/BN），优先检查 gather 位置对齐，不许放宽到 1e-3 以上。

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/rollout.py tests/rl/test_rollout.py
git commit -m "feat(rl): RolloutEngine protocol + TinyLM local rollout with recorded old_logprobs"
```

---

### Task 3: trainer.py — GRPO 主循环（torch 公式对拍 M0 + 端到端学习闭环）

**Files:**
- Create: `agenticx/rl/trainer.py`
- Test: `tests/rl/test_trainer.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_trainer.py
import numpy as np
import torch

from agenticx.rl import core_algos
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM
from agenticx.rl.trainer import GRPOTrainer, response_logprobs, torch_grpo_loss


def test_torch_loss_matches_numpy_core_algos():
    """对拍门：torch 公式与 M0 numpy 语义逐数值一致（kl_beta>0 + mask 混合场景）。"""
    rng = np.random.default_rng(0)
    logp = torch.tensor(rng.normal(size=6), dtype=torch.float64, requires_grad=True)
    old = torch.tensor(rng.normal(size=6), dtype=torch.float64)
    ref = torch.tensor(rng.normal(size=6), dtype=torch.float64)
    adv = torch.tensor(rng.normal(size=6), dtype=torch.float64)
    mask = torch.tensor([1.0, 1.0, 1.0, 0.0, 0.0, 1.0], dtype=torch.float64)

    t = torch_grpo_loss(logp, old, ref, adv, mask, clip_eps=0.2, kl_beta=0.04)
    n = core_algos.grpo_loss(
        logp.detach().numpy(), old.numpy(), ref.numpy(), adv.numpy(),
        mask.numpy(), clip_eps=0.2, kl_beta=0.04)
    assert abs(t.item() - n) < 1e-9

    t.backward()
    assert logp.grad is not None and torch.isfinite(logp.grad).all()


def test_torch_loss_zero_kl_beta_ignores_ref():
    rng = np.random.default_rng(1)
    args = [torch.tensor(rng.normal(size=4), dtype=torch.float64) for _ in range(4)]
    logp, old, ref, adv = args
    mask = torch.ones(4, dtype=torch.float64)
    a = torch_grpo_loss(logp, old, ref, adv, mask, kl_beta=0.0)
    b = torch_grpo_loss(logp, old, ref * 100.0, adv, mask, kl_beta=0.0)
    assert a.item() == b.item()


def test_response_logprobs_grad_flows():
    lm = TinyLM()
    s = LocalRolloutEngine(lm).generate([[1, 2]], n_samples=1, max_new_tokens=4)[0]
    lp = response_logprobs(lm, [s], torch.device("cpu"))
    assert lp.shape == (4,)
    lp.sum().backward()
    assert any(p.grad is not None for p in lm.parameters())


def test_trainer_learns_to_emit_target_token():
    """端到端闭环：GRPO 更新让 TinyLM 学会多吐 target token（bandit 语义升级版）。"""
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    target = 7

    def reward_fn(p, r):
        return float((r == target).sum().item())

    tr = GRPOTrainer(lm, eng, reward_fn, lr=5e-3)
    prompts = [[1, 2, 3], [4, 5]]
    first = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    for _ in range(59):
        last = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    assert last["reward_mean"] > first["reward_mean"] + 1.0
    assert last["reward_mean"] > 2.0            # 6 token 中至少 1/3 命中 target
    assert np.isfinite(first["loss"]) and np.isfinite(last["loss"])


def test_trainer_kl_beta_uses_frozen_ref():
    torch.manual_seed(0)
    lm = TinyLM()
    ref = TinyLM()
    ref.load_state_dict(lm.state_dict())
    for p in ref.parameters():
        p.requires_grad_(False)
    eng = LocalRolloutEngine(lm)
    tr = GRPOTrainer(lm, eng, lambda p, r: float(r.shape[0]),
                     lr=1e-3, kl_beta=0.05, ref_lm=ref)
    m = tr.train_step([[1, 2]], n_samples=4, max_new_tokens=5)
    assert np.isfinite(m["loss"])
    assert all(p.grad is None for p in ref.parameters())   # ref 冻结
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_trainer.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/trainer.py
"""GRPO torch 训练核（P1 · M1）：后端无关主循环，消费 M0 core_algos 语义。

数值纪律: torch_grpo_loss 与 core_algos.grpo_loss 的等价性由对拍测试钉死
（tests/rl/test_trainer.py::test_torch_loss_matches_numpy_core_algos）；
优势计算直接复用 numpy 版 grpo_outcome_advantage。
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import torch
from torch import nn

from .core_algos import grpo_outcome_advantage
from .rollout import RolloutEngine, RolloutSample


def response_logprobs(lm: nn.Module, samples: list[RolloutSample],
                      device: torch.device) -> torch.Tensor:
    """当前 lm 对各 sample response 段的 token logp（带梯度，拼接为 (ΣLr,)）。

    位置对齐: logits[i] 预测 token i+1，response token j（全局位置 P+j）
    的 logp 取自位置 P+j-1 的 log_softmax。
    """
    outs = []
    for s in samples:
        ids = torch.cat([s.prompt_ids, s.response_ids]).to(device).unsqueeze(0)
        logits = lm(ids)[0]                                   # (L, V)
        logp = torch.log_softmax(logits[:-1], dim=-1)
        seg = logp[len(s.prompt_ids) - 1: ids.shape[1] - 1]
        tgt = s.response_ids.to(device).unsqueeze(1)
        outs.append(seg.gather(1, tgt).squeeze(1))
    return torch.cat(outs)


def torch_grpo_loss(logprobs, old_logprobs, ref_logprobs, advantages, response_mask, *,
                    clip_eps: float = 0.2, kl_beta: float = 0.0) -> torch.Tensor:
    """core_algos.grpo_loss 的 torch 版（k3 KL，带梯度）。"""
    ratio = torch.exp(logprobs - old_logprobs)
    surr1 = ratio * advantages
    surr2 = torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps) * advantages
    pg = -torch.minimum(surr1, surr2)
    if kl_beta:
        d = ref_logprobs - logprobs
        kl = torch.exp(d) - d - 1.0                          # k3，恒非负
        per_tok = pg + kl_beta * kl
    else:
        per_tok = pg
    m = response_mask.to(logprobs.dtype)
    return (per_tok * m).sum() / m.sum().clamp_min(1.0)


class GRPOTrainer:
    """单进程 GRPO：rollout → reward → 组归一化优势 → torch loss → AdamW。

    设备无关: lm 在哪个 device（cuda/npu/mps/cpu），采样与训练就在哪跑。
    ref_lm=None 时 KL 参照退化为 rollout 策略（ref=old，首轮 KL=0）。
    """

    def __init__(self, lm: nn.Module, rollout: RolloutEngine,
                 reward_fn: Callable[[torch.Tensor, torch.Tensor], float], *,
                 lr: float = 1e-3, clip_eps: float = 0.2, kl_beta: float = 0.0,
                 ref_lm: nn.Module | None = None,
                 optimizer: torch.optim.Optimizer | None = None):
        self.lm = lm
        self.rollout = rollout
        self.reward_fn = reward_fn
        self.clip_eps = clip_eps
        self.kl_beta = kl_beta
        self.ref_lm = ref_lm
        self.opt = optimizer or torch.optim.AdamW(lm.parameters(), lr=lr)

    def train_step(self, prompts: list[list[int]], *, n_samples: int = 4,
                   max_new_tokens: int = 8, temperature: float = 1.0,
                   eos_id: int | None = None) -> dict:
        device = next(self.lm.parameters()).device
        samples = self.rollout.generate(
            prompts, n_samples=n_samples, max_new_tokens=max_new_tokens,
            temperature=temperature, eos_id=eos_id)
        rewards = [self.reward_fn(s.prompt_ids, s.response_ids) for s in samples]
        for s, r in zip(samples, rewards):
            s.reward = r

        adv = grpo_outcome_advantage(rewards, group_size=n_samples)  # numpy M0

        logprobs = response_logprobs(self.lm, samples, device)
        with torch.no_grad():
            old = torch.cat([s.old_logprobs for s in samples]).to(device)
            ref = (response_logprobs(self.ref_lm, samples, device)
                   if self.ref_lm is not None else old.clone())
        adv_t = torch.tensor(adv, dtype=logprobs.dtype, device=device)
        mask = torch.ones_like(logprobs)

        loss = torch_grpo_loss(logprobs, old, ref, adv_t, mask,
                               clip_eps=self.clip_eps, kl_beta=self.kl_beta)
        self.opt.zero_grad(set_to_none=True)
        loss.backward()
        self.opt.step()
        return {"loss": float(loss.detach()),
                "reward_mean": float(np.mean(rewards)),
                "n_samples": len(samples)}
```

- [ ] **Step 4: 跑测试确认通过**（5 PASS）

闭环测试固定种子下若学不动：允许调 lr∈[1e-3, 1e-2]、iters∈[40, 120]，断言不许放水（提升量 ≥1.0 且终值 >2.0 不变）。

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/trainer.py tests/rl/test_trainer.py
git commit -m "feat(rl): backend-agnostic GRPO trainer with numpy-parity torch loss + e2e learning gate"
```

---

### Task 4: scripts/rl_smoke.py — 本机 MPS 真跑冒烟门

**Files:**
- Create: `scripts/rl_smoke.py`

- [ ] **Step 1: 实现冒烟脚本**（纯脚本，无 pytest；由子代理与父代理各真跑一次）

```python
#!/usr/bin/env python3
"""RL 训练核冒烟：TinyLM + GRPO 在探测到的设备上真跑（本机=MPS）。

用法: python3 scripts/rl_smoke.py [--steps 30] [--device auto]
退出码 0 = 冒烟门通过（reward 显著上升）；非 0 = 失败。
真模型路径（0.xB）由 M2 vLLM rollout 接入后启用，本脚本钉设备无关训练核。
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import autocast_for, detect_device  # noqa: E402
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=60)
    ap.add_argument("--n-samples", type=int, default=8)
    ap.add_argument("--max-new-tokens", type=int, default=6)
    ap.add_argument("--target-token", type=int, default=7)
    ap.add_argument("--device", default="auto",
                    help="auto|cpu|cuda|npu|mps")
    args = ap.parse_args()

    info = detect_device(None if args.device == "auto" else args.device)
    print(f"[smoke] device={info.kind} name={info.name!r} "
          f"dtype={info.dtype} bf16={info.bf16}")
    dev = info.torch_device

    torch.manual_seed(0)
    lm = TinyLM().to(dev)
    eng = LocalRolloutEngine(lm)
    target = args.target_token

    def reward_fn(p, r):
        return float((r == target).sum().item())

    tr = GRPOTrainer(lm, eng, reward_fn, lr=5e-3)
    prompts = [[1, 2, 3], [4, 5]]

    t0 = time.time()
    first = last = None
    for i in range(args.steps):
        with autocast_for(info, enabled=False):
            m = tr.train_step(prompts, n_samples=args.n_samples,
                              max_new_tokens=args.max_new_tokens)
        first = first if first is not None else m
        last = m
        if (i + 1) % 5 == 0 or i == 0:
            print(f"[smoke] step {i + 1:3d}/{args.steps} "
                  f"loss={m['loss']:.4f} reward_mean={m['reward_mean']:.3f}")
    dt = time.time() - t0

    gain = last["reward_mean"] - first["reward_mean"]
    print(f"[smoke] done in {dt:.1f}s on {info.kind}: "
          f"reward {first['reward_mean']:.3f} -> {last['reward_mean']:.3f} "
          f"(gain={gain:+.3f})")
    if gain > 0.5:
        print("[smoke] PASS")
        return 0
    print("[smoke] FAIL: reward 未显著上升")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 本机真跑（MPS）+ CPU 对照**

Run: `python3 scripts/rl_smoke.py && python3 scripts/rl_smoke.py --device cpu`
Expected: 两次都输出 PASS，退出码 0；MPS 行打印 `device=mps`。若 MPS 上 60 步 gain≤0.5（学太慢），把 `--steps` 提到 120 排查并记录，禁止降低 gain 门槛。

- [ ] **Step 3: 全量回归**

Run: `python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q`
Expected: 全 PASS（M0 基线 93+ 新增 ~23）

- [ ] **Step 4: Commit**

```bash
git add scripts/rl_smoke.py
git commit -m "feat(rl): device smoke gate — GRPO end-to-end on detected backend (MPS local)"
```

---

## 真机验证清单（机子到位后执行，不改代码）

| 后端 | 动作 | 验证命令 |
|---|---|---|
| NVIDIA CUDA | 装 CUDA torch | `python3 scripts/rl_smoke.py`（device=cuda, bf16） |
| AMD ROCm | 装 ROCm torch | 同上（name 带 [ROCm] 标签） |
| 昇腾 NPU | `pip install torch_npu` + CANN | 同上（device=npu, bf16） |
| Apple MPS | 已随本计划验证 | `python3 scripts/rl_smoke.py` |
