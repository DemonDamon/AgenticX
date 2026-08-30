# TeamBench Pilot 实验报告（v2）

> 日期：2026-08-29
> 配置：DS v4 Flash（被测） · 15 任务 × 7 臂 × 3 seeds = 315 runs
> 花费：约 ¥12（余额 ¥83.85 → ¥71.98）
> 打分：scoring_v2 **v2.2**（内容感知 L1，见 §2 指标完整性事件）

## 1. 实验设置

**7 臂**：
- 朴素单体 `single`（1 次调用，v0.1 基线）
- 算力对齐单体 `single_refine_k` / `single_bon_k`（k 轮自修订 / best-of-k，调用数与团队对齐）
- 团队 4 种装配协议 `team_{last,concat,integrator,blackboard}`（同一批角色产出，仅装配方式不同）

**任务**：paper/tasks/data/v0.1 全部 15 个（5 办公类型 × 3 耦合度）。
**judge**：关闭（L3 禁用，L1/L2 重归一化，Q = 0.625·L1 + 0.375·L2）。

## 2. 指标完整性事件（本 pilot 的方法学发现）

首跑打分（v2.1 之前的 L1 只查标题存在性）中 `team_blackboard` 45/45 全部 Q=1.000——
但 41/45 含"（本节无内容）"空占位章节。blackboard 协议机械渲染全部规范章节标题，
**在不产生任何内容的情况下白拿 L1 满分**。

修复（scoring_v2 v2.2）：
1. L1 内容感知：章节命中要求标题匹配**且**正文非占位、规范化长度 ≥ 8；
2. 标准 markdown 章节语义：章节范围延伸到下一个同级/更高级标题或规范章节标题，
   子标题下的内容计入父章节；
3. 离线重打分：L1/L2 为确定性规则，315 个 run 免费重算，零 LLM 成本。

**教训（论文可写）**：自动装配协议会"结构性合规"地 gaming 结构性指标——
评测团队系统时，结构分必须绑定内容存在性检验。

## 3. 主结果（v2.2 打分）

| 臂 | Q_avg | Q_med | L1_avg | TR（token 比） |
|---|---|---|---|---|
| single | 0.692 | 0.688 | 0.508 | 1.00x |
| single_refine_k | 0.658 | 0.583 | 0.453 | 4.13x |
| single_bon_k | 0.681 | 0.583 | 0.489 | 4.17x |
| team_last | 0.548 | 0.531 | 0.276 | 1.12x |
| team_concat | 0.697 | 0.792 | 0.515 | 1.19x |
| **team_integrator** | **0.958** | **1.000** | **0.933** | 1.97x |
| team_blackboard | 0.579 | 0.583 | 0.326 | 1.19x |

配对统计（n=45，Wilcoxon 单侧 + Cliff's d，CTR 为配对几何均值）：

| 团队臂 | CTR_naive | CTR_matched(vs refine_k) | p | Cliff's d |
|---|---|---|---|---|
| team_last | 0.803 | 0.850 | 1.00 | −0.32 |
| team_concat | 1.014 | 1.074 | 0.55 | +0.02 |
| **team_integrator** | **1.450** | **1.536** | **6.3e−06** | **+0.59** |
| team_blackboard | 0.849 | 0.899 | 1.00 | −0.25 |

- integrator vs refine_k：p = 6.7e−07；vs bon_k：p = 9.6e−07
- CTR_matched bootstrap 95% CI：**[1.380, 1.727]**（不含 1）

## 4. 四个核心发现

**F1 装配协议是团队效能的主导变量。** 同一批角色产出，仅换装配方式，
Q 从 0.548（last）到 0.958（integrator）跨度 0.41，远大于其他任何因素。
v0.1 的"团队次优"结论（last, CTR=0.803）确证为装配 artifact。

**F2 团队优势无法用算力解释。** refine_k / bon_k 消耗 4.1x token 却得到
0.95x 质量（≤ 单次调用）；integrator 以 2.0x token 获得 1.45x 质量。
分工协作的信息增益 ≠ 更多采样/更多轮次。

**F3 机械装配全部失败，LLM 装配是唯一胜者。** concat（1.014）≈ 单体；
blackboard（0.849）甚至更差——机制已定位：角色用自由标题（如
"主文案撰写员（main）— 交付物"）而非规范章节名，机械槽位匹配失败，
内容被流放到"其他"章节（t-CONTENT-M-02 等任务 L1=0）。
只有 integrator 能做语义归一化 + 重组。

**F4 自我修订损害结构（反直觉负结果）。** refine_k（0.658）< single（0.692）：
k 轮自修订不升反降。单 agent 迭代不能替代角色分工。

## 5. 局限（诚实声明）

1. **L2 全部空转**：15 个 v0.1 任务无一携带 v2 断言 schema
   （expected_sets/values/counts + answer_block_schema），L2 恒为 1.0，
   **Q 差异完全由结构层（L1）驱动**。数值正确性尚未被检验。
2. 单模型（DS v4 Flash）、3 seeds、无 L3 judge。
3. CTR 数值（1.45）不可直接外推到多模型/正式实验；本 pilot 仅验证
   方向性与效应存在性。

## 6. 下一步（优先级序）

1. **任务迁移 v2 断言**（阻塞项）：15 任务 + generator 补
   answer_block_schema / expected_*，使 L2 真正生效；
2. 用迁移后任务重跑 pilot（~¥12），确认 F1/F2 在数值层是否保持；
3. 多模型（Kimi K3 等）+ L3 judge 正式实验；
4. blackboard 协议改进（支持粗体标题槽位）或明确报告为 negative result。

## 7. 工件

- 原始数据：`paper/experiments/v2/pilot_flash/`（315 run JSON，含 role_outputs）
- 汇总：`summary.jsonl` / `summary.csv` / `pairs.csv`（180 对）
- 离线重打分器：`paper/experiments/v2/rescore.py`
- 编排脚本：`paper/experiments/v2/run_pilot.sh`（断点续跑 + 余额守卫）
