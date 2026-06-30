---
name: ""
overview: ""
todos: []
isProject: false
---

# Reasoning Chain Persistence（思考链持久化）

Planned-with: GLM 5.2

## 背景与问题

Desktop 聊天中的「思考了 X 秒 / 思考中…」推理链（ReasoningBlock）目前**只在流式阶段可见**，turn 完成或切换会话回来后会消失，造成「显示 → 消失」的不一致体验。

根因（已查证）：

- 推理内容由 **provider 层**把上游 `reasoning_content` 包成 `<think>…</think>` 流式 token 下发：
  - `agenticx/llms/litellm_provider.py:423-459`
  - `agenticx/llms/kimi_provider.py:366-403`
- 前端流式累积的文本含 `<think>`，所以**流式中**与**刚提交的内存消息**能渲染 ReasoningBlock。
- 但后端持久化的最终正文取自 `response.content`（`agenticx/runtime/agent_runtime.py:2768` → `final_text`），**不含 `<think>`**；`_sanitize_structured_assistant_text` 也不注入 think。
- 因此磁盘 `messages.json` 的 assistant 消息**没有 reasoning**；切回会话走纯磁盘加载（`mapLoadedSessionMessage`）即丢失推理链。
- 关联：内存（含 think）与磁盘（无 think）正文不一致曾导致 `mergeSessionMessagesTail` 匹配失败、重复 assistant 行与 references 丢失——已在前序改动中通过「正文回退匹配 + 去重守卫」修复（`desktop/src/utils/session-message-merge.ts`）。本 plan 在该修复基础上，进一步把推理链做成**可持久化、前后一致**的能力。

## 目标

让推理链成为**一等持久化数据**：turn 完成后、切换会话后、应用重启后，「思考了 X 秒」可展开块保持稳定一致，可展开查看推理正文。

## 设计要点（决策）

1. **推理作为独立字段持久化，不混入 `content`**：新增 `reasoning`（文本）与 `reasoning_seconds`（整数秒）字段，挂在 assistant 消息上。**不**把 `<think>` 写回 `content`，避免推理正文被重新喂给 LLM 造成上下文污染与 token 成本上升。
2. **时长持久化**：`reasoning_seconds` 由后端在本轮捕获（首个 reasoning token 到首个正文 token 的间隔，回退用 reasoning 字符数估算或现有 stream 计时）。前端 `ReasoningBlock` 增加可选 `seconds` prop，优先使用持久化时长，缺失时回退现有 `reasoning-duration-cache` 行为。
3. **体积上限**：持久化 `reasoning` 截断到上限（建议 16KB），避免 `messages.json` 膨胀。
4. **来源单一**：渲染优先级为「持久化 `message.reasoning` > 从 `content` 解析的 `<think>`」。流式阶段仍走 `content` 内 `<think>`（实时）；finalize/reload 后走持久化字段。两路产出同一 ReasoningBlock，视觉与折叠行为一致。
5. **范围隔离**：仅改 Desktop 聊天主链路（Meta/群聊/分身/automation 共用的 ImBubble 渲染与 session 持久化/映射）。不动 enterprise、不动 Lite 专属逻辑（ChatView 共用 ImBubble，自动受益）。

## 需求（FR / NFR / AC）

**FR-1 后端捕获推理**：在 `agent_runtime` 最终回答分支捕获本轮 reasoning 文本与秒数。
**FR-2 后端持久化**：`_hist_assistant` 与 `_final_data` 携带 `reasoning` / `reasoning_seconds`；`session_manager` 归一化并写入 `messages.json`（截断、类型校验）。
**FR-3 前端读取**：`LoadedSessionMessage` + `mapLoadedSessionMessage` 解析 `reasoning` / `reasoning_seconds`；`Message` 类型新增对应字段。
**FR-4 前端渲染**：`ImBubble` 在 `message.reasoning` 存在时渲染 ReasoningBlock（非流式、传入持久化秒数）；与 content 内 `<think>` 解析二选一，避免重复。
**FR-5 合并保真**：`overlayMemoryEnrichment`（`session-message-merge.ts`）保留 `reasoning` / `reasoning_seconds`，使 turn 完成后的内存态与磁盘态一致。
**FR-6 SSE final 即时一致**：finalize 时把 `final` 事件的 `reasoning` / `reasoning_seconds` 合并到内存最终 assistant 消息（`mergeLastPaneMessageByRole`），使「刚完成」即等于「重载后」。

