---
name: session-identity-single-chokepoint-and-idempotency
overview: 彻底根治「A 会话内容串到 B 会话 / 重复落盘」。本质是前端把"会话身份(session_id)"当成可变共享状态、被多个异步入口在错误时机读取。修复分两层深度防御：(1) 前端——把所有发送入口收口到唯一函数 sendChat，并强制传入"发起时锁定的 lockedSessionId"，禁止续跑/重试/自动续跑/队列等路径再读实时 pane.sessionId；(2) 后端——/api/chat 增加 client_turn_id 幂等键，重复 POST 直接短路，不再二次落盘 user 行。本 plan 面向 Composer 2.5 执行，每步给出精确文件、锚点、可复制代码与验证命令。
todos:
  - id: t1-frontend-resume-lock
    content: resumeCurrentTask 续跑传 lockedSessionId
    status: completed
  - id: t2-frontend-autonudge-lock
    content: auto-nudge effect 传 lockedSessionId
    status: completed
  - id: t3-frontend-unattended-lock
    content: 无人值守 supervisor effect 传 lockedSessionId
    status: completed
  - id: t4-frontend-retry-edit-lock
    content: retryUserMessage / editUserMessage 传 lockedSessionId
    status: completed
  - id: t5-frontend-queue-forward-lock
    content: 队列 dequeue / forwardAutoReply / sendQueuedMessageNow 传 lockedSessionId
    status: completed
  - id: t6-frontend-dev-assert
    content: sendChat 内对 continuation/系统类发送缺 lockedSessionId 时 dev console.warn
    status: completed
  - id: t7-frontend-client-turn-id
    content: sendChat 生成 client_turn_id 并放入 /api/chat body
    status: completed
  - id: t8-backend-idempotency-field
    content: ChatRequest 增加 client_turn_id 字段
    status: completed
  - id: t9-backend-idempotency-guard
    content: /api/chat 重复 client_turn_id 短路返回，不二次落盘
    status: completed
  - id: t10-tests
    content: 新增 send-lock 单测 + 后端幂等冒烟测试；vitest/pytest 绿
    status: completed
isProject: false
---

# 会话身份单一收口 + 幂等键（彻底根治串台/重复落盘）

**Plan-Id**: 2026-06-06-session-identity-single-chokepoint-and-idempotency
**Plan-File**: `.cursor/plans/2026-06-06-session-identity-single-chokepoint-and-idempotency.plan.md`
**Owner**: Damon Li
**Made-with**: Damon Li

> 关联前序（同族，已部分修复）：
> `2026-06-05-session-switch-send-lock-and-disk-reconcile`（已加 send-dedupe + followup owner 校验 + 严格 owner 渲染）、
> `2026-06-05-concurrent-stream-ref-clobber-fix`（已修流式 ref 跨会话覆盖）、
> `2026-06-04-cross-session-message-contamination-and-loss`（ownerSessionId 归属戳）。
> 本 plan 收口"剩余的 5 个发送入口" + 后端幂等，目标是机制性根除而非继续补单点。

---

## 0. 背景与本质（执行前必读，1 分钟）

- 后端 `agenticx/studio/session_manager.py` 用 `self._sessions: Dict[str, ManagedSession]` 按 `session_id` 严格分桶，**从不主动混会话**。它只是忠实地把前端 POST 的 `session_id` 对应的内容落盘。
- 所以"A 串到 B"只能是：**前端用了错误的 session_id 去发请求**，或**重复发了同一请求**。
- 错误根因：`ChatPane` 一个组件实例跨会话复用（只换 `pane.sessionId`），而续跑/重试/自动续跑等异步路径**实时读 `pane.sessionId`**（可变共享值），在切换窗口期读到了"现在显示的会话"而非"发起时的会话"。
- 修复原则：**会话身份在发起时锁定一次（lockedSessionId），之后全程不可变**；后端再加幂等兜底。

执行前先读这两个文件了解现状，不要跳过：
- `desktop/src/components/ChatPane.tsx`（重点函数 `sendChat`、`resumeCurrentTask`、`retryUserMessage`、`editUserMessage`）
- `desktop/src/utils/send-dedupe.ts`（已存在的去重工具，本 plan 复用，不改它）

