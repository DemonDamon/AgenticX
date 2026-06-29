# 无意义续跑防护 + continuation 上下文污染修复

Planned-with: claude-sonnet-4.6

## 背景与问题定位

排查 session `7c5ca05b-1353-48a6-8f62-cb8a058ad823` 后确认两个独立 Bug：

### Bug A：任务已完成后触发无意义续跑循环

**事件链**：
1. 模型完成 3/3 todos，输出最终回复（产出视频文件）
2. 用户在**任务已完成**后按了停止 → 生成 `turn_interrupted` tool 消息
3. 用户点「恢复执行」→ `resumeCurrentTask()` 无条件发起 continuation
4. 模型回复「任务已完成」但系统没有终止，继续触发第 2、3、4 次续跑
5. 第 4 次续跑模型开始运行 `bash_exec` 验证文件，工具返回后无 final text → StallRecoveryCard 出现

**根因**：`resumeCurrentTask()` 在 `ChatPane.tsx` line 5650 没有判断「续跑是否有意义」。当 `turn_interrupted` 出现在已完成的 assistant 回复之后时，续跑只会让模型重复说「任务已完成」，进入死循环。

### Bug B：continuation 上下文中 `continuation_notice` 消息未被过滤

**事件链**：
- 每次续跑后，`continuation_notice` 工具消息积累（`kind="continuation_notice"`）
- `agent_runtime.py` 已过滤 `turn_interrupted`（line 984），但 **`continuation_notice` 未过滤**
- 第 4 次续跑时模型收到了 4 条 `continuation_notice` + 3 条「任务已完成」的 assistant 回复，context 混乱
- 模型决定验证文件（bash_exec），工具返回后因 context 过长或 codex 模型兼容问题未产出 final text

---

## 修复目标（FR / NFR / AC）

### FR（功能需求）

- **FR-1**：`resumeCurrentTask()` 在发起续跑前，检测「本次续跑是否有意义」。判定条件：
  - 最后一条 `turn_interrupted` 之前，最后一条 assistant 消息有实质内容（非空、非占位符）
  - 且在 `turn_interrupted` 之后不存在任何未完成的工具调用（`tool_calls` 无 pending）
  - 且会话中最近的 `todo_write` 快照显示所有项已完成（`(N/N completed)`）
  - 满足以上条件 → 判定为「无意义续跑」，展示 toast 提示「任务已完成，无需恢复」，return 不发请求

- **FR-2**：`agent_runtime.py` 的上下文清洗逻辑同时过滤 `kind="continuation_notice"` 的 tool 消息，不让它们进入 LLM 上下文。

- **FR-3**：`turn_interrupted` 消息在 `TurnInterruptionNoticeLine` 渲染时，若前序 assistant 已为完整回复（`lastTurnHasCompletedAssistantReply` 返回 true），则**隐藏「恢复执行」按钮**（不让用户误点）。

### NFR（非功能）

- **NFR-1**：FR-1 的「无意义」判定函数要纯函数、有单元测试，不依赖外部状态。
- **NFR-2**：FR-2 过滤 `continuation_notice` 时，确保仍然过滤 `turn_interrupted`（不破坏已有逻辑）。
- **NFR-3**：不改动续跑发送路径（`sendChat`）的核心逻辑，只在 `resumeCurrentTask` 入口处加 guard。
- **NFR-4**：不影响「真正需要续跑」的场景（中途断流、未完成 tool 调用、todos 有未完成项）。

### AC（验收）

- **AC-1**：在任务 3/3 完成后手动按 Stop，再点「恢复执行」→ 弹出 toast「任务已完成，无需恢复」，不发 continuation 请求，`messages.json` 不追加新 `continuation_notice`。
- **AC-2**：任务中途真正被中断（todos 有未完成项）→ 续跑正常发出，不触发 toast 拦截。
- **AC-3**：`agent_runtime.py` 过滤后，LLM 接收的 context 中不含 `continuation_notice` 或 `turn_interrupted` 消息。
- **AC-4**：`TurnInterruptionNoticeLine` 在「任务已完成」场景下不渲染「恢复执行」按钮。
- **AC-5**：新增单元测试文件通过，回归测试 `streaming-stop-policy.test.ts` 全绿。

---

## 实施步骤

### Step 1 · 新增 `isFutileResume` 判定函数（前端）

**文件**：`desktop/src/utils/task-stall-policy.ts`

在文件末尾新增：