**NFR-1 一致性**：同一 turn 在流式中、完成后、切走再切回、重启后，推理链展示完全一致（有/无、秒数、正文）。
**NFR-2 无回退**：不得重新引入重复 assistant 行、references 丢失或行间距问题（前序修复保持绿）。
**NFR-3 体积/上下文**：推理不进入 `content`、不回喂 LLM；`messages.json` 单条 reasoning ≤ 16KB。
**NFR-4 兼容旧数据**：旧 `messages.json`（无 reasoning 字段）正常加载，不报错、不渲染空推理块。

**AC-1**：开启思考的模型（如 DeepSeek-R1/Qwen3/Kimi/GLM 思考态）跑一轮 → 完成后「思考了 X 秒」仍在、可展开见推理正文。
**AC-2**：切到其他会话再切回该会话 → 推理链与切走前一致（不消失、不重复、秒数一致）。
**AC-3**：完全重启应用 → 历史会话该 turn 的推理链仍可见且可展开。
**AC-4**：不支持思考的模型 → 无推理块，行为与现状一致。
**AC-5**：旧历史会话加载无报错；`session-message-merge` 与既有冒烟测试全绿。

## 实施阶段

### Phase 0 — 取证与基线（read-only）
- [ ] 确认 `response.reasoning_content` / 最终 message 是否暴露 reasoning（`kimi_provider.py:446` 已有先例），决定后端「捕获 reasoning」取值来源：优先 `response.reasoning_content`，回退累积流式 `<think>` 文本解析。
- [ ] 记录一条真实 `messages.json` assistant 样本，确认当前 `content` 无 `<think>`。

### Phase 1 — 后端捕获与持久化（FR-1/FR-2）
- [ ] `agent_runtime.py`：在最终回答分支计算 `reasoning_text` / `reasoning_seconds`，写入 `_hist_assistant` 与 `_final_data`（截断 16KB；秒数 ≥1 才写）。
- [ ] `session_manager.py`（约 1949-1986 assistant 归一化块）：新增 `reasoning`（str 截断）与 `reasoning_seconds`（int>0）落盘。
- [ ] 后端单测/冒烟：构造带 reasoning 的 assistant item → 持久化与回读字段保真、截断生效。
- [ ] 验证：`python -m pytest tests/ -k reasoning_persist`（新增）。

### Phase 2 — 前端读取与类型（FR-3）
- [ ] `desktop/src/store.ts`：`Message` 新增 `reasoning?: string` 与 `reasoningSeconds?: number`。
- [ ] `session-message-map.ts`：`LoadedSessionMessage` 增 `reasoning?` / `reasoning_seconds?`；`mapLoadedSessionMessage` 对 assistant 解析这两个字段。
- [ ] 验证：`npx tsc --noEmit` 改动文件零新增错误。

### Phase 3 — 前端渲染与合并保真（FR-4/FR-5/FR-6）
- [ ] `ReasoningBlock.tsx`：新增可选 `seconds?: number`，存在时直接用于 `formatReasoningTitle`，不依赖计时缓存。
- [ ] `ImBubble.tsx`：当 `!isStreaming && message.reasoning` 存在时，用持久化字段渲染 ReasoningBlock（`text=message.reasoning`、`seconds=message.reasoningSeconds`）；流式态仍走 content 内 `<think>`；保证二者不同时渲染（避免重复）。
- [ ] `session-message-merge.ts` `overlayMemoryEnrichment`：保留 `reasoning` / `reasoningSeconds`（`memory.x ?? diskRow.x`）。
- [ ] `ChatPane.tsx` finalize：把 `final` 事件 reasoning 合并到最终 assistant 消息（FR-6）。
- [ ] 验证：`npx vitest run src/utils/session-message-merge.test.ts` 全绿 + 新增渲染保真用例。

### Phase 4 — 端到端验收（AC-1..5）
- [ ] 手动按 AC-1..4 走查（思考模型 + 非思考模型，切会话、重启）。
- [ ] 回归：前序「重复 assistant / references 丢失 / 行间距」三项不复发（NFR-2）。

## 风险与回滚
- 风险：触及流式提交/持久化高回归区。缓解：reasoning 走**独立字段**、渲染**降级安全**（无字段即现状）、合并用既有保真路径，单测先行。
- 回滚：移除前端渲染分支即恢复「流式可见、完成后折叠」的当前一致行为；后端字段为附加项，旧前端忽略即可。

## 关联
- 前序修复：`desktop/src/utils/session-message-merge.ts`（正文回退匹配 + 去重守卫）、`desktop/src/components/messages/ImBubble.tsx`（ReAct 行间距统一）、`desktop/src/components/messages/{ReasoningBlock,ReferencesCard,TurnToolGroupCard}.tsx` + `im-layout.ts`（rail 标题排版统一）。