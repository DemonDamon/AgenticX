# 定时任务运行会话历史可见性

Planned-with: GPT-6
Suggested-Impl-Model: gpt-5.6-luna / max

## 范围与证据

用户报告定时任务触发后没有出现在对话历史/项目历史，并确认是 Near 桌面端。本修复在 origin/main 的独立工作区实施，保留既有交付工作区与运行数据。

本机只读取证：两个定时任务最近执行均成功、各自 sessionId 的 messages.json 存在且含消息；SQLite metadata 的 avatar_id 为 automation:<taskId>，未归档且没有 internal purpose。因此不做消息恢复或修改用户数据。

精确缺陷：desktop/src/utils/sidebar-session-history.ts 的 normalizeSidebarSessionRows 在读取 avatar_id 后直接丢弃 automation:*；desktop/src/hooks/useGlobalSearch.ts 的 fetchConversationHits 同样丢弃该类全局搜索命中；desktop/src/App.tsx 的自动任务事件消费者没有 bumpSessionCatalogRevision。全局列表的上游归一化过滤导致后续对话/项目分桶都拿不到该记录。

## 实施

1. normalizeSidebarSessionRows 保留非归档 automation 行；matchesSidebarAvatarFilter 的 all 返回该行，__meta__ 仍仅返回无 avatar_id 的行，各分身和当前窗格过滤保持严格相等。更新 sidebar-session-history.test.ts 的旧隐藏断言，覆盖已归档仍隐藏、时间排序、全局/Meta/不同任务筛选。
2. resolveSidebarAvatarChipName 为 automation 行显示可读来源，不暴露原始 automation:<id> 占位文字。既有全局历史打开流程必须把 session_id 与 automation avatar_id 一同传入窗格，保持 activeAvatarId 仅供真实数字专家；回看旧运行不得重绑计划任务的最新 sessionId。
3. fetchConversationHits 保留全局搜索中的定时运行，并保留身份和标题供点击定位；不修改 SessionHistoryPanel 的当前窗格隔离语义。用全局搜索行为测试覆盖命中与打开身份。
4. App 自动任务事件在拿到新 sessionId 的 running 和终态时触发 catalog revision，使历史即时刷新；queued 无 sessionId 不构造旧记录，不通过事件伪造持久化。页面重新打开仍从 listSessions 读取已落盘历史。
5. `agenticx/studio/server.py` 的 `/api/projects` 路由存在冷恢复缺陷：`SessionManager._restore_from_disk` 把已保存工作目录还原到 `managed.taskspaces`，路由却只读 `managed.studio_session.taskspaces`，后者直到聊天时才填充。改为优先使用 `managed.taskspaces`，兼容原 `studio_session` 和 cwd fallback，不改变调度和项目定义。`tests/test_studio_server.py` 验证非聊天请求也返回已持久化工作目录；`tests/test_session_manager_persistence.py` 验证 lazy restore 的真实 session 目录与项目元数据。
6. 全局搜索 `GlobalSearchPanel.jumpToConversation` 复用 `findPaneForSidebarSession` 与 `activeAvatarIdForSidebarRow`，优先 session + automation avatar，避免搜索打开同任务旧运行时命中错误窗格。现有交付分支额外拥有 `active_taskspace_id` 项目分类，同步时必须保留此差异和附件锁恢复。

## 验收

- 全局历史显示成功/失败定时运行，且刷新或重开后仍从持久化源返回。
- Meta 专属历史不混入 automation；任务 A 历史不混入任务 B。
- 全局搜索能找到运行，点击正确的旧 session 而非计划任务最新 session；不改变任务配置。
- 自动执行 running/完成事件可触发目录刷新，queued 不制造空历史。
- 运行相关 Vitest 与 Desktop TypeScript 检查；若需要迁移到现有交付工作区，只同步本次精确改动，不覆盖其已有差异。

## 不在范围

不改任务触发频率、模型配置、租户数据、已有消息；不新增独立“定时任务历史”页面，不将专属历史隔离规则应用到全局“全部”列表；不提交/推送/打包发布。

## 本地验收进度

- Desktop 主线定向 Vitest：19 项通过。
- 精确同步至现有运行源码后，原有 Desktop 定向 Vitest：18 项通过，完整 TypeScript 检查通过。
- 实际 Electron 界面已在项目历史显示 3 条已保存定时运行，全局搜索返回两个对应时间的运行；点击 18 天前记录显示对应旧消息和时间。打开历史与搜索期间，任务配置文件 SHA256 未改变。
- 后端冷恢复与兼容回退回归：主线 3 项通过，交付分支 3 项通过；交付测试显式创建工作目录，以保持其“仅可绑定已存在目录”的保护。
