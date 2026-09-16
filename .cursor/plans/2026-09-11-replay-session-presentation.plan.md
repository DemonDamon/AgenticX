# 执行回放：整段会话演示

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: cursor-grok-4.6

Status: implementing

Plan-Id: 2026-09-11-replay-session-presentation

## Goal

回放下拉在「单次 run」之外增加「整段会话」：把该 session 里所有已结束 run 按时间拼成一条账本，点「演示」从第一轮揭到最后一轮。只读，不重跑。

## 根因

现有演示绑在 `selectedRunId` → `openRun` 的单份 ledger。同一 session 两轮（如 08:25:57 / 08:28:33）只能各播一次；选后一轮时前一轮当前情整段露出，选前一轮则后一轮整段藏住。

## 方案

合并账本，不串行切 run（避免 `openRun` 把 `presenting` 清掉导致左边闪回全文）。

1. `presentableSessionRuns`：状态 ∈ completed/failed/cancelled/interrupted，按 `createdAt` 升序；`< 2` 不显示该项。
2. 选中后拉齐各 run 全部分页事件，`seq` 按「上一 run 的 max seq」做偏移后拼接；`eventId` / `runId` 不改。
3. store 写入一份合成 `ReplayRun`（`runId = __session__`，`status = completed`），之后 `enterPresentation` / 聊天切片沿用现逻辑。
4. 整段会话下禁用从步骤分支（合成 run 不能当 source）；复制回顾给出明确不可用提示。

## Exact files

- Create: `desktop/src/components/replay/replay-session-play.ts`
- Create: `desktop/src/components/replay/replay-session-play.test.ts`
- Modify: `desktop/src/components/replay/replay-api.ts`（`listAllReplayEvents`）
- Modify: `desktop/src/components/replay/replay-store.ts`（`openSession`）
- Modify: `desktop/src/components/replay/ReplaySummaryBar.tsx`
- Modify: `desktop/src/components/replay/RunReplayPanel.tsx`
- Modify: `desktop/locales/{zh,en}/workspace.json`
- Modify: `docs/plans/2026-09-11-replay-chat-presentation-design.md`（补一句）

## In scope

- 下拉「整段会话」+ 演示整段揭开
- 进行中的 run 不进入拼接；仅拼接已结束 run
- 汇整期间演示按钮不可用

## Out of scope

- 不改 ledger / `server.py`
- 不改 ChatPane 切片公式（仍读 store.events）
- 不把整段会话当成可分支 source
- 不自动默认选中整段会话（默认仍是最新单次 run）

## AC

- AC-1: 两次 completed run 的事件 `seq` 1..N 与 1..M 合并后为单调递增，第二 run 的首条 `seq = N + 1`。
- AC-2: `bindMessagesToRun` + `sliceMessagesForPresentation` 在合并账本上先揭第一轮用户句，游标过第二轮 `user_message` 后才出现第二轮用户句。
- AC-3: `ReplaySummaryBar` 在 `runs.length >= 2` 且至少 2 条可演示时出现「整段会话」选项。
- AC-4: `openSession` 后 `enterPresentation` 成功；`run.status === running` 的 run 不进入 `presentableSessionRuns`。
- AC-5: run 列表每 2s 刷新时，若当前选中 `__session__` 且仍可提供整段会话，必须保留，不得回落到 `preferredReplayRun`（最新 completed）。否则下拉会在未点演示时自行跳到最后一次 run，演示也只揭最后一轮。
