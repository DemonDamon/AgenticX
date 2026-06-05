---
name: session-switch-send-lock-and-disk-reconcile
overview: 修复多 session 切换时 followup/重复发送把 B 会话 query 写入 A 会话（磁盘污染 + UI 重复），并加强切换后从磁盘 authoritative reconcile。
todos:
  - id: p0-send-dedupe
    content: 新增 send-dedupe 工具 + 测试；sendChat 2s 内同 session 同文案去重
    status: completed
  - id: p0-followup-owner-lock
    content: followup chip 携带 ownerSessionId，与 pane.sessionId 不一致则拒绝发送
    status: completed
  - id: p0-set-pane-messages-stamp
    content: setPaneMessages 为未打 owner 的行补 stamp，渲染层严格过滤
    status: completed
  - id: p0-bootstrap-stream-ref
    content: bootstrap 用 sessionStreamStateRef 判定是否在流式；流式结束后 mergeTail + 失效 tail cache
    status: completed
  - id: tests
    content: vitest 绿 + 改动文件 lint 干净
    status: completed
isProject: false
---

# Session 切换发送锁定与磁盘 reconcile（P0）

**Plan-Id**: 2026-06-05-session-switch-send-lock-and-disk-reconcile
**Plan-File**: `.cursor/plans/2026-06-05-session-switch-send-lock-and-disk-reconcile.plan.md`

## 现象

- `8b643ae6` 的 `messages.json` 混入本属 `c247a865` 的 Ongrid/SPO query，且同文案多次落盘（index 17–23）。
- 切换 session 后 UI 展示与磁盘一致地错乱/重复，非纯渲染 ghost。

## 根因

1. **Followup chip / 快速连点**：`sendFollowupChip` 未校验 chip 所属 session，切换窗口期可能向当前 pane 绑定的 session 重复 POST。
2. **无发送去重**：2s 内相同 user_input 多次 `/api/chat` → 磁盘重复 user 行。
3. **Bootstrap 误用 `streamingSessionId` React 态**：后台流结束后面板仍可能跳过磁盘 authoritative 加载。
4. **未打 owner 的历史行**：`messageBelongsToSession` 对 legacy 无 tag 行一律展示，切换时短暂串显。

## 修复

- `send-dedupe.ts` + sendChat 接入
- followup 传 `ownerSessionId`，与 pane 不一致则 warn + return
- `setPaneMessages` 补 owner stamp；`messageBelongsToSession` 有 sid 时无 owner 不展示
- bootstrap 改读 `sessionStreamStateRef`；send finally `mergeTailFromDisk` + `invalidateSessionTail`

Made-with: Damon Li
