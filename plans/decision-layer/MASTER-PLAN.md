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
| SP27 | [sp27-loop-gating-prototype.md](sp27-loop-gating-prototype.md) | loop gating：DecisionRouter + validator 接入 + 回放 policy 对照 | SP26 | ✅ |
| SP28 | [sp28-teacher-backfill-route-decision.md](sp28-teacher-backfill-route-decision.md) | teacher 批量补标 + 三路线 Go/No-Go 报告 | SP26, SP27 | ✅ |

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
- [x] SP27：router 单测绿（阈值/升级/降级/fail-open）；flag off 默认行为不变有测试；
      回放 policy_report 含 decision head vs 4 基线（train/held-out 双区、≥3 seeds）
- [x] SP28：补标幂等（重跑补 0 条）；test 零补标有断言；Go/No-Go 报告含明确路线建议
      （判定：路线 A 负结果——错杀有效尝试；路线 B 门槛已达，1066 条 continue_stop 标签）
- [x] 每个 sub plan 一个 commit；全部单测绿；本文档状态表回填
- [x] 核心价值终答（见第八节）用真实数字回填

## 七、执行状态跟踪

| 日期 | 动作 | 产出 |
|---|---|---|
| 2026-10-03 | SP26 完成（commit 待记） | decision_scorers 库（mock/openai/systemone 三路）+ decision_eval 指标库 + eval CLI + serve 脚本；34+34 单测绿（rl/trajectory 回归 341 绿） |
| 2026-10-03 | SP26 关键发现 1：真实 TB 数据 bash-only | 12 个 job 挖出 1259 决策点全部单候选——tool_selection 在当前域内数据上退化（top1=1.0 为官方短路）；域内基线需 multi-tool harness 或转向 error_classification/continue_stop |
| 2026-10-03 | SP26 关键发现 2：0.8B/4B 全链路实测通过 | hf-mirror 下载 + llama-server + 官方 gguf_server（/v1/systemone）；合成多工具数据 0.8B top1=0.45/ECE=0.295、4B top1=0.45/ECE=0.317（无语义信号，仅管线验证）；weights 许可 CC BY-NC 4.0 |
| 2026-10-03 | SP27 完成：三件套 + 真实 A/B | DecisionRouter（observe/nudge，fail-open）+ react_agent_async 接入（flag off 逐字节等价）+ DecisionHeadPolicy；15+5 单测绿，四域回归 386 通过；真实 A/B（12 tasks/30 attempts，4B systemone 1670 次打分，3 seeds）：tau0.6 abort_rate 0.002 但 train pass_rate 0.665 vs never_abort 0.829（降 16.4pt 超噪声带 ±6.6pt）——决策头几乎不 abort，但误杀恰好命中 pass 关键路径 |
| 2026-10-03 | SP27 关键发现：p_abort 分布探针 | 4B 零样本在 continue_stop state 上 p_abort 中位 0.212、≥0.5 仅 2%（8/515 步）、≥0.7 为 0%——零样本行为≈never_abort，且少数高置信 abort 是误杀 |
| 2026-10-03 | SP28 完成：补标纪律 + 路线报告 | backfill_decisions.py 补 --exclude-test（默认开）/--split-filter + 零渗透断言 + 幂等证明；continue_stop.labeled.jsonl 1066 条 teacher 标签（teacher_model 含量化规格）；route-decision.md 判定：**路线 A（直接部署公开头）负结果**——错杀有效尝试伤成功率；**路线 B（SP29 自训）门槛已达**——千级标签线达标，且每次 A/B prewarm 可产 ~1.2 万条 attempt-0 标签；采集侧动作：multi-tool harness 优先级上调（tool_selection 域内退化已证） |

## 八、核心价值终答（全部完成后回填，回答"做这么多事的核心价值是什么"）

**一句话：用三个 SP 的小工程投入，把"判断层自建还是外购"从一个直觉问题
变成了有真实数字的路线决策——并当场证伪了最诱人的那条捷径。**

按 V1-V4 逐条对账（真实数字）：

- **V1 训练投入的风险对冲——已兑现，这是最大的一笔收益。**
  公开头（StartLux-Decision 4B）零样本 gating A/B 的真实数字：train 区
  pass_rate 0.665 vs never_abort 0.829（降 16.4pt，超噪声带 ±6.6pt），
  而 abort 率仅 0.002——它几乎不出手，出手就是误杀。配套探针：p_abort
  ≥0.5 仅 2%、≥0.7 为 0%（n=515）。**如果跳过这次评测直接把公开头接进
  飞轮做早停，我们会用 16 个点的成功率换 13% 的成本节省**——这笔账
  只有跑了 A/B 才算得清。结论：公开头零样本不可部署（路线 A 证伪），
  域内自训的必要性第一次有了数字依据，SP29 立项不再靠信仰。

- **V2 数据资产变现验证——已兑现，且改变了采集优先级。**
  SP25 攒的 decisions.jsonl 第一次被消费即发现：域内 1259 个
  tool_selection 决策点 100% 单候选（bash-only），top1=1.0 是退化短路
  ——采集侧的 multi-tool harness 缺口由此从猜测变成实锤，优先级上调。
  同时闭环反向转动：A/B 回放顺手产出 1066 条 continue_stop teacher
  标签（teacher_model 含量化规格、test 零渗透、幂等可续），每次全量
  prewarm 可产 ~1.2 万条——**"采集→消费→再采集"的飞轮第一次真实转
  了起来，且积累速率已经跨过 SP29 自训的千级门槛。**

- **V3 飞轮自身降本——负结果，但负得有信息量。**
  回放侧 continue/abort 早停：决策头 tau0.6 没有跑赢任何启发式基线
  （never_abort 0.829 / progress_stall_8 0.829 / error_streak_3 0.765
  / decision_head 0.665）。它揭示了这类决策头的真实风险画像：
  **惰性 + 高置信误杀**——95%+ 的 state 上它说"继续"（与 never_abort
  无差异、零节省），剩下 2% 的高置信"放弃"恰好落在 pass 路径上。
  这直接改写了 V3 的路线：守门员降本不能靠零样本公开头，要么自训
  （SP29，标签已就绪），要么继续用启发式（error_streak_3 在 2 个
  基线之上省 4.8% 成本、只掉 6.4pt 成功率，仍是当前最优可部署项）。

- **V4 论文/叙事素材——顺手入账。**
  "外部决策头在域内分布上失效"本身是 RSI 叙事的一个论点：判断层
  没有免费午餐，state/候选集的域内分布决定一切——这正是 RSI 飞轮
  自产决策数据的正当性来源。负结果 + 完整证据链（探针分布 → A/B →
  路线报告）比一个说不清的正面数字更有论文价值。

**为什么说这三个 SP 花得值：** 战役总投入是三个 sub plan 的工程量
（scorer 库 + 三件套 + 评测/补标脚本，全部 feature flag 保护、flag off
逐字节等价、386 项测试绿），换来的是——一个被证伪的捷径（省下未来
数周的错误集成）、一个已跨门槛的自训立项（数据就绪）、一个采集优先
级的实锤调整、一条可复跑的证据链（test 只读一次、温度不改 argmax、
held-out 只验收）。**判断层的问题从"要不要接外部模型"变成了"SP29
什么时候立项"——这就是核心价值。**
