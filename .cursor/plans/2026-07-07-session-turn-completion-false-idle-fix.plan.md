# 会话轮次"假完成"误判修复：工具链未收尾却被判定为 idle/已完成

Planned-with: <待用户确认，见对话末尾提问>
Suggested-Impl-Model: Codex 系列（后端纯函数 + 前端镜像纯函数改造，无跨栈高风险收口，中档代码专精模型足够）

> 背景：用户反馈 session `1b558266-e8e0-47db-9a89-d2aea0da27e2` 明明看到工具组标了「已调用 3 次工具」蓝勾，但整轮任务其实没做完（模型只说了一句建议，后面调了 3 次工具后再没收尾），前端却没有提示"未完成"，反而显示成正常状态。根因已定位：后端/前端各有一份"上一轮是否已完成"的判定函数，只要在最后一条用户消息之后**出现过任意一条有文字内容的 assistant 消息**就判定为"已完成"——不管这条消息后面是不是还跟着新的、从未收尾的工具调用。

---

## 0. 根因证据链（不依赖对话记忆，可独立核验）

### 0.1 复现数据

会话磁盘文件：`~/.agenticx/sessions/1b558266-e8e0-47db-9a89-d2aea0da27e2/messages.json`，最后一个用户轮次（第 50 条消息之后）结构：

```
[50] user:      上面是kimi-k2.6的回答，你有什么好的建议？你直接帮我做的了吧
[51] assistant: 我建议直接做 B 的增强版：不硬编码 JD 路径…（纯文字建议，无 tool_calls）
[52] assistant: (tool_calls: skill_use)
[52t] tool:      OK: activated skill 'skill-creator'...
[53] assistant: (tool_calls: bash_exec)
[53t] tool:      exit_code=0 stdout: ...（读取 JD 文件）
[54] assistant: (tool_calls: bash_exec，重试)
[54t] tool:      exit_code=0 stdout: ...（读取 JD 文件）
—— 之后没有任何新消息，轮次到此为止，没有收尾 assistant 回复 ——
```

（`agent_messages.json` 的裸消息视图更直观地展示了 tool_calls 结构，见该文件第 14~21 条。）

### 0.2 后端误判位置

```73:95:agenticx/studio/session_manager.py
def _messages_last_turn_has_completed_reply(messages: List[Dict[str, Any]]) -> bool:
    """Pure helper: whether the last user turn has a completed assistant reply."""
    if not messages:
        return False
    last_user_idx = -1
    for idx, msg in enumerate(messages):
        if str(msg.get("role", "")).strip() == "user":
            last_user_idx = idx
    if last_user_idx < 0:
        return False
    for msg in messages[last_user_idx + 1 :]:
        if str(msg.get("role", "")).strip() != "assistant":
            continue
        content = str(msg.get("content", "") or "")
        visible = _visible_assistant_body(content)
        if visible and not any(marker in visible for marker in _INTERRUPTED_PLACEHOLDER_MARKERS):
            return True   # <-- 命中 msg[51] 立即 return True，压根没看后面还有 tool_calls
        raw_sq = msg.get("suggested_questions")
        if isinstance(raw_sq, list) and any(str(x).strip() for x in raw_sq):
            return True
        if "</followups>" in content.lower():
            return True
    return False
```

msg[51]（"我建议直接做 B 的增强版…"）一有可见文字，函数立即 `return True`，根本不会往后扫描 msg[52]/[53]/[54] 这些带 `tool_calls` 的后续 assistant 消息——即这段代码把"开场建议"误当成"最终交付"。

此函数被 `_last_turn_has_completed_reply`（`session_manager.py:684`）调用，进而被 `_normalize_execution_state_for_listing`（`session_manager.py:600-624`）在 `raw == "running"` 且会话已从内存态 `_sessions` 驱逐（非活跃 LRU）时，用来判断是否可以把 `execution_state` 从磁盘残留的 `"running"` 降级为 `"idle"`。已用 `agx serve` 存活进程实测复现：该 session 的 `/api/sessions` 返回 `"execution_state": "idle"`，尽管磁盘元数据原始值是 `"running"`——印证了这条代码路径确实被命中。

