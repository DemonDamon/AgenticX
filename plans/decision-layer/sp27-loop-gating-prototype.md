# SP27 Loop 级 Gating 原型：DecisionRouter + validator 接入 + 回放对照

> Master plan: [MASTER-PLAN.md](MASTER-PLAN.md)（核心价值 V3 飞轮降本，validator/守门员定位）
> 前置：SP26（scorer 库 + 评测 harness）

## 背景

诚实前提（master plan 第二节）：FC loop 里 LLM 要生成工具**参数**，决策头替代不了
整轮 LLM 调用；本仓评测链路是 verifier 规则判分，没有 LLM-judge 可省。因此 v1
gating 的两个落点都不是"替换 LLM"：

1. **validator（守门员）**：LLM 选完工具后，决策头对同一 state 独立打分
   P(tool|state, 候选集)。错配且高置信 → nudge 下一轮修正。省的是"走错路的
   整轮 LLM+工具执行"。先 observe 模式只记录不干预，agreement/置信度与任务
   终局 outcome 的相关性本身就是决策数据。
2. **回放策略**：`Policy` 协议（continue/abort）+ `evaluate_policy` +
   train/held-out 双区报告已就绪（SP7/P0.5），4 个启发式基线。决策头作为
   第 5 个 policy 进场，A/B 零推理成本、天然带隔离纪律。

## 任务

### T1 DecisionRouter 组件
- [ ] 新建 `agenticx/agents/decision_router.py`：
  - `RouterVerdict`：action（`pass`/`nudge`）、probs、confidence（top-1 prob）、
    argmax_symbol、latency_ms、degraded（bool）
  - `DecisionRouter(scorer, decision_type, tau_high=0.8, tau_low=0.5)`：
    `check(state, symbols) -> RouterVerdict`；内部 yes_no/choice 题型适配
  - 阈值语义：confidence ≥ tau_high 且与被验证选择错配 → nudge；
    < tau_low 或 scorer 异常 → pass（fail-open，degraded 标记）
  - 遥测累积：`telemetry` list + `dump(path)`，行格式对齐 DecisionRecord
    可序列化字段（后续可回流训练数据）

### T2 agent loop 接入（tool_selection validator）
- [ ] `react_agent_async.py` `_loop`：normalized tool_calls 确定后、dispatch 前
  - 新 kwargs `decision_gate: dict | None = None`（None=默认 off，现状逐字节等价）
  - gate 配置：`{"mode": "observe"|"nudge", "router": {...}}`；router 由
    `make_scorer` 构造注入，agent 不依赖具体服务
  - observe：只记录 agreement + confidence（本轮不干预）
  - nudge：错配且高置信 → 本轮照常执行 + 追加 system nudge 影响下一轮
    （对齐 loop_detector.nudge 先例，不 block 执行）
  - 遥测落盘：gate 结束（finish/error）时 dump 到 session 目录或指定路径
- [ ] 测试：flag off 行为等价（无 router 调用）；observe 记录字段完整；
  scorer 抛异常 → degraded + 原路径继续

### T3 回放侧 DecisionHeadPolicy
- [ ] 新建 `agenticx/learning/trajectory/decision_policy.py`：
  - `DecisionHeadPolicy(scorer, state_builder, tau_abort)`：`act(obs, ctx)` 把
    StepFeatures 渲染成 state 文本 → yes_no 题（continue/abort）→ scorer probs
    → abort 概率 ≥ tau 才 abort，否则 continue（fail-open → continue）
  - state_builder：StepFeatures 字段的确定性文本化（版本号
    `step-features-v1`，沿用 SP25 训推一致纪律）
- [ ] A/B 脚本 `scripts/eval_gating_ab.py`：
  - 回放侧：`policy_report` 跑 4 基线 + DecisionHeadPolicy，≥3 seeds，
    train/held-out 双区汇总（成功率/步数/放弃率）
  - live 侧：`--live` 跑 observe 模式一致性报告（环境可得时）
  - mock scorer 全链路冒烟；报告落 `results/decision-layer/gating/`

## 做成什么样

- router + 接入 + policy 三件套全部 feature flag 保护，默认 off
- `pytest tests/agents/test_decision_router.py
  tests/trajectory/test_decision_policy.py` 全绿（mock/fake scorer）
- 一份 A/B 报告（真实 scorer 或 degraded 标记）：回放侧 policy 对比表
  （含 held-out 纪律）+ live observe 一致性统计（如有）

## 验收

- [ ] flag off：现有 agent 测试回归全绿，无新增调用路径
- [ ] fail-open 三处验证：scorer 异常 / 超时语义（degraded）/ 题型不匹配 → 原路径
- [ ] nudge 模式注入的消息可被关闭（gate 配置一次性），不与 loop_detector 冲突
- [ ] 回放 A/B：DecisionHeadPolicy 与 4 基线同表可比，3 seeds 数字落盘
- [ ] mock 冒烟：observe→遥测落盘→nudge 注入→报告生成一条命令可重跑

## 明确不做

- 不做 live-loop 提前终止（continue_stop 直连 _loop，master plan 不做清单 #3）
- 不做 block/拦截执行模式（死锁风险，nudge 先行）
- 不接 judge_prescreen（无宿主，master plan 不做清单 #4）
- 不在 harbor 容器内插桩（沿用 SP25 决策：driver 侧/本地侧处理）
