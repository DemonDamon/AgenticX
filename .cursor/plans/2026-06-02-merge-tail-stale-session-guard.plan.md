---
name: merge-tail-stale-session-guard
overview: 修复「频繁切换并发 session 后，已完成 session 的对话在内存中被截断/丢失，必须重启从磁盘重载才恢复完整」的竞态。根因是 mergeTailFromDisk 在 await 磁盘加载后未重新校验 pane 当前显示的仍是同一 session，导致后台为旧 session 发起的磁盘合并把数据写到了已切换到的新 session 的 pane.messages 上。修复方式是补上 poll 路径早已有、mergeTailFromDisk 却缺失的「session 仍然一致」守卫。
todos:
  - id: guard-merge-tail
    content: mergeTailFromDisk 在 await loadSessionMessages 后用 store 实时 pane.sessionId 重新校验，与传入 sid 不一致则放弃 setPaneMessages（对齐 poll 已有守卫）
    status: completed
  - id: verify
    content: 改动文件无 lint/类型错误；现有 vitest 仍通过
    status: completed
isProject: false
---

# mergeTailFromDisk 跨 session 覆盖修复

## 背景与现象

并发两个 session（同一 `ChatPane` 经历史面板切换显示）。频繁切换后，已结束 session A 的对话在 UI 中显示不完整（部分消息「丢失」），但**重启应用后又完整显示**。

→ 磁盘 `messages.json` 完好，是内存 `pane.messages` 在切换过程中被错误覆盖/截断。

## 根因（已 trace）

`desktop/src/components/ChatPane.tsx` `mergeTailFromDisk(sid)`（:4227）：

```
const msgs = await window.agenticxDesktop.loadSessionMessages(sid); // 异步
const current = ...panes.find(p => p.id === pane.id)?.messages ?? [];
const merged = mergeSessionMessagesTail(current, msgs.messages, sid);
setPaneMessages(pane.id, merged);   // ← 无「pane 仍显示 sid」守卫
```

后台多处会以**某个 sid** 调用它：stall `evaluate`（:4517/:4539）、`syncBackgroundRun`（:4376/:4398）、session 进入 effect（:4367）、`reattachLiveStream` finally（:4317）。这些 effect 在 `pane.sessionId` 变化时清理（`cancelled=true` / clearInterval），但**已经 in-flight 的 `await loadSessionMessages(oldSid)` 会在切换之后才 resolve**，此时：

1. `current` 读到的是**新 session（A）**的内存消息；
2. `mergeSessionMessagesTail(A 的消息, 旧 session B 的磁盘消息, "B")` 产生错乱结果；
3. `setPaneMessages(pane.id, merged)` 把错乱结果写回 pane → A 被截断/污染。

`poll`（:2519-2522）早已针对同一类竞态加了守卫并注释「Never overwrite the new session's pane with messages from the previous session」，但 `mergeTailFromDisk` 漏了同样的守卫。这就是「频繁切换→丢消息→重启才恢复」的根因。

## 修复方案

### FR-1 mergeTailFromDisk 增加 stale-session 守卫（`desktop/src/components/ChatPane.tsx`）

- 在 `await loadSessionMessages(sid)` 之后、读取/合并/写入之前，用 store **实时** pane.sessionId 重新校验：
  ```
  const latestSid = String(
    useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? ""
  ).trim();
  if (latestSid !== sid) return false;
  ```
  （不依赖闭包里的 `pane.sessionId`，因为 useCallback 依赖未含它会过期。）
- 不一致即 `return false`，不触碰 `setPaneMessages` / `recordProgressActivity`。
- 与 `poll` 守卫语义完全一致，属于补齐遗漏，不引入新机制。

## 验收

- AC-1：A 已结束，反复在 A / 仍运行的 B 之间快速切换多次，A 的对话保持完整，不再出现「切回后变少、重启才恢复」。
- AC-2：正常单 session 的后台续看 / 完成后 `mergeTailFromDisk` 仍能正常把磁盘尾部并入当前显示 session（latestSid === sid 时行为不变）。

## 范围与排除

- 仅在 `mergeTailFromDisk` 内补一处与 `poll` 同款的守卫；不动 `mergeSessionMessagesTail` 算法、不动 SSE reader、不动 `ChatView`（Lite）。
- 不改并发 SSE 的单一 `streamTextRef`/`streamCommittedRef` 设计（更大改动，若 AC 验证后仍有残留再单独评估）。
