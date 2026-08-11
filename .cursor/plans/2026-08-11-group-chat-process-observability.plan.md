# 群聊过程可观测性：三层投影（消息流轻状态 / 成员活动侧栏 / 运行图）

Planned-with: Opus 5
Suggested-Impl-Model: 见「Suggested-Impl 子任务表」（分阶段不同模型）

> **For implementers:** 仅凭本 plan 即可落地；勿依赖对话记忆。所有落点均给出文件路径 + 函数名 + 行号锚点。

**Goal:** 群聊中分身调用工具的过程不再平铺污染消息流。同一份运行数据做三层投影：消息流只保留「谁在忙」的一行轻状态；成员活动侧栏展示「某成员具体做了哪些工具步骤」；运行图展示「整个回合的任务流转」。三者共享同一 store 与选中态，不出现互相矛盾的状态。

**Architecture:** 后端 `group_progress` SSE 事件当前只有 `avatar_name` / `content`（人类可读长文本），无法归属到运行图节点。本方案给该事件补 `graph_run_id` / `graph_node_id` / 结构化工具字段（`tool_name` / `tool_phase` / `tool_call_id`），前端不再把它塞进消息流 message 列表，而是写入 `useGraphRunStore` 的 `toolStepsByNode`，由成员侧栏与运行图共同消费。`graph_run_id` 已存在于 `base_session.scratchpad["graph_run_id"]`（见证据链 3），节点 ID 沿用既有 `agent:{avatar_id}` 约定，无需新建图。

**Tech Stack:** Python（`agenticx/runtime/group_router.py`、`agenticx/studio/server.py`）+ React/Zustand（`desktop/src/components/graph/*`、`ChatPane.tsx`）+ pytest smoke + vitest。

---

## 根因与证据链

1. **群聊工具进度被排除在聚合卡之外**，退化为逐条扁平文本行：

   ```
   desktop/src/components/messages/group-tool-messages.ts:12
   if ((message.toolName ?? "").trim() === "group_progress") return false;
   ```

   单聊侧 `TurnToolGroupCard`（默认折叠 + 「已调用 N 次工具」摘要 + 实时计时）群聊完全用不上。

2. **身份被硬拼进文案**，与专家标签重复：

   ```
   desktop/src/components/ChatPane.tsx:9040
   const progressTitle = `${avatarName}：${progressText}`;
   ```

   同一成员还在 `groupTyping` 里再渲染一个带 `expertLabelChipStyle` 的 `ImBubble`（L7596-7614），故截图中「架构师·阿析」出现两次。

3. **`graph_run_id` 已可用但未随进度事件下发**：
   - `group_router.py:577` / `:632`：`pad["graph_run_id"] = run.run_id`（presence run）
   - `group_router.py:1946`：`scratch["graph_run_id"] = graph_run.run_id`（workforce run）
   - 但 `GroupReply`（`:266-274`）无任何 graph 字段，`server.py:3047-3058` 的 SSE data 也只透出 6 个字段。

4. **工具结果整段塞进状态行**：

   ```
   group_router.py:498-502
   if len(result_preview) > 220: result_preview = result_preview[:217] + "..."
   return f"工具已完成：{tool_name} · {result_preview}"
   ```

   叠加 MCP 原始 ID（`mcp__metaso-search__metaso_search`）后单行极长。

5. **去重键用文本，会吞掉重复工具调用**：

   ```
   desktop/src/components/ChatPane.tsx:9046-9048
   const prevText = lastGroupProgressRef.current[eventAgentId] ?? "";
   if (prevText === progressText) continue;
   ```

   同一分身连续两次调用同一工具（如搜两次）时，第二次事件被丢弃，进度停在旧状态。

6. **运行图与工具进度节奏不一致**：`RunGraphPanel` 为 4 秒轮询（`RunGraphPanel.tsx:76-80` 的 `setInterval(..., 4000)`），而进度是 SSE 实时推。若侧栏也走轮询，会出现「消息流已显示在搜网页、侧栏仍空」的状态不同步。

## In scope

