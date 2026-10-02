# plans/rsi/sp25-decision-annotation.md
# SP25 决策点标注层（Jev 式判别头的数据地基）

## 背景

Agent loop 中存在高频、选项有界、结果可验证的决策点（工具选择/错误分类/
继续终止/hint 门控/judge 预筛）。用生成式模型逐 token 思考做三选一是
"拿慢思考做快思考的活"——OpenRouter 上 Classification 占全平台 10.4% 花销，
主力烧钱的是最贵档模型。Jev 复刻潮（Intern-Decision 榜单 / Datawhale
09-pytrio-jev）已验证：marker token 单点监督 + 受限 softmax + 温度校准，
2160 条数据、¥14 成本即可逼近甚至超过 Jev 本体。

本分支的差距：SP24 三投影（flat/pieces/turn）只记录 token 真值，不含
决策点标注——每跑一轮 rollout 就丢一批判别头训练数据，且 state 压缩表示
无法事后忠实重建。SP25 补第四投影：决策点 sidecar，先落 schema 与守卫，
数据立刻开始积累，训练侧（B300/SP26）另计。

## 决策清单（v1）

| 决策点 | 题型 | 说明 | v1 优先级 |
|---|---|---|---|
| tool_selection | choice | 下一步调用哪个工具（选项=当前可用工具集+负采样干扰项） | 上 |
| judge_prescreen | score | 输出质量 0-5 预筛，低分才上昂贵 LLM-judge | 上 |
| error_classification | choice | tool error 可重试/瞬时/致命 | v2 |
| continue_stop | yes_no | 当前分支继续或终止 | v2 |
| hint_gating | yes_no | failure-memory hint 注入门控（bug 率≥15% 激活） | v2 |

## Schema v1 要点

- join 键：`(rollout_id, turn)` join TokenRollout / TurnRecord，
  `decision_id` 全局唯一——不嵌入 TokenRollout（test_rollout_tokens 对
  字段集有断言，且"轨迹是事实、标注是判断"各自演进）
- `state_compressor` 版本必填：训推一致性红线，压缩函数换版=换数据集，
  杜绝"短 state 训练、长 state 部署"的分布漂移（Hard 档越训越掉的教训）
- 标签多来源并存，消费侧按优先级取用：**execution（执行真值，延迟回填）
  > self（policy logprob，仅本地 rollout）> teacher（离线补标，受限 softmax）**
- `outcome` 延迟回填：decision → action → outcome 显式关联，决策好坏由
  下游真值定义——这是本分支相对 Jev 复刻潮的根本差异（执行真值 vs 老师观点）
- `split` 三分：train/calib/test，sha256(rollout_id|seed) 确定性分桶，
  **rollout 粒度隔离**（同一轨迹的决策点不跨划分，防 state 近重复泄漏）

## 纪律（与 SP18/SP21 同源）

1. held-out guard 扩展：12 个 TB 考试任务的决策点严禁进决策头训练——
   `load_trainable_decisions` 逐条 assert，违规抛 `HeldoutViolation`
2. test 划分冻结后才可读；校准温度只在 calib 划分拟合；温度不改变 argmax
3. teacher 标签必须记录 `teacher_model`（可复现红线）；补标不覆盖
   execution/self 既有标注
4. choice 干扰项记录 `distractor_source` 生成器版本（负采样溯源）
5. 落盘为独立 sidecar（decisions.jsonl），raw 只追加不改写；补标结果
   写新文件（`*.labeled.jsonl`），原始数据不可变

## 交付

- `agenticx/rl/decision.py`：DecisionQuestion/Label/Outcome/Record +
  DecisionLog（累积/回填/落盘/加载）+ assign_split + held-out 守卫 +
  backfill_teacher
- `agenticx/learning/trajectory/decision_mining.py`：driver 侧轨迹挖掘
  （tool_selection 提取 + state 纯函数尾部压缩 msg-tail-N-v1 + 候选集
  trace-observed）
- `scripts/rsi_explore.py` 在线插桩：trial 完成即挖决策点、终局 outcome
  回填、轮级 sidecar（`<out>/decisions/round_N.jsonl`），断点重跑幂等
- `scripts/backfill_decisions.py`：teacher 离线补标入口
  （openai 兼容受限 softmax 标注机 + mock 冒烟模式）
- `tests/rl/test_decision.py`（23）+ `tests/trajectory/test_decision_mining.py`
  （7）：schema 校验/join 对齐/标签优先级/守卫/回填/切分隔离/挖掘

## 验证

- 新测试 30/30（decision 23 + mining 7）；RSI 回归 tests/rl +
  tests/trajectory 全绿；tests/trainer 单独 30 passed（组合收集撞
  basename 是 pyproject 已文档化的存量问题，与本次无关）
- mock 冒烟全链路跑通：构造 → outcome 回填 → 切分（rollout 粒度隔离）→
  落盘 → mock 补标 → 幂等重跑（补 0 条）→ load_trainable_decisions 守卫通过
- dry 驱动器冒烟（rsi_explore --dry --rounds 2）：每轮 decisions sidecar
  落盘，记录含 execution 真值 + 终局 outcome，轮报告带 decisions 统计

## 未做（明确决策）

- marker LoRA 训练管线（B300：公开数据 baseline → 自有数据混合）——SP26
- loop 级评测（gating 点接入 + 3 seeds + Wilcoxon）——SP26
- self 来源标签（policy logprob 采集，需本地 rollout 直读引擎）——
  B300 rollout 普及后启用
- harbor 容器内 agent 的实时捕获（当前为 driver 侧 post-trial 挖掘，
  state 压缩是 messages 纯函数故忠实；容器内插桩等 token-native rollout
  接入时一并做）
