# Plan: 工具卡片 UX 收敛 + 智能体长程稳定性增强

- **Plan-Id**: 2026-05-08-toolcall-ux-and-longrun-stability
- **Owner**: Damon Li
- **Created**: 2026-05-08
- **状态**: Drafted (待启动 Phase 1)
- **关联问题**：用户在 `glm-5v-turbo` 跑 `@skill://tech-daily-news` 一次完整会话观察到 3 个具体痛点（见下文「2. 真实日志根因」）

---

## 1. 背景与目标

用户在 Machi Desktop 的元智能体会话里跑技能 `tech-daily-news`，整个长程任务（19 站点抓取 + 文件落盘）虽然最终成功，但 UI 与底层运行时暴露出三类显著问题：

1. **工具调用展示太冗余**：同一个回合内 `tool_call` / `tool_result` 各自落成独立 `tool` role 消息，N 次调用 → 2N 张垂直堆叠的卡片，屏幕被刷满，观感与 Cursor 单行折叠态（"Read UserBubble.tsx L1-27"、"Explored 8 files, 2 searches"）差距明显。
2. **执行中状态丑陋**：`tool_progress` 事件被当作流式文本写进 `__stream__` 占位消息，呈现为 `⏳ bash_exec 执行中…（stderr）` 这种 emoji + 中文混排的临时段落，没绑定到对应的 tool_call 卡片，也没用现有的 `Shimmer`（微光动画）组件。
3. **长程运行反复犯错**：模型在 4 次重复 `python3 ... 2>&1` 调用后才意识到 `2>&1` 报错；又反复 `find ai_tech_daily_*.md` 找不到文件而不知道脚本默认输出在 `~/tech-daily-news-output`；stdout 已经返回完整日报内容时仍执着搜本地文件——`loop_detector` 仅作"警告"而未给模型 actionable 的下一步反馈。

本 plan 的目标是把上述三类问题分阶段、可独立验收地修掉，**不**做 scope creep（不顺手重构 ChatPane.tsx 整体、不改 ToolCallCard 之外的渲染管线、不动 ImBubble / TerminalLine / CleanBlock 三套主气泡视觉）。

---

## 2. 真实日志根因（用户对话证据）

### 2.1 UI 层

- `desktop/src/components/ChatPane.tsx:3984-4011`：`tool_progress` 分支调用 `scheduleStreamTextUpdate("⏳ ${name} 执行中…（${streamLabel}）")`，把临时状态字符串写入 `__stream__` 占位文本，与下一段 LLM 真正回答混在同一个 assistant 气泡。
- `ChatPane.tsx:4032-4072` / `4075-4088`：`tool_call` 与 `tool_result` 两个事件各自调用 `addPaneMessageIfSessionActive(pane.id, "tool", content, "meta")`，**没有 `tool_call_id` 关联字段**——前端无法把 result 卡片合并回原 call 卡片，也无法做"回合级"聚合。
- `desktop/src/components/messages/ToolCallCard.tsx:69-162`：单卡片已具备折叠 + chevron，但缺少 `status` 概念（pending / running / done / error），更没有 Shimmer 微光动画绑在标题上。
- `desktop/src/components/messages/MessageRenderer.tsx:91-143`：每条 `tool` role 消息独立渲染为一张 `ToolCallCard`，无回合级 grouping。
- `desktop/src/components/ds/Shimmer.tsx` + `desktop/src/styles/animations.css:42-54`：`agx-working-shimmer` 微光动画已存在，但仅用于 `WorkingIndicator`（"Thinking..."），没复用到工具卡片标题。

### 2.2 后端长程层

- `agenticx/cli/agent_tools.py:1836-1859` `_try_peel_cd_prefix_parts`：检测到 `cd <path> && cmd ...` 形式后剥离 `cd`，再 `shlex.join(rest)` 把剩余 token 重组为新 command 字符串。
  - **BUG**：`shlex.join` 会对 `2>&1`、`|` 等 shell metachar 加引号，导致后续 `use_shell` 检测虽仍为 True（`>` 在正则里），但 `2>&1` 已变成 `'2>&1'`——bash 解析为字面字符串当 python argv，触发 `argparse: unrecognized arguments: 2>&1`。
  - **证据**：用户日志里 4 次 `python3 ... 2>&1`、`... 2>&1 | tail -80` 都直接 `exit_code=2 unrecognized arguments`，模型不断尝试不同写法，浪费 tool round。