---

## 1. 现状事实（已核对，供定位）

`sendChat` 已支持 `lockedSessionId`（无需新增参数）：

```5807:5875:desktop/src/components/ChatPane.tsx
  const sendChat = async (
    userText: string,
    options?: {
      retryAttachments?: MessageAttachment[];
      suppressUserEcho?: boolean;
      skipUserHistory?: boolean;
      forceSend?: boolean;
      lockedSessionId?: string;
      continuation?: { reason: ContinueReason; source: ContinueSource };
    }
  ) => {
    ...
    let requestSessionId = String(options?.lockedSessionId ?? pane.sessionId ?? "").trim();
```

`sendChatRef.current(...)` 现存调用点（行号为当前快照，定位用锚点字符串为准）：

| 行 | 入口 | 现状 | 本 plan 处理 |
|----|------|------|------|
| 4178 | `retryUserMessage` | 未传 lock | **t4 加 lock** |
| 4221 | `editUserMessage` | 未传 lock | **t4 加 lock** |
| 5065 | auto-nudge effect | 未传 lock | **t2 加 lock** |
| 5111 | unattended supervisor effect | 未传 lock | **t3 加 lock** |
| 5166 | `resumeCurrentTask` | 未传 lock | **t1 加 lock** |
| 5199 | `sendFollowupChip` | 已传 lock | 不动 |
| 5208 | `sendQueuedMessageNow` | 未传 lock | **t5 加 lock** |
| 7329 | dequeue `nextQueued` | 未传 lock | **t5 加 lock** |
| 7345 | `forwardAutoReply` | 未传 lock | **t5 加 lock** |
| 8506/8526/8537/8542/8693 | 用户输入框 `sendChat(...)` | 未传 lock | **不动**（见下方注意） |

**注意（重要）**：用户输入框（composer）的发送**保持不传 lockedSessionId**。原因：lazy 会话（"全新对话"）需要 `requestSessionId` 为空时才能触发 `createSession`。用户正盯着当前 pane，用 `pane.sessionId` 解析是正确的。lockedSessionId 只用于**异步/系统类**入口（续跑、重试、队列、转发），它们必须锁定发起时的会话。

---

## 2. 前端改动（逐步，可复制）

> 所有改动只在 `desktop/src/components/ChatPane.tsx`。每步改完不要急着测，全部改完一起跑测试。

### t1 — resumeCurrentTask 续跑锁定 sid

锚点：`resumeCurrentTask` 内 `void sendChatRef.current("", {` + `source: "desktop_manual"`。
该函数顶部已有 `const sid = (pane.sessionId || "").trim();`。把发送改为携带 `lockedSessionId: sid`：

```ts
    void sendChatRef.current("", {
      lockedSessionId: sid,
      continuation: { reason, source: "desktop_manual" },
    });
```

### t2 — auto-nudge effect 锁定 sid

锚点：`source: "desktop_auto_nudge"`。该 effect 内已有 `const sid = (pane.sessionId || "").trim();`（在 `if (!sid) return;` 上方）。改为：

```ts
    void sendChatRef.current("", {
      lockedSessionId: sid,
      continuation: { reason, source: "desktop_auto_nudge" },
    });
```

### t3 — 无人值守 supervisor effect 锁定 sid

锚点：`source: "supervisor"`。同一 effect 内已有 `const sid = (pane.sessionId || "").trim();`。改为：

```ts
    void sendChatRef.current("", {
      lockedSessionId: sid,
      continuation: { reason, source: "supervisor" },
    });
```

### t4 — retryUserMessage / editUserMessage 锁定 sid

两个函数顶部都已有 `const sid = (pane.sessionId || "").trim();`。

`retryUserMessage`（锚点：`await sendChatRef.current(msg.content, {` 紧跟 `suppressUserEcho: true,`）：

