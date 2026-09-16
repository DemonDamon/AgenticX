# AgenticX Learning 模块总结

> 结论更新时间：2026-09-01（覆盖基线 `f3ba65001c29` 之后的变更：新增证据模型 `evidence.py` 与确定性会话复盘 `loop_review.py`，信号提取/质量门禁/复盘 Hook 接入证据分级）

## 模块概述

AgenticX Learning（技能自进化）模块实现了一套「观察 → 信号提取 → 会话复盘 → 技能生命周期管理」的闭环：在运行时捕获每次工具调用的结构化观察，会话结束后据信号判断是否值得复盘，并由后台 LLM 自主调用 `skill_manage` 创建/更新可复用技能；同时提供技能质量门禁、使用统计、低效技能淘汰与条件可见性过滤等生命周期管理能力。该模块内化自 hermes-agent 的技能自进化设计，统一受 `~/.agenticx/config.yaml` 的 `learning:` 节与 `AGX_LEARNING_ENABLED` 等环境变量控制。

对应参考 commit：`af352cee`（instinct store + observer hook）与 `bbb241ae`（hermes 风格技能自进化闭环）。

## 目录结构

```
agenticx/learning/
├── __init__.py                 # 导出 Instinct/InstinctStore/ObservationHook/InstinctAnalyzer
├── observer.py                 # ObservationHook：捕获工具调用观察并落盘
├── analyzer.py                 # 信号提取（extract_signals）+ InstinctAnalyzer 骨架
├── evidence.py                 # 会话证据模型：EvidenceState 分级 + 证据封顶分数
├── loop_review.py              # 确定性五维会话健康检查（无 LLM），产出 loop_review.json
├── config.py                   # 读取 config.yaml 的 learning: 节（带默认值与环境变量覆盖）
├── session_review_hook.py      # 会话复盘 Hook：后台 LLM 自主调用 skill_manage + 触发 loop review
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
- 会话目录解析（`_resolve_session_dir`）优先取 session 的 `_session_id` 与 `_usage_owner_session_id` 私有属性，再回退 `session_id`/`id`，保证委派/分身会话的观察落到真实执行会话目录。
- 受 `learning.enabled`（或环境变量 `AGX_LEARNING_ENABLED`，默认开）门控；关键点：`success` 由返回内容推断而非硬编码，保证失败/重试类学习信号可用。

### 信号提取与分析（analyzer.py）

- **SessionSignals**：dataclass，记录工具调用数、唯一工具数、成功/失败数、错误恢复数、重试模式数与总耗时，并派生 `success_rate`、`has_error_recovery`、`is_complex`（≥5 次调用且 ≥2 种工具）；另含证据字段 `verification_calls` / `verification_success` / `write_calls` / `validation_evidence`（EvidenceState 值）。
- **load_session_observations()**：直接从 session 目录读取观察 JSON（新路径）；`load_observations`/`filter_session` 为旧 JSONL 路径保留向后兼容。
- **extract_signals()**：确定性（无 LLM）地识别 error_recovery（失败后对同一工具重试成功）与 retry_pattern（连续调用同一工具）；末尾调用 `collect_session_evidence` + `classify_validation_evidence` 回填上述证据字段。
- **InstinctAnalyzer**：Phase-1 仅占位（`analyze_session` 返回空列表），LLM 驱动的 instinct 生成留待 Phase-2。

### 会话证据模型（evidence.py）

对「会话成果声明的可信度」做确定性、只读分级，核心思想是**证据强度给质量分数封顶**——只写文件却未跑验证的会话不能被评为「已验证」：

- **EvidenceState**：七级枚举——`MISSING`/`UNOBSERVED`（rank 0）、`PRESENT`（1）、`WIRED`（2）、`EXERCISED`（3）、`OUTCOME_SUPPORTED`（4）、`NOT_APPLICABLE`（-1）；`EVIDENCE_SCORE_CAP` 把各级映射到分数上限（20/40/55/70/85/100），`cap_score()` 执行封顶。
- **collect_session_evidence()**：从观察与 `messages.json` 聚合 `SessionEvidence`（验证调用/成功数、写操作数、用户轮次与纠偏轮次、高风险确认数、两个数据源可用性）。验证类工具为 `run_tests`/`liteparse` 与命令签名命中 `VERIFICATION_CMD_RE`（pytest/npm test/tsc/go test/ruff/mypy 等）的 `bash_exec`；写操作工具含 `file_write`/`file_edit`/`str_replace`/`apply_patch`/`skill_manage`；用户纠偏由 `CORRECTION_RE`（「不对/错了/重来/revert」等）识别。
- **classify_validation_evidence() / classify_delivery_evidence()**：分别对「变更验证」「可靠交付」两个维度给出证据等级（如验证成功 → `OUTCOME_SUPPORTED`，有写无验证 → `PRESENT`）。

### 确定性会话复盘（loop_review.py）

无 LLM、无网络、只读的单会话健康检查，产出 `<session_dir>/loop_review.json`（仅经显式 `write_review` 落盘）：

- **五维评分**：任务理解（task_framing）、受控执行（controlled_execution）、变更验证（change_validation）、可靠交付（reliable_delivery）、学习沉淀（learning_capture）；每个维度先算 raw 分（含一行可读的计分理由 rationale），再按对应 EvidenceState 用 `cap_score` 封顶；`overall` 为五维均分下取整。
- **Findings 与分数解耦**：仅当维度证据偏弱（`MISSING`/`PRESENT`）且观察数据可用时，才从固定模板 `FINDING_TEMPLATES`（impact/repair/verification 三段式，无自由生成）产出修复建议；低分本身不触发 finding。
- `observations_available` / `messages_available` 标志让消费方能区分「评得差」与「无数据可评」；`format_review_text()` 提供 CLI 纯文本渲染。

### 配置中心（config.py）

集中读取 `~/.agenticx/config.yaml` 的 `learning:` 节，提供默认值（`enabled`、`nudge_interval=10`、`min_tool_calls=5`、`auto_create`、`skip_confirm`、`quality_gate_min_score=0.6`、`review_model`、`review_enabled`、`evidence_gate_strict=False`、`loop_review_enabled=True` 等），并做类型校验；支持环境变量覆盖（`AGX_LEARNING_ENABLED` / `AGX_LEARNING_NUDGE_INTERVAL` / `AGX_LEARNING_MIN_TOOL_CALLS` 等）。`get(key, default)` 为单键便捷访问器。

### 会话复盘 Hook（session_review_hook.py）

继承 `AgentHook`（注册优先级 -50，在 memory/summary hook 之后运行）：

- `on_agent_end` 触发；先无条件调用 `_spawn_loop_review`（独立于技能复盘门控，受 `loop_review_enabled` 控制，默认开）——以 `asyncio.to_thread` 跑 `review_session` + `write_review` 落盘 `loop_review.json`，任务句柄存入 `_loop_review_tasks` 强引用集合防 GC，异常仅记 debug 日志不外抛；随后才按 `_review_enabled` 与 `_should_review`（`nudge_interval` 距上次 `skill_manage` 的轮数、`min_tool_calls` 阈值）决定是否进入 LLM 技能复盘。
- `_run_review` 加载观察、提取信号，仅当 `signals.is_complex` 时才触发复盘 agent。
- `_run_skill_review_agent` 截取近 20 条 user/assistant 历史（长内容截断），拼接技能复盘 system/user 提示与现有技能清单，循环（最多 3 轮）调用 `litellm.acompletion`，将模型发起的 `skill_manage` 工具调用真实执行（`_tool_skill_manage`，现传入真实 `session` 而非 `None`）；无 `pending_skills.json` 中间态，复盘 agent 直接落盘技能。

### Instinct 模型与存储（instinct.py / instinct_store.py）

- **Instinct**：可持久化的行为本能（trigger/action/confidence/domain/scope/project_id/evidence），支持 YAML frontmatter + Markdown 正文的双向序列化。
- **InstinctStore**：在 `~/.agenticx/instincts` 下按 scope（global / projects/<pid>/instincts）组织文件，`save` 用临时文件 + `replace` 实现原子写，`list_instincts` 跳过无效文件。

### 技能生命周期闭环

- **skill_quality_gate.py（质量门禁）**：5 项确定性检查——min_steps（足够工具调用）、success_evidence（按验证证据分级，见下）、dedup（与现有技能描述相似度 < 0.85）、guard_scan（安全扫描）、actionability（含 frontmatter 且正文 ≥80 字符）；`evaluate` 仅在平均分 ≥ `min_score`（默认 0.6）且无 0 分项时通过。其中 `success_evidence` 已从「至少一次成功调用」升级为证据分级判定：纯只读会话（`NOT_APPLICABLE`）给 0.6 保底分（全部调用失败仍判 0）；证据达 `EXERCISED` 及以上满分；仅 `PRESENT`（有写操作但未验证）时在默认非严格模式下按 legacy 满分放行，开启 `learning.evidence_gate_strict` 后降为 0.5 通过分，把「未验证的写」拉向门禁阈值；证据缺失则判 0。
- **skill_usage_tracker.py（使用统计）**：每个技能目录维护 `.usage_stats.json`，`record_use` 追加使用事件，`get_stats` 聚合 SkillStats（成功率、平均后续工具调用数），`get_deprecation_candidates` 找出「用得多但成功率低」的技能。
- **skill_deprecation.py（淘汰报告）**：基于使用统计产出结构化淘汰报告（含建议 `update`/`remove`），`check_deprecation_json` 输出可直接作为工具结果的 JSON。
- **skill_condition_filter.py（条件过滤）**：解析 SKILL.md frontmatter 的 `requires_tools` / `requires_toolsets` / `fallback_for_*`，按当前会话可用工具/工具集决定技能是否出现在技能索引中（镜像 hermes `_skill_should_show` 逻辑）。

## 设计模式

1. **Hook / 观察者模式**：`ObservationHook` 与 `SessionReviewHook` 挂接到 agent 运行时生命周期事件，无侵入地采集与复盘。
2. **管道 / 闭环**：观察落盘 → 信号提取 → 阈值判定 → LLM 复盘 → 技能 CRUD → 使用统计 → 淘汰，形成自进化闭环；另有并行的确定性支路：会话结束即跑五维 loop review 落盘 `loop_review.json`。
3. **门禁（Gate）模式**：质量门禁以多项加权检查 + 零分否决的方式拦截低质技能。
4. **策略 + 配置驱动**：行为完全由 `learning:` 配置与环境变量驱动，默认值集中在 `config.py`。
5. **原子写**：Instinct 与使用统计落盘均走临时文件/原子替换，避免并发写损坏。

## 技术亮点

1. **success 真实推断**：观察的 `success` 由返回内容启发式判定（error 信号词表 + JSON 标志位），而非硬编码 True，保证失败与错误恢复信号可用。
2. **复杂度门控复盘**：仅对「足够复杂」（多次调用 + 多工具）的会话触发后台复盘，控制 LLM 成本与噪音。
3. **直写式技能创建**：复盘 agent 直接调用 `skill_manage` 落盘技能，去掉中间 `pending_skills.json`，对齐 hermes 架构。
4. **确定性信号提取**：error_recovery / retry_pattern 等关键信号无需 LLM，纯规则可复现。
5. **证据封顶评分**：loop review 与质量门禁均以 EvidenceState 给分数设上限——「有写操作但未跑验证」最高只能到 `PRESENT` 档（55 分封顶、严格模式下 success_evidence 仅 0.5），从机制上防止「看似忙碌实则未验证」的会话被高估。
6. **条件可见性**：依据会话实际可用工具动态过滤技能索引，避免暴露当前环境用不上的技能。

## 应用场景

1. **工作流自动沉淀**：复杂多工具任务结束后，自动把可复用方法沉淀为 SKILL.md。
2. **技能质量管控**：新技能创建前过质量门禁，过滤短小、重复或不安全的技能。
3. **技能效果追踪与淘汰**：长期跟踪每个技能的使用成功率，标记需更新或移除的低效技能。
4. **环境自适应技能注入**：依据当前工具集只展示真正可用的技能。

## 总结

Learning 模块把「运行时观察」转化为「可复用技能」，以 ObservationHook 采集、analyzer 提取确定性信号、SessionReviewHook 后台 LLM 复盘直写技能为主链路，再以质量门禁、使用统计、淘汰报告与条件过滤构成技能生命周期管理闭环；证据模型（evidence.py）与五维会话复盘（loop_review.py）在此基础上提供无 LLM 的确定性健康检查，以证据强度为分数封顶。整套机制配置驱动、成本可控、信号可复现，是 AgenticX 实现「越用越聪明」的技能自进化基础设施。
