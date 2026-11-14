# AgenticX RSI 训练说明书

> 版本 v0.1 · 2026-11-14 · 分支 `feat/rsi-data-flywheel`
> 读者：要在这台 8×B300 上跑 RSI 训练的人
> 定位：本文件既是训练操作手册，也是论文 §6-7 与技术推文的源稿

**配套资产**

- 实验跟踪表（每个 run 一行，含指标与门控日志）：[AgenticX RSI 实验跟踪表](https://wv18cbjmgi0.feishu.cn/sheets/PF0cswwsUhMHUUtP70sc2dzwnFb)
- 实验流程图：见本文档 §4.3 后的画板

---

## 0. 一页看懂

| 项 | 结论 |
|---|---|
| 训练什么 | Qwen3.8-27B + LoRA(r=64)，GRPO 闭环自我改进 |
| 用什么卡 | 8×B300（288GB/卡，合计 2304GB） |
| 怎么切 | rollout 6 卡（vLLM TP=3×2 副本）+ 训练 2 卡 |
| 数据 | 3698 题池，按实测墙钟分 short/medium/long；训练只用 short+medium，long 只进评测 |
| 考试 | 12 题 Terminal-Bench 4.0 held-out，代码守卫硬隔离 |
| 主实验 | 4 臂 × 3 seed，评测指标 5 个（含假晋升率） |
| 预计时长 | 短任务配方 ≈ 17h/run；8 个 run ≈ 6 天（含排队与重跑余量） |
| 最大风险 | B300 是 sm_103，vLLM/SGLang 预编译轮子可能不覆盖 |

---

## 1. 论文定位（为什么这么设计实验）

2026 年 7-11 月，Agent Harness RSI 已经跑出 20+ 篇，主流是 **harness 与权重联合进化**（HASE、SIA、VERA、EvoTrainer、AutoEnvScaling、Terminal-RSI、Harness-S）。"我们做权重层 RSI"不再是差异点。

本工作的主张改成：

> **自我改进的收益，只能和允许它晋升的那条规则一样可信。**
> Self-improvement gains are only as trustworthy as the promotion rule that admits them.

三个可被审稿人检验的贡献：

1. **真实权重层闭环里的假晋升率审计**。REUSE 只给了理论与模拟；我们第一次在真实 GRPO 训练循环里用全局 α 预算实测假晋升率。
2. **成本归一化的 RSI-Index**。同行报 +pp，我们报「每 GPU-hour 换多少 RSI-Index」。
3. **权重一起变时，harness-benefit 的非单调性是否仍成立**（承接 arXiv:2605.30621 的 harness-only 结论）。

三条纪律当卖点而非脚注：全池零 LLM-judge、12 题硬隔离无 bypass、hacking 率与污染率双观测。

---

## 2. 数据工程

### 2.1 数据来源与规模

| 域 | 数量 | 判分方式 | 来源 |
|---|---|---|---|
| code | 2,698 | test_patch + test_command（容器内真实执行） | MiMo SWE 任务 |
| cyber | 1,000 | 镜像内规则型 verifier | ARVO 漏洞复现 |
| 合计 | 3,698 | 全部 executable / rule，**零 LLM-judge** | — |

评测集：Terminal-Bench 4.0 的 12 题 held-out，永久排除于训练。守卫在 `agenticx/learning/trajectory/task_split.py:assert_trainable_task`，无 bypass 开关。

### 2.2 分层规则

终端任务的单 episode 墙钟跨度极大（实测 514s ~ 11802s），直接混采会让一个 GRPO step 被长尾拖死。按实测墙钟分三层：

| 层 | 阈值 | 用途 |
|---|---|---|
| short | < 900s | 训练主力，保证一步能在 20 分钟内走完 |
| medium | 900–1800s | 训练次主力，占比小 |
| long | > 1800s | **只进评测**，不进训练 |
| unmeasured | 未采到墙钟 | 单列，需先做长度探测 |

分层由 `agenticx/learning/trajectory/train_manifest.py` 实现，`collect_durations()` 从 `results/*/summary.json` 聚合多轮中位数。

### 2.3 manifest 字段

```json
{
  "seed": "tb40-v1",
  "thresholds": {"short_max": 900, "medium_max": 1800},
  "summary": {"train": 12, "eval": 12, "short": 4, "medium": 4,
               "long": 4, "unmeasured": 3686, "excluded": {}},
  "tiers":   {"short": [...], "medium": [...], "long": [...], "unmeasured": [...]},
  "train":   [...],
  "eval":    [...],          // 12 题 held-out，永不进 train
  "observed": {"task": {"wall_seconds": 1196.0, "samples": 1, "reward": 1.0}}
}
```

三条硬规则（均有测试覆盖）：

1. held-out 先经 `normalize_task_id` 归一化再比对——harbor 的 `terminal-bench/xxx` 前缀曾导致守卫漏配；
2. 未实测任务单列，不静默混入；
3. 输出可复现：排序稳定、采样显式 seed。

### 2.4 长度探测（开训前必须做）

当前只有 12 题有实测墙钟，3686 题未实测。开训前必须补测：

- 从 `unmeasured` 里按域分层抽 200 题，用**最便宜的模型**（DS V4.1 Flash API）跑单 seed，只记 `wall_seconds` 与 reward，不看效果；
- 预计成本 ¥150–250，一次性；
- 产出回填后重跑 `build_rsi_manifest.py`，short 层应达到 60–100 题量级。

**不做这一步就开训，等于把 30% 的算力花在 3 小时长的任务上。**

### 2.5 轨迹纯净度

两类样本段携带 harness 干预信号，训练时必须 loss mask 或降权：

- hints 注入段（SP22 三态门控激活时的经验摘要）；
- 经验回放段（M4 replay shaping 的历史片段）。

每步统计**污染率**（干预段 token 占比），与 hacking 率并列为训练数据质量的两个观测维度。参考 RSR 的教训：源轨迹中 29.6% 的 harness 私有命令直接 SFT 会让 TB2 倒退 7.9pp。

---

## 3. 算力方案

### 3.1 显存账

| 方案 | 占用 | 判断 |
|---|---|---|
| 27B BF16 权重 | 54GB | 基准 |
| LoRA r=64（adapter+优化器） | ~2GB | 可忽略 |
| 全参 GRPO（BF16+AdamW） | 432GB | 需 ZeRO-3，吃掉一半长上下文空间 |
| 全参 + Critic（PPO） | ~864GB | 不采用，这也是选 GRPO 的理由 |

**第一轮只做 LoRA。** 结构优势：每轮飞轮只同步 MB 级 adapter，不做 54GB 全量重载。

### 3.2 拓扑

```
GPU 0-5  rollout：vLLM，TP=3，2 副本，max_model_len=32768
GPU 6-7  training：FSDP + LoRA + 梯度检查点
权重同步：每步只推 adapter
```

### 3.3 吞吐估算

单序列 KV ≈ 256KB/token（64 层 × 8 KV heads × head_dim 128 × 2 × 2B），32k 上下文 ≈ 8GB。

| 训练集 | 假设单 episode | 并发 | 吞吐 | 64 条/步 → 步时长 |
|---|---|---|---|---|
| 全部混采 | 25 min | 30 | 72 ep/h | 3.4 h |
| short 为主 | 8 min | 30 | 225 ep/h | 17 min |

这就是为什么必须先做长度分层。

### 3.4 B300 特有问题

B300 是 Blackwell Ultra，compute capability **sm_103**。开训前第一件事是在目标机上跑：

```bash
python3 scripts/rsi_preflight.py
```

它会打印 GPU 型号、capability、显存合计、vllm 版本、数据隔离状态、磁盘余量。若 sm_103 不在 vLLM 支持列表内，需要自编译或降级到可用的推理后端——**这一步不通，后面全部白搭**。

---

## 4. 代码工程准备

### 4.1 已完成

| 文件 | 作用 |
|---|---|
| `agenticx/learning/trajectory/train_manifest.py` | 分层 manifest、课程顺序、held-out 归一化隔离 |
| `scripts/build_rsi_manifest.py` | 从 calibration 结果聚合墙钟并落盘 |
| `scripts/rsi_preflight.py` | 算力/框架/数据/磁盘四类自检 |
| `configs/rsi/grpo_lora_27b.yaml` | 27B LoRA + GRPO + SPR + 全局 α 预算 配置模板 |
| `agenticx/learning/rsi_index.py` | RSI-Index 归一化增益 |
| `agenticx/learning/attribution.py` | 决策步信用归因账本 |
| `agenticx/learning/verifier_drift.py` | 判分漂移四指标 |
| `agenticx/learning/gap_dispatch.py` | 失败聚类与缺口派发 |
| `agenticx/learning/trajectory/replay_spans.py` | 选择性重放区间派生 |
| `agenticx/trainer/adapters.py` | Adapter 注册表（租户命名空间） |
| `agenticx/ops/rsi_slo.py` | SLO 指标与报告 |
| `agenticx/rl/promotion_gate.py` | 晋升门控：全局 α 预算 + gate.json 账本 + 二值精确符号检验 |
| `agenticx/rl/spr.py` | SPR 奖励层：strict/partial 分离，λ 0.5→0.1，harbor partial credit 提取 |
| `agenticx/rl/contamination.py` | 污染率埋点：干预 token 占比的训练侧聚合 |
| `agenticx/rl/promotion_audit.py` | 假晋升率审计：零假设置换检验（FPR vs 名义 α） |
| `agenticx/learning/trajectory/length_probe.py` + `scripts/probe_task_lengths.py` | 长度探测：分层抽样 + 断点续跑 + calibration 格式回填 |

### 4.2 待完成（按优先级）

1. **训练后端接入**（唯一剩余项）：打通「harbor rollout → TokenRollout → GRPO 更新 → adapter 热同步」的 27B 全链路。四个纯逻辑件（门控/SPR/污染率/审计）已就位并有测试，剩下的是把它们接进 27B 训练循环——依赖后端选型决策（自研 GRPOTrainer 打底 vs 接 verl/AReaL/slime）与目标机 preflight 通过；
2. **长度探测执行**：脚本就绪，需要在**目标训练机**上跑 200 题（跨架构墙钟不可比，本机 qemu 容器测出的值会污染分层阈值）。

> 前置就绪判定：`python3 -m pytest tests/rl/test_promotion_gate.py tests/rl/test_spr.py tests/rl/test_contamination.py tests/rl/test_promotion_audit.py tests/trajectory/test_length_probe.py -q` → 49 通过。

### 4.3 启动顺序

```bash
# 1. 自检
python3 scripts/rsi_preflight.py

# 2. 生成 manifest
python3 scripts/build_rsi_manifest.py --exclude-solved

# 3. 长度探测（若有 unmeasured）
#    → 回填 results/ 后重跑第 2 步

# 4. 单任务冒烟：short 层抽 1 题，走完 rollout→reward→update→sync
# 5. 小规模跑 5 步，确认吞吐与显存
# 6. 正式开训
```

---

## 5. 实验矩阵

| 臂 | 内容 | seeds | 目的 |
|---|---|---|---|
| W | 纯 GRPO（只改权重） | 3 | 下界基线 |
| W+T | + 轨迹重写（RSR 式） | 1 | 归因：轨迹重写贡献多少 |
| W+T+H | + harness 共同进化（hints/skills） | 1 | 归因：harness 贡献多少 |
| W+T+H+G | + 完整性门控（α 预算/纯净度/SPR） | 3 | 主方法 |

评测：12 题 held-out TB4.0 + TB2.1 公开子集（对外可比）。

指标（缺一不可）：

| 指标 | 定义 |
|---|---|
| held-out 通过率 | 12 题 strict pass |
| RSI-Index | (final − initial) / (1 − initial) |
| 假晋升率 | 零假设下门控误接受比例 |
| hacking 率 | patch 冲突标记数 / 总 trial 数 |
| 污染率 | 干预段 token / 总训练 token |
| tokens/task | 单任务平均 token（效率） |
| GPU-hours/pp | 每提升 1pp 消耗的 GPU 小时 |

---

## 6. 时长与预算

| Run | 步数 | 步时长 | 墙钟 |
|---|---|---|---|
| 单 run（short 配方） | 60 | 17 min | ~17 h |
| 主对比 W ×3 + G ×3 | — | — | ~102 h |
| 归因臂 ×2 | — | — | ~34 h |
| 重跑/失败余量 | — | — | ~30 h |
| **合计** | | | **~166 h ≈ 7 天** |

节省手段（按优先级）：减 group_size（8→4）、减每步任务数、缩短 episode 上限、先用 medium 替换部分 long。

---

## 7. 数学原理

### 7.1 GRPO 目标

同一任务采样 $G$ 条轨迹，用组内均值做基线，不需要 critic：

$$
\mathcal{J}(\theta)=\mathbb{E}\left[\frac{1}{G}\sum_{i=1}^{G}\frac{1}{|o_i|}\sum_{t=1}^{|o_i|}
\min\left(r_{i,t}\hat{A}_i,\ \mathrm{clip}(r_{i,t},1-\epsilon,1+\epsilon)\hat{A}_i\right)\right],
\quad r_{i,t}=\frac{\pi_\theta(o_{i,t}\mid h_{i,t})}{\pi_{\theta_{old}}(o_{i,t}\mid h_{i,t})}
$$

$$
\hat{A}_i=\frac{R_i-\mathrm{mean}(R_{1:G})}{\mathrm{std}(R_{1:G})}
$$

选 GRPO 而非 PPO 的直接原因：省掉一份 27B critic，显存与实现复杂度都减半。

### 7.2 ARVO 惩罚

$$
R_i = R_i^{\text{verifier}} - \kappa_e \cdot n_i^{\text{err}} - \kappa_l \cdot \frac{L_i-\bar{L}}{\sigma_L}
$$

$\kappa_e=\kappa_l=2$ 为默认。第一项惩罚工具调用错误，第二项惩罚组内长度离群，抑制「刷步数」行为。

### 7.3 SPR 部分信用（Success-Prioritized Reward）

$$
R_i = S_i + (1-S_i)\,\lambda_t\, p_i,\qquad \lambda_t:\ 0.5 \rightarrow 0.1
$$

$S_i\in\{0,1\}$ 是严格通过，$p_i\in[0,1]$ 是 verifier 检查点完成比例。严格通过钉死满分、部分信用只给失败轨迹——这是 Terminal-RSI 线性混合 $R=(1-\lambda)S+\lambda p$ 的保守变体：终判已过但个别子检查未走全时，线性混合会罚掉已验证的成功，与 success-prioritized 语义矛盾；失败轨迹上两者等价（都剩 $\lambda p$）。前段给部分信用保探索，后段压低迫使收敛到严格通过。Terminal-RSI 实测该机制把失败轨迹的奖励占比从 50.09% 压到 28.72%。实现在 `agenticx/rl/spr.py`。

### 7.4 RSI-Index

$$
\mathrm{RSI\text{-}Index}=\frac{\text{final}-\text{initial}}{1-\text{initial}}
$$

归一化到「剩余空间被填了多少」。40%→43% 得 0.05，90%→93% 得 0.30——同样的 +3pp，含金量差 6 倍。跨任务集、跨版本可比。

成本归一版本：

$$
\mathrm{RSI\text{-}Index}_{\mathrm{cost}}=\frac{\mathrm{RSI\text{-}Index}}{\text{GPU-hours}}
$$

这是我们的第二个贡献：让「涨了多少」和「花了多少」同时进入分母。

### 7.5 REUSE 的全局 α 预算

逐轮独立用 $\alpha=0.1$ 会在多轮飞轮中膨胀假阳性。按 REUSE 的分配：

$$
\alpha_{t,p}=w_t\cdot v_p\cdot \alpha,\qquad \sum_t w_t=1,\ \sum_p v_p=1
$$

第 $t$ 轮第 $p$ 次晋升的有效显著性水平从全局预算中扣减，扣减记录写 `gate.json`。

配对二值结果下，Wilcoxon 退化为精确符号检验：

$$
p=2\sum_{k=n_+}^{M}\binom{M}{k}0.5^{M}
$$

$M$ 为非零配对对数，$n_+$ 为提升方向的翻转数。我们首轮干预实验 $n_+=3,\ n_-=2$，$p=1.0$，门控拒绝——这是管线正确性的证据，不是失败。

### 7.6 保留界（Harness-RSI 的 PAC 视角）

在「历史回归预算」约束下，若每次晋升都在**fresh 独立验证集**上评估，则被接受的修订在概率 $1-\delta$ 下满足泛化不退化。工程含义只有一句：**校准集复用必须被预算约束，否则保留界不成立**——这正是全局 α 预算的理论依据。

### 7.7 假晋升率（我们的核心度量）

在零假设（新版本与旧版本同分布）下重复 $N$ 次门控决策，统计被误接受的比例：

$$
\mathrm{FPR}=\frac{1}{N}\sum_{k=1}^{N}\mathbb{1}\left[p_k<\alpha_{t_k,p_k}\right]
$$

理想值应接近名义 $\alpha$。REUSE 实测现有 RSI 系统可达 20.7%，我们把它作为主实验的一等指标。

---

## 8. 风险与回滚

| 风险 | 触发信号 | 处置 |
|---|---|---|
| sm_103 不支持 | preflight 报 capability 异常 / vLLM 加载失败 | 自编译或换后端，暂停训练 |
| 长尾吃并发 | 步时长 > 40 min | 收紧 episode 超时到 20 min，long 层全部移出训练 |
| reward 饱和 | 通过率 > 80% 持续 5 步 | 换更难任务，或提高 SPR 的 λ 衰减末值 |
| reward 消失 | 通过率 < 5% 持续 5 步 | 回退到 short 层，检查任务是否超出模型能力 |
| 假晋升失控 | FPR > 2×名义 α | 冻结晋升，检查 α 预算扣减是否生效 |
| adapter 同步失败 | 训练侧更新后 rollout 行为不变 | 检查是否退化成全量重载 |

回滚：每个 run 的 adapter 按轮次版本化存 `runs/rsi-27b/adapters/`，`AdapterRegistry.rollback()` 一键回到上一轮。

---

## 9. 复现命令

```bash
git checkout feat/rsi-data-flywheel
python3 scripts/rsi_preflight.py
python3 scripts/build_rsi_manifest.py --exclude-solved
python3 scripts/verifier_drift_report.py
python3 scripts/rsi_slo_report.py --baseline-intervention 0.5
```

测试：

```bash
python3 -m pytest tests/trajectory/ tests/rl/ -q
```

---

## 10. 参考资料

见 `paper/rsi-weight-layer/refs/INDEX.md`（26 篇分级索引）。最直接对标的五篇：

- Terminal-RSI（arXiv:2610.22192）——同基座、同基准，我们的外部参照
- HASE（2607.03935）——harness 编辑的信用分配
- Harness-S（2611.04277）——sibling harness rescue，对应我们的 LoRA 专家池
- VERA（2610.05923）——9B/27B 双档与「冻结一轴损失一半收益」
- RSIHub（2610.32253）——统一 baseline 脚手架，且证明增益不总迁移到 held-out