- `agenticx/runtime/loop_detector.py`：四种检测器（generic_repeat / ping_pong / no_progress / tool_saturation）只产出 `LoopCheckResult` 文本警告，没有把"上一次同名工具的成功调用 + 其参数 + 其结果摘要"作为 actionable nudge 反向喂给模型。
- `tool_call` 与 `tool_result` 在 `STUDIO_TOOLS` 调度路径上没有为模型显式提示"上次类似命令在 stdout 中已返回 X / 文件已生成在 Y"，模型每次都得自己重新观察工具结果整段文本。

---

## 3. Functional Requirements (FR)

### Phase 1（UI 紧急修复）

- **FR-0**：消息列表渲染层引入 **"ReAct 块"分组**（视觉层，不改后端数据结构）：
  - 定义：从某条用户消息之后、到下一条用户消息（或 session 结束）之前，所有连续的 `assistant` + `tool` 消息构成一个 **ReActBlock**。
  - 渲染规则：整个 ReActBlock **只渲染一次** Machi 头像（锚定在块顶部），块内所有 assistant text、reasoning block、tool group 均作为子内容；中间 assistant 轮次**不再单独绘制新头像**。
  - 可选"最终答案分离"模式：若 ReActBlock 的最后一段 assistant text 长度 ≥ 阈值（默认 120 chars）且前面有过至少一次工具调用，则把最后这段文字单独渲染为第二个头像块（对标 Manus 的"完成！"块）。短回答或无工具调用的简单回复不触发分离，整块仍为 1 个头像。
  - 视觉参照：`assets/image-8d1c6cd6-…png`（Manus 双头像模式：工作块 + 最终答案块）。
  - 实现位置：`ChatPane.tsx` / `ChatView.tsx` 主消息列表渲染处，提取 `groupMessagesIntoReActBlocks(messages)` 辅助函数，输出 `ReActBlock[]`；每个 block 内部仍走现有 ToolCallGroup + ToolCallCard 渲染；**不改 `ImBubble` / `TerminalLine` / `CleanBlock` 单条消息渲染逻辑**。
  - 兼容性：旧 `messages.json` 中单条 assistant 消息（无工具调用上下文）自然形成单条 block，行为与现状一致，不出现视觉回退。

- **FR-1**：`tool_call` / `tool_result` SSE 事件必须把同一 `tool_call_id` 的 call 与 result 合并为同一 ToolCallCard 实例（result 不再生成新的独立 `tool` role 消息）。
- **FR-2**：ToolCallCard 引入 `status` 字段，至少包含 `pending` / `running` / `done` / `error` / `cancelled` 五态；`running` 时标题文本必须复用现有 `agx-working-shimmer` 微光动画（亮暗交替波浪）。
- **FR-3**：`tool_progress` SSE 事件不再写入 `__stream__` assistant 文本流，只更新对应 ToolCallCard 的 `status=running` 与可选 `elapsedSec` / 最近一行 stdout/stderr（仍走 `ToolOutputStream` 折叠区，不在标题里堆 emoji）。
- **FR-4**：同一个 LLM 回合（assistant turn）内的所有 ToolCallCard 默认聚合为一个 `TurnToolGroup`（横向 chip 行 + 总条数：「Used 4 tools · 2 file_read, 1 bash_exec, 1 todo_write」），单击展开才显示每张子卡。回合定义：相邻 tool 消息之间没有非空 assistant text；遇到 assistant text / 用户消息 / 状态切换则结束当前 group。
- **FR-5**：ToolCallCard 标题左侧图标按工具类别区分（bash_exec → Terminal、file_read/file_edit/file_write → File、todo_write → ListChecks、mcp_call → Plug、knowledge_search → Search、其他 → Wrench），保持折叠态信息密度。

### Phase 2（bash_exec 长程根因修复）

