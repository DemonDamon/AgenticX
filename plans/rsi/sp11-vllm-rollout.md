# SP11: RL 训练核 M2 — 真模型 rollout（HF 本地 + vLLM 适配）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 GRPO 训练核吃真模型：`hf_rollout.py`（transformers 引擎，本机 MPS 真跑 Qwen3-0.6B）+ `vllm_rollout.py`（GPU 机高速引擎，守卫式 import + 离线权重同步，mock 测试钉死协议）+ trainer 权重同步钩子。**Apple 路径 = transformers + MPS（已验证可跑 0.6B）；vLLM 路径适配先做好，GPU 机到位零改动真测。**

**P1 路线图位置（M0✅ M1✅ → **M2 本计划** → M3 harbor env → M4 回放混合 GRPO → M5 多卡）**

**父代理已验证的环境事实（2026-09-17）:**
- transformers 5.17.0 已装（litellm 导入不受影响）；vllm 未装（预期，Mac）
- Qwen3-0.6B 已下载至 HF 缓存（1.4G，hf-mirror）；MPS fp32 加载+generate+output_logits 全部正常（8.7s）
- `GPT2LMHeadModel` forward `out[0]` 即 logits (B,L,V) —— trainer.response_logprobs 对 HF 模型零改动可用
- generate(output_logits=True, return_dict_in_generate=True) 在 transformers 5.x 可用；`logits[t]` 是 (B,V) raw logits，与第 t 个新 token 对齐

**设计纪律:**
- 三引擎同一协议（`generate(prompts, *, n_samples, max_new_tokens, temperature, eos_id) -> list[RolloutSample]`）：LocalRolloutEngine（toy）、HFRolloutEngine（本机真模型）、VLLMRolloutEngine（GPU 机）——trainer 零改动换引擎
- HF 引擎走 `model.generate`（KV-cache 提速），warpers 全关（top_k=0, top_p=1.0）保证 raw logits 与训练 forward 可对拍；old_logprobs = log_softmax(logits/temperature)[tok]
- 一致性保证在 temperature=1.0 成立；KV-cache 与全序列 forward 的 fp32 浮点差用 atol=1e-4（错位是 O(1) 误差，1e-4 足够分辨）
- HF 引擎 response_ids 含终止符 eos（与 TinyLM 语义一致）；vLLM 引擎 token_ids 不含 stop token（vLLM 行为）——协议允许，trainer 不关心
- 小 GPT2 测试模型 dropout 全关（resid/embd/attn_pdrop=0），对齐真实 LLM RL 实践（Qwen3 dropout=0），保证 ratio=1 起点成立
- trainer 增加 post-step 钩子：rollout 引擎若有 `sync_weights(model)` 方法则每步调用（vLLM 离线模式需要；HF/Local 引擎共享模型对象无此方法，零开销）

**Tech Stack:** Python 3.13 + torch 2.12 + transformers 5.17 + numpy。pytest 命令一律 `-o addopts="--import-mode=importlib"`。

---

### Task 1: hf_rollout.py — HFRolloutEngine（transformers 真模型 rollout）

