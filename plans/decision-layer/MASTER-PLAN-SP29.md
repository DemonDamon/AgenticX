# SP29 决策头自训 Master Plan（路线 B 兑现 + 采集侧扩容）

> **定位：** 判断层战役第二期。SP26-28 已证：公开头零样本不可部署（路线 A 证伪，
> 16.4pt 成功率损失换 0.2% abort 率），自训门槛已达（1066 条 continue_stop 标签）。
> 本战役把"路线 B（自训）"从立项判断推进到**终审判定**——自训头到底行不行，
> 用 gating A/B 的真实数字回答；同时把采集侧最便宜的扩容做掉。
> 本文档是唯一的状态与验收控制点：每个 sub plan 做完一个提交一个。

**分支:** `feat/rsi-data-flywheel`
**前置:** [MASTER-PLAN.md](MASTER-PLAN.md)（SP26-28，已完成）+ [route-decision.md](route-decision.md)

---

## 一、核心价值（收益最大化分析，先想清楚再动手）

**一句话：用轻量工程把 SP26-28 攒下的证据链走到终点——
"自训头 vs 4 启发式基线"的 gating A/B 终审数字，以及
"老师观点 vs 执行真值"哪种标签训出来的头更值钱的第一份实证。**

按确定性 × 收益排序的价值流：

| # | 价值流 | 确定性 | 说明 |
|---|---|---|---|
| V1 | **路线 B 终审** | 高（框架全在，只差训练器+回填） | SP26-28 证伪了捷径（路线 A），本战役检验正路（路线 B）。无论结论正负，"判断层自建"的路线决策闭环完成：正 → 飞轮获得第一个数据驱动的守门员；负 → error_streak_3 启发式坐实为最优可部署项，自训线止损。 |
| V2 | **标签学实证：老师观点 vs 执行真值** | 高 | SP25 schema 的根本差异设计（execution > teacher 标签优先级）至今没有数字背书。1066 条 teacher 标签 outcome 全 null——回填后同一批数据两种监督信号，三路对照（蒸馏/真值/混合）第一次量化"执行真值贵在哪、值多少"。这是数据飞轮的方法论资产，结论外推到所有决策类型。 |
| V3 | **采集侧最便宜扩容** | 中 | error_classification 零候选依赖（route-decision 已认定次优加采项），从现有轨迹即可挖；multi-tool distractor 候选集最小验证（`mine_tool_decisions` 已有 `extra_options` 钩子）。重实施（新任务族/数据集）明确推迟——不押注大工程在未验证的域。 |
| V4 | **论文素材** | 中（顺手） | "外部决策头域内失效 → 执行真值自训 → 部署判定"完整闭环，是 RSI 判断层叙事的核心实验章节。 |

**为什么现在做（时机判断）：** 数据（1066 条 + 回填机制就绪）、框架
（eval_gating_ab / DecisionHeadPolicy / 4 基线 / scorer 工厂）、判据
（route-decision 部署线）三者齐备，SP29 是纯执行战役，无外部依赖。

## 二、做 / 不做（YAGNI 边界）

**做：**
- SP29a 数据层：execution 真值回填（attempt 终局 → 步级 outcome）+
  split 划分（rollout 粒度隔离）+ 全量 prewarm 扩容（12→全量 tasks）
- SP29b 训练层：轻量决策头训练器（step-features 数值特征 + torch 手写
  logistic/MLP，soft-target 支持）+ `make_scorer` 注册 `trained` 类型 +
  三路标签对照报告（teacher 蒸馏 / execution 真值 / 混合）
- SP29c 终审层：最优自训头 gating A/B vs 4 基线（3 seeds）+ Go/No-Go 报告
- SP29d 采集层：error_classification 挖掘器（规则真值）+ multi-tool
  distractor 候选集最小验证（4B 零样本多候选 acc 探针）

**不做（明确决策，写在这里防止执行漂移）：**
1. **不训练 LM / 不做 marker LoRA**——continue_stop 的 state 是
   step-features-v1（9 维结构化特征的确定性渲染，见
   decision_policy.py L26-38），轻量分类器表达力匹配；Mac 无训练 GPU
   （llama-server 无 Metal 的教训），LoRA 微调 4B 不可行；轻量头可解释
   （feature importance 直接读出"什么信号该止损"）且迭代秒级。
   marker LoRA 留给 tool_selection 文本 state 域——那个域先等 multi-tool 数据
2. **不微调 StartLux-Decision**——它是 teacher 与对照物；且 weights
   CC BY-NC 4.0，自训轻量头无许可问题
3. **不接入新多工具数据集 / 不改造 TB 任务族**——bash-only 是
   terminal-bench 数据集决定的；接新域是独立大工程，等 SP29d 的
   distractor 验证给出"state 语义是否足以区分工具"的信号后再立项
4. **不做 live-loop 早停部署**——即使 A/B 达标也只出报告，默认行为不变
   （feature flag 纪律延续，SP27 的 flag 继续默认 off）
