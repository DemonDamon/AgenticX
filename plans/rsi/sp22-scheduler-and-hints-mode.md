# SP22: 探索调度器 + hints 分期（Dream-RSI 论文吸收）

状态: 已完成（2026-09-26）
来源: Google DeepMind《Dream-RSI: Recursive Self-Improvement through Evolving
Worlds》（arXiv 2609.14858）。论文证明: 冻结底座模型, 把探索策略形式化为
可演化代码 + 用历史数据做零成本回放模拟器, 能把长程搜索算力降 1-2 个数量级。

## 论文 → 我们的映射（背书确认）

| Dream-RSI 组件 | 我们已有的等价物 | 状态 |
|---|---|---|
| 发现树 = 回放模拟器 | TrialForest（P0.5） | 已建 |
| 离线做梦（策略在历史上重跑择优） | replay.evaluate_policy + evolve_loop（P0.5） | 已建 |
| 只演化策略代码, 底座/评测锁死 | SP18 拆分守卫 + SP21 单次验证 | 已建 |
| 被否定假设不重试 | SP21 已否定清单 | 已建 |
| 四维调度动作空间（选节点/定并发/设深度/下止损） | **缺失——replay 的分支调度退化为顺序** | **SP22 补齐** |
| 5.1 消融: prompt 先验压制探索多样性 | **与我们 inject_hint 工作模式冲突** | **SP22 补分期** |
| infra/算法错误分离 + 分支赦免 | 仅在 harness 层（重试约定）, 未进策略层 | **SP22 补齐** |

## 交付内容

### (a) hints 分期（`scripts/rsi_explore.py`）
- `run_round(hints_mode=)`: "exploit"=注入上轮经验（执行期语义, API 默认,
  存量测试零改动）; "explore"=不注入（探索期语义, CLI `--hints-mode` 默认）
- 经验提取/入库/freeze 生命周期完全不受影响——只是不进 prompt
- 实验纪律: 汇报经验层收益必须带 hint on/off 对照臂（写进模块 docstring）

### (b) 探索调度器（`agenticx/learning/trajectory/scheduler.py`）
- 四维动作: (focus, batch, depth, stop)——选节点/定并发/设深度/下止损
- `replay_evaluate_scheduler`: 调度器在已记录森林上的零成本回放。
  花一次调用 = 揭示一条已记录 attempt; 对已揭示完分支的投入计浪费
  （平台期惩罚的回放等价物）; 分支突破即撤深度锁（论文: 突破后主动压算力）
- `SEED_SCHEDULER_SOURCE`: 平台期切换种子（批 2 / 深 1 / 平台期阈值 3 结题）
- `scheduler_evolve`: 接进 evolve_loop——崩溃/非法动作 → -inf → 按"无提升"
  进 SP21 否定清单, 不炸循环; 与 PolicyRegistry/LLM proposer 全兼容
- `rsi_explore.py --evolve-scheduler`: 轮末在 train 区回放上演化调度器
  （heldout_split 同款隔离纪律）

### (c) 错误三分类 + 分支赦免（`forest.py` + `scheduler.py`）
- `classify_error(messages) -> infra|algorithm|none`（algorithm 优先）:
  infra=网络/超时/容器/限流/显存/维度/编译/路径类可修复失误;
  algorithm=断言/测试/验证器/期望不符的判真失败
- `AttemptNode.error_class` 字段（from_trajectory 自动填, 旧记录向后兼容）
- 健康度规则（论文附录避坑规则落地）: infra 失败不老化 steps_since_improve
  （"单次出现不允许关停分支"）; 部分奖励提升清零计数（分支赦免）;
  algorithm 失败才推进平台期

## 测试钉死的语义（tests/trajectory/test_scheduler.py, 12 用例）

- infra 赦免: 4 次 infra 失败后通过的分支被一路挖到通过;
  4 次 algorithm 失败后通过的分支被止损放弃（"迟来的通过"被错过——
  止损是 recall/效率交换, 论文同款语义, 测试注释明示）
- 种子调度器 < 预算内主动结题, 得分高于死磕型（0 通过烧光预算）
- 突破撤锁: 已通过分支不吃满 depth×batch
- 哈希序陷阱: from_trajectories 按 trajectory_id（哈希）排序, 顺序敏感
  测试必须直接构造 AttemptNode（测试文件头注明）
- evolve 接线: 无提升变体/崩溃变体均进否定清单

回归: tests/rl + tests/trajectory = 242 passed（227 存量 + 15 新增, 零破坏）。
dry 冒烟: 2 轮 + --evolve-scheduler 全流程跑通, schedulers.json 落盘。

## 边界与诚实声明

- 回放调度的收益上限受历史记录约束: 只能重排/重访/剪枝已记录结果,
  不能预测未尝试路径（论文边界二, 与 SP21 边界声明同款表述）
- 调度器在线驱动（run_round 的任务循环按调度器决策分配批次）是
  follow-up: 现在交付的是离线演化通路, 在线接线等真跑（GPU/MinT 容量）
  时连同调度器注册表一起接
- LLM proposer 的调度器专用 prompt 未做（dry 用 mutate 提议器足够;
  make_llm_proposer 的 prompt 描述的是 StepFeatures, 调度器变体需要
  另写一版, 列为待办）