### 0.3 前端同款镜像误判位置

```62:78:desktop/src/utils/task-stall-policy.ts
export function lastTurnHasCompletedAssistantReply(messages: Message[]): boolean {
  if (!messages.length) return false;
  let lastUserIdx = -1;
  for (let idx = 0; idx < messages.length; idx += 1) {
    if (messages[idx]?.role === "user") lastUserIdx = idx;
  }
  if (lastUserIdx < 0) return false;
  for (let idx = lastUserIdx + 1; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    if (msg.id === "__stream__" || msg.id === "typing-meta") continue;
    const content = assistantBodyText(msg);
    if (!content) continue;
    if (INTERRUPTED_ASSISTANT_PLACEHOLDERS.has(content)) continue;
    return true;   // <-- 同样的问题：命中即返回，不看后面是否还有 tool_calls
  }
  return false;
}
```

此函数被 `shouldTriggerIncompleteEndStall`（`desktop/src/utils/task-stall-policy.ts:349-367`，ChatPane.tsx 里的 Channel C 停滞检测）直接调用：`return !lastTurnHasCompletedAssistantReply(messages)`。**Channel C 停滞检测机制本身是好的、已经存在的功能**（`execution_state === "idle"` 但最后一轮没收尾时，展示"未完成"横幅 + "立即重试"按钮，见 `ChatPane.tsx:9863` 附近 `stallReason === "incomplete"` 分支），但因为 `lastTurnHasCompletedAssistantReply` 判断有误，导致这个已有的兜底机制在本案例里**没有被触发**——用户什么提示都没看到。

### 0.4 为什么不能简单改成"最后一条消息是 tool 就判未完成"

`task-stall-policy.test.ts:176-187` 有一条**必须保留**的既有测试：

```ts
it("returns true when assistant reply exists before a trailing tool message", () => {
  const messages: Message[] = [
    msg({ id: "u1", role: "user", content: "查知识库" }),
    msg({ id: "a1", role: "assistant", content: "费马大定理的核心是：..." }),
    msg({ id: "t1", role: "tool", toolName: "knowledge_search", content: "hits" }),
  ];
  expect(lastTurnHasCompletedAssistantReply(messages)).toBe(true);
});
```

以及本会话自己第 44~47 条消息（同一 session 里早前一轮，属于**真正已完成**的案例）：

```
[44] assistant: <think>...(推理)  任务已恢复并完成...
[45] tool:      todo_write 快照 [x][x][x][x] (4/4 completed)
[46] assistant: 任务已恢复并完成。Skill 已落盘并验证通过。……（完整总结，无 tool_calls）
[47] tool:      ✅ 任务已完成（4/4）  ← todo_write 收尾快照，assistant 回复之后仍有 tool 行
```

如果简单粗暴地用"tail 是否以 tool 行结束"判断未完成，会把上面这两个**真正已完成**的案例也误判为未完成，属于新的回归。

**真正应该检测的信号不是"reply 后面有没有 tool 行"，而是"reply 后面有没有出现新的 assistant 消息还带着 `tool_calls`（即模型确实又发起了新的工具调用，但这条工具调用链最终没有被总结收尾）"。** `tool` 角色的收尾播报行（如 todo_write 的 "✅ 已完成" 快照、知识库命中日志）不代表模型还有未完结的动作，只有 **assistant 自己重新发起 `tool_calls`** 才代表"这轮还没完"。

---

## 1. 修复方案

### FR-1（后端）：`agenticx/studio/session_manager.py` 的 `_messages_last_turn_has_completed_reply`

**改动点**：`agenticx/studio/session_manager.py:73-95`

把"扫到第一条可见 assistant 回复就 return True"，改为：

