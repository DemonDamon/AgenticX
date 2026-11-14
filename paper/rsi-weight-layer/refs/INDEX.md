# RSI / Agent Harness 参考库索引

> 采集于 2026-11-14。来源：arXiv HTML 版（文本完整、体积小）→ Markdown。
> 本地全文在 `papers/`，可克隆的官方实现在 `repos/`（已 gitignore，不入库）。
> 重新拉取：`python3 fetch_arxiv_md.py`（幂等，已存在则跳过）。

## P0 必读：直接决定我们的方法设计

| 论文 | arXiv | 本地 | 仓库 | 一句话 | 对我们 |
|---|---|---|---|---|---|
| Terminal-RSI | 2610.22192 | [md](papers/2610.22192-terminal-rsi.md) | [Terminal-RSI](repos/Terminal-RSI) | 27B，RSR↔RPR 交替五阶段，四基准均值 50.58%（+29.9pp） | 最直接的对照：我们 §2 的 RSR 已被做成闭环。要吸收 TB-GAE / FDR / SPR |
| HASE | 2607.03935 | [md](papers/2607.03935-hase.md) | — | 单模型多轮动作空间内同时解题与改 harness，Qwen3-8B 追平 120B+Claude Code | 8B 可行性的关键证据；harness 编辑按 PoC 给信用的奖励设计 |
| AutoEnvScaling | 2610.14163 | [md](papers/2610.14163-autoenvscaling.md) | [AutoEnvScaling](repos/AutoEnvScaling) | proposer 在沙箱造环境，valid-env 率 25×、成本 -75%，TB4.0 1.6→3.2 | 任务池的下一代形态：从静态 3698 → 自造环境 |
| VERA | 2610.05923 | [md](papers/2610.05923-vera.md) | VERACode（克隆失败，需手动） | 9000+ 长程可验证环境；9B 与 27B 两档 +10.3/+13.0 | 8B/27B 双档决策的外部对照；rubric+可执行 check+judge 三关准入 |
| Harness-S | 2611.04277 | [md](papers/2611.04277-harness-s.md) | [Harness-S](repos/Harness-S) | 兄弟 harness 仅在 base 全失败时 rescue，蒸馏回单一 policy | 与我们「多 LoRA 专家 + Adapter 一等公民」路线同构 |

## P1 值得读：能改进具体模块

| 论文 | arXiv | 本地 | 仓库 | 对我们 |
|---|---|---|---|---|
| Self-Evolving Agent Harness | 2610.18813 | [md](papers/2610.18813-self-evolving-agent-harness.md) | [Harness-RSI](repos/Harness-RSI) | PAC 界 + 带回归预算的保留界 + fresh-validation 准入；§5.4 门控的更强理论版 |
| HarnessEvolve | 2609.00829 | [md](papers/2609.00829-harnessevolve.md) | — | reference trajectory 做 credit assignment；quality gate 防数据泄漏 |
| Harness Updating ≠ Harness Benefit | 2605.30621 | [md](papers/2605.30621-harness-update-vs-benefit.md) | [a-evolve](repos/a-evolve) | updating 与基座能力无关；benefit 非单调、中档最大 → 决定主模型档位 |
| HarnessMM | 2610.32813 | [md](papers/2610.32813-harnessmm.md) | [HarnessMM](repos/HarnessMM) | harness token 效率 RSI；DeepSeek harness 上 token -88% |
| EvoTrainer | 2606.03108 | [md](papers/2606.03108-evotrainer.md) | — | 共同进化 policy 与「训练侧 harness」（诊断器/回测/技能库） |
| Self-Harness | 2606.09498 | [md](papers/2606.09498-self-harness.md) | [Self-Harness](repos/Self-Harness) | Weakness Mining → Proposal → Validation，方法极简可搬 |
| SIA | 2605.27276 | [md](papers/2605.27276-sia.md) | — | 最早明确「harness 与权重两个 silo 要合并」，双杠杆 > 单 scaffold |
| MaD-RSI | 2610.28201 | [md](papers/2610.28201-mad-rsi.md) | — | 模型当数据、共享 harness 跨异构 LLM；提示做跨模型迁移检验 |
| Environment Evolution | 2609.04128 | [md](papers/2609.04128-environment-evolution.md) | — | off-policy 递增难度环境谱系，27B/35B TB2.1 +14.4/+18.0 |
| RSIHub | 2610.32253 | [md](papers/2610.32253-rsihub.md) | [RSIHub](repos/RSIHub) | 统一复现 AHE/A-Evolve/GEPA；增益不总迁移到 held-out → 现成 baseline 脚手架 |

## P2 知道即可

| 论文 | arXiv | 本地 | 仓库 |
|---|---|---|---|
| Ouroboros | 2608.08311 | [md](papers/2608.08311-ouroboros.md) | [ouroboros](repos/ouroboros) |
| Grow the Harness, Not the Context | 2609.26760 | [md](papers/2609.26760-grow-the-harness.md) | — |
| HSI（三层 scope） | 2608.08466 | [md](papers/2608.08466-hsi.md) | [hsi](repos/hsi) |
| The Last AI Built by Humans | 2609.11873 | [md](papers/2609.11873-last-ai-built-by-humans.md) | — |
| Harness Evolution as Learning | 2609.36892 | [md](papers/2609.36892-harness-evolution-as-learning.md) | [self-evolving-harness-as-learning](repos/self-evolving-harness-as-learning) |

## 已吸收 / 已在论文中的基线

| 论文 | arXiv | 本地 | 仓库 |
|---|---|---|---|
| Harness²（Google） | 2610.14224 | [md](papers/2610.14224-harness2.md) | [harness2](repos/harness2) |
| AIDE² | 2609.26457 | [md](papers/2609.26457-aide2.md) | — |
| SETA | 2607.10891 | [md](papers/2607.10891-seta.md) | [seta](repos/seta) |
| RSR（腾讯混元） | 2610.02826 | [md](papers/2610.02826-rsr.md) | — |
| REUSE | 2609.33180 | [md](papers/2609.33180-reuse.md) | — |
| RSIGym | 2610.10310 | [md](papers/2610.10310-rsigym.md) | [RSIGym](repos/RSIGym) |

## 附：社区维护的 RSI 论文清单

- [awesome-rsi](repos/awesome-rsi) — 持续更新的 RSI 论文/项目汇总，适合每月扫一遍增量。

## 未纳入

- Flex-RSI（2611.08946）、RegenHarness（2609.27612）：视觉/具身，按要求跳过。
- SwarmRSI（2610.20431）、RSI-Dojo（2611.03698）、上海 AI Lab agent 安全自进化（2608.09885）：边缘相关，需要时再拉。
