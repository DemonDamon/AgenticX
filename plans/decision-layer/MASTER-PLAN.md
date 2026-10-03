# 判断层接入 Master Plan（Decision Layer Integration，SP26-SP28）

> **定位：** RSI 数据飞轮的判断层（Decision Layer）子战役。承接 SP25（决策点标注层，
> 已合入）预留的 SP26 位子，把"采集到的决策数据"第一次变成"被消费的资产"。
> 本文档是唯一的状态与验收控制点：每个 sub plan 做完一个提交一个，
> 状态表与终答由本文档回填。

**分支:** `feat/rsi-data-flywheel`
**外部锚点:** StartLux-Decision（开源决策模型，0.8B/2B/4B/9B/27B + GGUF 量化；
毫秒级受限 softmax，输出候选项概率分布）。行业同步信号：OpenAI Decisions API、
Cloudflare Clef——"判断层"已成共识方向。

---

## 一、核心价值（收益最大化分析，先想清楚再动手）

**一句话：用最小的工程投入，回答"RSI 飞轮的判断层该自建、外购还是混合"，
并让 SP25 攒下的决策数据第一次产生真金白银的判断依据。**

按确定性 × 收益排序的四条价值流：

| # | 价值流 | 确定性 | 说明 |
|---|---|---|---|
| V1 | **训练投入的风险对冲** | 高（无论结果如何都赚） | SP26 自训 marker LoRA 是一条完整训练线（数据混合/训练/评测 infra）。先评公开头零样本：够用 → 直接部署，省整条线；不够 → 自训的必要性第一次有数字依据（"公开最强也不过 X"）。花小钱避免大投入走错路。 |
| V2 | **SP25 数据资产变现验证** | 高 | decisions.jsonl 的 test 划分第一次被消费。零样本不行 + 数据量不足 → 早知道早调整采集优先级；闭环"采集→消费"第一次真实转动。 |
| V3 | **飞轮自身降本** | 中（需 A/B 数字说话） | 两个诚实定位：(a) **validator 模式**——决策头做守门员不做司机，LLM 仍生成工具与参数，决策头只在错配时 nudge，省的是"走错路的整轮 LLM+执行"；(b) **回放策略**——TrialForest 上 continue/abort 早停从 4 个启发式基线升级为决策头驱动，省的是飞轮自己跑 trial 的算力。 |
| V4 | **论文/叙事素材** | 中（顺手收集不专项投入） | RSI 五级划分（StartLux 自定位 Level 3）、"判断层拼图→系统整合"叙事，作为 RSI 论文 related work 素材。 |

**必须诚实面对的现实（决定了 V3 的边界）：**
- FC Agent loop 里 LLM 还要生成工具**参数**，决策头替代不了整轮 LLM 调用——
  文章购物 demo 的动作空间是无参数页面点击，与我们不同；
- 本仓评测链路是 verifier 规则判分，**没有 LLM-judge 可省**，
  judge_prescreen 的 gating 接入暂无宿主（数据 schema 保留，接入推迟）。

## 二、做 / 不做（YAGNI 边界）

**做：**
- SP26 决策头基线：scorer 库化 + test 划分评测（accuracy/ECE/温度校准）
- SP27 loop gating 原型：DecisionRouter + tool_selection validator（observe/nudge）+ 回放侧 DecisionHeadPolicy 与 4 基线对照
- SP28 teacher 批量补标（train/calib，禁 test）+ 三路线 Go/No-Go 报告

**不做（明确决策，写在这里防止执行漂移）：**
1. **不微调 StartLux-Decision**——它是对照物与候选兜底，不是改造对象；域内自训是 SP29+ 的独立决策
2. **不上 9B/27B**——4B（Q8/Q4）主力 + 0.8B 速度参照足以回答问题；显存带宽也是本地约束
3. **不做 live-loop 提前终止（continue_stop 直连 _loop）**——终止需要生成最终答案，最终仍是 LLM；收益存疑风险高。降级到回放侧做（动作空间本来就是 continue/abort，零推理成本 A/B）
4. **不做 judge_prescreen 的 loop 接入**——无宿主（verifier 规则判分），等 LLM-judge 链路出现再接
5. **不做 finance 工单分流等 demo 场景**——演示性质，对飞轮零贡献
6. **不追 Decision Index 外部榜单**——外部口径与我们的 state/候选集分布无关，test 划分是唯一裁判
7. **模型下载失败不阻塞**——endpoint 可配置 + mock 全链路保证工程可交付，真实数字可得则得、不可得则报告标记 degraded

