# Plan: Prompt Cache 命中增强 + 视觉历史预算裁剪

Plan-Id: 2026-06-15-prompt-cache-vision-budget
Status: draft (approved by user, pending implementation)
Owner: Damon Li
Scope: AgenticX runtime / studio (non-enterprise)

---

## 0. 背景与目标

当前 AGX 在「长对话压缩与记忆体系」上能力较强，但在两项直接降本杠杆上仍缺少产品化闭环：

1. Prompt cache：缺少统一的可缓存段构建、provider 能力判定、命中指标观测与回退策略。
2. 视觉历史预算：缺少会话级图片窗口、图片预算控制、超预算降级（原图 -> 摘要）链路。
3. 压缩语义保真：缺少「用户硬约束逐字保留」的强约束模板与自动校验。

本计划目标是在不破坏现有能力的前提下，补齐这两条降本主链路，并提供可观测指标验证 ROI。

---

## 1. 范围与非目标

### 1.1 In Scope

- Meta/Agent 侧请求构建阶段的 prompt cache 注入与观测。
- Studio 请求侧 image_inputs 的预算化处理（保留/裁剪/摘要占位）。
- 运行时配置项与默认值（默认安全，不改变现网语义）。
- 冒烟测试 + 回归测试 + 指标日志。

### 1.2 Out of Scope

- 不改 memory graph / reinforce / decay 算法。
- 不替换 embedding provider（hashing -> semantic）；
  该事项已有独立 plan。
- 不改 enterprise 目录。
- 不新增高风险外部依赖（尽量复用现有 runtime 能力）。

---

## 2. 设计原则

- **默认不回归**：开关默认 OFF 或 conservative，未开启时行为与当前一致。
- **渐进增强**：仅对支持的 provider 生效，其他 provider 自动 no-op。
- **可观测优先**：每轮可输出命中率、节省 token 估算、视觉裁剪决策。
- **可回滚**：配置一键关闭，不依赖复杂迁移。

---

## 3. 功能需求（FR）

### FR-1 Prompt Cache 配置与能力判定

新增运行时配置节（建议放在 `~/.agenticx/config.yaml` 的 `runtime` 下）：

- `runtime.prompt_cache.enabled` (bool, default: false)
- `runtime.prompt_cache.provider_allowlist` (list[str], default: [])
- `runtime.prompt_cache.min_cacheable_chars` (int, default: 800)
- `runtime.prompt_cache.segment_strategy` (enum: stable_prefix | full_system, default: stable_prefix)

行为：

- 仅在 `enabled=true` 且 provider 命中 allowlist 时启用。
- provider 不支持时自动跳过，记录 `cache_mode=unsupported_provider`。

### FR-2 Prompt Cache 注入链路

在请求组装阶段，构建「稳定前缀段」并按 provider 兼容格式注入缓存标记（如 `cache_control` 等）。

要求：

- 支持最多 4 个缓存断点（对齐目标 provider 能力上限）：
  - 断点 1：system prompt + 稳定工具定义。
  - 断点 2-4：最近 3 条高价值 `tool_result` 片段（按时间倒序）。
- 每轮请求需执行「旧断点清理 + 新断点重排」，并保持断点策略可预测。
- 仅对稳定内容注入（system prompt、长期规则、稳定工具描述、最近稳定 tool_result）。
- 避免对用户实时输入段注入，防止 cache 污染与命中率下降。
- 不改变最终语义内容，仅附加缓存元信息。

### FR-3 Prompt Cache 指标

新增轮次级指标采集并打点：

- `cache_eligible_chars`
- `cache_hit_chars`（若 provider 无命中回执则估算为 0）
- `cache_hit_rate`
- `cache_saved_tokens_est`

要求：

- 在 debug 日志可见；
- 能进入会话级 usage 累计结构（若现有结构不支持则先日志+内存计数）。

### FR-4 视觉历史窗口（Recent-N + 批量清理）

新增视觉预算配置：

