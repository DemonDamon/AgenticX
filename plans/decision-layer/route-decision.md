# 判断层战役 Go/No-Go 路线决策报告

> 生成: decision_route_report.py
> 框架: [MASTER-PLAN.md](MASTER-PLAN.md) 第五节；判据见下文

## 1. 证据汇总

| 维度 | 数字 | 来源 |
|---|---|---|
| 零样本 tool_selection top1 / ECE | 1.0 / 0.0  | SP26 基线（test 切分） |
| 域内 tool_selection 数据形态 | 1259 决策点 100% 单候选（bash-only），top1=1.0 为退化短路，零信息 | SP26 实测 |
| 合成多工具管线验证 | 0.8B/4B top1 均 0.45（无语义信号，仅证协议兼容） | SP26 |
| gating A/B forest | 12 tasks / 30 attempts | SP27 回放 |
| continue_stop teacher 标签 | 1066 条（startlux:StartLux-Decision-4B-Q4_K_M:systemone） | SP27/SP28 补标 |

## 2. 判据（真实分布定标）

- train 区为准（held-out 只验收，不参与选择）；跨 seed 全距一半作噪声带
- 部署线：pass_rate 不降出噪声带 且 成本节省 >5%
- 自训线：teacher 标签达千级且持续积累

## 3. 判定

**路线结论: 负结果（伤成功率）**

- decision_head_tau0.6 train pass_rate 0.665 低于 never_abort 0.829（超出噪声带 ±0.066）——公开头零样本在域内 continue_stop state 上会错杀有效尝试

**SP29 自训立项门槛**: 自训门槛：teacher 标签 1066 条（已达 千级线；积累速率 = 每次 gating A/B prewarm 可产 ~1.2 万条 attempt-0 标签）

**采集侧动作（兜底也是结论）**:
- SP25 采集优先级上调 multi-tool harness（tool_selection 域内退化已证）
- continue_stop 标签随每次回放评测自然积累（eval_gating_ab.py --dump-decisions）
- error_classification 是零候选依赖的次优决策类型，SP25 可低成本加采

## 4. 三路线对照（第五节框架）

| 路线 | 条件 | 当前证据 |
|---|---|---|
| A 直接部署公开头 | gating 无显著下降 + 可测节省 | 不满足（见判定） |
| B 自训 SP29+ 立项 | 零样本不足 + 千级标签持续积累 | teacher 标签 1066 条（已达 千级线；积累速率 = 每次 gating A/B prewarm 可产 ~1.2 万条 attempt-0 标签） |
| C 混合 | A 兜底冷启动 + B 攻高价值类型 | 视 A/B 判定组合 |

> 许可提醒: StartLux-Decision weights 为 CC BY-NC 4.0（研究可用，商用需授权）；推理代码 Apache-2.0。路线 A 若涉商用需先过许可。