```ts
      await sendChatRef.current(msg.content, {
        lockedSessionId: sid,
        retryAttachments: msg.attachments ?? [],
        suppressUserEcho: true,
        skipUserHistory: true,
      });
```

`editUserMessage`（锚点：`await sendChatRef.current(newContent, {`）：

```ts
      await sendChatRef.current(newContent, {
        lockedSessionId: sid,
        retryAttachments: msg.attachments ?? [],
      });
```

### t5 — 队列 / 转发 / 队列立即发送 锁定 sid

**sendQueuedMessageNow**（锚点：`const item = takePendingMessage(paneId, msgId);`）。在调用前取当前 pane sid 并锁定：

```ts
  const sendQueuedMessageNow = useCallback(
    (msgId: string) => {
      const item = takePendingMessage(paneId, msgId);
      if (!item) return;
      const lockedSessionId = (useAppStore.getState().panes.find((p) => p.id === paneId)?.sessionId || "").trim();
      void sendChatRef.current(item.text, {
        lockedSessionId: lockedSessionId || undefined,
        retryAttachments: item.attachments,
        forceSend: true,
      });
    },
    [paneId, takePendingMessage]
  );
```

**dequeue nextQueued**（锚点：`const nextQueued = useAppStore.getState().dequeuePaneMessage(pane.id);`，在 `sendChat` 的 finally 内）。此处 `requestSessionId` 在闭包内可用，就是刚跑完的会话，直接锁定它：

```ts
      const nextQueued = useAppStore.getState().dequeuePaneMessage(pane.id);
      if (nextQueued) {
        requestAnimationFrame(() => {
          void sendChatRef.current(nextQueued.text, {
            lockedSessionId: requestSessionId,
            retryAttachments: nextQueued.attachments,
          });
        });
      }
```

**forwardAutoReply**（锚点：`void sendChatRef.current(forwardAutoReply.text, {`）。该 effect 上方已校验 `(pane.sessionId||"").trim() === forwardAutoReply.sessionId.trim()`，锁定 `forwardAutoReply.sessionId`：

```ts
    void sendChatRef.current(forwardAutoReply.text, {
      lockedSessionId: forwardAutoReply.sessionId,
      suppressUserEcho: forwardAutoReply.suppressUserEcho ?? true,
      skipUserHistory: forwardAutoReply.skipUserHistory ?? true,
    });
```

（保留该行原有的其余字段，只新增 `lockedSessionId`。改前先读 7345 附近确认完整字段列表。）

### t6 — sendChat 内 dev 断言：系统类发送缺 lock 就 warn

目的：未来若有人新增异步入口又忘了传 lock，开发期立刻暴露。

定位：`sendChat` 内 `let requestSessionId = String(options?.lockedSessionId ?? pane.sessionId ?? "").trim();` 这一行**之后**插入：

```ts
    // Dev-only invariant: every async/system send (continuation / retry / queued /
    // forward) MUST lock the session id captured at dispatch time. Reading the live
    // pane.sessionId for these paths is the root cause of cross-session leakage.
    const isSystemStyleSend =
      isContinuation || !!options?.suppressUserEcho || !!options?.skipUserHistory;
    if (
      import.meta.env?.DEV &&
      isSystemStyleSend &&
      !String(options?.lockedSessionId ?? "").trim()
    ) {
      console.warn(
        "[ChatPane] system-style send without lockedSessionId — potential cross-session leak source",
        { source: options?.continuation?.source },
      );
    }
```

（`isContinuation` 在 `sendChat` 内已定义；若顺序在其后则正常，确认 `isContinuation` 在该插入点之前已声明。）

### t7 — sendChat 生成 client_turn_id 写入 body

定位：`sendChat` 内构造请求 body 处，锚点 `const body: Record<string, unknown> = { session_id: requestSessionId, user_input: messageText };`。在其后追加：

```ts
      // Idempotency key: backend short-circuits a duplicate POST (double-click /
      // chip burst / retry race) so it never appends a second user row.
      body.client_turn_id = crypto.randomUUID();
```