## 三、Sub Plans 与依赖

| # | 文件 | 内容 | 前置 | 状态 |
|---|---|---|---|---|
| SP26 | [sp26-decision-head-baseline.md](sp26-decision-head-baseline.md) | 决策头基线：scorer 库化 + 本地服务化 + test 划分评测 | SP25 | ✅ |
| SP27 | [sp27-loop-gating-prototype.md](sp27-loop-gating-prototype.md) | loop gating：DecisionRouter + validator 接入 + 回放 policy 对照 | SP26 | ☐ |
| SP28 | [sp28-teacher-backfill-route-decision.md](sp28-teacher-backfill-route-decision.md) | teacher 批量补标 + 三路线 Go/No-Go 报告 | SP26, SP27 | ☐ |

## 四、统一纪律（继承 SP25，全战役有效）

1. **state 同构红线**：喂给任何外部/本地决策模型的 state 必须走
   `state_compressor=msg-tail-*-v1`（`decision_mining.compress_state`），换版即换数据集
2. **test 划分冻结后只读一次**：SP26 基线报告读一次；SP28 补标**排除 test**
   （补标渗透 test = 基线不可比）；温度只在 calib 拟合，不改变 argmax
3. **held-out 守卫**：`load_trainable_decisions` 逐条 assert，考试任务决策点禁入训练/补标消费
4. **teacher 标签必须记录 `teacher_model`**（含量化规格）；补标幂等不覆盖 execution/self
5. **概率输出依赖运行时 logprobs**——服务化选型第一验证项；argmax-only 则 gating
   只能用硬判断，降级模式必须显式记录
6. **fail-open**：gating 组件任何异常 → 自动走原路径，不得影响任务成功率
7. **feature flag 默认 off**：flag off 时代码路径与现状逐字节等价

## 五、Go/No-Go 决策框架（SP28 产出，阈值由真实分布定标）

三路线：
- **路线 A（直接部署公开头）**：gating A/B 成功率无显著下降（Wilcoxon p≥0.05）
  且浪费轮次/算力有可测下降；零样本 tool_selection acc 达"部署可用"档
- **路线 B（自训 marker LoRA，SP29+ 立项）**：公开头零样本不足，但 train 决策点
  n 达自训门槛（Jev 复刻经验：千级即可逼近本体）且持续积累
- **路线 C（混合）**：公开头兜底/冷启动 + 自训头攻高价值决策类型
- **兜底结论也是结论**：数据不足且零样本差 → "继续积累数据，gating 搁置"，
  直接反馈 SP25 采集优先级

## 六、总验收标准

- [x] SP26：test 划分分决策类型 accuracy/ECE 报告落盘；scorer 单测绿；mock 全链路冒烟
- [ ] SP27：router 单测绿（阈值/升级/降级/fail-open）；flag off 默认行为不变有测试；
      回放 policy_report 含 decision head vs 4 基线（train/held-out 双区、≥3 seeds）
- [ ] SP28：补标幂等（重跑补 0 条）；test 零补标有断言；Go/No-Go 报告含明确路线建议
- [ ] 每个 sub plan 一个 commit；全部单测绿；本文档状态表回填
- [ ] 核心价值终答（见第八节）用真实数字回填

## 七、执行状态跟踪

| 日期 | 动作 | 产出 |
|---|---|---|
| 2026-10-03 | SP26 完成（commit 待记） | decision_scorers 库（mock/openai/systemone 三路）+ decision_eval 指标库 + eval CLI + serve 脚本；34+34 单测绿（rl/trajectory 回归 341 绿） |
| 2026-10-03 | SP26 关键发现 1：真实 TB 数据 bash-only | 12 个 job 挖出 1259 决策点全部单候选——tool_selection 在当前域内数据上退化（top1=1.0 为官方短路）；域内基线需 multi-tool harness 或转向 error_classification/continue_stop |
| 2026-10-03 | SP26 关键发现 2：0.8B/4B 全链路实测通过 | hf-mirror 下载 + llama-server + 官方 gguf_server（/v1/systemone）；合成多工具数据 0.8B top1=0.45/ECE=0.295、4B top1=0.45/ECE=0.317（无语义信号，仅管线验证）；weights 许可 CC BY-NC 4.0 |

## 八、核心价值终答（全部完成后回填，回答"做这么多事的核心价值是什么"）

> 占位。SP28 收尾时用 V1-V4 对应的真实数字回填：基线 acc/ECE、
> gating A/B 差值、补标规模、路线决策结论。
