---
Plan-Id: 2026-05-18-long-task-display-and-resilience
Status: Implemented
Owner: Damon Li
Last-Updated: 2026-05-18
---

# 长任务可恢复性 + WorkBuddy 风格任务进度条

## 背景

继 `2026-05-18-long-task-feedback-transparency` 与 `2026-05-18-long-task-recovery-gates` 之后，用户在执行 `PyO3 混合架构草案` 这类长任务时仍出现以下问题：

1. **compactor 摘要污染 UI**：模型输出 `[pending_user_question] 请将以下对话压缩成用于后续推理的精炼上下文。 [/pending_user_question]` 这类幻觉标签，被前端原样渲染成"用户消息"或夹在 system message 里随后续轮次回流。根因：`agenticx/runtime/compactor.py:284` 的 prompt 里同时出现 `[pending_user_question]`（占位字符串）和 `[user-pending-question]`（真正使用的标签），弱模型（minimax-m2.7、glm-4-flash 等）混淆后会幻觉一个 `[/pending_user_question]` 闭合标签把 prompt 第一行包进去。
2. **`file_write` 空参数后任务直接放弃**：模型流式 tool_call 在 token 紧张时被截断 → `_repair_streamed_tool_arguments` 解析失败 → 空字典 → `dispatch_tool_async` 返回 `ERROR: file_write() called with empty arguments.` → 模型读到 ERROR 后又说一句"我马上写"就再无下文，整个任务终止。错误信息没有强引导"立即重试"，且模型放弃后委派任务被判 `completed` 而文件并不存在（产物门禁 FR-5 已实现，但仅在 `tool_results.txt` 显式 mention 文件路径时触发）。
3. **任务清单展示不够直观**：`TodoUpdateCard` 已存在但作为 inline 消息卡片，每次 `todo_write` 都新插一张，用户需要往上翻才能看到当前 todo。期望参考 WorkBuddy：**贴在输入框上方**的常驻状态条，默认折叠仅展示完成度与进行中任务；点击展开看完整列表，已完成项打删除线。

## 范围（已确认）

按用户选择 `all`：FR-A / FR-B / FR-C / FR-D / FR-E 全部落地，FR-D 采用 `above_input` 形态。

## Functional Requirements

### FR-A：消除 compactor 摘要标签污染

- **FR-A.1**：`agenticx/runtime/compactor.py:_build_compaction_prompt` 改写，把 prompt 内对占位标签的描述改为**与系统真正使用的标签名一致**（统一用 `[user-pending-question]`），并把"原样保留"改为引用消息原文（不通过仿造标签语法），降低模型把它当 XML 标签复述的概率。
- **FR-A.2**：`_summarize` 在拿到 LLM 返回文本后做后处理：剥离 `[pending_user_question]…[/pending_user_question]`、`[/user-pending-question]`、`[/compacted]` 等模型幻觉的闭合标签块（仅剥外壳标签，标签**之间的真实内容保留**，但若内部仅是 prompt 自身的指令文本如"请将以下对话压缩……"则整段丢弃）。
- **AC-A.1**：单测：构造一个 LLM 输出 `[pending_user_question] 请将以下对话压缩成用于后续推理的精炼上下文。 [/pending_user_question]\n- 真实摘要内容` 的场景，断言压缩后的 system message 不包含 `[pending_user_question]` 字符串，且真实摘要内容（"真实摘要内容"）保留。
- **AC-A.2**：现有 `tests/test_smoke_compactor_pending_question.py` 全部通过，不回归。

### FR-B：`file_write` / `file_edit` 空参数错误信息强化引导

- **FR-B.1**：`agenticx/cli/agent_tools.py:dispatch_tool_async` 中针对 `_TOOL_REQUIRED_PARAMS` 的空参数错误，在错误文本里追加：
  - 明确列出每个必填参数及其用途（不是只列名字）
  - 提示"请立即重新调用，不要换其他工具，不要把这次失败汇报给用户"
  - 对 `file_write` / `file_edit` 类工具特别提示"如果忘记目标路径，可重读 system prompt 中的工作区根 / 用户原始任务描述"
- **AC-B.1**：单测：构造空参数调用 `file_write`，断言返回错误文本包含 "立即重新调用" 与 "path"、"content" 字段说明。

### FR-C：流式 tool_call 解析失败回退

- **FR-C.1**：`agenticx/runtime/agent_runtime.py:_repair_streamed_tool_arguments` 不变（保持纯函数），但调用点（约 `1265` 行附近）在 streaming 解析返回空字典且工具属于 `_TOOL_REQUIRED_PARAMS`（即必需参数工具）时，**不直接派发**：
  - 若当前轮次未达 `max_tool_rounds`，丢弃该 tool_call，向 messages 追加一条 `tool` 角色的 ERROR 消息（内容：「上一次工具调用因流式输出被截断导致参数为空，请重新生成完整调用」），并跳过本次 dispatch、进入下一轮 LLM 调用。
  - 若已达 `max_tool_rounds`，按现有路径处理（保留派发并返回标准错误）。
- **AC-C.1**：单测：mock streaming 工具调用，模拟 `arguments` 字段为空字符串，断言下一次 LLM 调用前 messages 包含 truncation-retry 提示，且**没有**派发 file_write。