> 注意：retry/edit 是**有意重发**，但它们走 truncate 后是新一轮，应允许 → 每次 `sendChat` 都新生成 UUID 即可（不要复用）。幂等只拦"完全相同的并发重复 POST"，靠后端在极短时间内的同 id 命中。**真正防重复落盘的关键仍是前端 send-dedupe + 后端同 id 短路双保险。**

---

## 3. 后端改动（agenticx/studio）

### t8 — ChatRequest 增加 client_turn_id

文件：`agenticx/studio/protocols.py`，`class ChatRequest` 内（锚点 `retrieval_mode: Optional[str] = None`）末尾追加：

```python
    # Idempotency key from desktop: a duplicate POST with the same id within a
    # short window is short-circuited so no second user row is persisted.
    client_turn_id: Optional[str] = None
```

### t9 — /api/chat 重复 client_turn_id 短路

文件：`agenticx/studio/server.py`，`@app.post("/api/chat")` 的 `chat()` 函数体。
定位锚点：`managed = manager.get(payload.session_id, touch=False)` 后、`raise HTTPException(404)` 之后、`manager.touch(payload.session_id)` 之前插入幂等检查：

```python
        # Idempotency guard: dedupe a duplicate POST (double-click / chip burst /
        # retry race) so the backend never persists a second identical user turn.
        # Keyed by client_turn_id on the managed session (bounded recent set).
        _ctid = str(getattr(payload, "client_turn_id", "") or "").strip()
        if _ctid:
            _seen = getattr(managed, "_recent_client_turn_ids", None)
            if _seen is None:
                from collections import deque
                _seen = deque(maxlen=64)
                setattr(managed, "_recent_client_turn_ids", _seen)
            if _ctid in _seen:
                async def _dup_noop_stream():
                    yield 'data: {"type":"done","data":{"duplicate":true}}\n\n'
                return StreamingResponse(_dup_noop_stream(), media_type="text/event-stream")
            _seen.append(_ctid)
```

> 说明：用 in-memory bounded deque 即可，无需持久化——目标只是拦"几乎同时的重复 POST"，进程重启后旧 id 失效不影响正确性。`ManagedSession` 是普通对象，`setattr` 动态挂属性可行（与现有 `setattr(session, ...)` 用法一致）。

---

## 4. 测试（t10）

### 4.1 前端单测：lockedSessionId 优先级

新建 `desktop/src/utils/send-lock.test.ts`（纯函数级，验证锁定语义）。先抽一个纯函数到 `desktop/src/utils/send-lock.ts`：

```ts
// desktop/src/utils/send-lock.ts
/** Resolve the session a send is bound to: explicit lock wins over live pane sid. */
export function resolveSendSessionId(
  lockedSessionId: string | undefined,
  livePaneSessionId: string | undefined,
): string {
  const locked = String(lockedSessionId ?? "").trim();
  if (locked) return locked;
  return String(livePaneSessionId ?? "").trim();
}
```

然后在 `sendChat` 内把 `let requestSessionId = String(options?.lockedSessionId ?? pane.sessionId ?? "").trim();`
替换为使用该函数：

```ts
    let requestSessionId = resolveSendSessionId(options?.lockedSessionId, pane.sessionId);
```

并在 `ChatPane.tsx` 顶部 import：

```ts
import { resolveSendSessionId } from "../utils/send-lock";
```

测试 `desktop/src/utils/send-lock.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { resolveSendSessionId } from "./send-lock";

describe("resolveSendSessionId", () => {
  it("locked id wins even when pane shows another session", () => {
    expect(resolveSendSessionId("A", "B")).toBe("A");
  });
  it("falls back to live pane sid when no lock (composer / lazy)", () => {
    expect(resolveSendSessionId(undefined, "B")).toBe("B");
    expect(resolveSendSessionId("", "B")).toBe("B");
  });
  it("returns empty when neither present (lazy create path)", () => {
    expect(resolveSendSessionId(undefined, undefined)).toBe("");
    expect(resolveSendSessionId(" ", " ")).toBe("");
  });
});
```

### 4.2 后端冒烟：重复 client_turn_id 不二次落盘

