# SP9: RL 训练核 M0 — GRPO core_algos 移植（P1 启动）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** P1 最小训练核的第一块：把 verl `core_algos.py` 的 GRPO 数学（outcome advantage / clip policy loss / KL 估计）移植为 **纯 numpy、零 torch 依赖** 的 `agenticx/rl/core_algos.py`，用手算 toy batch 钉死数值语义，再用端到端 bandit 学习闭环证明"数学组合起来真的能学"。

**P1 路线图（M0→M5，终点=用户的独立 8 卡机微调+强化 8B/27B）:**
- M0 (SP9): core_algos 移植 + 数值钉死 + bandit 闭环 —— **纯 CPU，现在就做**
- M1 (SP10): torch 训练核——单卡 GRPO 主循环（tiny-LM/0.5B），FSDP 就绪的抽象
- M2 (SP11): vLLM rollout 引擎 + 权重同步（先离线 sync，后 colocate）
- M3 (SP12): harbor env 适配器 + verifier reward（RSI 任务进训练）
- M4 (SP13): 回放混合 GRPO + 演化策略塑形 rollout（**我们的论文贡献点**）
- M5 (SP14): 多卡扩展（torchrun/FSDP）+ 尺寸配方

**M5 硬件现实核查（诚实版）:**
| 目标 | 8×4090 24G（消费级） | 8×A100/H100 80G |
|---|---|---|
| 8B LoRA GRPO | 舒适 | 舒适 |
| 8B 全参 GRPO | ZeRO-3 offload 勉强、慢 | 舒适 |
| 27B LoRA GRPO | 不行（权重 54G 放不下） | 舒适 |
| 27B 全参 GRPO | 不行 | FSDP+offload 可行但紧 |

**移植纪律:** 数学逐行对照 verl `trainer/ppo/core_algos.py`（`compute_grpo_outcome_advantage` / `compute_policy_loss` / `kl_penalty`），不做重推导；实现框架无关（输入输出全是 numpy array），SP10 的 torch trainer 直接消费这些函数。

**Tech Stack:** Python 3.13 + numpy 2.4（已确认本机可用），pytest。

---

### Task 1: grpo_outcome_advantage（组归一化优势）

**Files:**
- Create: `agenticx/rl/__init__.py`（空包）、`agenticx/rl/core_algos.py`
- Test: `tests/rl/test_core_algos.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_core_algos.py
import numpy as np
from agenticx.rl.core_algos import grpo_outcome_advantage

def test_advantage_hand_computed_g2():
    # G=2, rewards [1,0]: mean=0.5 std=0.5 → [+1, -1]
    adv = grpo_outcome_advantage([1.0, 0.0], group_size=2)
    assert np.allclose(adv, [1.0, -1.0])

def test_advantage_hand_computed_g3():
    # G=3, [1,0,0]: mean=1/3, std=sqrt(2/9)≈0.4714 → [1.4142, -0.7071, -0.7071]
    adv = grpo_outcome_advantage([1.0, 0.0, 0.0], group_size=3)
    assert np.allclose(adv, [np.sqrt(2.0), -np.sqrt(0.5), -np.sqrt(0.5)])

def test_advantage_zero_std_clamped():
    # 组内全同 reward → std=0，eps 保护 → 优势全 0
    adv = grpo_outcome_advantage([0.5, 0.5, 0.5, 0.5], group_size=4)
    assert np.allclose(adv, [0.0, 0.0, 0.0, 0.0])

def test_advantage_no_center_keeps_raw():
    adv = grpo_outcome_advantage([1.0, 0.0], group_size=2,
                                 center=False, normalize_by_std=False)
    assert np.allclose(adv, [1.0, 0.0])

def test_advantage_multi_prompt_batches():
    # 2 组各 G=2，逐组归一化不串组
    adv = grpo_outcome_advantage([1.0, 0.0, 0.0, 0.0], group_size=2)
    assert np.allclose(adv, [1.0, -1.0, 0.0, 0.0])
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_core_algos.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/__init__.py
```