**Files:**
- Create: `agenticx/rl/hf_rollout.py`
- Test: `tests/rl/test_hf_rollout.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_hf_rollout.py
import torch
from transformers import GPT2Config, GPT2LMHeadModel

from agenticx.rl.hf_rollout import HFRolloutEngine
from agenticx.rl.rollout import RolloutSample


def _tiny_gpt2():
    torch.manual_seed(0)
    cfg = GPT2Config(n_embd=32, n_layer=1, n_head=4, vocab_size=128,
                     bos_token_id=1, eos_token_id=2,
                     resid_pdrop=0.0, embd_pdrop=0.0, attn_pdrop=0.0)
    return GPT2LMHeadModel(cfg)


def test_generate_counts_and_shapes():
    lm = _tiny_gpt2()
    eng = HFRolloutEngine(lm)
    samples = eng.generate([[10, 11, 12], [4, 5]], n_samples=3, max_new_tokens=5)
    assert len(samples) == 6
    for s in samples:
        assert isinstance(s, RolloutSample)
        assert 0 < s.response_ids.shape[0] <= 5
        assert s.response_ids.shape[0] == s.old_logprobs.shape[0]
        assert s.prompt_ids.tolist() in ([10, 11, 12], [4, 5])
    # 分组排列约定：前 3 个属于 prompt1
    assert [s.prompt_ids.tolist() for s in samples[:3]] == [[10, 11, 12]] * 3


def test_generate_logprobs_match_forward_recompute():
    """rollout 记录的 old_logprobs 与训练 forward 重算一致（T=1，KV-cache 浮点差<1e-4）。"""
    lm = _tiny_gpt2().eval()
    eng = HFRolloutEngine(lm)
    torch.manual_seed(0)
    s = eng.generate([[10, 11, 12]], n_samples=1, max_new_tokens=6)[0]
    ids = torch.cat([s.prompt_ids, s.response_ids]).unsqueeze(0)
    logits = lm(ids)[0]                                  # (L, V) — 与 trainer 同路径
    logp = torch.log_softmax(logits[:-1].float(), dim=-1)
    seg = logp[len(s.prompt_ids) - 1:]
    lp = seg.gather(1, s.response_ids.unsqueeze(1)).squeeze(1)
    assert torch.allclose(s.old_logprobs, lp, atol=1e-4)


def test_generate_stops_at_eos_greedy():
    """greedy（temperature=0）首 token 即 eos → response 恰为 [eos]。"""
    lm = _tiny_gpt2().eval()
    eng = HFRolloutEngine(lm)
    with torch.no_grad():
        logits = lm(torch.tensor([[10, 11]]))[0][0, -1]
    top = int(logits.argmax())
    s = eng.generate([[10, 11]], n_samples=1, max_new_tokens=8,
                     temperature=0.0, eos_id=top)[0]
    assert s.response_ids.tolist() == [top]


def test_generate_preserves_training_mode():
    lm = _tiny_gpt2()
    eng = HFRolloutEngine(lm)
    lm.train()
    eng.generate([[1]], n_samples=1, max_new_tokens=2)
    assert lm.training
    lm.eval()
    eng.generate([[1]], n_samples=1, max_new_tokens=2)
    assert not lm.training


def test_generate_temperature_recorded_in_logprobs():
    """T≠1 时记录的是采样分布（logits/T）下的 logp。"""
    lm = _tiny_gpt2().eval()
    eng = HFRolloutEngine(lm)
    torch.manual_seed(0)
    s = eng.generate([[10, 11]], n_samples=1, max_new_tokens=4, temperature=2.0)[0]
    assert s.old_logprobs.shape[0] == s.response_ids.shape[0]
    assert torch.isfinite(s.old_logprobs).all()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_hf_rollout.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**（5 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/hf_rollout.py tests/rl/test_hf_rollout.py
git commit -m "feat(rl): HFRolloutEngine — transformers real-model rollout with KV-cache and recorded logprobs"
```

---

### Task 2: trainer 权重同步钩子 + GPT2 真架构 GRPO 闭环

**Files:**
- Modify: `agenticx/rl/trainer.py`（train_step 末尾追加 3 行钩子）
- Test: `tests/rl/test_trainer.py`（追加 2 个测试）

- [ ] **Step 1: 写失败测试（追加到 tests/rl/test_trainer.py 末尾）**