- `runtime.vision_history.enabled` (bool, default: false)
- `runtime.vision_history.max_images` (int, default: 3)
- `runtime.vision_history.max_image_chars_per_turn` (int, default: 12000)
- `runtime.vision_history.degrade_mode` (enum: drop_oldest | keep_referenced, default: keep_referenced)
- `runtime.vision_history.batch_compact_interval` (int, default: 25)

行为：

- 当 `image_inputs` 超过 `max_images` 时，仅保留最近 N 张原图。
- 被裁剪图片保留结构化占位（文件名、时间、引用 id），不保留大体积数据。
- 占位符标准化为 `[Image omitted]`（可带最小元信息后缀）。
- 清理策略采用**批量替换**而非逐轮逐张替换：
  - 仅在累计图片数达到 `batch_compact_interval` 时执行批量历史替换；
  - 非触发轮尽量保持历史前缀字节稳定，以提高缓存命中率。

### FR-5 视觉超预算降级（原图 -> 摘要占位）

当本轮图片总字符预算超限时，按优先级降级：

1. 先裁剪最旧且未被当前 query 明确提及的图片；
2. 仍超限时对旧图改为摘要占位（caption/ocr 摘要，使用已有可用信息）；
3. 最终保证本轮图片注入总量不超过预算。

### FR-6 LLM 压缩模板强化（硬约束逐字保留）

在 `ContextCompactor` 的压缩 prompt 中强制纳入 8 类保真信息，且新增硬规则：

1. 用户完整指令（逐字保留所有「必须/不要/始终」等硬约束）
2. 任务模板
3. 约束规则
4. 已执行操作
5. 错误与修复记录
6. 进度追踪
7. 当前状态
8. 下一步动作

新增校验：

- 压缩后摘要缺失关键硬约束时，触发一次补救压缩；
- 补救仍失败时回退到更保守的截断摘要（fail-open）。

### FR-7 服务端自动压缩协同（Provider-specific）

对于支持服务端 context management 的 provider，新增可选透传：

- `context_management` 参数（provider 协议兼容格式）
- beta/feature 标识（例如 `compact-2026-01-12`，由 provider adapter 控制）

要求：

- 客户端收到服务端压缩边界后，本地消息数组执行同位置截断，保持缓存对齐。
- 若 provider 不返回压缩边界信息，则保持现有本地压缩策略，不报错。

### FR-8 用户可感知提示（低噪音）

在触发视觉裁剪时，添加一次性、低噪音提示（系统内部消息，不刷屏）：

- 示例：`已对历史图片进行预算化精简，保留最近高相关内容。`

要求：

- 不重复刷屏；
- 与既有系统提示规范一致。

---

## 4. 非功能需求（NFR）

- NFR-1 性能：新增逻辑不引入显著额外延迟（P95 +100ms 以内）。
- NFR-2 稳定性：任何注入/裁剪异常均 fail-open（回退到原始链路）。
- NFR-3 可维护性：策略函数拆分清晰，避免把 provider 分支硬编码散落。
- NFR-4 可测试性：每个策略有独立单测，端到端有 smoke 覆盖。
- NFR-5 前缀稳定性：在非批量清理轮次中，视觉历史前缀应保持字节级稳定（允许计数器等非语义字段变化）。

---

## 5. 代码改动规划（按模块）

### 5.1 Runtime 配置与策略模块

拟新增/修改：

- `agenticx/runtime/` 下新增：
  - `prompt_cache_policy.py`（能力判定、段选择、注入适配）
  - `vision_history_budget.py`（recent-N、预算裁剪、占位转换）
- 修改：
  - `agenticx/runtime/agent_runtime.py`（接入策略调用与指标记录）
  - `agenticx/studio/server.py`（`image_inputs` 进入 runtime 前的预算处理接入点）

### 5.2 指标与日志

拟修改：

- `agenticx/runtime/usage_metadata.py`（若需要扩展 usage 字段）
- `agenticx/runtime/agent_runtime.py`（回合日志/usage 汇总）

### 5.3 配置读取

拟修改：