### FR-D：WorkBuddy 风格任务进度条（贴输入框上方）

- **FR-D.1**：新增 `desktop/src/components/StickyTaskBar.tsx`：
  - 输入：当前 pane 的 `messages` 数组
  - 行为：从后往前找最近一条满足 `isTodoUpdateToolMessage(content)` 的助手消息，复用 `TodoUpdateCard` 的 `parseTodoMessage` 逻辑提取 `items / completed / total`
  - 默认折叠态：单行高亮条（约 32px 高），左侧 `LayoutList` 图标 + "任务"标签 + 当前 in_progress 任务文本（截断 ≤ 50 字）+ `completed/total` chip + 进度条
  - 展开态：完整任务列表，已完成项打删除线（保留与 `TodoUpdateCard` 一致的图标与配色），最大高度 `40vh` 可滚动
  - 折叠/展开通过点击行内按钮切换，状态保存于组件本地（每个 pane 独立）
  - 当 `completed === total` 且 `total > 0` 时显示一条隐去的庆祝态：保留进度条 100%，文本显示"已全部完成"，2 秒后自动折叠（不强制销毁组件，避免后续 todo_write 进来时闪烁）
  - 当解析不到 todo 时整个组件返回 null（不占位）
- **FR-D.2**：在 `desktop/src/components/ChatPane.tsx` 输入区容器（line ~6133，`<div className="agx-pane-composer-body ...">` 之前）插入 `<StickyTaskBar messages={messages} />`。
- **FR-D.3**：UI 必须遵循主题 token：
  - 折叠态背景 `bg-surface-card` + `border-border`，保持与现有 `TodoUpdateCard` 视觉一致
  - 进度条用 `bg-cyan-400/80`（与 `TodoUpdateCard` 统一）
  - 不要硬编码 `bg-[#…]` 等 hex 色
- **AC-D.1**：在群聊 pane / 分身 pane / Meta pane 切换时，状态条独立追踪每个 pane 的最新 todo，不串台。
- **AC-D.2**：手动验收：模拟 `🗂 任务清单更新\n[x] A\n[>] B <- 当前\n[ ] C\n(1/3 completed)` 后，输入框上方应显示折叠条（图标 + "B" + `1/3` + 33%）；点击展开后 A 项打删除线；提交新输入到底部应不被遮挡。

### FR-E：弱模型 anti-tag-hallucination 提示（轻量）

- **FR-E.1**：`agenticx/runtime/prompts/meta_agent.py` 与 `agenticx/runtime/meta_tools.py:delegation_system_prompt` 的"压缩与历史标记"段落里追加一句：
  > 上下文中出现的 `[…]` 形式的标记（如 `[compacted]`、`[user-pending-question]`、`[session_memory]`）是系统注入的元数据**只读**标签，禁止你在回复或工具参数中模仿造一个，禁止用 `[/xxx]` 形式生成闭合标签。
- **AC-E.1**：grep 验证两处 prompt 包含该指令；不写新单测（属于提示词调优）。

## Non-Functional Requirements

- **NFR-1**：本次改动不调整 `runtime.max_tool_rounds`、token budget 阈值等运行时参数（与 no-scope-creep 原则一致）。
- **NFR-2**：FR-D 的状态条**不能**触发 `messages` 整体重渲染（用 `useMemo` 派生 todo 数据，依赖 `messages.length` 与最后一条助手消息的 id）。
- **NFR-3**：所有新增/修改 prompt 文本必须使用中文标点，避免再次出现 ASCII 引号包中文导致的语法歧义。

## 实施顺序

1. FR-A（compactor 改 prompt + 输出清洗）+ 单测
2. FR-E（meta/delegation prompt 文案补丁）
3. FR-B（错误文本强化）+ 单测
4. FR-C（streaming 空参数回退）+ 单测
5. FR-D（StickyTaskBar 组件 + 接入 ChatPane）
6. 桌面端类型检查 + 后端 pytest smoke

## 风险与回滚

- FR-A 的清洗逻辑使用正则匹配特定标签，若模型输出包含合法的同名标签（极少）会被误删；通过仅剥**包裹了 prompt 自身指令文本**的标签块来收敛。回滚成本：还原 compactor.py 即可。
- FR-C 的 retry 路径在极少数模型流式 bug 反复触发时可能造成空轮自旋；通过保留 `max_tool_rounds` 上限、且 retry 不消耗工具调用配额（仅追加 tool message 后进入下一轮 LLM）控制。回滚成本：去掉空字典回退分支。
- FR-D 的 sticky bar 高度 / 折叠态可视性改变 composer 上方布局，最坏情况通过删除 `<StickyTaskBar />` 一行回滚。

## 不在范围

- 不改任务调度引擎本身（不对 `task_scheduler.py` 做 Rust 化或重写）
- 不调整 `max_tool_rounds` / `AGX_MAX_TOKENS_*` 等阈值
- 不更换 minimax-m2.7 / 不强制要求 provider 切换
- 不为单个工具构建"参数 cache + 自动重填"机制（FR-C 的 retry 已足够）