1. 先扫描整个 tail，记录**最后一条**满足"可见文字 / suggested_questions / `</followups>`"条件的 assistant 消息下标 `last_reply_idx`（不要命中就 return，要跑完整个循环取最后一个）。
2. 若 `last_reply_idx < 0`，返回 `False`（无变化）。
3. 否则，再扫描 `tail[last_reply_idx+1:]`：如果其中存在任意一条 `role == "assistant"` 且 `tool_calls` 字段非空列表的消息，说明这条 reply 只是"开场白"，后面模型确实又发起了新的工具调用，返回 `False`。
4. 否则返回 `True`。

伪代码（可直接照此实现，保持函数签名 `_messages_last_turn_has_completed_reply(messages: List[Dict[str, Any]]) -> bool` 不变）：

```python
def _messages_last_turn_has_completed_reply(messages: List[Dict[str, Any]]) -> bool:
    if not messages:
        return False
    last_user_idx = -1
    for idx, msg in enumerate(messages):
        if str(msg.get("role", "")).strip() == "user":
            last_user_idx = idx
    if last_user_idx < 0:
        return False
    tail = messages[last_user_idx + 1:]

    last_reply_idx = -1
    for idx, msg in enumerate(tail):
        if str(msg.get("role", "")).strip() != "assistant":
            continue
        content = str(msg.get("content", "") or "")
        visible = _visible_assistant_body(content)
        is_reply = bool(visible) and not any(
            marker in visible for marker in _INTERRUPTED_PLACEHOLDER_MARKERS
        )
        raw_sq = msg.get("suggested_questions")
        if isinstance(raw_sq, list) and any(str(x).strip() for x in raw_sq):
            is_reply = True
        if "</followups>" in content.lower():
            is_reply = True
        if is_reply:
            last_reply_idx = idx

    if last_reply_idx < 0:
        return False

    # A visible reply that is only a preamble before the model dispatches
    # further, never-concluded tool calls must NOT count as a completed
    # turn. `tool`-role bookkeeping rows (e.g. todo_write's terminal
    # snapshot) after the reply are fine — only a *new assistant message
    # carrying tool_calls* means the turn kept going past this "reply".
    for msg in tail[last_reply_idx + 1:]:
        if str(msg.get("role", "")).strip() != "assistant":
            continue
        tool_calls = msg.get("tool_calls")
        if isinstance(tool_calls, list) and len(tool_calls) > 0:
            return False

    return True
```

不需要改 `_last_turn_has_terminal_assistant_reply`（`session_manager.py:654-682`，用于 `raw=="running"` 且会话仍在内存活跃态的严格分支）——这条分支本来就只信 `suggested_questions`/`</followups>` 这种强终态信号，语义上更严格，不受本次问题影响，**不在本次改动范围内**。

### FR-2（前端镜像）：`desktop/src/utils/task-stall-policy.ts` 的 `lastTurnHasCompletedAssistantReply`

**改动点**：`desktop/src/utils/task-stall-policy.ts:62-78`

同款逻辑镜像到前端，保持与后端完全对称（文件顶部注释已明确写着"Aligns with backend `SessionManager._last_turn_has_completed_reply`"，必须同步改）：

```ts
export function lastTurnHasCompletedAssistantReply(messages: Message[]): boolean {
  if (!messages.length) return false;
  let lastUserIdx = -1;
  for (let idx = 0; idx < messages.length; idx += 1) {
    if (messages[idx]?.role === "user") lastUserIdx = idx;
  }
  if (lastUserIdx < 0) return false;

  let lastReplyIdx = -1;
  for (let idx = lastUserIdx + 1; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    if (msg.id === "__stream__" || msg.id === "typing-meta") continue;
    const content = assistantBodyText(msg);
    if (!content) continue;
    if (INTERRUPTED_ASSISTANT_PLACEHOLDERS.has(content)) continue;
    lastReplyIdx = idx;
  }
  if (lastReplyIdx < 0) return false;

  // FR-1 mirror: a reply followed by a further assistant message that still
  // carries tool_calls means the turn kept going past this "reply" and was
  // never wrapped up — do not count it as completed.
  for (let idx = lastReplyIdx + 1; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    const toolCalls = (msg.tool_calls as unknown[] | undefined) ?? [];
    if (toolCalls.length > 0) return false;
  }
  return true;
}
```

