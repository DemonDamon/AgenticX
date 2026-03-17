---
name: ""
overview: ""
todos: []
isProject: false
---

# 流式 Tool Call 展示位置修复 & 输入卡顿优化

## 背景

用户反馈两个 UI 问题：

1. **Tool Call 展示位置反直觉**：streaming 期间收到 tool_call 事件时，tool 消息出现在 streaming 文本**上方**而非下方
2. **输入卡顿**：streaming 期间 textarea 输入响应迟缓

## 问题 1：Tool Call 展示位置

### 根因分析

渲染结构为：

```
{visibleMessages.map(m => ...)}   ← 已提交消息
{streaming && <div>streaming text</div>}  ← 流式块，永远在最下方
```

当 streaming 期间收到 `tool_call` SSE 事件：

- `addMessage("tool", content, "meta")` 把 tool 消息追加到 `messages` 数组末尾
- 但 streaming 块永远在 `visibleMessages` 之后渲染
- **结果**：tool 消息出现在 streaming 文本上方（`messages` 列表末尾 < streaming 块位置）

用户看到的效果：

```
[assistant streaming text]   ← 下方（streaming 块）
[🔧 bash_exec: ...]         ← 上方（被插到 messages 末尾）
[✅ bash_exec result: ...]   ← 上方
```

期望的效果：

```
[assistant: 前半段文字]      ← 先提交的 assistant 消息
[🔧 bash_exec: ...]         ← tool call
[✅ bash_exec result: ...]   ← tool result
[assistant streaming: 后半段] ← 新的 streaming 块
```

### 修复方案

**收到 meta 的 tool_call 时，先 flush 当前 streaming 文本为一条 assistant 消息，再追加 tool 消息。**

涉及文件：

- `desktop/src/components/ChatView.tsx`（~L660-666）
- `desktop/src/components/ChatPane.tsx`（~L619-628）

具体改动（ChatView 为例，ChatPane 同理）：

```typescript
// tool_call handler 内，eventAgentId === "meta" 分支
if (payload.type === "tool_call") {
  // ... existing code ...
  if (!SILENT_TOOLS_SSE.has(toolName)) {
    const content = `🔧 ${toolName}: ${JSON.stringify(toolArgs).slice(0, 120)}`;
    if (eventAgentId === "meta") {
      // ★ 新增：flush 当前 streaming text
      const partialText = streamTextRef.current.trim();
      if (partialText && !isThinkingPlaceholderText(partialText) && !streamCommittedRef.current) {
        addMessage("assistant", streamTextRef.current, "meta", reqProvider, reqModel);
        streamCommittedRef.current = true;
      }
      // 重置 streaming 显示
      full = "";
      streamTextRef.current = "";
      if (isCurrentRequest()) setStreamedAssistantText("");
      streamCommittedRef.current = false;

      addMessage("tool", content, "meta");
    } else {
      // ... existing sub-agent code unchanged ...
    }
  }
}
```

同理 `tool_result` handler 不需要特殊处理（因为 tool_result 通常紧跟 tool_call，flush 已在 tool_call 时完成）。

流结束时的 `addMessage("assistant", full, ...)` 逻辑保持不变——如果 tool_call 之后还有 token 回来，会形成新的 streaming 段，最终提交为新的 assistant 消息。

### 边界条件

- **streaming 文本为空时**（agent 还没输出就调用了 tool）：不 flush，只追加 tool 消息
- **thinking placeholder 文本**：不 flush（已有 `isThinkingPlaceholderText` 守卫）
- **多次连续 tool_call**：第一次 flush 后设 `streamCommittedRef = true`，后续 tool_call 不会重复 flush，直到 `full` 被重置且有新 token
- `**insertAfterId` 模式**：此模式下 tool_call 也需要相同的 flush 逻辑

## 问题 2：输入卡顿

### 根因分析

每收到一个 `token` SSE 事件，都会调用 `setStreamedAssistantText(full)`，触发 React 状态更新 → 整个组件树重渲染。当 token 高频到达时（每秒数十次），textarea 所在的组件被频繁重渲染，导致输入卡顿。

关键代码路径：

- `ChatView.tsx` L658: `setStreamedAssistantText(full)` — 每个 token 触发一次
- `ChatPane.tsx` L608: `setStreamedAssistantText(full)` — 同上

### 修复方案

**使用 `requestAnimationFrame` 节流 streaming text 的状态更新，确保每帧最多更新一次。**

涉及文件：

- `desktop/src/components/ChatView.tsx`
- `desktop/src/components/ChatPane.tsx`

具体改动：

```typescript
// 在 sendChat 函数顶部或组件级别添加：
const rafIdRef = useRef<number>(0);

// token handler 中替换 setStreamedAssistantText(full)：
if (payload.type === "token") {
  if (eventAgentId !== "meta") { ... continue; }
  full += payload.data?.text ?? "";
  if (isCurrentRequest()) {
    streamTextRef.current = full;
    // ★ 节流：合并到下一帧
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = 0;
        setStreamedAssistantText(streamTextRef.current);
      });
    }
  }
}
```

清理（sendChat 结束或 abort 时）：

```typescript
if (rafIdRef.current) {
  cancelAnimationFrame(rafIdRef.current);
  rafIdRef.current = 0;
}
// 确保最终状态同步
setStreamedAssistantText(streamTextRef.current);
```

### 额外优化（可选）

- 将输入区域抽为独立的 `React.memo` 组件，使其不受 streaming text 状态变化影响
- streaming 显示区域使用 `React.memo` + 只依赖 `streamedAssistantText`

## 实施计划

### Phase 1: Tool Call 位置修复（核心）

- **Task 1.1**: ChatView.tsx — tool_call handler 中添加 flush 逻辑
- **Task 1.2**: ChatPane.tsx — tool_call handler 中添加相同的 flush 逻辑
- **Task 1.3**: 验证边界条件（空 streaming、thinking placeholder、连续 tool_call）

### Phase 2: 输入卡顿优化

- **Task 2.1**: ChatView.tsx — token handler 使用 rAF 节流
- **Task 2.2**: ChatPane.tsx — token handler 使用 rAF 节流
- **Task 2.3**: 清理逻辑（abort/结束时 cancel rAF + 同步最终状态）

### Phase 3: 验证

- 手动测试：streaming 期间触发 tool_call，确认 tool 消息出现在 streaming 文本下方
- 手动测试：streaming 期间输入文字，确认无明显卡顿
- 确认 sub-agent 的 tool_call 展示不受影响（它们走 `addSubAgentEvent` 分支，不涉及此次改动）

## 风险评估


| 风险                                       | 等级  | 缓解措施                                     |
| ---------------------------------------- | --- | ---------------------------------------- |
| flush 后 agent 无新 token，最终 assistant 消息为空 | 低   | `final` 事件处理中已有空检查                       |
| rAF 节流导致最后一帧文本丢失                         | 低   | abort/结束时强制同步                            |
| `streamCommittedRef` 状态管理不当导致重复提交        | 中   | flush 后重置为 false，仅在有新 token 后才可能再次 flush |