- **FR-6**：`_try_peel_cd_prefix_parts` 在原始 command 字符串包含 shell 重定向 / 管道 / 子 shell（`>` `<` `|` `` ` `` `$(` 等）时**禁止剥离 cd**，让命令整体走 `/bin/bash -c`，确保 redirect 与 pipe 语义不丢失。
- **FR-7**：当 bash_exec 子进程 stderr 命中典型「重定向被吞」错误模式（`unrecognized arguments:.*2>`、`unexpected token .*'|'`、`No such file or directory.*&&` 等）时，在工具返回值末尾追加结构化提示：
  > 检测到 shell 元字符（`2>&1` / `|` / `>` 等）可能因 cd 前缀剥离被破坏。建议改用：(a) 移除 `cd` 前缀并在 `arguments.cwd` 里指定工作目录；(b) 或加入 `bash -c "..."` 显式包裹。

  目的：让模型在下一轮自行修正而非反复试错。

### Phase 3（长程反思能力）

- **FR-8**：`LoopDetector.check()` 触发 `warning` / `critical` 时，除现有 `message` 外新增 `nudge: Optional[str]`，内容形如「最近 5 次同名 `find` 调用均未发现新路径；工具 `bash_exec` 的最近一次成功 stdout 中包含 `/Users/.../tech-daily-news-output`，可优先在该路径检索」，由 `agent_runtime` 在下一轮请求里通过 system 段（或追加到工具结果末尾）注入。
- **FR-9**：`agent_runtime` 维护进程内（per-session）"工具调用记忆"轻量结构，记录最近 N=20 次 `(tool_name, args_signature)` 与对应"产出指纹"（result 中匹配 `path` / `url` / `id=` 等的关键 token，长度上限 256 chars），供 FR-8 复用与 ToolCallCard 调试展示。
- **FR-10**：`bash_exec` 在 exit_code=0 且 stdout 长度 ≥ 阈值（默认 200 chars）时，在工具结果末尾增加一行结构化「OUTPUT_HINT: stdout 已包含 X 个非空行，主要文件路径 = …」，便于模型识别「答案已在 stdout，无需再 find」。

### Phase 4（可选增强，P2）

- **FR-11**：ToolCallCard 折叠头部右侧固定一个「复制」按钮（复制 call args + result 的合并 JSON）。

---

## 4. Non-Functional Requirements (NFR)

- **NFR-1**：零回归——`ImBubble` / `TerminalLine` / `CleanBlock` 三种聊天主气泡视觉、`SubAgentCard`、`SubAgentPanel`、`AutomationTab`、群聊 `MultiAvatarPane` 等不在本 plan 修改范围内的组件行为完全不变。
- **NFR-2**：消息持久化兼容——`messages.json` 中已有的 `role: "tool"` 历史消息（无 `toolCallId`、无 `status`）必须仍可正常渲染（自动落入"未知 group"或独立卡片，不报错、不丢失）。
- **NFR-3**：FR-3 完成后，所有 `⏳ ${name} 执行中…` / `⏳ … 执行中…（stderr）` 字符串从 `desktop/src/components/ChatPane.tsx` 与 `desktop/src/components/ChatView.tsx` 的"主聊天文本流"路径下完全消失（cc-bridge 专用文案除外，那是 cc-bridge 子模块独立 UX，由 `cc-bridge-ui.ts` 维护）。
- **NFR-4**：bash_exec FR-6 的修复必须有针对性单元测试覆盖至少 4 个 case：`cd /x && cmd 2>&1`、`cd /x && cmd | tail -5`、`cd /x && cmd > out.txt`、`cd /x && cmd`（无元字符——仍允许剥离）。
- **NFR-5**：FR-8 / FR-9 的 nudge 注入只在该 session 内启用，不污染 `chat_history`、不写入 `messages.json` 的用户可见消息流，仅作为模型上下文的"系统提示后缀"。
- **NFR-6**：所有 React 组件改动须保持现有 `chatStyle === "im" | "terminal" | "clean"` 三种视觉风格的兼容（terminal/clean 模式下 ToolCallCard 的状态化与 grouping 至少不报错；可选不出 group 装饰，但保留 status + Shimmer）。
- **NFR-7**：性能预算——同一 turn 内 30 张 tool 卡聚合为 1 个 group 时，渲染开销不得显著高于现状（粗看 React Profiler ≤ 当前 1.2x）；`tool_progress` 高频事件（最高 5 Hz）必须节流，标题动画依旧流畅。

---

## 5. Acceptance Criteria (AC)

- **AC-0**（FR-0）：在元智能体会话里跑一个涉及 3+ 轮工具调用的任务（如 `@skill://tech-daily-news`），UI 行为：
  - Machi 头像出现次数 ≤ 2（工作块一次 + 最终答案块一次），**不得**出现 3 次及以上；
  - 纯文字问答（无工具调用）的简单回复仍是 1 个头像，与现状一致；
  - 切换到含旧格式历史消息的 session 后 UI 渲染无报错、无空白。

- **AC-1**（FR-1 / FR-2 / FR-3）：在元智能体会话里手动触发一个 `bash_exec` 长命令（`sleep 2 && echo done`），UI 行为：
  - 卡片立即出现并显示 `running` 微光（亮暗波浪）；
  - 标题文本不再出现 `⏳ … 执行中…（stderr）` 字样；
  - 命令结束后同一卡片切到 `done` 静态态，title 回归普通颜色，输出折叠在卡片内。
- **AC-2**（FR-4 / FR-5）：让模型在一个回合内连续调用 3 次以上工具（如本次 `tech-daily-news` 跑全流程），UI 行为：
  - 默认折叠展示 chip 行：`Used 4 tools · 2 file_read · 1 bash_exec · 1 todo_write`；
  - 单击 chip 行展开后才看到具体卡片列表；
  - 每张卡片图标与工具类型一致。
- **AC-3**（FR-6）：新增 `tests/test_smoke_bash_exec_redirect.py`，覆盖 NFR-4 列出的 4 个 case 全绿。
- **AC-4**（FR-7）：构造 `bash_exec({ command: "cd /tmp && echo hi 2>&1" })`，工具结果末尾必须包含「检测到 shell 元字符 …」结构化提示。
- **AC-5**（FR-8 / FR-9）：新增 `tests/test_smoke_loop_detector_nudge.py` 验证 `check()` 返回的对象（不一定是 `LoopCheckResult`，可拓展 `LoopCheckResult.nudge`）在历史中存在「最近一次相同 tool 成功路径」时携带可读 nudge 字符串。
- **AC-6**（FR-10）：构造 `bash_exec({ command: "echo /Users/x/output.md" })` 直接成功，工具结果末尾须包含 `OUTPUT_HINT:` 行；构造 `bash_exec({ command: "true" })` 等空输出时不附 hint。
- **AC-7**（NFR-2）：拷贝一份既有会话 `messages.json`（含旧 `tool` 消息无 `toolCallId`），切换到该 session 后 UI 渲染无报错、无空白卡。
- **AC-8**（NFR-1）：重跑 `desktop/scripts/` 下的 vitest（如有）+ `python -m pytest tests/test_smoke_*` 抽样，不开启本 plan 引入的任何新开关时全部保持绿。

---

## 6. 任务清单（按 Phase 拆分）

> 提交规范：每个 Phase 的代码 commit 必须带 `Plan-Id: 2026-05-08-toolcall-ux-and-longrun-stability` trailer + `Plan-File:` trailer + `Made-with: Damon Li`，使用 `/commit --spec=.cursor/plans/2026-05-08-toolcall-ux-and-longrun-stability.plan.md` 自动注入。

### Phase 1 — UI 紧急修复（P0）

- [ ] **P1-T0**：在 `desktop/src/components/ChatPane.tsx`（以及 `ChatView.tsx`）主消息列表渲染处提取辅助函数 `groupMessagesIntoReActBlocks(messages: Message[]): ReActBlock[]`：
  - `ReActBlock` 类型：`{ messages: Message[]; hasFinalSplit: boolean }` — `hasFinalSplit=true` 时最后一段 assistant text 单独作为第二头像块渲染。
  - 分组逻辑：遇到 `role === "user"` 则截断当前 block、开新 block；`role === "assistant"` 或 `role === "tool"` 追加进当前 block。
  - 渲染修改：外层循环按 block 迭代，每个 block 只渲染一次 `<MachiAvatar />`，block 内部按现有 message 渲染顺序（先 ToolCallGroup / ToolCallCard，再 ImBubble 文字）；`hasFinalSplit` 时最后一段文字独立包裹在第二个 `<AvatarRow />` 中。
  - 对旧版 `messages.json`（无 `tool` 类型消息、纯 assistant 回复）：每条 assistant 消息自然是独立 block，渲染结果与现状完全一致。

- [ ] **P1-T1**：`agenticx/runtime/events.py` / SSE schema 在 `tool_call` / `tool_result` / `tool_progress` 事件 payload 中确保始终带 `id`（即 tool_call_id）。如已存在则跳过；缺失则补充并保持向后兼容（旧客户端忽略多余字段）。
- [ ] **P1-T2**：`desktop/src/store.ts` `Message` 类型新增可选字段：
  - `toolCallId?: string`
  - `toolName?: string`
  - `toolArgs?: Record<string, unknown>`
  - `toolStatus?: "pending" | "running" | "done" | "error" | "cancelled"`
  - `toolElapsedSec?: number`
  - `toolResultPreview?: string`
  - `toolGroupId?: string`（同一 turn 的卡片共享，由前端基于"上一条非 tool 消息 id + 自增计数器"派生）
  - 同步更新持久化 schema 兼容逻辑（无字段时按现状渲染）。
- [ ] **P1-T3**：`ChatPane.tsx` 与 `ChatView.tsx`：
  - 重构 `tool_call` 分支：仍 `addPaneMessageIfSessionActive(..., "tool", ...)`，但写入扩展字段 `toolCallId / toolName / toolArgs / toolStatus="running" / toolGroupId`；删除 emoji 内容前缀，content 仅保留 `JSON.stringify(args).slice(0, 200)` 作为后备 raw 内容（用于多选/复制）。
  - 重构 `tool_result` 分支：用 `updatePaneMessageByToolCallId(pane.id, toolCallId, { toolStatus, toolResultPreview, content: "<raw result>" })`，**不再 push 新消息**；找不到对应 call 则 fallback 走旧路径（兼容 NFR-2）。
  - 重构 `tool_progress` 分支：删除所有 `scheduleStreamTextUpdate("⏳ … 执行中…")` 写法；改为 `updatePaneMessageByToolCallId(pane.id, toolCallId, { toolStatus: "running", toolElapsedSec: sec, toolResultPreview: <最近一行 stdout/stderr 预览> })`。
  - 同步在 `desktop/src/store.ts` 新增 `updatePaneMessageByToolCallId` action。
- [ ] **P1-T4**：`desktop/src/components/messages/ToolCallCard.tsx`：
  - 新增 `status` / `elapsedSec` / `toolName` 渲染逻辑；
  - `running` 状态：标题文本套 `<Shimmer text=... />`；
  - `done` / `error` / `cancelled`：根据状态切换前缀图标颜色（done = text-emerald-300、error = text-rose-300、cancelled = text-text-faint），不动卡片整体边框；
  - 新增 tool-name → icon 映射（FR-5），缺省回落到 `Wrench`。
- [ ] **P1-T5**：新增 `desktop/src/components/messages/TurnToolGroupCard.tsx`：
  - 接收一组 `Message[]`（皆 role=tool 且共享 `toolGroupId`），默认折叠成 chip 行；
  - 点击展开 / 收起，展开时按顺序渲染 `ToolCallCard` 列表；
  - 折叠摘要文案：`Used N tools · ${count} ${toolName}` 排序按出现频率；
  - 兼容 N=1（直接降级为单卡，不强行 group 装饰）。
- [ ] **P1-T6**：`desktop/src/components/messages/MessageRenderer.tsx` 拆出辅助函数 `groupConsecutiveToolMessages(messages)`，调用方（`ChatPane.tsx` / `ChatView.tsx` / `ImBubble.tsx` 上一层渲染循环）按 group 渲染；具体接入点写入 `ChatPane.tsx` 主消息列表渲染处（保持影响面最小，不改 `MessageRenderer` 的单消息职责）。
- [ ] **P1-T7**：本地 `npm run dev` 在 Machi Desktop 跑一遍：触发 `bash_exec sleep 2 && echo done`、`file_read` 多次、`todo_write`，对比 AC-1 / AC-2 现象。
- [ ] **P1-T8**：commit 1 — `feat(desktop): collapse tool calls into turn-level group with shimmer status`，包含 P1-T1 ~ P1-T7。

**Phase 1 验收**：AC-1 + AC-2 + AC-7 + NFR-1 / NFR-3 / NFR-6 / NFR-7 通过。

### Phase 2 — bash_exec 长程根因修复（P0）

- [ ] **P2-T1**：修改 `agenticx/cli/agent_tools.py` `_try_peel_cd_prefix_parts`：
  - 新增 `command_str: str` 形参（或在调用处先做检测），若原始字符串包含 `(\|\||\||>|<|`|\$\()` 之一则直接 return None（不剥离）；
  - 当前正则保留作 use_shell 决策。
- [ ] **P2-T2**：在 `_tool_bash_exec` 主路径，检测命令执行后 stderr 命中以下任一模式时，向最终返回字符串末尾追加结构化提示（FR-7）：
  - `unrecognized arguments:.*2>`
  - `syntax error.*unexpected token`
  - `command not found.*&&`
- [ ] **P2-T3**：新增 `tests/test_smoke_bash_exec_redirect.py`：
  - `test_cd_prefix_kept_when_redirect`（预期不剥离 cd，bash 正确执行 `2>&1`）；
  - `test_cd_prefix_kept_when_pipe`；
  - `test_cd_prefix_kept_when_outfile`；
  - `test_cd_prefix_peeled_when_no_metachar`（保留旧行为）；
  - `test_redirect_error_hint_appended_on_argparse_failure`。
- [ ] **P2-T4**：本地跑 `pytest tests/test_smoke_bash_exec_redirect.py -v` 全绿；抽样跑 `pytest tests/test_smoke_*` 不出现新红。
- [ ] **P2-T5**：commit 2 — `fix(bash_exec): preserve shell metachars when peeling cd prefix and emit redirect hint`，包含 P2-T1 ~ P2-T4。

**Phase 2 验收**：AC-3 + AC-4 通过。

### Phase 3 — 长程反思能力（P1）

- [ ] **P3-T1**：扩展 `agenticx/runtime/loop_detector.py`：
  - `LoopCheckResult` 新增可选 `nudge: Optional[str] = None`；
  - 新增内部"成功历史"字段：`record_call(..., result_fingerprint: Optional[str])`；
  - 4 种 detector 命中时尝试构造 nudge：「同名工具 `<tool>` 最近一次成功调用产出 `<fingerprint>`，建议复用而非重复尝试」；
  - 现有 detector 行为不变（`stuck` / `level` / `message` 不变），仅追加 nudge 字段。
- [ ] **P3-T2**：`agenticx/runtime/agent_runtime.py`：
  - 在调用 LLM 前，若上一轮 `LoopCheckResult.nudge` 非空，将其作为附加 system 段（或追加到上一条 tool result 末尾，二选一以最小改动为准）注入到下一次 LLM 请求；
  - 日志结构化字段 `loop_nudge_injected=true tool=<...>` 便于 jq 过滤；
  - **不**写入 `chat_history`（NFR-5）。
- [ ] **P3-T3**：`agenticx/cli/agent_tools.py` `_tool_bash_exec` 在 exit_code=0 且 stdout 非空时，扫描 stdout 中可能的关键路径（`/Users/...`、`~/...`、`./...`、`*.md` / `*.json` 等）并取首个匹配 ≤ 2 个，向工具返回字符串末尾追加 `OUTPUT_HINT:` 行（FR-10）。
- [ ] **P3-T4**：编写 `tests/test_smoke_loop_detector_nudge.py`：
  - `test_nudge_carries_last_success_fingerprint`；
  - `test_nudge_absent_when_no_prior_success`；
  - `test_existing_loopcheckresult_fields_unchanged`。
- [ ] **P3-T5**：编写 `tests/test_smoke_bash_exec_output_hint.py`：
  - `test_hint_appended_for_long_stdout`；
  - `test_hint_skipped_for_empty_stdout`；
  - `test_hint_skipped_on_error_exit`。
- [ ] **P3-T6**：本地跑 `pytest tests/test_smoke_loop_detector_nudge.py tests/test_smoke_bash_exec_output_hint.py -v` 全绿；抽样跑 `tests/test_smoke_*` 无回归。
- [ ] **P3-T7**：commit 3 — `feat(runtime): inject actionable nudge from loop_detector and stdout hint from bash_exec`，包含 P3-T1 ~ P3-T6。

**Phase 3 验收**：AC-5 + AC-6 + NFR-5 + NFR-1（不开启时零开销）通过。

### Phase 4 — 可选增强（P2，按需触发）

- [ ] **P4-T1**：ToolCallCard 折叠头部右侧加「复制」按钮，复制 `{call_args, result_preview, status, elapsedSec}` 合并 JSON 到剪贴板（成功 toast）。
- [ ] **P4-T2**：commit 4（如启动）—— `feat(desktop): copy combined tool call payload from card header`。

**Phase 4 验收**：手工冒烟点击「复制」按钮，剪贴板得到合并 JSON。

---

## 7. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 旧 `messages.json` 中 `tool` role 消息缺 `toolCallId`，新 group 渲染逻辑出现空 group | 中 | 中 | NFR-2 + AC-7 强制兼容；`groupConsecutiveToolMessages` 在缺字段时按 1:1 退化为单卡 |
| `_try_peel_cd_prefix_parts` 改动误伤合法 `cd /x && cmd`（无元字符）路径 | 中 | 中 | NFR-4 测试覆盖第 4 个 case 即"无元字符仍剥离"；同时确保 cwd 解析逻辑保持原样 |
| FR-8 nudge 注入打断模型既有思路、引入幻觉 | 中 | 中 | 仅在 `LoopCheckResult.stuck=True` 且历史确实存在 success fingerprint 时注入；nudge 短句 ≤ 200 chars；可加配置开关 `runtime.loop_detector.inject_nudge` 默认 True，问题严重时可一键关 |
| FR-10 OUTPUT_HINT 在已有 stdout 包含 emoji 表情或彩色 ANSI 时注入失败/乱码 | 低 | 低 | 路径扫描正则限定 ASCII 字符 + 可选汉字；失败时静默跳过，绝不抛异常 |
| Phase 1 同一 turn 多卡聚合显著增加渲染开销 | 低 | 中 | NFR-7；如出现性能问题，回退为只对 N ≥ 3 卡片才聚合 |
| `__stream__` 占位文本逻辑被 P1-T3 改动后影响 reasoning（`<think>`）/ token 流式渲染 | 中 | 高 | P1-T3 仅删除 `tool_progress` → `scheduleStreamTextUpdate` 的写法；`token` / `reasoning` 路径完全不动；提交前手工跑一段含 think 的回答验证 ReasoningBlock 仍正常 |

**回滚策略**：

1. 每个 Phase 独立 commit，遇问题 `git revert <commit>` 即可单独回滚。
2. Phase 1 改动集中于 `desktop/src/components/messages/ToolCallCard.tsx` / 新增 `TurnToolGroupCard.tsx` / `MessageRenderer.tsx` / `ChatPane.tsx` / `ChatView.tsx` / `store.ts`；revert 不影响 Phase 2 / 3。
3. Phase 2 改动集中于 `agenticx/cli/agent_tools.py` `_try_peel_cd_prefix_parts` 与 `_tool_bash_exec` 末尾 hint 注入；revert 不影响其他 STUDIO_TOOLS。
4. Phase 3 改动集中于 `agenticx/runtime/loop_detector.py` 字段扩展 + `agent_runtime.py` 注入点 + `agent_tools.py` OUTPUT_HINT；revert 后 `LoopCheckResult.nudge` 字段消失，行为退回纯警告。

---

## 8. 验证与度量

- **代码层度量**：
  - `ruff check agenticx/cli/agent_tools.py agenticx/runtime/loop_detector.py agenticx/runtime/agent_runtime.py` 零报错；
  - `mypy` 视项目现状择优执行；
  - `npm run typecheck`（在 `desktop/`）零报错；
  - `pytest tests/test_smoke_bash_exec_redirect.py tests/test_smoke_loop_detector_nudge.py tests/test_smoke_bash_exec_output_hint.py -v` 全绿。
- **运行时度量**（手工冒烟）：
  - 重跑 `@skill://tech-daily-news` 一次，对比修复前后：
    - tool 卡片视觉条数（应从 ~15 张缩为 1 个 group + 内部展开 ~15 卡）；
    - "⏳ … 执行中…（stderr）" 字符串出现次数（应为 0）；
    - `2>&1` 重定向相关错误（应为 0）；
    - `find` 同名重复调用次数（应 ≤ 2）。
- **观测**：`agenticx/runtime/agent_runtime.py` 注入 nudge 时打印结构化日志 `loop_nudge_injected=true session=<id> tool=<name>`。

---

## 9. 不在范围（明确否决）

- **不**重写 `ChatPane.tsx` 整体（仅最小改 `tool_call` / `tool_result` / `tool_progress` 三个分支与 messages 渲染处）。
- **不**改 `ImBubble` / `TerminalLine` / `CleanBlock` 三种主气泡视觉。
- **不**改 `SubAgentCard` / `SubAgentPanel` / 群聊侧的工具状态展示（子智能体侧 `currentAction` 文案沿用现状，避免连带影响 spawn / 委派 UX）。
- **不**改 `cc-bridge-ui.ts` 的专用文案（cc-bridge 模式有自己的解释逻辑，不强行收敛）。
- **不**重构 `loop_detector` 4 种 detector 的判定逻辑，只追加 `nudge` 字段。
- **不**引入 `tool_call_id` 之外的新关联机制（如 span tracing），保持改动最小。
- **不**做工具调用结果的服务端聚合（如"折叠 N 次重复 file_read 为 1 行"），所有聚合逻辑都在前端渲染层。

---

## 10. 关联文件锚点

- 用户视觉参照：`assets/image-dee69edf-…png`（Cursor 折叠态）、`assets/image-3ea9f5c5-…png`（Cursor 进行中 Shimmer）、`assets/image-66a3cafe-…png`（当前 Machi 工具卡堆叠）、`assets/image-8d1c6cd6-…png`（Manus 双头像工作块+最终答案块模式）、`assets/image-93bb9183-…png`（Machi 当前多头像问题截图）。
- 后端：
  - `agenticx/cli/agent_tools.py`（`_try_peel_cd_prefix_parts` / `_tool_bash_exec` / `_bash_exec_shell_argv`）
  - `agenticx/runtime/loop_detector.py`（`LoopCheckResult` / 4 种 detector）
  - `agenticx/runtime/agent_runtime.py`（loop check 接入点 / 工具结果回传给 LLM 的位置）
  - `agenticx/runtime/events.py`（tool_call / tool_result / tool_progress 事件 schema）
- 前端：
  - `desktop/src/store.ts`（`Message` 类型 + 新 action `updatePaneMessageByToolCallId`）
  - `desktop/src/components/ChatPane.tsx:3984-4172`（SSE 处理三大分支）
  - `desktop/src/components/ChatView.tsx`（同上，Lite 路径）
  - `desktop/src/components/messages/MessageRenderer.tsx`（grouping 接入点）
  - `desktop/src/components/messages/ToolCallCard.tsx`（status / icon / Shimmer）
  - `desktop/src/components/messages/TurnToolGroupCard.tsx`（**新建**）
  - `desktop/src/components/messages/ToolOutputStream.tsx`（折叠区接入新 status）
  - `desktop/src/components/ds/Shimmer.tsx` + `desktop/src/styles/animations.css`（已有动画，复用）
- 既往同源 plan：`.cursor/plans/2026-05-07-symphony-longrun-internalization.plan.md`（FR-8 的 nudge 思路与 Phase 3 的`TaskStallDetector` 互为补充，本 plan 不依赖其落地）。