**下游影响面（确认无需改动）**：
- `shouldTriggerIncompleteEndStall`（`task-stall-policy.ts:349-367`）直接调用本函数，FR-2 修复后它会在本案例里正确返回 `true`（触发"未完成"横幅），**函数本身不用改**。
- `isFutileResume`（同文件 `170-`）内部调用的是独立逻辑，未复用本函数，不受影响。
- `group-tool-messages.ts` 的 `hasAssistantTailAfterToolGroup` / `TurnToolGroupCard` 的"已调用 N 次工具"渲染逻辑**保持不变、不在本次范围内**——它只负责单个工具组自身是否 running/done 的视觉状态，本来就不该承担"整轮任务是否完成"的判断职责，这次修复后 Channel C 的"未完成"横幅会在工具组卡片下方正确出现，两者语义分工更清晰。

### FR-3：新增/修改单元测试

**后端**：在 `tests/` 下新增 `tests/test_smoke_session_turn_completion.py`（新文件，纯函数测试，无需起服务）：

```python
from agenticx.studio.session_manager import _messages_last_turn_has_completed_reply


def test_reply_then_unresolved_tool_calls_is_not_completed():
    """Regression: msg[1b558266] pattern — advisory reply, then new tool_calls
    that never got a wrap-up assistant reply."""
    messages = [
        {"role": "user", "content": "你直接帮我做的了吧"},
        {"role": "assistant", "content": "我建议直接做 B 的增强版"},
        {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "skill_use"}}]},
        {"role": "tool", "content": "OK: activated skill"},
        {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
        {"role": "tool", "content": "exit_code=0 stdout: ..."},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_reply_after_tool_rows_is_completed():
    """Existing-good pattern must keep working: reply arrives after tool
    calls resolve, with a trailing tool bookkeeping row (todo_write summary)."""
    messages = [
        {"role": "user", "content": "继续未完成的任务"},
        {"role": "assistant", "content": "<think>...</think>任务已恢复并完成"},
        {"role": "tool", "content": "[x][x][x][x] (4/4 completed)"},
        {"role": "assistant", "content": "任务已恢复并完成。Skill 已落盘并验证通过。"},
        {"role": "tool", "content": "已完成（4/4）"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_plain_reply_with_trailing_tool_log_is_completed():
    messages = [
        {"role": "user", "content": "查知识库"},
        {"role": "assistant", "content": "费马大定理的核心是：..."},
        {"role": "tool", "content": "hits"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_no_assistant_reply_is_not_completed():
    messages = [{"role": "user", "content": "问题"}]
    assert _messages_last_turn_has_completed_reply(messages) is False
```

**前端**：在既有 `desktop/src/utils/task-stall-policy.test.ts` 的 `describe("lastTurnHasCompletedAssistantReply", ...)` 块（第 175-220 行）内追加两条 `it(...)`（沿用文件顶部 `msg(...)` 工具函数）：

```ts
it("returns false when a reply is followed by a new assistant tool_calls that never got a wrap-up", () => {
  const messages: Message[] = [
    msg({ id: "u1", role: "user", content: "你直接帮我做的了吧" }),
    msg({ id: "a1", role: "assistant", content: "我建议直接做 B 的增强版" }),
    msg({ id: "a2", role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "skill_use", arguments: "{}" } }] } as Partial<Message> & Pick<Message, "id" | "role">),
    msg({ id: "t1", role: "tool", toolName: "skill_use", content: "OK" }),
  ];
  expect(lastTurnHasCompletedAssistantReply(messages)).toBe(false);
});

it("keeps returning true for reply-after-tools with a trailing tool bookkeeping row", () => {
  const messages: Message[] = [
    msg({ id: "u1", role: "user", content: "继续未完成的任务" }),
    msg({ id: "t1", role: "tool", content: "[x][x][x][x] (4/4 completed)" }),
    msg({ id: "a1", role: "assistant", content: "任务已恢复并完成。Skill 已落盘并验证通过。" }),
    msg({ id: "t2", role: "tool", content: "已完成（4/4）" }),
  ];
  expect(lastTurnHasCompletedAssistantReply(messages)).toBe(true);
});
```