新建 `tests/test_smoke_chat_idempotency.py`（参考 `tests/` 现有冒烟测试风格）。最小验证幂等 deque 逻辑：

```python
from collections import deque


def test_duplicate_client_turn_id_short_circuits():
    """同一 client_turn_id 二次到达应被短路，不重复入列业务处理。"""
    seen = deque(maxlen=64)
    ctid = "turn-123"

    # 第一次：未见过，入列，放行
    first_blocked = ctid in seen
    if not first_blocked:
        seen.append(ctid)
    assert first_blocked is False
    assert ctid in seen

    # 第二次：已见过，应短路
    second_blocked = ctid in seen
    assert second_blocked is True
    # 短路时不应再次 append（长度不变）
    assert list(seen).count(ctid) == 1


def test_distinct_turn_ids_all_pass():
    seen = deque(maxlen=64)
    for i in range(5):
        ctid = f"turn-{i}"
        assert (ctid in seen) is False
        seen.append(ctid)
    assert len(seen) == 5
```

> 该测试验证幂等数据结构的语义；不强求起整个 FastAPI app。若 `tests/` 已有 app fixture，可进一步加端到端用例，但**非必需**。

### 4.3 运行命令

```bash
# 前端（在 desktop/ 下）
cd desktop && npx vitest run src/utils/send-lock.test.ts src/utils/send-dedupe.test.ts src/utils/message-ownership.test.ts

# 后端（仓库根）
pytest tests/test_smoke_chat_idempotency.py -q
```

### 4.4 lint

改完跑 `ReadLints`（或 IDE）确认 `ChatPane.tsx`、`protocols.py`、`server.py`、新建文件无错误。

---

## 5. 验收标准（Composer 完成后自检）

- [ ] AC-1：`ChatPane.tsx` 中所有 `sendChatRef.current(` 调用，**除 composer 用户输入框（8506/8526/8537/8542/8693）外**，全部带 `lockedSessionId`。可用 grep 自查：`rg "sendChatRef.current\(" desktop/src/components/ChatPane.tsx` 逐条核对。
- [ ] AC-2：`sendChat` 用 `resolveSendSessionId` 解析 `requestSessionId`，不再内联 `?? pane.sessionId`。
- [ ] AC-3：`/api/chat` body 含 `client_turn_id`；`ChatRequest` 有该字段；后端重复 id 短路返回 done。
- [ ] AC-4：dev 模式下系统类发送缺 lock 会 console.warn。
- [ ] AC-5：`vitest`（send-lock / send-dedupe / message-ownership）与 `pytest`（idempotency）全绿。
- [ ] AC-6：改动文件 lint 干净。

---

## 6. 范围与排除（不要做）

- **不重构** `sendChat` 主体逻辑、不动 SSE 解析、不动 `stream-commit-registry`（前序 plan 已修）。
- **不改**用户输入框 composer 的 lazy 会话创建行为。
- **不持久化** client_turn_id（in-memory bounded set 足够）。
- **不动** `desktop/src/utils/send-dedupe.ts`（已存在并已接线，本 plan 与之互补）。
- 遵循 `no-scope-creep`：每个改动都能追溯到上面某条 todo / AC。

---

## 7. 提交（全部测试绿后）

```
/commit @desktop @agenticx/studio --spec=.cursor/plans/2026-06-06-session-identity-single-chokepoint-and-idempotency.plan.md
```

commit message 必须含：
```
Plan-Id: 2026-06-06-session-identity-single-chokepoint-and-idempotency
Plan-File: .cursor/plans/2026-06-06-session-identity-single-chokepoint-and-idempotency.plan.md
Made-with: Damon Li
```

只 `git add` 本 plan 直接改动的文件：
`desktop/src/components/ChatPane.tsx`、`desktop/src/utils/send-lock.ts`(+test)、
`agenticx/studio/protocols.py`、`agenticx/studio/server.py`、`tests/test_smoke_chat_idempotency.py`、本 plan 文件。
**不要**把仓库里其它无关已改文件（AvatarSidebar/SettingsPanel/VoiceFocusMode 等）一起提交。
