# RSI 数据飞轮 P0 — Master Plan

> **For agentic workers:** 本目录下每个 sub plan 按顺序执行。推荐使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实施。所有步骤使用 checkbox（`- [ ]`）跟踪。

**分支:** `feat/rsi-data-flywheel`（基于 main @ a878b840）
**对齐文档:** 飞书《RSI 自进化智能体：切入场景与华为昇腾合作规划》P0 阶段（2026-09~10，零采购）
**目标:** 打通 ②采集→④蒸馏 的软件链路，搭起 ⑥回灌骨架，建立 ③评测隔离——使 TB 4.0 轨迹自动转化为训练资产，闭环的工程断链全部补上（硬件无关部分）。

## 六环闭环 → 本分支工作映射

| 环 | 现状 | 本分支交付 | Sub Plan |
|---|---|---|---|
| ① 执行 | 已有 | 不动 | — |
| ② 采集 | 雏形 | 统一轨迹 schema（含决策沿袭）+ harbor/session 双采集器 + 轨迹库 | SP1 |
| ③ 评测 | 已有 | held-out 任务隔离机制（训练/评测物理分离，防污染） | SP2-T1 |
| ④ 蒸馏 | 待建 | trainer/ 完整实现：质量评分、SFT/DPO 构建、脱敏去重、LLaMA-Factory 导出 | SP2 |
| ⑤ 训练 | 雏形 | 不动（envharness/rl 独立 conda 环境；TB→RL 环境适配属 P1，需 950PR 测试结果） | — |
| ⑥ 回灌 | 待建 | Stable Model ID 注册表 + 别名路由 + promote/rollback（骨架，无流量镜像） | SP3 |

## 数据源事实（已验证，规划据此设计）

- **harbor trial**（`harness-lab/jobs/<job>/<task>__<hash>/`）：
  - `agent/agenticx.trajectory.json` → `{agent, model, success, output, error, iterations, messages, totals}`
  - `result.json` → `verifier_result.rewards.reward`（0.0/1.0）、`task_name`、时间戳
  - `config.json` → task/agent/model 配置
- **AgenticX 会话**（`~/.agenticx/sessions/<session_id>/`）：`messages.json`、`agent_messages.json`、`context_stats.jsonl`、`tool_call_observations.json`（learning 启用时，`ObservationHook` 产出）
- **trainer/**：仅 0 字节 `__init__.py`
- **llm_factory.py**：`create_llm()` 按 `config.type` 路由 provider，无版本/注册概念

## Sub Plans（执行顺序即依赖顺序）

| # | 文件 | 内容 | 前置 |
|---|---|---|---|
| SP1 | [sp1-trajectory-pipeline.md](sp1-trajectory-pipeline.md) | ②采集层：RSITrajectory schema、harbor 采集器、session 采集器、轨迹库、CLI | — |
| SP2 | [sp2-distillation-trainer.md](sp2-distillation-trainer.md) | ④蒸馏层：held-out 隔离、质量评分、SFT/DPO 构建器、脱敏去重、导出、CLI | SP1 |
| SP3 | [sp3-backfill-registry.md](sp3-backfill-registry.md) | ⑥回灌骨架：ModelRegistry、别名解析、llm_factory 集成、CLI | — （与 SP2 可并行） |
| SP4 | [sp4-e2e-validation.md](sp4-e2e-validation.md) | 端到端验收：真实 jobs 数据跑通 collect→build→registry，dataset card，PR 准备 | SP1-SP3 |

## 设计原则（来自飞书文档 2.3 / 3.2 节，实现时必须遵守）

1. **决策沿袭采集**：轨迹不是 (输入,输出,reward) 三元组——必须记录 `decision_lineage`（知识引用、工具调用序列、验证步骤、修正事件）
2. **复合 Reward schema**：`RewardRecord(label, source, components)` 从第一天就支持 verifier/user/composite 三源（P0 只填 verifier，schema 为运营商场景预留）
3. **Stable Model ID**：产品侧引用 `agent-carrier-v1` 这类别名，具体权重版本由注册表路由——"模型持续变强，接口永远不变"
4. **训练/评测物理隔离**：held-out 任务在数据集构建时被硬性排除，构建器遇 held-out 任务必须拒绝

## 验收标准（SP4 端到端）

```bash
# 一条命令链跑通数据飞轮
python -m agenticx.learning.trajectory collect --source harbor --jobs-dir harness-lab/jobs
python -m agenticx.trainer build --format sft --out datasets/tb40-sft-v1
python -m agenticx.trainer registry register agent-coding-v1 --model openai/glm-5.3-flash
python -m agenticx.trainer registry promote agent-coding-v1
```

- 产出的 SFT 数据集可被 LLaMA-Factory 直接加载（sharegpt 格式 + dataset_info.json）
- 数据集 card 记录：样本数、来源分布、held-out 排除清单、脱敏统计
- `resolve("agent-coding-v1")` 返回 promoted 版本的具体模型 spec
- 全部单测通过；构建器在 held-out 任务上抛错（防污染守卫生效）

## P0.5 阶段：对齐 Dream-RSI（arXiv 2609.14858）的回放式策略演化

P0 完成后（PR #54），基于已落地的 TrajectoryStore 增设回放模拟器与策略演化能力。设计映射与决策：

| 论文组件 | 本仓库等价物 | Sub Plan |
|---|---|---|
| 发现树持久化 | TrialForest（任务→attempt 森林 + 逐步特征；不做文件快照） | SP5 |
| Replay Simulator（Evolving World） | ReplayAttempt/evaluate_policy（零推理成本回放 + continue/abort 动作） | SP6 |
| 探索策略 + 固定基线 | Policy 协议 + never_abort（论文基线）+ 3 个早停启发式；train/held-out 双区报告 | SP7 |
| Dreaming-based Policy Improvement | evolve_loop：提议（LLM/变异）→回放评分→择优 promote；PolicyRegistry 版本化 | SP8 |

- 动作空间 P0.5 = {continue, abort}；fork/switch 需工作区快照，属 P1
- 演化评分只允许绑定 train 区任务树（复用 SP2 held-out 隔离）；held-out 仅作验收报告
- 分支：继续用 `feat/rsi-data-flywheel`（P0 PR 合入前在同一分支追加，或视 PR 状态切新分支——以执行时 git 状态为准）

## 明确不做（YAGNI / 属后续阶段）

- 运营商场景采集器（P0 用 TB 4.0 内部验证场，场景切换在 harness-lab 适配后）
- TB 4.0 → verl-agent RL 环境（P1，需 950PR 实测后决策）
- 流量镜像/真实灰度切流（P2，Enterprise Gateway 落地时）
- 实际训练执行（P2，硬件到位后）