> 注：`Message` 类型中 `tool_calls` 字段的确切类型以 `desktop/src/store.ts` 现有定义为准；若类型不允许在 `msg({...})` 字面量里直接传 `tool_calls`，改用 `{ ...msg({...}), tool_calls: [...] } as Message` 组装，不要为了迁就测试改动 `Message` 类型定义（out of scope）。

---

## 2. Acceptance Criteria

- **AC-1**：`pytest tests/test_smoke_session_turn_completion.py -v` 4 条用例全部通过。
- **AC-2**：`cd desktop && npx vitest run src/utils/task-stall-policy.test.ts` 全部通过（含新增 2 条 + 原有全部用例，不允许有测试因本次改动被迫删除或跳过）。
- **AC-3**：人工回归——用本 plan §0.1 的消息序列构造一个本地会话（或直接复用 `1b558266-e8e0-47db-9a89-d2aea0da27e2`，若磁盘文件还在），重启 `agx serve` 后调用 `GET /api/sessions`（带 `x-agx-desktop-token` header），确认该 session 的 `execution_state` 不再被误报为 `idle`（应为 `interrupted`，因为 `scan_interrupted_sessions` 启动扫描会在 completed 判定为 False 时打上 `interrupted`）。
- **AC-4**：Desktop 侧打开该 session（或人工重放等价消息序列），确认 Channel C 停滞检测正确触发，界面出现"未完成"横幅（`stallReason === "incomplete"`）与"立即重试"按钮，而不是静默显示成一切正常。

---

## 3. In scope / Out of scope

**In scope**：
- `agenticx/studio/session_manager.py` 的 `_messages_last_turn_has_completed_reply` 函数体（仅此一处）
- `desktop/src/utils/task-stall-policy.ts` 的 `lastTurnHasCompletedAssistantReply` 函数体（仅此一处）
- 新增/追加对应单元测试

**Out of scope（严禁顺手改动）**：
- `_last_turn_has_terminal_assistant_reply`（`session_manager.py:654-682`）——语义更严格的独立分支，不受本 bug 影响
- `TurnToolGroupCard` / `group-tool-messages.ts` 的工具组渲染逻辑——职责边界清晰（只管单个工具组视觉状态），不应该也承担"整轮是否完成"的判断
- `shouldTriggerIncompleteEndStall` 函数本身、`ChatPane.tsx` 里 Channel C 相关渲染代码——这些是已有的正确基础设施，修完两处判定函数后应该"自动生效"，不需要改
- 任何 subagent/委派完成判定逻辑（`team_manager.py`）——那是另一套独立机制，与本次 bug 所在的"主会话轮次完成判定"是不同的代码路径，已有独立的 `.cursor/plans/2026-07-07-subagent-*.plan.md` 系列在跟踪，不要混在一起改
- 不新增任何 UI 组件或新的横幅样式——复用已有的 `StallRecoveryCard` / "未完成"横幅即可

---

## 4. 风险与回滚

- 该函数是纯函数、无副作用、无 I/O，改动风险低；唯一风险点是"是否会误伤某个我们没枚举到的历史消息模式"，因此 AC-2 要求**跑通全部既有 + 新增前端测试**，不允许为了让新用例通过而删除或放宽任何一条既有断言。
- 若回归发现新的误伤模式，优先在 plan 里补充该模式的复现用例再调整算法分支，不要退回"扫到第一条就 return"的旧逻辑（那就是本次要修的 bug 本身）。