```typescript
/**
 * Returns true when triggering a resume/continuation would be futile:
 * the last turn_interrupted follows a complete assistant reply and
 * there are no pending tool calls or unfinished todos.
 */
export function isFutileResume(messages: Message[]): boolean {
  if (!messages.length) return false;

  // Find the last turn_interrupted message
  let lastInterruptedIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m?.role === "tool" &&
      (m.metadata as Record<string, unknown> | undefined)?.kind === "turn_interrupted"
    ) {
      lastInterruptedIdx = i;
      break;
    }
  }
  if (lastInterruptedIdx < 0) return false;

  // Check if there's a complete assistant reply before the interruption
  const beforeInterrupt = messages.slice(0, lastInterruptedIdx);
  if (!lastTurnHasCompletedAssistantReply(beforeInterrupt)) return false;

  // Ensure no pending tool calls after the last user message
  let lastUserIdx = -1;
  for (let i = beforeInterrupt.length - 1; i >= 0; i--) {
    if (beforeInterrupt[i]?.role === "user") { lastUserIdx = i; break; }
  }
  for (let i = lastUserIdx + 1; i < beforeInterrupt.length; i++) {
    const m = beforeInterrupt[i];
    if (m?.role === "assistant" && (m.tool_calls as unknown[] | undefined)?.length) {
      // Has tool_calls — check all have corresponding tool results
      const toolCallIds = new Set(
        ((m.tool_calls as { id?: string }[]) || []).map((tc) => tc.id).filter(Boolean)
      );
      for (let j = i + 1; j < beforeInterrupt.length; j++) {
        const tm = beforeInterrupt[j];
        if (tm?.role === "tool" && tm.tool_call_id) {
          toolCallIds.delete(tm.tool_call_id as string);
        }
      }
      if (toolCallIds.size > 0) return false; // pending tool calls exist
    }
  }

  // Check latest todo snapshot — all items must be completed
  for (let i = lastInterruptedIdx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "tool") continue;
    const content = String(m.content ?? "");
    // Todo snapshot pattern: "(N/N completed)"
    const match = content.match(/\((\d+)\/(\d+) completed\)/);
    if (match) {
      const done = parseInt(match[1]!, 10);
      const total = parseInt(match[2]!, 10);
      return total > 0 && done === total; // all done = futile resume
    }
  }

  // No todo snapshot found → be conservative, allow resume
  return false;
}
```

**注意**：`Message` 类型在 `../store` 已定义，`tool_calls` 和 `tool_call_id` 字段需确认在 `Message` 类型里（若没有则用 `(m as Record<string, unknown>).tool_calls`）。

---

### Step 2 · 在 `resumeCurrentTask` 入口加 guard

**文件**：`desktop/src/components/ChatPane.tsx`

**位置**：line 5650 的 `resumeCurrentTask` 函数，`beginResumeInFlight(sid)` 之前插入。

**改动**：

```typescript
// 在文件顶部 import 区补充（已有 lastTurnHasCompletedAssistantReply 的 import 行）：
// 原来：
import {
  ...
  lastTurnHasCompletedAssistantReply,
  ...
} from "../utils/task-stall-policy";
// 新增 isFutileResume 到同一 import：
import {
  ...
  lastTurnHasCompletedAssistantReply,
  isFutileResume,                      // ← 新增
  ...
} from "../utils/task-stall-policy";
```

在 `resumeCurrentTask` 函数体（line 5650 附近）的 `beginResumeInFlight(sid)` 之前插入：

```typescript
const resumeCurrentTask = useCallback(async () => {
  const sid = (pane.sessionId || "").trim();
  if (!sid || resumeInFlightRef.current[sid]) return;

  // ── GUARD：检测无意义续跑 ──────────────────────────────────────────
  const currentMsgs =
    useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ??
    pane.messages ??
    [];
  if (isFutileResume(currentMsgs)) {
    // 任务已完成后被意外中断，续跑无意义
    addPaneMessage(
      pane.id,
      "tool",
      "✅ 任务已全部完成，无需恢复执行。",
      "meta",
      undefined,
      undefined,
      undefined,
      { kind: "futile_resume_guard" }
    );
    return;
  }
  // ── END GUARD ──────────────────────────────────────────────────────

  beginResumeInFlight(sid);
  // ... 下面是原有逻辑，保持不变
```

---

### Step 3 · 隐藏「恢复执行」按钮当续跑无意义

**文件**：`desktop/src/components/messages/TurnInterruptionNoticeLine.tsx`

**位置**：line 26 的 `{onResume ? (` 条件。

**改动**：给组件新增 `isFutile?: boolean` prop，为 true 时不渲染按钮。

```typescript
// Props 类型新增：
type Props = {
  message: Message;
  resumeInFlight?: boolean;
  onResume?: () => void;
  isFutile?: boolean;   // ← 新增：为 true 时不显示恢复按钮
};

// 渲染时改为：
{onResume && !isFutile ? (   // ← 加 !isFutile
  <div className="mt-2 flex flex-wrap items-center gap-2">
    <button ... >
      {resumeInFlight ? "恢复中…" : "恢复执行"}
    </button>
  </div>
) : null}
```

