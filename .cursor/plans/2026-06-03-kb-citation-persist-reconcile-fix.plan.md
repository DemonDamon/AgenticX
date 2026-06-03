# KB 角标流式→落盘丢失修复

## 问题

- 流式阶段可见 `[N]`，结束后角标与 ima 式 pill 均消失。
- MiniMax M3 / Qwen-plus 使用 `①②` 而非 `[1][2]`，即使有 references 也无法渲染 `CitationBadge`。
- `reconcileDisplayedSessionFromDisk` 在 persist 竞态下用无 `references` 的磁盘行整表覆盖内存。

## 根因

1. `CitationMarkdownBody` 在 `!hasReferences && !isStreaming` 时 `stripOrphanCitationMarkers` 剥掉 `[N]`。
2. 回合结束时常 `message.references` 为空（SSE `structured` 未解析 / 未并入最后 assistant / 磁盘 reconcile 覆盖）。

## 修复

- `accumulateReferenceTurn`：`structured` 缺失时从 `knowledge_search` 的 `result` JSON 解析 hits（客户端兜底）。
- `ChatPane` / `ChatView`：`final` 后同步 `streamReferences`；`finally` 再 `mergeLastPaneMessageByRole` 附着 references。
- `reconcileDisplayedSessionFromDisk`：`enrichDiskMessagesWithInMemoryReferences` 保留内存 references。
- `citation-normalize`：`①②` → `[1][2]`。

## 验收

- [ ] 知识库检索回复落盘后仍有绿色角标 pill + `ReferencesCard`
- [ ] 点击角标弹出摘录 Popover
- [ ] 流式与落盘一致，不因 reconcile 丢失 references

Plan-Id: 2026-06-03-kb-citation-persist-reconcile-fix