- 与现有 config 读取聚合模块（按仓库现有模式定位）
- Desktop/Studio 设置项后续可单独出 UI plan，本 plan 先保证配置生效。

---

## 6. 测试计划（AC 对应）

### AC-1 Prompt cache 默认无回归

- 给定 `runtime.prompt_cache.enabled=false`，请求 payload 与现状等价（允许字段顺序差异）。
- 现有核心 smoke 全绿。

### AC-2 Prompt cache 注入生效

- 给定支持 provider + enable=true：
  - 仅出现 1~4 个缓存断点，且布局符合「1 个系统 + 3 个最新 tool_result」策略；
  - 稳定段携带缓存标记；
  - 非稳定段无缓存标记；
  - 日志可见 `cache_eligible_chars > 0`。

### AC-3 不支持 provider 自动回退

- 给定不支持 provider：
  - 无异常；
  - `cache_mode=unsupported_provider`；
  - 正常返回模型结果。

### AC-4 视觉窗口裁剪（Recent-N）

- 输入 6 张图片 + `max_images=3`：
  - 输出仅保留最近 3 张原图；
  - 旧图转占位或被裁剪；
  - 输出结构满足下游调用契约。

### AC-5 批量清理与前缀稳定性

- 给定 `batch_compact_interval=25`：
  - 在未触发批量清理的连续轮次中，历史前缀保持稳定（hash 不变或仅白名单字段变化）；
  - 在触发轮执行批量 `[Image omitted]` 替换；
  - 替换后下一批次前缀再次稳定。

### AC-6 视觉预算上限生效

- 构造超大 image_inputs：
  - 本轮输入总字符 <= `max_image_chars_per_turn`；
  - 超预算时触发降级路径；
  - 不抛异常。

### AC-7 压缩保真校验

- 构造含「必须/不要/始终」约束的长会话：
  - 压缩后摘要仍逐字保留这些硬约束；
  - 若首次未保留，补救压缩被触发并修复；
  - 失败时回退路径生效。

### AC-8 服务端自动压缩协同

- 给定支持 provider 且开启透传：
  - 请求包含 `context_management` 与对应 beta 标识；
  - 收到服务端压缩边界后，本地消息同位截断；
  - 后续轮次缓存命中指标不异常抖动。

### AC-9 端到端 smoke（含多轮）

- 场景：多轮问答 + 多图 + 部分回看历史图引用；
- 验证：
  - 答案可用；
  - 日志可见裁剪决策；
  - token 成本较基线下降（记录对比数据）。

---

## 7. 实施步骤（建议）

1. 先做 FR-1/FR-2（不接 UI），确保 feature flag + 注入 no-op 路径完整。
2. 再做 FR-3，保证可观测后再做性能判断。
3. 做 FR-4/FR-5（Recent-N + 批量清理 + 预算降级）及单测。
4. 做 FR-6（压缩 8 类保真 + 硬约束逐字保留校验）。
5. 做 FR-7（服务端自动压缩协同，provider-specific adapter）。
6. 做 FR-8 低噪音提示整合。
7. 运行 smoke + GAIA 小样本 A/B 对比，输出成本与质量报告。

---

## 8. 回滚策略

- 快速回滚：将以下配置置为 false：
  - `runtime.prompt_cache.enabled`
  - `runtime.vision_history.enabled`
- 代码层回滚：策略模块为可选调用，移除调用不影响主链路。

---

## 9. 风险与缓解

- 风险 R1：provider 缓存协议差异导致兼容问题。
  - 缓解：provider adapter + fail-open + 分 provider 单测。
- 风险 R2：视觉裁剪误伤关键上下文。
  - 缓解：默认保守阈值；保留引用占位；必要时回退到 recent-N only。
- 风险 R3：指标不可对齐实际账单。
  - 缓解：区分 `est` 与 `provider_reported`，先做趋势验证。

---

## 10. 交付物

- 代码改动（runtime + studio）
- 单元测试与 smoke 测试
- 一份 A/B 对比说明（成本/质量）
- 可直接发布的配置说明文档（后续可补 UI plan）

