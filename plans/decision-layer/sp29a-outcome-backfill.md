# SP29a：execution 真值回填 + split 冻结 + prewarm 扩容

## 背景

1066 条 continue_stop teacher 标签（12 rollouts）**outcome 全 null**——
teacher 观点有了，执行真值没接上。SP25 schema 的 `backfill_outcome` 机制
（decision.py L187）就是为此设计的，只差在 eval_gating_ab.py 的 dump
链路里接通：attempt-0 终局 = `TaskTree.attempts[0].passed`
（reward_label ≥ 1.0）。同时 split 全空——训练前必须冻结划分。

扩容机会：12 rollouts 是 `--limit-tasks 12` 的收敛结果；全量
`agenticx-*` jobs 的 attempt-0 步级 state 打一遍（dump-only 模式已存在）
可把数据资产从 12 rollouts 扩到全量任务。scorer 缓存
（scorer_cache.jsonl）已存 4551+1670 条，重跑只打增量。

## 交付

1. `scripts/eval_gating_ab.py` dump 链路扩展（--dump-decisions 时）：
   - 逐 task 调 `backfill_outcome(f"{task_id}#0", ok=attempts[0].passed,
     task_status=attempts[0].status)`（幂等：outcome 已非 None 跳过）
   - dump 后调 `assign_split(records)`（默认 ratio，rollout 粒度隔离）
   - dump-only 模式下同样生效
2. 数据资产产出（新文件，原始 continue_stop.labeled.jsonl 只读不动）：
   - `results/decision-layer/gating/continue_stop.dataset.jsonl`
     （全量 tasks，含 teacher 标签 + outcome 真值 + split 三分）
3. 单测（tests/trajectory/ 或 tests/rl/）：
   - 回填幂等：outcome 已存在的 record 重跑不覆盖、计数正确
   - join 正确性：rollout_id `task#0` 的 outcome == 该 task attempt-0 passed
   - split 冻结：同输入同 seed 两次 assign 结果一致；rollout 不跨划分
4. 真实跑：全量 prewarm dump-only（llama-server 单线程纪律
   `--prewarm-workers 1`；缓存续跑）→ 数据集统计报告
   （rollouts / 步级样本 / pass-fail 比 / split 分布）落
   `results/decision-layer/gating/dataset_stats.md`

## 关键实现细节

- `_abort_record` 的 rollout_id 格式 = `f"{task_id}#0"`（attempt-0），
  backfill_outcome 按此 join；只回填 dump 覆盖的 attempt-0
  （后续 attempt 不进数据资产，SP29b 不消费）
- llama-server 若不可用：用 mock scorer 冒烟链路 + 已有 12 rollouts
  缓存做回填验证；全量扩容标记 degraded 留待服务可用时补跑，
  不阻塞 SP29b（12 rollouts 也能先训，统计限制写进报告）

## 验收

- [ ] 幂等重跑补 0 条 outcome；teacher 标签未被触碰
- [ ] dataset.jsonl 每条含 outcome(ok) + split ∈ {train,calib,test}
- [ ] rollout 粒度隔离断言绿；统计报告落盘
- [ ] 既有回归全绿（tests/rl + tests/trajectory）

## 不做

- 不改 DecisionRecord schema（features 不入库；SP29b 从 state 文本解析）
- 不回填非 attempt-0 决策点（后续 attempt 的 state 依策略分化，
  不属于数据资产范畴）
- 不动 12-rollout 的既有 teacher 标签文件
