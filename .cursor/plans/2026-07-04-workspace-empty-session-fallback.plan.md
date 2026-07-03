# 工作区面板无活跃会话时空窗修复

Plan-Id: 2026-07-04-workspace-empty-session-fallback
Plan-File: .cursor/plans/2026-07-04-workspace-empty-session-fallback.plan.md
Planned-with: Claude Opus 4.8 (Cursor)

## 背景 / 现象（用户报告，有截图）

打开工作区面板时，若当前 pane **没有活跃 session**（未选历史对话、也未新建对话），工作区一直停在灰色骨架卡片，内容「一直显示不出来」，用户不知原因，误以为是重大 bug。

## 根因（已定位）

`desktop/src/components/WorkspacePanel.tsx`：
- taskspace 列表按 **session 绑定**：`loadTaskspaces()` 依赖 `getBrowseSessionId()`；
- 无 `sessionId` 时，`useEffect`（~422）走 `shouldKeepWorkspaceVisibleWhenSessionMissing` 分支后 `setTaskspaces([])` 并早退 → 停在空态；
- 已有 fallback（~389、~439）会尝试从 `listSessions(paneAvatarId)` 找最近/记住的 session，但：
  - 依赖后端 `listSessions`，冷启动慢时长时间拿不到（与 backend-session-list-perf plan 关联）；
  - 用户处于「显式新建对话（awaiting fresh）」态时按设计不自动回填 → 空窗但无任何说明文案。

这属于上一轮 `2026-07-04-desktop-studio-ready-refetch` plan 中 **FR-4 明确本轮跳过**的部分。

## 目标

无活跃 session 时，工作区面板**要么可靠回退到最近可用 session 的 taskspace，要么给出明确空态文案**（而非无限灰骨架），并在后端 ready 后自愈刷新一次。

## 范围（严格限定，遵守 no-scope-creep）

**改**：
- `desktop/src/components/WorkspacePanel.tsx`：
  - 无 session 且非「显式新建」态时，回退逻辑健壮化（复用现有 `fallbackBrowseSessionIdRef` / `pickMostRecentSessionId`，不新增数据源）；
  - 确无可回退 session 时，用明确空态文案替代永久骨架（如「选择或新建一个对话后显示工作区文件」）；
  - 可选：订阅 `onStudioReady`（已由另一 plan 暴露）在后端 ready 后做一次 `refreshListAndActiveTaskspace`，仅当当前为空时触发。

**不改（明确排除）**：
- 后端 taskspace / session 接口与 `session_manager` 逻辑（性能归 backend-session-list-perf plan）。
- 「显式新建对话」不自动恢复旧 session 的既有语义（避免把新话题误并入旧任务）——仅改「非显式新建但仍空」与「彻底无会话」两种态的呈现。
- 定时任务窗格（本轮不含，另评）。
- taskspace 上限 / 添加逻辑（已在其他改动完成，不动）。

## 需求

### FR-1 无 session 时的回退健壮化
- 非 awaiting-fresh 且无 sessionId 时，可靠尝试回退到 remembered / most-recent session 并加载其 taskspace；
- 回退请求失败或无候选时不 spin，进入 FR-2 空态。

### FR-2 明确空态文案
- 彻底无可用 session（新用户 / 全部为空）时，展示居中说明文案，替代三张空灰卡片骨架；
- 文案中文、简洁，符合项目 UX 语气。

### FR-3（可选）ready 后自愈
- 订阅 `onStudioReady`，仅当工作区当前为空时做一次轻量刷新；卸载反注册；不无条件清空已加载内容。

## 验收标准

- AC-1：无活跃 session 但存在历史会话时，打开工作区能回退加载最近 session 的 taskspace（不再永久空白）。
- AC-2：彻底无会话时显示明确空态文案，而非无限灰骨架。
- AC-3：「显式新建对话」态语义不变，不误恢复旧 session。
- AC-4：后端 ready（含慢冷启动）后工作区在无需手动操作下补出内容（若实现 FR-3）。
- AC-5：`cd desktop && npx tsc --noEmit -p tsconfig.json` 错误数不高于基线；无新增 lint。
- AC-6：改动仅限 `WorkspacePanel.tsx`（若 FR-3 需类型则含 global.d.ts，但 onStudioReady 类型已由上一 plan 补齐）。

## 实施步骤

1. 读透 `WorkspacePanel.tsx` 现有三个无-session effect 的交互，避免相互覆盖。
2. 实施 FR-1 回退健壮化 + FR-2 空态文案。
3. 评估 FR-3（可选）；不做则注明延后。
4. 跑 typecheck（AC-5）+ 手测三种态（有历史/无历史/新建）。

## 提交约定

- trailer 顺序：`Plan-Id` → `Plan-File` → `Plan-Model` → `Impl-Model` → `Made-with: Damon Li`。
- `Plan-Model` / `Impl-Model` 由用户提供，未提供须询问，禁止编造。
- 只 add `desktop/src/components/WorkspacePanel.tsx`（及必要时本 plan 文件）。