**调用方**（`ChatPane.tsx` 中渲染 `TurnInterruptionNoticeLine` 的地方）需传入 `isFutile`：

在 `ChatPane.tsx` 中搜索 `TurnInterruptionNoticeLine`，找到渲染处，改为：

```typescript
<TurnInterruptionNoticeLine
  message={msg}
  resumeInFlight={resumeInFlight}
  onResume={() => void resumeCurrentTask()}
  isFutile={isFutileResume(pane.messages ?? [])}   // ← 新增
/>
```

---

### Step 4 · 后端过滤 `continuation_notice` 消息（不污染 LLM context）

**文件**：`agenticx/runtime/agent_runtime.py`

**位置**：line 982-986，找到：

```python
if role == "tool":
    meta_raw = msg.get("metadata")
    meta = meta_raw if isinstance(meta_raw, dict) else {}
    if meta.get("kind") == "turn_interrupted":
        idx += 1
        continue
```

**改动**：在 `turn_interrupted` 判断后紧跟加一行 `continuation_notice` 过滤：

```python
if role == "tool":
    meta_raw = msg.get("metadata")
    meta = meta_raw if isinstance(meta_raw, dict) else {}
    # Filter UI-only notice messages from LLM context
    if meta.get("kind") in ("turn_interrupted", "continuation_notice", "futile_resume_guard"):
        idx += 1
        continue
```

---

### Step 5 · 新增单元测试

**文件**：`desktop/src/utils/task-stall-policy.test.ts`

在文件末尾追加（参考该文件已有的测试风格）：

```typescript
describe("isFutileResume", () => {
  it("returns true when last turn_interrupted follows complete assistant + all todos done", () => {
    const messages = [
      { role: "user", content: "make a video", id: "u1" },
      { role: "tool", content: "[x] init [x] render (2/2 completed)", id: "t1" },
      {
        role: "assistant",
        content: "Video complete! File at /tmp/out.mp4",
        id: "a1",
      },
      {
        role: "tool",
        content: "已按用户请求中断当前生成。",
        id: "t2",
        metadata: { kind: "turn_interrupted", cause: "user_interrupt" },
      },
    ] as Message[];
    expect(isFutileResume(messages)).toBe(true);
  });

  it("returns false when todos are not all done", () => {
    const messages = [
      { role: "user", content: "make a video", id: "u1" },
      { role: "tool", content: "[x] init [>] render (1/2 completed)", id: "t1" },
      {
        role: "tool",
        content: "中断",
        id: "t2",
        metadata: { kind: "turn_interrupted" },
      },
    ] as Message[];
    expect(isFutileResume(messages)).toBe(false);
  });

  it("returns false when no turn_interrupted message", () => {
    const messages = [
      { role: "user", content: "hello", id: "u1" },
      { role: "assistant", content: "hi", id: "a1" },
    ] as Message[];
    expect(isFutileResume(messages)).toBe(false);
  });
});
```

---

## 不在本 plan 范围内

- 不改 `sendChat` continuation 的发送路径
- 不改 `supervisor.py` 无人值守逻辑
- 不改 `StallRecoveryCard` 的 stall/exhausted 两种状态的恢复按钮（那是针对真实 stall，不是 futile resume）
- 不处理 codex 模型在 tool result 之后不产出 text 的底层兼容问题（那是 provider 侧，单独立项）

---

## 关键文件索引

```
desktop/src/utils/task-stall-policy.ts         # Step 1：新增 isFutileResume
desktop/src/utils/task-stall-policy.test.ts    # Step 5：新增测试
desktop/src/components/ChatPane.tsx            # Step 2：resumeCurrentTask 加 guard
desktop/src/components/messages/TurnInterruptionNoticeLine.tsx  # Step 3：隐藏按钮
agenticx/runtime/agent_runtime.py             # Step 4：过滤 continuation_notice
```

---

## Commit 计划

```
fix(chat): guard futile resumes and filter continuation_notice from LLM context

- Add isFutileResume() helper: detects when turn_interrupted follows
  a complete assistant reply with all todos done
- resumeCurrentTask() returns early with toast when resume is futile
- TurnInterruptionNoticeLine hides 恢复执行 button when isFutile=true
- agent_runtime: filter continuation_notice + futile_resume_guard from
  LLM context (alongside existing turn_interrupted filter)

Plan-Id: 2026-06-29-futile-resume-guard-and-continuation-context-cleanup
Plan-File: .cursor/plans/2026-06-29-futile-resume-guard-and-continuation-context-cleanup.plan.md
Plan-Model: claude-sonnet-4.6
Impl-Model: <由实施者填写>
Made-with: Damon Li
```