- `GroupReply` 新增 graph / tool 结构化字段；两处进度 emit 点接线
- `_runtime_event_to_progress_text` 拆出结构化 `_runtime_event_to_tool_step`；状态文案去掉结果预览
- `server.py` 群聊 SSE data 透出新字段
- `graph-types.ts` 新增 `ToolStep` + `toolStepsByNode`；`useGraphRun.ts` 新增 `applyToolStep`
- `ChatPane.tsx` 的 `group_progress` 分支改为写 graph store，不再 `addPaneMessageIfSessionActive`
- 新组件 `MemberActivityList.tsx`，挂载进 `GroupMembersSidePanel`
- 消息流保留「一个成员一行」轻状态（复用 `groupTyping` 通路，文案带当前工具）
- MCP 工具名可读化工具函数 + 单测
- 双向选中联动（侧栏 ↔ 运行图，复用 `setSelected`）
- 对应 pytest + vitest

## Out of scope / no-scope-creep

- **不改** `group_blocked` / `group_clarification` 通路——阻塞式确认必须留在消息流（侧栏关闭时用户看不到会导致任务永久卡住）
- **不改** 历史会话中已持久化的 `group_progress` tool message 渲染（`MessageRenderer.tsx:366` 的 `GroupProgressLine` 保留作向后兼容；不做存量迁移）
- **不改** `RunGraphCanvas` 布局算法、`GraphInterveneDock` 干预语义
- **不改** 单聊 `TurnToolGroupCard` / `ImBubble` 现有行为
- **不做** 工具步骤落盘持久化（Phase 3，本 plan 只定义接口位，不实现）
- **不改** `desktop/electron/*` 主进程、`enterprise/*`
- **不动** `agenticx/studio/server.py` 顶部 import 区块（见 AGENTS.md 强约束）

## Suggested-Impl 子任务表

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| Phase 1 后端事件契约 + 接线 | GPT-5.6 Terra | 跨 router/server 的字段透传，落点明确但需保序不误删 |
| Phase 2a graph store 扩展（纯数据） | Composer 2.5 Fast | 纯函数 + reducer 样板 |
| Phase 2b 侧栏 UI + 轻状态视觉 | Claude Opus 5 Thinking | 需要视觉品味与微信级交互手感 |
| Phase 2c 选中联动 + 去重键重构 | GPT-5.6 Terra | 跨组件状态一致性，回归风险高 |
| 单测（pytest + vitest） | Composer 2.5 Fast | 样板断言 |

---

## FR / AC

### FR-1：`group_progress` 事件携带 graph 归属与结构化工具字段

**落点：** `agenticx/runtime/group_router.py`

`GroupReply` dataclass（当前 `:266-274`）追加字段，**仅新增、不改动既有 6 个字段的顺序与默认值**：

```python
@dataclass
class GroupReply:
    agent_id: str
    avatar_name: str
    avatar_url: str
    content: str
    skipped: bool = False
    error: str = ""
    event_type: str = "group_reply"
    confirm_request_id: str = ""
    # --- new (FR-1) ---
    graph_run_id: str = ""
    graph_node_id: str = ""
    tool_name: str = ""
    tool_phase: str = ""      # "calling" | "done" | ""
    tool_call_id: str = ""
```

新增静态方法（放在 `_runtime_event_to_progress_text` 之后，约 `:517` 后）：

```python
@staticmethod
def _runtime_event_to_tool_step(event_type: str, data: Dict[str, Any]) -> Dict[str, str]:
    """Structured tool step for graph projection (no long previews)."""
    et = str(event_type or "")
    if et == EventType.TOOL_CALL.value:
        phase = "calling"
    elif et == EventType.TOOL_RESULT.value:
        phase = "done"
    else:
        return {}
    tool_name = str(data.get("name", "") or data.get("tool_name", "") or "tool")
    call_id = str(data.get("id", "") or data.get("tool_call_id", "") or "")
    return {"tool_name": tool_name, "tool_phase": phase, "tool_call_id": call_id}
```

新增 helper 读取 run id（放在 `_graph_sse_reply` 附近）：

```python
@staticmethod
def _graph_run_id_of(base_session: StudioSession) -> str:
    pad = getattr(base_session, "scratchpad", None)
    if not isinstance(pad, dict):
        return ""
    return str(pad.get("graph_run_id") or "").strip()
```