5. **不为凑数据跑昂贵采集**——扩容只复用 eval_gating_ab 的 prewarm
   机制（llama-server 单线程稳定），不新开采集线
6. **不追 test 划分上的多轮调参**——test 只读一次（SP29c 终审），
   三路对照与超参选择只在 train/calib 上做

## 三、Sub Plans 与依赖

| # | 文件 | 内容 | 前置 | 状态 |
|---|---|---|---|---|
| SP29a | [sp29a-outcome-backfill.md](sp29a-outcome-backfill.md) | execution 真值回填 + split 划分 + prewarm 扩容 | SP28 | ⬜ |
| SP29b | [sp29b-lightweight-head.md](sp29b-lightweight-head.md) | 轻量决策头训练器 + trained scorer + 三路标签对照 | SP29a | ⬜ |
| SP29c | [sp29c-gating-final.md](sp29c-gating-final.md) | 自训头 gating A/B 终审 + Go/No-Go + 终答 | SP29b | ⬜ |
| SP29d | [sp29d-collect-expand.md](sp29d-collect-expand.md) | error_classification 挖掘 + multi-tool distractor 最小验证 | SP28（与 a/b/c 并行独立） | ⬜ |

## 四、统一纪律（继承 SP26-28，全战役有效）

1. **state 同构红线**：continue_stop 域 state 版本 = `step-features-v1`；
   训练特征与推理特征必须同源（dump 的 features 或 state 文本确定性解析，
   两者一致性有测试）
2. **test 划分只读一次**：SP29a 产出的 split 随数据冻结；三路对照与调参
   只用 train/calib；test 留给 SP29c 终审 A/B 一次性消费
3. **rollout 粒度隔离**：同一 attempt 的步级决策点不跨划分
   （SP25 既有 assign_split 语义，步级样本强相关，防泄漏）
4. **统计诚实条款**：rollout 级独立样本少（12 起，扩容后数十），报告必须
   (a) 按 rollout 聚类呈现结论 (b) 标注样本量限制 (c) 噪声带沿用跨 seed 全距一半
5. **teacher 标签不可变**：outcome 回填与 split 写入不覆盖既有 teacher 标签
   （新字段/新文件，原始 continue_stop.labeled.jsonl 只读）
6. **温度只在 calib 拟合，不改变 argmax**；soft-target 训练的蒸馏头同理
7. **fail-open / flag off 等价**：trained scorer 任何异常走原路径
8. **执行真值标签语义**：continue_stop 的 outcome = attempt 终局
   （pass/fail），framing 是 p(pass|step-features) 成功概率预测器，
   p_abort = 1 - p(pass)——credit assignment 噪声由概率化天然吸收，
   不做逐步对错的硬归因

## 五、Go/No-Go 终审框架（SP29c 产出）

- **部署线（延用 route-decision 判据）**：train 区 pass_rate 不降出噪声带
  （跨 seed 全距一半）且成本节省 >5% —— 达标则"自训头可部署"，
  SP30+ 讨论接线上线（仍走 feature flag）
- **标签学结论线**：execution 真值头 vs teacher 蒸馏头在 calib 上
  AUC/acc 差距 ≥ 噪声 → "执行真值监督显著优于老师观点"成立，
  采集侧 outcome 回填机制的价值被数字背书
- **止损线**：最优自训头仍不敌 error_streak_3 → 判断层结论回到
  "启发式 + 持续积累"，自训线冻结，资源转向 multi-tool 采集（SP29d 信号）
- **兜底也是结论**：12-30 rollouts 的统计限制若使结论不可分辨，
  报告如实标注 + 给出"多少 rollouts 可分辨"的功效估算，供下期战役决策

## 六、总验收标准

- [ ] SP29a：outcome 回填幂等（重跑补 0 条）；split 冻结落盘且 rollout
      粒度隔离；扩容后数据资产含 execution 真值标签
- [ ] SP29b：训练器单测绿（soft/hard target、特征一致性、保存加载）；
      trained scorer 注册进 make_scorer 且 fail-open；三路对照报告落盘
      （train/calib，含 AUC/acc/ECE + feature importance）
- [ ] SP29c：test 划分一次性消费；自训头 vs 4 基线 3 seeds 报告落盘；
      Go/No-Go 报告含明确判定与噪声带
- [ ] SP29d：error_classification 挖掘器单测绿 + 从现有轨迹产出第一批数据；
      distractor 候选集 4B 探针有信号/无信号的明确记录
- [ ] 每个 sub plan 一个 commit；全部单测绿；本文档状态表回填
- [ ] 核心价值终答（第八节）用真实数字回填

## 七、执行状态跟踪

| 日期 | 动作 | 产出 |
|---|---|---|
| 2026-10-03 | 战役规划（本文件 + 四个 sub plan） | 侦察结论：state 9 维结构化 → 轻量头路线；1066 条标签 outcome 全 null → 回填即真值；bash-only 根源 = terminal-bench 数据集选择 |

## 八、核心价值终答（全部完成后回填，回答"做这么多事的核心价值是什么"）

（待 SP29a-d 完成后用真实数字回填）