```python
# agenticx/rl/core_algos.py
"""GRPO 核心数学（P1 · M0）：自 verl core_algos 移植，纯 numpy 零 torch。

移植来源对照（verl trainer/ppo/core_algos.py）:
  grpo_outcome_advantage ← compute_grpo_outcome_advantage
  clipped_policy_loss    ← compute_policy_loss
  kl_k1 / kl_k3          ← kl_penalty 的 k1/k3 估计器
SP10 的 torch trainer 消费本模块；数值语义由本目录测试钉死。
"""
from __future__ import annotations

import numpy as np


def grpo_outcome_advantage(rewards, group_size: int, *,
                           center: bool = True,
                           normalize_by_std: bool = True,
                           eps: float = 1e-4) -> np.ndarray:
    """outcome reward → sequence 级优势（组内归一化，verl GRPO 语义）。

    A_j = (r_j - mean_g) / max(std_g, eps)；std 为总体标准差（ddof=0）。
    序列内所有 token 共享同一优势（由 trainer 层广播到 token 级）。
    """
    r = np.asarray(rewards, dtype=np.float64).reshape(-1, group_size)
    adv = (r - r.mean(axis=1, keepdims=True)) if center else r.copy()
    if normalize_by_std:
        std = r.std(axis=1, keepdims=True)
        adv = adv / np.maximum(std, eps)
    return adv.reshape(-1)
```

- [ ] **Step 4: 跑测试确认通过**（5 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/__init__.py agenticx/rl/core_algos.py tests/rl/test_core_algos.py
git commit -m "feat(rl): port GRPO outcome advantage from verl core_algos (numpy, M0)"
```

---

### Task 2: clip policy loss + KL 估计器 + grpo_loss 组合

**Files:**
- Modify: `agenticx/rl/core_algos.py`（追加）
- Test: `tests/rl/test_core_algos.py`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```python
from agenticx.rl.core_algos import (
    clipped_policy_loss, grpo_loss, kl_k1, kl_k3, masked_mean,
)

def test_policy_loss_on_policy_ratio_one():
    # old==current → ratio=1 → per-token loss = -adv
    loss = clipped_policy_loss([0.0, 0.0], [0.0, 0.0], [1.0, -2.0])
    assert np.allclose(loss, [-1.0, 2.0])

def test_policy_loss_clip_activates():
    # old=0, logp=ln(1.3) → ratio=1.3 > 1+0.2 → clip 生效
    logp = [np.log(1.3)]
    loss = clipped_policy_loss(logp, [0.0], [1.0], clip_eps=0.2)
    assert np.allclose(loss, [-1.2])          # -min(1.3, 1.2)*1.0
    # 负向：logp=ln(0.5) ratio=0.5 < 0.8, adv=1 → clip 到 0.8
    loss2 = clipped_policy_loss([np.log(0.5)], [0.0], [1.0], clip_eps=0.2)
    assert np.allclose(loss2, [-0.8])

def test_kl_estimators():
    assert np.allclose(kl_k1([0.0], [-1.0]), [-1.0])          # ref - logp
    # k3 = exp(ref-logp) - (ref-logp) - 1；ref-logp=-1 → e^-1 +1 -1
    assert np.allclose(kl_k3([0.0], [-1.0]), [np.exp(-1.0)])
    assert np.allclose(kl_k3([0.0], [0.0]), [0.0])            # 相等→0
    # k3 恒非负
    assert (kl_k3([-2.0, 1.0, 3.0], [0.0, 0.0, 0.0]) >= 0).all()

def test_masked_mean_ignores_padding():
    assert masked_mean([1.0, 5.0, 100.0], [1, 1, 0]) == 3.0
    assert masked_mean([1.0, 2.0], [0, 0]) == 0.0             # 全 mask 防 0 除

def test_grpo_loss_combines_pg_and_kl():
    # 2 token，mask 掉第 2 个；ratio=1、kl=0 → 纯 PG 项
    total = grpo_loss(
        logprobs=[0.0, 9.0], old_logprobs=[0.0, 0.0],
        ref_logprobs=[0.0, 0.0], advantages=[1.0, -1.0],
        response_mask=[1, 0], kl_beta=0.04)
    assert np.allclose(total, -1.0)
    # 加 KL：kl_beta * k3(ref-logp=-1) = 0.04 * e^-1
    total2 = grpo_loss(
        logprobs=[0.0], old_logprobs=[0.0], ref_logprobs=[-1.0],
        advantages=[0.0], response_mask=[1], kl_beta=0.04)
    assert np.allclose(total2, 0.04 * np.exp(-1.0))
```

- [ ] **Step 2: 跑测试确认失败**（新增 5 FAIL，ImportError）

- [ ] **Step 3: 最小实现（追加到 core_algos.py）**

```python
def clipped_policy_loss(logprobs, old_logprobs, advantages, *,
                        clip_eps: float = 0.2) -> np.ndarray:
    """PPO 式 clip surrogate（GRPO 无 critic，无 value 项）。返回 per-token loss。"""
    logp = np.asarray(logprobs, dtype=np.float64)
    old = np.asarray(old_logprobs, dtype=np.float64)
    adv = np.asarray(advantages, dtype=np.float64)
    ratio = np.exp(logp - old)
    surr1 = ratio * adv
    surr2 = np.clip(ratio, 1 - clip_eps, 1 + clip_eps) * adv
    return -np.minimum(surr1, surr2)