- **AC-1.1:** `_runtime_event_to_tool_step` 对 `TOOL_CALL` 返回 `phase == "calling"`，对 `TOOL_RESULT` 返回 `"done"`，对 `ROUND_START` / `FINAL` 返回 `{}`。
- **AC-1.2:** `graph_node_id` 格式为 `agent:{avatar_id}`；若 `avatar_id` 已带 `agent:` 前缀则不重复添加（与 `_project_a2a_message_edge` 的 `src`/`tgt` 归一化逻辑一致，见 `:578-587`）。
- **AC-1.3:** 测试文件 `tests/test_smoke_group_progress_tool_step.py`，断言上述两条 + `GroupReply` 默认值向后兼容（不传新字段时全为 `""`）。

### FR-2：状态文案去掉结果预览

**落点：** `agenticx/runtime/group_router.py:488-502`（`_runtime_event_to_progress_text` 的 `TOOL_RESULT` 分支）

Before：

```python
if result_preview and result_preview not in {"{}", "null", "None"}:
    return f"工具已完成：{tool_name} · {result_preview}"
return f"工具已完成：{tool_name}"
```

After：

```python
# Result body belongs to the assistant reply / side panel detail, not the
# one-line status. Keep the status row scannable.
return f"工具已完成：{tool_name}"
```

`TOOL_CALL` 分支（`:473-487`）的 `args_preview` 同理收敛：状态文案只保留 `正在调用工具：{tool_name}`，参数预览改为随 `tool_step` 下发（`args_preview` 字段可选，Phase 3 使用）。

- **AC-2.1:** `_runtime_event_to_progress_text(EventType.TOOL_RESULT.value, {"name": "web_search", "result": "x" * 500})` 返回 `"工具已完成：web_search"`，长度 < 40。
- **AC-2.2:** 上述断言写入 `tests/test_smoke_group_progress_tool_step.py`。

### FR-3：两处 emit 点接线 + SSE 透出

**落点 A：** `group_router.py:1145-1153`（`_progress_reply` 调用，「已接收任务」）——补 `graph_run_id` / `graph_node_id`。

**落点 B：** `group_router.py:1175-1185`（runtime 事件循环内的 `GroupReply(...)` 构造）——补 5 个新字段：

```python
tool_step = self._runtime_event_to_tool_step(event.type, event.data)
progress_queue.put_nowait(
    GroupReply(
        agent_id=avatar_id,
        avatar_name=avatar_name,
        avatar_url=avatar_url,
        content=progress_text,
        skipped=True,
        event_type=group_evt_type,
        confirm_request_id=confirm_request_id,
        graph_run_id=self._graph_run_id_of(base_session),
        graph_node_id=f"agent:{avatar_id}",
        tool_name=tool_step.get("tool_name", ""),
        tool_phase=tool_step.get("tool_phase", ""),
        tool_call_id=tool_step.get("tool_call_id", ""),
    )
)
```

**落点 C：** `agenticx/studio/server.py:3047-3058` 的 `SseEvent` data dict——**只追加 key，不动既有 key**：

```python
"graph_run_id": str(getattr(reply, "graph_run_id", "") or ""),
"graph_node_id": str(getattr(reply, "graph_node_id", "") or ""),
"tool_name": str(getattr(reply, "tool_name", "") or ""),
"tool_phase": str(getattr(reply, "tool_phase", "") or ""),
"tool_call_id": str(getattr(reply, "tool_call_id", "") or ""),
```

- **AC-3.1:** 群聊一轮工具调用后，SSE `group_progress` 事件的 `data.graph_node_id` 非空且形如 `agent:<id>`。
- **AC-3.2:** `graph_run_id` 为空（presence run 尚未建立）时不抛异常，前端按 FR-4 降级为「仅显示轻状态」。
- **AC-3.3:** 改完 `server.py` 后**必须**冷启动验证：`agx serve --host 127.0.0.1 --port <临时端口>`，确认进程不崩溃且 `/api/session`、`/api/avatars`、`/api/sessions` 返回 200（AGENTS.md 强制门槛）。

### FR-4：前端 graph store 承载工具步骤

**落点：** `desktop/src/components/graph/graph-types.ts`

新增类型（放在 `GraphProjection` 之后，约 `:41` 后）：

```typescript
export type ToolStep = {
  callId: string;
  toolName: string;
  phase: "calling" | "done";
  /** epoch ms of first observation */
  startedAt: number;
  updatedAt: number;
};
```

