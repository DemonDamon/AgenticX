# SP29d：采集侧扩容——error_classification 加采 + multi-tool distractor 最小验证

## 背景

route-decision 采集侧动作落地：(a) error_classification 是零候选依赖的
次优决策类型（SP25 表 v2 优先级，route-decision 认定低成本加采项）；
(b) multi-tool harness 优先级上调，但重实施（新任务族/数据集）必须先有
"state 语义是否足以区分工具"的信号——`mine_tool_decisions` 已有
`extra_options` 干扰项钩子（decision_mining.py L52），最小验证的成本
只是一次探针。

## 交付

### D1：error_classification 挖掘器（真值零标注成本）

1. `decision_mining.py` 扩展 `mine_error_decisions(log, messages, *, rollout_id, task_id)`：
   - 定位 tool result 为 error 的消息（复用 forest.py `_is_error_result`）
   - 决策点：choice(retryable | transient | fatal)，"该错误应如何处置"
   - **规则真值 = SP22 `classify_error` 三分类**（execution 性质标签，
     非老师观点）——`AttemptNode.error_class` 同源逻辑，标注一致性互证
   - state 复用 msg-tail 压缩（与 tool_selection 同 compressor）
2. 从现有 agenticx-* 轨迹全量挖掘 → 
   `results/decision-layer/decisions/error_classification.jsonl`
   + 产出统计（多少 error 决策点 / 三类分布 / 与 SP26 decisions 的
   tool_selection 对比）
3. 单测：error 消息定位、三分类真值绑定、非 error 轨迹零产出

### D2：multi-tool distractor 候选集探针（信号判定，不重实施）

1. 对现有 12 rollouts 的 tool_selection 决策点重挖：候选集 =
   trace-observed ∪ 干扰项（全局工具注册表采样 3-5 个常见工具名，
   `distractor_source="registry-distractor-v1"` 溯源）
2. 4B teacher 对多候选决策点零样本打分（scorer 缓存续跑）：
   `results/decision-layer/decisions/multitool_probe.md`
   - 判定信号：top1 acc 显著高于均匀随机基线（1/|candidates|）→
     "state 任务语义足以区分工具"成立，multi-tool 采集按 distractor
     路线立项（便宜）；不显著 → state 需含工具描述（compressor 升级）
     或走新任务族（贵）——两条路线的成本差异写明
3. 产出仅报告 + 数据，不接新数据集、不改采集默认行为

## 验收

- [ ] error_classification.jsonl 落盘且规则真值覆盖率 100%（error 点必有标签）
- [ ] 三类分布与 SP22 error_class 统计互证（口径差异如有则注明）
- [ ] distractor 探针有明确"显著/不显著"结论 + 路线建议
- [ ] 单测绿 + 既有回归绿

## 不做

- 不接新多工具数据集 / 不改造 TB 任务族（master plan 不做清单第 3 条）
- 不给 error_classification 上 teacher 软标签（规则真值优先；
  teacher 补标等消费需求出现再说）
- 不把 distractor 候选集变成采集默认（探针数据独立落盘）