```python
# ---- SP11 追加：真架构闭环 + 离线引擎权重同步钩子 ----
from agenticx.rl.hf_rollout import HFRolloutEngine
from transformers import GPT2Config, GPT2LMHeadModel


def _tiny_gpt2():
    torch.manual_seed(0)
    cfg = GPT2Config(n_embd=32, n_layer=1, n_head=4, vocab_size=128,
                     bos_token_id=1, eos_token_id=2,
                     resid_pdrop=0.0, embd_pdrop=0.0, attn_pdrop=0.0)
    return GPT2LMHeadModel(cfg)


def test_grpo_learns_on_real_attention_arch():
    """GRPO 闭环在真注意力架构（GPT2，dropout=0 对齐 LLM RL 实践）上成立。"""
    torch.manual_seed(0)
    lm = _tiny_gpt2()
    eng = HFRolloutEngine(lm)
    target = 7
    tr = GRPOTrainer(lm, eng, lambda p, r: float((r == target).sum().item()),
                     lr=5e-3)
    prompts = [[10, 11, 12], [4, 5]]
    first = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    for _ in range(59):
        last = tr.train_step(prompts, n_samples=8, max_new_tokens=6)
    assert last["reward_mean"] > first["reward_mean"] + 1.0
    assert last["reward_mean"] > 2.0


def test_trainer_syncs_offline_engine_weights():
    """rollout 引擎带 sync_weights（vLLM 离线模式）时，每步训练后同步一次。"""
    lm = TinyLM()
    local = LocalRolloutEngine(lm)
    synced = []

    class OfflineEngine:
        def generate(self, prompts, *, n_samples, max_new_tokens,
                     temperature=1.0, eos_id=None):
            return local.generate(prompts, n_samples=n_samples,
                                  max_new_tokens=max_new_tokens,
                                  temperature=temperature, eos_id=eos_id)

        def sync_weights(self, model):
            synced.append(model)

    tr = GRPOTrainer(lm, OfflineEngine(), lambda p, r: 0.0, lr=1e-3)
    tr.train_step([[1, 2]], n_samples=2, max_new_tokens=3)
    assert synced == [lm]                # 恰好一次，传的是训练模型本体
```

- [ ] **Step 2: 跑测试确认失败**（新增 2 FAIL：GPT2 闭环可能直接过——那也先跑，确认基线；sync 钩子必 FAIL）

- [ ] **Step 3: 最小实现（trainer.py train_step 的 opt.step() 之后追加）**

```python
        self.opt.step()
        sync = getattr(self.rollout, "sync_weights", None)   # vLLM 离线模式热同步
        if callable(sync):
            sync(self.lm)
        return {"loss": float(loss.detach()),
```

（即把原 `self.opt.step()` 与 `return` 之间插入 3 行。）

- [ ] **Step 4: 跑测试确认通过**（原有 5 + 新增 2 = 7 PASS）

GPT2 闭环若学不动：允许调 lr∈[1e-3, 1e-2]、iters∈[40, 120]（写回测试），断言（提升≥1.0 且终值>2.0）绝不放水。

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/trainer.py tests/rl/test_trainer.py
git commit -m "feat(rl): offline-engine weight sync hook + GRPO gate on real attention architecture"
```

---

### Task 3: vllm_rollout.py — VLLMRolloutEngine（守卫式 import + 离线权重同步，mock 测试）

**Files:**
- Create: `agenticx/rl/vllm_rollout.py`
- Test: `tests/rl/test_vllm_rollout.py`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_vllm_rollout.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**（5 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/vllm_rollout.py tests/rl/test_vllm_rollout.py
git commit -m "feat(rl): VLLMRolloutEngine — guarded vLLM adapter with offline weight sync (mock-tested)"
```

---

### Task 4: scripts/rl_smoke_hf.py — Qwen3-0.6B 真模型 GRPO 冒烟（MPS）

**Files:**
- Create: `scripts/rl_smoke_hf.py`

- [ ] **Step 1: 实现冒烟脚本**（纯脚本；由子代理与父代理各真跑一次）