`PaneGraphState`（`:85-96`）追加 `toolStepsByNode: Record<string, ToolStep[]>`；`emptyPaneGraphState()`（`:98-110`）初始化为 `{}`。

⚠️ 注意 `:112-118` 已有的注释约束：`EMPTY_PANE_GRAPH_STATE` 是共享单例，**禁止原地 mutate**，写入必须先拷贝。

新增 reducer（纯函数，同文件）：

```typescript
export function applyToolStepToState(
  state: PaneGraphState,
  nodeId: string,
  step: ToolStep,
): PaneGraphState {
  if (!nodeId || !step.callId) return state;
  const prev = state.toolStepsByNode[nodeId] ?? [];
  const idx = prev.findIndex((s) => s.callId === step.callId);
  const next = idx >= 0
    ? prev.map((s, i) => (i === idx ? { ...s, phase: step.phase, updatedAt: step.updatedAt } : s))
    : [...prev, step];
  return { ...state, toolStepsByNode: { ...state.toolStepsByNode, [nodeId]: next } };
}
```

**落点：** `desktop/src/components/graph/useGraphRun.ts:32-73`——新增 action：

```typescript
applyToolStep: (paneId: string, nodeId: string, step: ToolStep) =>
  set((s) => ({
    byPane: {
      ...s.byPane,
      [paneId]: applyToolStepToState(ensureMutable(s.byPane, paneId), nodeId, step),
    },
  })),
```

- **AC-4.1:** 同一 `callId` 的 `calling` → `done` 更新为**原地 phase 变更**，数组长度不变。
- **AC-4.2:** 不同 `callId`（同一 `toolName` 连调两次）追加为 2 条——直接覆盖证据链 5 的去重 bug。
- **AC-4.3:** 测试文件 `desktop/src/components/graph/tool-steps.test.ts`，含上述两条 + 空 `nodeId`/空 `callId` 原样返回。

### FR-5：`group_progress` 不再进入消息流

**落点：** `desktop/src/components/ChatPane.tsx:9036-9074`

Before（现状）：拼 `progressTitle` → `updatePaneToolMessageForSession` / `addPaneMessageIfSessionActive` 造一条 `toolName: "group_progress"` 的 tool message。

After（意图伪代码）：

```typescript
if (payload.type === "group_progress") {
  const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
  const nodeId = String(payload.data?.graph_node_id ?? "").trim();
  const callId = String(payload.data?.tool_call_id ?? "").trim();
  const toolName = String(payload.data?.tool_name ?? "").trim();
  const phase = String(payload.data?.tool_phase ?? "").trim();
  const progressText = String(payload.data?.content ?? "").trim();

  // 1) 轻状态：一个成员一行，原地更新（不新增消息行）
  setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
  setGroupActivityHint((prev) => ({ ...prev, [eventAgentId]: progressText }));

  // 2) 明细：写入 graph store，由成员侧栏 / 运行图消费
  if (nodeId && callId && (phase === "calling" || phase === "done")) {
    const now = Date.now();
    useGraphRunStore.getState().applyToolStep(pane.id, nodeId, {
      callId, toolName, phase, startedAt: now, updatedAt: now,
    });
  }
  continue;
}
```

同时删除 `lastGroupProgressRef` 对 `group_progress` 的按文本去重（保留其对 `group_blocked` 的用法，`:9086-9088` 不动）。

- **AC-5.1:** 群聊调用 3 次工具后，`pane.messages` 中 `toolName === "group_progress"` 的条目数为 **0**。
- **AC-5.2:** 同一分身连调两次 `web_search`，侧栏显示 2 条步骤（回归证据链 5）。
- **AC-5.3:** `group_blocked` / `group_clarification` 仍产生消息流内的交互卡（回归保护，禁止一并移除）。
- **AC-5.4:** `graph_node_id` 为空时不写 store，但轻状态仍显示——降级可用。

### FR-6：成员活动侧栏

**新建：** `desktop/src/components/graph/MemberActivityList.tsx`

