---
id: 2026-04-02-desktop-session-token-persistence
title: 修复 Desktop 重启后会话 token 显示归零
status: completed
owner: Damon Li
created: 2026-04-02
---

## 背景

Desktop 聊天输入区上方 token 指标在切换会话或应用重启后经常回到 `0 tokens`，与用户已看到的会话累计不一致。

## 需求

- FR-1: 会话 token 累计按 `sessionId` 维度持久化，切回同一会话可恢复。
- FR-2: 工作区快照需包含 pane 的 `sessionTokens`，重启恢复时不能丢失。
- FR-3: 会话绑定更新时避免无缓存场景误清零已有 pane token。

## 验收标准

- AC-1: 同一 `sessionId` 在切换 pane / 切换 session 后 token 显示可恢复。
- AC-2: 完全退出并重启 Desktop 后，已记录过的会话 token 不再回到 0。
- AC-3: `desktop` 构建通过。

## 实施结果

- `desktop/src/store.ts`
  - 新增 `agx-session-token-cache-v1` 本地缓存；
  - 在 `accumulatePaneTokens` 中同步写入 `sessionId -> token`；
  - 在 `setPaneSessionId` 中优先恢复缓存，并对同 session 切换做不清零保护。
- `desktop/src/App.tsx`
  - 扩展工作区快照 `PersistedPaneState`，纳入 `sessionTokens`；
  - 启动恢复时回填 pane token；
  - 保存工作区快照时持久化 `sessionTokens`。
- 验证：`npm run build`（desktop）通过。