def kl_k1(logprobs, ref_logprobs) -> np.ndarray:
    """朴素 KL 估计 k1 = ref - logp（可负，高方差）。"""
    return np.asarray(ref_logprobs, dtype=np.float64) - np.asarray(logprobs, dtype=np.float64)


def kl_k3(logprobs, ref_logprobs) -> np.ndarray:
    """低方差无偏 k3 = exp(ref-logp) - (ref-logp) - 1，恒非负（verl 默认）。"""
    d = np.asarray(ref_logprobs, dtype=np.float64) - np.asarray(logprobs, dtype=np.float64)
    return np.exp(d) - d - 1.0


def masked_mean(values, mask) -> float:
    """token 级掩码均值（response_mask 忽略 padding/prompt 段）。"""
    m = np.asarray(mask, dtype=np.float64)
    v = np.asarray(values, dtype=np.float64)
    return float((v * m).sum() / max(m.sum(), 1.0))


def grpo_loss(logprobs, old_logprobs, ref_logprobs, advantages, response_mask, *,
              clip_eps: float = 0.2, kl_beta: float = 0.0,
              kl_estimator=kl_k3) -> float:
    """GRPO 总损失 = masked_mean( clip PG + beta * KL )。"""
    pg = clipped_policy_loss(logprobs, old_logprobs, advantages, clip_eps=clip_eps)
    if kl_beta:
        kl = kl_estimator(logprobs, ref_logprobs)
        return masked_mean(pg + kl_beta * kl, response_mask)
    return masked_mean(pg, response_mask)
```

- [ ] **Step 4: 跑测试确认通过**（10 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/core_algos.py tests/rl/test_core_algos.py
git commit -m "feat(rl): clipped policy loss + KL estimators + combined GRPO loss"
```

---

### Task 3: Bandit 闭环——Milestone 0 验收门

**Files:**
- Test: `tests/rl/test_core_algos.py`（追加，纯测试无新实现）

**意义:** 用 `grpo_loss` 对 4 臂 bandit 做有限差分梯度下降，多轮后最优臂胜出——证明移植的数学**组合起来真的能学**，这是 M0 的验收门（对应"复现不了就停下来"纪律的 CPU 版前置）。

- [ ] **Step 1: 写测试（追加）**

```python
def test_bandit_learns_best_arm_via_grpo_loss():
    """端到端 sanity：最小化 grpo_loss ⇔ 策略向高 reward 动作倾斜。"""
    rng = np.random.default_rng(0)
    K, G, iters, lr = 4, 8, 60, 2.0
    arm_values = np.array([0.0, 0.2, 0.8, 1.0])
    logits = np.zeros(K)

    def probs_of(z):
        e = np.exp(z - z.max())
        return e / e.sum()

    for _ in range(iters):
        probs = probs_of(logits)
        actions = rng.choice(K, size=G, p=probs)
        rewards = arm_values[actions]
        adv = grpo_outcome_advantage(rewards, group_size=G)

        def loss_fn(z):
            p = probs_of(z)
            lp = np.log(p)[actions]              # on-policy: old=cur → ratio=1
            return grpo_loss(lp, lp, lp, adv, np.ones(G))

        # 中心有限差分求 logits 梯度
        grad = np.zeros(K)
        for k in range(K):
            h = 1e-5
            zp, zm = logits.copy(), logits.copy()
            zp[k] += h; zm[k] -= h
            grad[k] = (loss_fn(zp) - loss_fn(zm)) / (2 * h)
        logits -= lr * grad

    final = probs_of(logits)
    assert final.argmax() == 3                   # 最优臂胜出
    assert final[3] > 0.4                        # 且明显占优
```

- [ ] **Step 2: 跑测试确认通过**（11 PASS；若 argmax 断言因采样随机性偶发失败，可加大 iters 或固定后校验——seed 已固定，通过即稳定）

- [ ] **Step 3: 全量回归 + Commit**

```bash
python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q
git add tests/rl/test_core_algos.py
git commit -m "test(rl): M0 gate — bandit loop learns through grpo_loss (end-to-end sanity)"
```

---

## 完成后（父代理汇报用）
- M0 完成 = core_algos 三件套全绿 + bandit 闭环过门
- 下一步：SP10（torch 训练核，需先确认目标机器 torch/vllm 环境——本机是 macOS 无 CUDA，SP10 的 GPU 部分须在用户的 8 卡机上跑，CPU 可先行写主循环骨架）
