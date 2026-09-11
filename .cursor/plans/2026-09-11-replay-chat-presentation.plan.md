# 执行回放：聊天区演示播放

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: cursor-grok-4.6

Status: implementing

Plan-Id: 2026-09-11-replay-chat-presentation

设计原文：`docs/plans/2026-09-11-replay-chat-presentation-design.md`

## Goal

售前对已结束的长任务点「演示」，现有聊天区按节拍揭开气泡；调试回放（点选、因果链、时间轴播放）左边不动。只读，不重跑模型或工具。

## Exact files

- Create: `desktop/src/components/replay/replay-presentation.ts`
- Create: `desktop/src/components/replay/replay-presentation.test.ts`
- Modify: `desktop/src/components/replay/replay-store.ts`（`presenting`、`enterPresentation` / `exitPresentation`、演示节拍调度）
- Modify: `desktop/src/components/replay/ReplayControls.tsx`
- Modify: `desktop/src/components/replay/RunReplayPanel.tsx`
- Modify: `desktop/src/components/ChatPane.tsx`（仅 `renderMessages` 切片、输入锁、演示条）
- Modify: `desktop/locales/{zh,en}/workspace.json`

## In scope / Out of scope

见设计稿。不改 ledger / `server.py`、不改因果链、不改 `pane.messages`。
