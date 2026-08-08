# AgenticX Learning 模块总结

> 结论生成时间：2026-05-29（首次创建，覆盖当前代码）

## 模块概述

AgenticX Learning（技能自进化）模块实现了一套「观察 → 信号提取 → 会话复盘 → 技能生命周期管理」的闭环：在运行时捕获每次工具调用的结构化观察，会话结束后据信号判断是否值得复盘，并由后台 LLM 自主调用 `skill_manage` 创建/更新可复用技能；同时提供技能质量门禁、使用统计、低效技能淘汰与条件可见性过滤等生命周期管理能力。该模块内化自 hermes-agent 的技能自进化设计，统一受 `~/.agenticx/config.yaml` 的 `learning:` 节与 `AGX_LEARNING_ENABLED` 等环境变量控制。

对应参考 commit：`af352cee`（instinct store + observer hook）与 `bbb241ae`（hermes 风格技能自进化闭环）。

## 目录结构

```
agenticx/learning/
├── __init__.py                 # 导出 Instinct/InstinctStore/ObservationHook/InstinctAnalyzer
├── observer.py                 # ObservationHook：捕获工具调用观察并落盘
├── analyzer.py                 # 信号提取（extract_signals）+ InstinctAnalyzer 骨架
├── config.py                   # 读取 config.yaml 的 learning: 节（带默认值与环境变量覆盖）
├── session_review_hook.py      # 会话复盘 Hook：后台 LLM 自主调用 skill_manage
├── instinct.py                 # Instinct 数据模型 + Markdown 序列化
├── instinct_store.py           # Instinct 文件存储（原子写）
├── skill_quality_gate.py       # 技能质量门禁（5 项检查）
├── skill_usage_tracker.py      # 技能使用统计与淘汰候选
├── skill_deprecation.py        # 低效技能淘汰报告
└── skill_condition_filter.py   # 按 frontmatter 条件过滤技能可见性
```

## 核心组件分析

### ObservationHook（observer.py）

继承 `AgentHook` 的运行时观察钩子：

- `before_tool_call` 记录起始时间，`after_tool_call` 据工具返回文本推断 `success`（`infer_success` 基于 error 信号词表 + JSON `success: false` 判定），提取 `error_signal`、记录 `turn_index` 与 `elapsed_ms`。
- 观察以 JSON 列表持久化到 `~/.agenticx/sessions/<session_id>/tool_call_observations.json`（`asyncio.create_task` 异步落盘，不阻塞主流程）。
- 受 `learning.enabled`（或环境变量 `AGX_LEARNING_ENABLED`，默认开）门控；关键点：`success` 由返回内容推断而非硬编码，保证失败/重试类学习信号可用。

### 信号提取与分析（analyzer.py）

- **SessionSignals**：dataclass，记录工具调用数、唯一工具数、成功/失败数、错误恢复数、重试模式数与总耗时，并派生 `success_rate`、`has_error_recovery`、`is_complex`（≥5 次调用且 ≥2 种工具）。
- **load_session_observations()**：直接从 session 目录读取观察 JSON（新路径）；`load_observations`/`filter_session` 为旧 JSONL 路径保留向后兼容。
- **extract_signals()**：确定性（无 LLM）地识别 error_recovery（失败后对同一工具重试成功）与 retry_pattern（连续调用同一工具）。
- **InstinctAnalyzer**：Phase-1 仅占位（`analyze_session` 返回空列表），LLM 驱动的 instinct 生成留待 Phase-2。

### 配置中心（config.py）

集中读取 `~/.agenticx/config.yaml` 的 `learning:` 节，提供默认值（`enabled`、`nudge_interval=10`、`min_tool_calls=5`、`auto_create`、`skip_confirm`、`quality_gate_min_score=0.6`、`review_model`、`review_enabled` 等），并做类型校验；支持环境变量覆盖（`AGX_LEARNING_ENABLED` / `AGX_LEARNING_NUDGE_INTERVAL` / `AGX_LEARNING_MIN_TOOL_CALLS` 等）。`get(key, default)` 为单键便捷访问器。

### 会话复盘 Hook（session_review_hook.py）

继承 `AgentHook`（注册优先级 -50，在 memory/summary hook 之后运行）：