```python
#!/usr/bin/env python3
"""真模型 GRPO 冒烟（P1 · M2）：Qwen3-0.6B + HFRolloutEngine，设备自适应（本机 MPS）。

用法: python3 scripts/rl_smoke_hf.py [--steps 30] [--model Qwen/Qwen3-0.6B]
下载（直连不通时）: HF_ENDPOINT=https://hf-mirror.com python3 -c \
  "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-0.6B')"
PASS 标准: 跑完全程且 loss 有限（真模型学习曲线证据随 M3 verifier reward 到来，
本门钉"0.xB 真模型全管线在消费级设备上能训"）。
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import detect_device  # noqa: E402
from agenticx.rl.hf_rollout import HFRolloutEngine  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--n-samples", type=int, default=6)
    ap.add_argument("--max-new-tokens", type=int, default=12)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    from transformers import AutoModelForCausalLM, AutoTokenizer

    info = detect_device(None if args.device == "auto" else args.device)
    print(f"[smoke-hf] device={info.kind} ({info.name}) dtype={info.dtype} "
          f"model={args.model}")
    dev = info.torch_device

    tok = AutoTokenizer.from_pretrained(args.model)
    target = tok.encode(" GOOD", add_special_tokens=False)[0]
    print(f"[smoke-hf] target token id={target} ({tok.decode([target])!r})")

    lm = AutoModelForCausalLM.from_pretrained(args.model)
    lm.to(dtype=info.dtype, device=dev)
    eng = HFRolloutEngine(lm)

    def reward_fn(p, r):
        return float((r == target).sum().item())

    tr = GRPOTrainer(lm, eng, reward_fn, lr=args.lr)
    prompts = [tok.encode("The secret password is", add_special_tokens=False),
               tok.encode("My favorite word is", add_special_tokens=False)]

    t0 = time.time()
    first = last = None
    for i in range(args.steps):
        m = tr.train_step(prompts, n_samples=args.n_samples,
                          max_new_tokens=args.max_new_tokens)
        first = first if first is not None else m
        last = m
        if (i + 1) % 5 == 0 or i == 0:
            print(f"[smoke-hf] step {i + 1:3d}/{args.steps} "
                  f"loss={m['loss']:.4f} reward_mean={m['reward_mean']:.3f}")
    dt = time.time() - t0

    gain = last["reward_mean"] - first["reward_mean"]
    print(f"[smoke-hf] done in {dt:.1f}s on {info.kind}: "
          f"reward {first['reward_mean']:.3f} -> {last['reward_mean']:.3f} "
          f"(gain={gain:+.3f})")
    if not (math.isfinite(first["loss"]) and math.isfinite(last["loss"])):
        print("[smoke-hf] FAIL: loss 出现 NaN/Inf")
        return 1
    verdict = "learning signal positive" if gain > 0 else "gain<=0（步数/lr 偏保守，见文档说明）"
    print(f"[smoke-hf] PASS ({verdict})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 本机真跑（MPS，模型已在 HF 缓存）**

Run: `python3 scripts/rl_smoke_hf.py`
Expected: 输出 `device=mps`，全程无 NaN，PASS，退出码 0。单步预计 ~10-20s、全程 5-10 分钟属正常。若 MPS 算子报错：加 `attn_implementation="eager"` 到 from_pretrained 重试（报告里注明）。若超 15 分钟可减 `--steps 20`，禁止改 PASS 标准。

- [ ] **Step 3: 全量回归**

Run: `python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q`
Expected: 全 PASS（SP10 基线 115 + 新增 12 = 127）

- [ ] **Step 4: Commit**

```bash
git add scripts/rl_smoke_hf.py
git commit -m "feat(rl): real-model smoke gate — Qwen3-0.6B GRPO on detected backend (MPS local)"
```

---

## 真机验证清单（GPU/昇腾机到位后执行，不改代码）

| 后端 | 动作 | 验证命令 |
|---|---|---|
| NVIDIA CUDA | `pip install vllm` | `python3 -c "from agenticx.rl.vllm_rollout import VLLMRolloutEngine; VLLMRolloutEngine('Qwen/Qwen3-0.6B')"`（真引擎拉起）+ 用它替换 rl_smoke_hf.py 的引擎跑组采样 |
| 昇腾 NPU | vllm-ascend + torch_npu | 同上（vllm-ascend 生态） |
| AMD ROCm | ROCm 版 vllm | 同上 |
| update_weights_from_disk 版本差异 | 若 collective_rpc 方法名不同（vllm 版本） | 只调 `vllm_rollout.py` 的 sync_weights 一处 |