- Props：`{ paneId: string; agentIds: string[]; avatarById: Map<string, Avatar> }`
- 数据源：`useGraphRunStore((s) => s.byPane[paneId]?.toolStepsByNode ?? {})`，按 `agent:{id}` 取该成员步骤
- 每成员一行头部：分身色点（复用 `desktop/src/utils/avatar-color.ts`）+ 名称 + 状态（`运行中 · {elapsed}s` / `空闲`）
- 展开后列出工具步骤：可读工具名（FR-7）+ phase 图标；默认折叠，与 `ToolCallCard` 折叠语义一致
- 点击某成员/步骤 → `useGraphRunStore.getState().setSelected(paneId, [nodeId])`

**挂载点：** `desktop/src/components/ChatPane.tsx:2043` 的 `GroupMembersSidePanel` 内部，作为成员网格**下方**的独立区块（与 AGENTS.md 「成员区 → 列表」的自上而下编排一致）。父级挂载处 `:12372-12377` 需把 `paneId` 传入。

- **AC-6.1:** 侧栏关闭 → 打开后，已完成的步骤仍可见（store 保留，不随面板卸载清空）。
- **AC-6.2:** 步骤更新经 SSE 实时反映，**不等** `RunGraphPanel` 的 4s 轮询（回归证据链 6）。断言方式：mock 一次 `applyToolStep` 后立即断言渲染结果，不引入 timer。
- **AC-6.3:** 多分身并发时按成员分组，不串台。

### FR-7：MCP 工具名可读化

**新建：** `desktop/src/components/messages/tool-display-name.ts`

```typescript
/** mcp__metaso-search__metaso_search → 「metaso · metaso_search」 */
export function formatToolDisplayName(raw: string): string {
  const name = String(raw ?? "").trim();
  if (!name) return "工具";
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (m) return `${m[1]} · ${m[2]}`;
  return name;
}
```

- **AC-7.1:** `formatToolDisplayName("mcp__metaso-search__metaso_search")` → `"metaso-search · metaso_search"`。
- **AC-7.2:** `formatToolDisplayName("web_search")` → `"web_search"`（非 MCP 原样返回）。
- **AC-7.3:** 空串 → `"工具"`。
- **AC-7.4:** 测试文件 `desktop/src/components/messages/tool-display-name.test.ts`。

### FR-8：双向选中联动

- 侧栏点击 → `setSelected(paneId, [nodeId])`（已有 action，`useGraphRun.ts:48-65`）
- 运行图点击节点 → 已写入 `selectedNodeIds`；侧栏订阅该值，滚动到对应成员并展开
- **AC-8.1:** `setSelected` 已有的「同值不触发更新」短路逻辑（`:53-58`）保持不变，避免渲染循环。
- **AC-8.2:** 侧栏与图选中态读同一 `selectedNodeIds`，不新增第二份选中状态。

---

## 实施阶段与验收门槛

| Phase | 内容 | 门槛 |
|-------|------|------|
| 1 | FR-1 / FR-2 / FR-3（后端） | pytest 绿 + `agx serve` 冷启动 smoke（AC-3.3） |
| 2a | FR-4（store 纯数据） | vitest 绿 |
| 2b | FR-6 / FR-7（侧栏 UI） | 本机群聊实测：消息流无平铺工具行，侧栏可见步骤 |
| 2c | FR-5 / FR-8（消息流改造 + 联动） | AC-5.1~5.4 全过，特别是 5.3 阻塞卡回归 |
| 3 | 工具步骤落盘（历史回看） | 本 plan 不实施，另开 plan |

每个 Phase 独立 `npm run typecheck` + `npm run build` 绿后再进下一段。

## 风险与回归清单

1. **阻塞确认丢失**（最高危）：FR-5 改造时若误把 `group_blocked` 一并移出消息流，侧栏关闭态下任务会永久卡住。AC-5.3 专门守这条。
2. **可感知性退化**：过程全移侧栏且轻状态做得太弱，会撞上「只有『正在输入』看不到在做什么」的既有痛点。FR-5 的 `groupActivityHint` 是必需项，不是可选装饰。
3. **多窗格串台**：`toolStepsByNode` 按 `paneId` 分桶，勿用全局单键。
4. **历史会话空态**：存量 session 的 `messages.json` 里已有 `group_progress` tool message，仍走 `GroupProgressLine`；新逻辑不得让这些历史行消失。
5. **`server.py` import 区**：本次只在 `:3047-3058` 追加 dict key，**不要**触碰文件顶部 import 段（AGENTS.md 记录过误删 `GroupChatRegistry` 导致 `agx serve` 启动即崩的事故）。