- `on_agent_end` 触发；`_should_review` 据 `nudge_interval`（距上次 `skill_manage` 的轮数）与 `min_tool_calls` 阈值判定。
- `_run_review` 加载观察、提取信号，仅当 `signals.is_complex` 时才触发复盘 agent。
- `_run_skill_review_agent` 截取近 20 条 user/assistant 历史（长内容截断），拼接技能复盘 system/user 提示与现有技能清单，循环（最多 3 轮）调用 `litellm.acompletion`，将模型发起的 `skill_manage` 工具调用真实执行（`_tool_skill_manage`）；无 `pending_skills.json` 中间态，复盘 agent 直接落盘技能。

### Instinct 模型与存储（instinct.py / instinct_store.py）

- **Instinct**：可持久化的行为本能（trigger/action/confidence/domain/scope/project_id/evidence），支持 YAML frontmatter + Markdown 正文的双向序列化。
- **InstinctStore**：在 `~/.agenticx/instincts` 下按 scope（global / projects/<pid>/instincts）组织文件，`save` 用临时文件 + `replace` 实现原子写，`list_instincts` 跳过无效文件。

### 技能生命周期闭环

- **skill_quality_gate.py（质量门禁）**：5 项确定性检查——min_steps（足够工具调用）、success_evidence（至少一次成功）、dedup（与现有技能描述相似度 < 0.85）、guard_scan（安全扫描）、actionability（含 frontmatter 且正文 ≥80 字符）；`evaluate` 仅在平均分 ≥ `min_score`（默认 0.6）且无 0 分项时通过。
- **skill_usage_tracker.py（使用统计）**：每个技能目录维护 `.usage_stats.json`，`record_use` 追加使用事件，`get_stats` 聚合 SkillStats（成功率、平均后续工具调用数），`get_deprecation_candidates` 找出「用得多但成功率低」的技能。
- **skill_deprecation.py（淘汰报告）**：基于使用统计产出结构化淘汰报告（含建议 `update`/`remove`），`check_deprecation_json` 输出可直接作为工具结果的 JSON。
- **skill_condition_filter.py（条件过滤）**：解析 SKILL.md frontmatter 的 `requires_tools` / `requires_toolsets` / `fallback_for_*`，按当前会话可用工具/工具集决定技能是否出现在技能索引中（镜像 hermes `_skill_should_show` 逻辑）。

## 设计模式

1. **Hook / 观察者模式**：`ObservationHook` 与 `SessionReviewHook` 挂接到 agent 运行时生命周期事件，无侵入地采集与复盘。
2. **管道 / 闭环**：观察落盘 → 信号提取 → 阈值判定 → LLM 复盘 → 技能 CRUD → 使用统计 → 淘汰，形成自进化闭环。
3. **门禁（Gate）模式**：质量门禁以多项加权检查 + 零分否决的方式拦截低质技能。
4. **策略 + 配置驱动**：行为完全由 `learning:` 配置与环境变量驱动，默认值集中在 `config.py`。
5. **原子写**：Instinct 与使用统计落盘均走临时文件/原子替换，避免并发写损坏。

## 技术亮点

1. **success 真实推断**：观察的 `success` 由返回内容启发式判定（error 信号词表 + JSON 标志位），而非硬编码 True，保证失败与错误恢复信号可用。
2. **复杂度门控复盘**：仅对「足够复杂」（多次调用 + 多工具）的会话触发后台复盘，控制 LLM 成本与噪音。
3. **直写式技能创建**：复盘 agent 直接调用 `skill_manage` 落盘技能，去掉中间 `pending_skills.json`，对齐 hermes 架构。
4. **确定性信号提取**：error_recovery / retry_pattern 等关键信号无需 LLM，纯规则可复现。
5. **条件可见性**：依据会话实际可用工具动态过滤技能索引，避免暴露当前环境用不上的技能。

## 应用场景

1. **工作流自动沉淀**：复杂多工具任务结束后，自动把可复用方法沉淀为 SKILL.md。
2. **技能质量管控**：新技能创建前过质量门禁，过滤短小、重复或不安全的技能。
3. **技能效果追踪与淘汰**：长期跟踪每个技能的使用成功率，标记需更新或移除的低效技能。
4. **环境自适应技能注入**：依据当前工具集只展示真正可用的技能。

## 总结

Learning 模块把「运行时观察」转化为「可复用技能」，以 ObservationHook 采集、analyzer 提取确定性信号、SessionReviewHook 后台 LLM 复盘直写技能为主链路，再以质量门禁、使用统计、淘汰报告与条件过滤构成技能生命周期管理闭环。整套机制配置驱动、成本可控、信号可复现，是 AgenticX 实现「越用越聪明」的技能自进化基础设施。
